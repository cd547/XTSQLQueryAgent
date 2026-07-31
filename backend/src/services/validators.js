/**
 * validate_sql_fields 工具的 4 类校验器 + 主入口
 *
 * 设计：4 个验证器放在单文件，未来如某个 > 200 行再单独拆出到 validators/r1.js 等。
 *
 * 4 类规则：
 * - R1 字段-表归属（防幻觉核心）：extractColumnRefs + buildAliasMap + loadColumnsMap
 * - R2 字段别名反引号：纯 regex（non-greedy + lookahead 避免吃掉后续 SQL 关键字）
 * - R3 MySQL 5.7 限制（CTE / 窗口函数 / JSON_TABLE）：parser 顺带
 * - R5 LIMIT 子句：regex（不用 AST 避免子查询 LIMIT 误判）
 *
 * 核心约束：
 * - 工具只"报错"（errors[]），不"开方"（无 suggestion 字段）
 * - 工具无 warnings 数组（所有不通过都进 errors）
 * - 工具不参与路由层（仅服务于 LLM 流）
 *
 * 错误格式：
 *   {
 *     rule: 'R1_FIELD_OWNERSHIP',         // 规则码
 *     message: '...',                      // 具体问题描述
 *     sqlSnippet: '...',                   // 出错的 SQL 片段
 *     type?: 'CTE' | 'WINDOW_FUNCTION' | 'JSON_TABLE'  // R3 子分类
 *   }
 */

import {
  parseSql,
  extractColumnRefs,
  extractTables,
  buildAliasMap,
  extractDerivedTableColumns,
  hasCte,
  hasWindowFunction,
  hasJsonTable,
  hasLimitClause,
} from './sqlParser.js';
import { loadColumnsMap } from './ddlUtils.js';
import { getTableDDL } from './toolFuncs.js';


// =================================================================
//  R1: 字段-表归属校验（防幻觉核心）
// =================================================================

/**
 * R1 字段-表归属校验
 *
 * 核心逻辑：
 * 1. 解析 SQL 中所有 column ref（带 table.column 形式）
 * 2. 通过 aliasMap 把 alias 映射到 real table（兼容 parser 已解析的情况）
 * 3. 对每张表的 DDL 联合 field_aliases 校验字段是否存在
 * 4. DDL 不存在 → 显式 error 'DDL 不存在'（拒绝校验，避免空 Set 误报）
 * 5. 字段不在 DDL → error '疑似幻觉'
 * 6. 跳过无表别名前缀的字段（如 `SELECT id FROM t`）
 *
 * @param {object} ctx - {sql, tables, columnsMap, missingDdl}
 * @returns {Promise<Array<{rule, message, sqlSnippet}>>}
 */
export async function validateR1FieldOwnership(ctx) {
  const errors = [];
  const { sql, tables, columnsMap, missingDdl } = ctx;

  // 1. DDL 缺失：拒绝校验（避免空 Set 误报"所有字段都是幻觉"）
  if (missingDdl && missingDdl.length > 0) {
    errors.push({
      rule: 'R1_FIELD_OWNERSHIP',
      message: `表 ${missingDdl.join(', ')} 的 DDL 不存在（无法校验字段-表归属）`,
      sqlSnippet: missingDdl.join(', '),
    });
    return errors;
  }

  // 2. 解析 SQL 提取所有字段引用
  const aliasMap = buildAliasMap(sql);
  const columnRefs = extractColumnRefs(sql);

  // 3. 逐个字段校验
  for (const ref of columnRefs) {
    // 跳过无表别名前缀的字段（如 `SELECT id FROM t`）
    // 原因：单表场景下 R1 较难精确归属
    if (!ref.table) continue;

    // ★ 2026-07-30：处理 derived table 别名（修复 JOIN/FROM 子查询误报"未知别名"）
    //   - aliasMap.get(alias) 返回 string  → 普通物理表别名
    //   - aliasMap.get(alias) 返回 {isDerived:true} → 子查询别名
    //   - aliasMap.get(alias) 返回 undefined → 未登记（真未知）
    const aliasValue = aliasMap.get(ref.table);
    let resolvedTable;
    if (typeof aliasValue === 'string') {
      resolvedTable = aliasValue;
    } else if (aliasValue && aliasValue.isDerived) {
      // 子查询别名走虚拟表 `__DERIVED__<alias>`（由主入口预先注入 columnsMap）
      resolvedTable = `__DERIVED__${ref.table}`;
    } else {
      resolvedTable = ref.table;
    }

    const tableColumns = columnsMap.get(resolvedTable);

    // 表不在 columnsMap 中（极端情况：parser 抽出的 table 未在 SQL 引用列表中，
    //   或 derived table 未被主入口正确注入虚拟表）
    if (!tableColumns) {
      errors.push({
        rule: 'R1_FIELD_OWNERSHIP',
        message: `未知别名: ${ref.table}`,
        sqlSnippet: `${ref.table}.${ref.column}`,
      });
      continue;
    }

    // 字段不在 DDL + field_aliases 中 → 疑似幻觉
    if (!tableColumns.has(ref.column)) {
      errors.push({
        rule: 'R1_FIELD_OWNERSHIP',
        message: `字段 ${ref.table}.${ref.column} 不在表 ${resolvedTable} 的 DDL 中（疑似幻觉）`,
        sqlSnippet: `${ref.table}.${ref.column}`,
      });
    }
  }
  return errors;
}


// =================================================================
//  R2: 字段别名反引号（纯 regex）
// =================================================================

/**
 * R2 字段别名反引号
 *
 * 触发：AS <别名> 中别名含特殊字符但未用反引号包裹
 * 特殊字符：括号 / 空格 / 中文（与 plan 4.2.1 一致；纯中文也报）
 *
 * 已用 ``..`` / ''..'' / ".." 包裹的别名 → 跳过
 *
 * 实现：non-greedy + lookahead 避免 alias 吃掉后续 SQL 关键字
 *
 * @param {object} ctx - {sql}
 * @returns {Array<{rule, message, sqlSnippet}>}
 */
export function validateR2BacktickAlias(ctx) {
  const errors = [];
  const { sql } = ctx;

  // plan 4.2.1: 特殊字符 = 括号 / 空格 / 中文
  const SPECIAL_CHARS = /[\(\)\s\u4e00-\u9fff]/;

  // 匹配 AS <别名>，4 种形式
  //   已包裹：`..` / '..' / ".."
  //   未包裹：non-greedy 直到下一个 SQL 关键字（FROM/WHERE/...）或逗号
  // case-insensitive (`i`): 兼容 `as` / `AS` 两种写法
  const aliasPattern = /\bAS\s+(?:`[^`]+`|'[^']+'|"[^"]+"|([^,\n]+?))(?=\s*(?:,|FROM\b|WHERE\b|GROUP\b|ORDER\b|LIMIT\b|HAVING\b|UNION\b|INTERSECT\b|EXCEPT\b|;|$))/gi;

  for (const match of sql.matchAll(aliasPattern)) {
    const raw = match[1];
    // 已用反引号/单引号/双引号包裹 → 跳过
    if (!raw) continue;

    if (SPECIAL_CHARS.test(raw)) {
      errors.push({
        rule: 'R2_BACKTICK_ALIAS',
        message: `字段别名「${raw.trim()}」含特殊字符但未用反引号包裹`,
        sqlSnippet: `AS ${raw.trim()}`,
      });
    }
  }
  return errors;
}


// =================================================================
//  R3: MySQL 5.7 限制检测
// =================================================================

/**
 * R3 MySQL 5.7 限制检测
 *
 * 触发：CTE（WITH）/ 窗口函数（OVER）/ JSON_TABLE
 *
 * 注意：
 *   - CTE/窗口函数：parser 能解析为 AST，AST 检测
 *   - JSON_TABLE：parser 直接抛错（5.7 语法不支持），由主入口 PARSE_ERROR 兜底
 *   - hasJsonTable 检测主要是为 MySQL 8.0 升级后兜底
 *
 * @param {object} ctx - {ast, parseOk}
 * @returns {Array<{rule, message, sqlSnippet, type?}>}
 */
export function validateR3Mysql57Limits(ctx) {
  const errors = [];
  const { ast, parseOk } = ctx;

  // parse 失败时（JSON_TABLE 等），跳过 AST 检测，统一由主入口 PARSE_ERROR 报错
  if (!parseOk) return errors;

  // 1. CTE 检测
  if (hasCte(ast)) {
    errors.push({
      rule: 'R3_MYSQL57_LIMIT',
      type: 'CTE',
      sqlSnippet: 'WITH ... AS (...)',
      message: 'MySQL 5.7 不支持 CTE（WITH ... AS）',
    });
  }

  // 2. 窗口函数检测
  if (hasWindowFunction(ast)) {
    errors.push({
      rule: 'R3_MYSQL57_LIMIT',
      type: 'WINDOW_FUNCTION',
      sqlSnippet: '... OVER (...)',
      message: 'MySQL 5.7 不支持窗口函数 ... OVER (...)',
    });
  }

  // 3. JSON_TABLE 检测（主要兜底 8.0）
  if (hasJsonTable(ast)) {
    errors.push({
      rule: 'R3_MYSQL57_LIMIT',
      type: 'JSON_TABLE',
      sqlSnippet: 'JSON_TABLE(...)',
      message: 'MySQL 5.7 不支持 JSON_TABLE()',
    });
  }

  return errors;
}


// =================================================================
//  R5: LIMIT 子句检测
// =================================================================

/**
 * R5 LIMIT 子句检测
 *
 * 触发：SELECT 语句无 LIMIT 子句
 *
 * 实现：regex (hasLimitClause) 而非 AST
 *   原因：AST 检查 `ast.limit` 无法处理「子查询含 LIMIT 但外层无 LIMIT」的情况
 *   regex 简单匹配 LIMIT 关键字，子查询的 LIMIT 也算"有 LIMIT"（不报外层 R5）
 *
 * @param {object} ctx - {sql, ast}
 * @returns {Array<{rule, message, sqlSnippet}>}
 */
export function validateR5LimitClause(ctx) {
  const errors = [];
  const { sql, ast } = ctx;

  // 只检查 SELECT（含 UNION，AST type 也是 'select'）
  if (!ast || ast.type !== 'select') return errors;

  if (!hasLimitClause(sql)) {
    errors.push({
      rule: 'R5_MISSING_LIMIT',
      message: 'SELECT 语句无 LIMIT 子句',
      sqlSnippet: '(末尾)',
    });
  }
  return errors;
}


// =================================================================
//  主入口（编排 + 共享 ctx）
// =================================================================

/**
 * 主入口：编排 4 类校验，返回结构化结果
 *
 * 流程：
 * 1. parse SQL → 失败则立即返回 PARSE_ERROR
 * 2. 提取 tables → loadColumnsMap
 * 3. 检测 missingDdl
 * 4. 跑 4 个验证器（R1 异步，其他同步）
 * 5. 汇总 errors
 *
 * @param {{sql: string}} input
 * @returns {Promise<{valid: boolean, errors: Array, summary: string}>}
 */
export async function validateSqlFields({ sql }) {
  // 1. parse SQL
  const parseResult = parseSql(sql);
  if (!parseResult.ok) {
    return {
      valid: false,
      errors: [
        {
          rule: 'PARSE_ERROR',
          message: `SQL 解析失败: ${parseResult.error}`,
          sqlSnippet: sql.slice(0, 80),
        },
      ],
      summary: '1 error',
    };
  }
  const ast = parseResult.ast;

  // 2. 提取表名
  const tables = extractTables(sql);

  // 3. 加载列映射 + 检测 DDL 缺失
  //    注：loadColumnsMap 内部已调用 getTableDDL，这里再调用一次用于检测 missing
  //    文件读是 cache-friendly（fs 缓存），性能可接受；未来如成为瓶颈可优化
  let columnsMap = new Map();
  let missingDdl = [];
  if (tables.length > 0) {
    const ddlBlocks = await getTableDDL(tables, { short: true });
    missingDdl = tables.filter(t => ddlBlocks.includes(`-- 表 ${t} 的DDL不存在`));
    columnsMap = await loadColumnsMap(tables);
  }

  // ★ 2026-07-30：子查询（derived table）虚拟表注入
  //   - 解析所有 (SELECT ...) t_sub 形式的子查询，收集 t_sub 的输出列
  //   - 注入到 columnsMap：`__DERIVED__t_sub` → Set<输出列>
  //   - 配合 buildAliasMap 的 `{isDerived:true}` 标记，让 R1 校验能基于
  //     子查询实际 SELECT 列表判断 `t_sub.col` 是否合法
  const derivedColumns = extractDerivedTableColumns(sql);
  for (const [alias, cols] of derivedColumns) {
    columnsMap.set(`__DERIVED__${alias}`, cols);
  }

  // 4. 共享 ctx
  const ctx = {
    sql,
    ast,
    tables,
    columnsMap,
    missingDdl,
    parseOk: true,
  };

  // 5. 跑所有验证器
  const errors = [
    ...(await validateR1FieldOwnership(ctx)),
    ...validateR2BacktickAlias(ctx),
    ...validateR3Mysql57Limits(ctx),
    ...validateR5LimitClause(ctx),
  ];

  return {
    valid: errors.length === 0,
    errors,
    summary: `${errors.length} error${errors.length === 1 ? '' : 's'}`,
  };
}

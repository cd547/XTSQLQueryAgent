/**
 * SQL 解析器封装
 *
 * 封装 `node-sql-parser`，提供：
 * 1. AST 解析（try-catch 包裹，parse 失败返回结果而非抛错）
 * 2. 表名提取（解析 `select::null::table` 格式）
 * 3. 列引用提取（解析 `select::table::column` 格式 + 别名解析）
 * 4. AST 共享工具（detectCte / detectWindowFunc / detectJsonTable）
 *
 * 设计原则：
 * - **不抛错**给 LLM：parse 失败时返回 {ok: false, error: '...'}，让 LLM 重写
 * - **共享 ctx**：validateSqlFields 一次 parse，全规则复用
 * - **MySQL 5.7 方言**：database: 'mysql'
 *
 * 关键发现（来自 smoke test）：
 * - AST 检测 CTE 用 `ast.cte`（不是 `ast.with`）
 * - AST 检测窗口函数：JSON 字符串中含 `"over"`
 * - `columnList` 自动排除字符串字面量里的伪字段
 * - 特殊别名（中文+括号）parser 会挂 → 必有 try-catch
 */

import pkg from 'node-sql-parser';

const { Parser } = pkg;
const _parser = new Parser();

/**
 * 解析 SQL 为 AST
 *
 * @param {string} sql - SQL 语句
 * @returns {{ok: true, ast: object} | {ok: false, error: string}}
 */
export function parseSql(sql) {
  try {
    const ast = _parser.astify(sql, { database: 'mysql' });
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 提取 SQL 中引用的表名（去重）
 *
 * @param {string} sql - SQL 语句
 * @returns {string[]} - 表名列表（如 ['edu_teacher', 'admin_user']）
 */
export function extractTables(sql) {
  try {
    const rawList = _parser.tableList(sql, { database: 'mysql' });
    // 格式：'select::null::table' → 提取最后一段
    const tables = new Set();
    for (const raw of rawList) {
      const parts = raw.split('::');
      const tableName = parts[parts.length - 1];
      if (tableName) tables.add(tableName);
    }
    return [...tables];
  } catch {
    return [];
  }
}

/**
 * 提取 SQL 中所有列引用（含 table.column 形式）
 *
 * 自动排除：
 * - 字符串字面量里的伪字段
 * - 注释里的字段
 *
 * @param {string} sql - SQL 语句
 * @returns {Array<{table: string|null, column: string}>} - 列引用列表
 */
export function extractColumnRefs(sql) {
  try {
    const rawList = _parser.columnList(sql, { database: 'mysql' });
    const refs = [];
    for (const raw of rawList) {
      // 格式：'select::table::column' 或 'select::null::column'
      const parts = raw.split('::');
      if (parts.length < 3) continue;
      const table = parts[1] === 'null' ? null : parts[1];
      const column = parts.slice(2).join('::'); // 兼容含 :: 的列名（罕见）
      // 过滤掉无效列（如 '(.*)' 这种 parser 内部占位符）
      if (!column || column.startsWith('(')) continue;
      refs.push({ table, column });
    }
    return refs;
  } catch {
    return [];
  }
}

/**
 * 递归遍历 AST 检测是否含窗口函数（含非空 `over` 属性的 function call）
 *
 * 关键发现：node-sql-parser 给**所有** function call 节点都预置 `over: null` 字段
 *   即使没写 `OVER (...)`，AST 里也会有 `"over": null`
 *   错误写法：`'over' in ast` → 会把 CURDATE() / DATE() 等普通函数全误判为窗口函数
 *   正确写法：`ast.type === 'function' && ast.over` → 必须有非空 over 子句
 *
 * @param {object} ast - AST 对象
 * @returns {boolean}
 */
export function hasWindowFunction(ast) {
  if (!ast || typeof ast !== 'object') return false;
  if (Array.isArray(ast)) {
    return ast.some(hasWindowFunction);
  }
  // 节点是 function call 且 over 子句存在（非 null）→ 窗口函数
  if (ast.type === 'function' && ast.over) return true;
  // 递归所有字段
  for (const key of Object.keys(ast)) {
    if (hasWindowFunction(ast[key])) return true;
  }
  return false;
}

/**
 * 检测是否含 JSON_TABLE 函数调用
 *
 * 注意：MySQL 5.7 不支持 JSON_TABLE，且 node-sql-parser 也无法解析
 * （5.7 SQL 经 parser 必抛错）——所以这个检测主要是为 MySQL 8.0 升级后兜底
 *
 * @param {object} ast - AST 对象
 * @returns {boolean}
 */
export function hasJsonTable(ast) {
  if (!ast || typeof ast !== 'object') return false;
  if (Array.isArray(ast)) {
    return ast.some(hasJsonTable);
  }
  // 节点是 function call 且 name === 'json_table'
  if (ast.type === 'function' && typeof ast.name === 'string'
      && ast.name.toLowerCase() === 'json_table') {
    return true;
  }
  for (const key of Object.keys(ast)) {
    if (hasJsonTable(ast[key])) return true;
  }
  return false;
}

/**
 * 检测是否含 CTE（WITH ... AS ...）
 *
 * 关键发现（node-sql-parser 行为）：
 * 1. **带 `;` 或多条 SQL** → parser 返回 Array 包装
 *    Array 顶层有 `with`（即 Array.prototype.with 方法），是 Function 类型
 *    旧实现 `ast.with` 命中此内置方法 → 误报所有带分号的 UPDATE/SELECT
 * 2. **真实 CTE** → `ast.with` 是数组 `[{name, stmt, columns}, ...]`（CTE 定义列表）
 * 3. **无 CTE** → `ast.with === null`
 * 4. `ast.cte` 顶层无（仅 `ast.with.cte` 这种判据是错的，MySQL parser 不这么放）
 *
 * 正确判断：递归处理 Array，且 `with` 必须是包含 CTE 定义的数组（非 null、非 function）
 *
 * @param {object} ast - AST 对象（可能是 Array）
 * @returns {boolean}
 */
export function hasCte(ast) {
  if (!ast) return false;
  // 多语句 / 带分号：parser 返回 Array，每条都需检查
  if (Array.isArray(ast)) {
    return ast.some(hasCte);
  }
  if (typeof ast !== 'object') return false;
  // 排除 Array.prototype.with 等内置方法（带分号 UPDATE 被误报 CTE 的同款 bug）
  if (typeof ast.with === 'function') return false;
  // 真实 CTE：ast.with 是数组（CTE 定义列表）；null 表示无 CTE
  if (Array.isArray(ast.with) && ast.with.length > 0) {
    return true;
  }
  return false;
}

/**
 * SQL 中是否含 LIMIT 子句（regex 简单检测）
 *
 * 不依赖 parser，因为：
 * 1. parser 对复杂 LIMIT 表达式可能解析失败
 * 2. LIMIT 是 SQL 末尾的简单子句，regex 准确率高
 *
 * @param {string} sql - 原始 SQL
 * @returns {boolean}
 */
export function hasLimitClause(sql) {
  // 匹配 LIMIT 关键字（后跟数字 / OFFSET / 变量）
  return /\bLIMIT\s+(?:\d+|@[\w_]+|\([^)]+\))/i.test(sql);
}

/**
 * 解析 SQL 中的表别名映射（alias → table 或 {isDerived:true}）
 *
 * 支持：
 * - `FROM table t` → {t: 'table'}
 * - `FROM table AS t` → {t: 'table'}
 * - `FROM schema.table t` → {t: 'table'}
 * - `FROM (subquery) t_sub` → {t_sub: {isDerived: true}}        ★ 2026-07-30：null 改对象
 * - `JOIN table t` → {t: 'table'}
 * - `JOIN (subquery) t_sub` → {t_sub: {isDerived: true}}         ★ 2026-07-30：修复 JOIN 子查询盲区
 *
 * 子查询（derived table）的别名不映射到物理表，而是用 `{isDerived: true}` 标记。
 * 调用方在 `validateSqlFields` 主入口里会用 `__DERIVED__<alias>` 虚拟表键名，
 * 配合 `extractDerivedTableColumns` 收集到的输出列做 R1 校验。
 *
 * @param {string} sql - SQL 语句
 * @returns {Map<string, string | {isDerived: true}>} - alias → 物理表名 / 子查询标记
 */
export function buildAliasMap(sql) {
  const map = new Map();
  try {
    const { ast } = parseSql(sql) || {};
    if (!ast) return map;
    walkFromClauses(ast, (fromItem) => {
      if (!fromItem) return;
      const table = fromItem.table;
      const alias = fromItem.as;
      // FROM 项：物理表 / 子查询分支
      if (table && alias && alias !== table) {
        map.set(alias, table);
      }
      if (fromItem.expr && fromItem.as) {
        // ★ 子查询（derived table）别名登记为 {isDerived:true}
        map.set(fromItem.as, { isDerived: true });
      }
      // JOIN
      if (fromItem.join) {
        for (const join of fromItem.join) {
          if (join.table && join.as) {
            map.set(join.as, join.table);
          }
          // ★ 修复：JOIN 子查询原代码完全漏掉，会导致 R1 报"未知别名"
          if (join.expr && join.as) {
            map.set(join.as, { isDerived: true });
          }
        }
      }
    });
  } catch {
    // parse 失败返回空 map
  }
  return map;
}

/**
 * 提取 SQL 中所有子查询（derived table）的输出列集合
 *
 * 用法：在 `validateSqlFields` 主入口调用，结果用于给每个子查询别名
 *       构造虚拟 columnsMap 条目（key: `__DERIVED__<alias>`，value: 输出列 Set），
 *       这样 R1 校验能基于子查询实际 SELECT 列表判断 `t_sub.col` 是否合法。
 *
 * 输出列名提取优先级：
 *   1. `AS xxx` 的别名
 *   2. 列引用 `{type:'column_ref', column:'xxx'}` 的列名
 *   3. 函数调用（`SUM/COUNT/...`）的函数名（兜底）
 *   4. 其它表达式（字面量、运算）→ 跳过（无法静态命名）
 *
 * @param {string} sql - SQL 语句
 * @returns {Map<string, Set<string>>} - alias → 输出列名集合
 */
export function extractDerivedTableColumns(sql) {
  const result = new Map();
  try {
    const { ast } = parseSql(sql) || {};
    if (!ast) return result;
    walkDerivedTables(ast, (alias, subqueryAst) => {
      const cols = new Set();
      const colArr = subqueryAst?.columns || [];
      for (const col of colArr) {
        let name = null;
        if (col?.as) {
          name = col.as;
        } else if (col?.expr?.type === 'column_ref' && col.expr.column) {
          name = col.expr.column;
        } else if (col?.expr?.type === 'function' && col.expr.name) {
          name = col.expr.name;
        }
        if (name) cols.add(name);
      }
      result.set(alias, cols);
    });
  } catch {
    // parse 失败返回空 map
  }
  return result;
}

/**
 * 递归遍历 AST 收集所有子查询的 (alias, subqueryAst) 对
 * - 覆盖 FROM 级子查询：`FROM (SELECT ...) t_sub`
 * - 覆盖 JOIN 级子查询：`LEFT JOIN (SELECT ...) t_sub ON ...`
 *   ★ 关键：node-sql-parser 把 JOIN 也扁平化放在 ast.from 数组里，
 *     每个 from 元素可能是 `{table, as}`（普通表）或 `{expr:{ast,...}, as, join, on}`（子查询 JOIN）
 *   所以不需要单独处理 `fromItem.join` 数组
 * - 递归进子查询内部（fromItem.expr.ast），处理嵌套 derived table
 *   ★ 2026-07-30 修复：原 walkFromClauses 只递归到 ast 的兄弟字段，
 *     不会进入 fromItem.expr.ast，导致嵌套子查询（如 `t1(col) FROM (t2 FROM (...) t2) t1`）
 *     里的 t2 被遗漏
 */
function walkDerivedTables(ast, callback) {
  if (!ast || typeof ast !== 'object') return;
  if (Array.isArray(ast)) {
    ast.forEach(item => walkDerivedTables(item, callback));
    return;
  }
  if (ast.from) {
    const fromArr = Array.isArray(ast.from) ? ast.from : [ast.from];
    for (const fromItem of fromArr) {
      if (!fromItem) continue;
      // ★ 修复：真子查询 AST 在 fromItem.expr.ast，原代码错传 fromItem.expr
      //   fromItem.expr 实际是 {ast, tableList, columnList, parentheses} 包装对象
      if (fromItem.expr && fromItem.as) {
        const subAst = fromItem.expr.ast || fromItem.expr;
        callback(fromItem.as, subAst);
        // ★ 修复：递归进子查询的 ast.from，处理嵌套 derived table
        if (subAst && subAst.from) {
          walkDerivedTables(subAst, callback);
        }
      }
    }
  }
  // 递归进其它字段（注意：会进入子查询内部，可能遇到更深的子查询）
  for (const key of Object.keys(ast)) {
    if (key === 'from') continue;
    walkDerivedTables(ast[key], callback);
  }
}

/**
 * 递归遍历 AST 收集所有 FROM/JOIN 子句
 * ★ 2026-07-30 修复：递归进子查询（fromItem.expr.ast）以处理嵌套子查询
 *   原版只递归到 ast 的兄弟字段，不会进入 fromItem.expr.ast，
 *   导致嵌套子查询里的 from 节点被遗漏
 */
function walkFromClauses(ast, callback) {
  if (!ast || typeof ast !== 'object') return;
  if (Array.isArray(ast)) {
    ast.forEach(item => walkFromClauses(item, callback));
    return;
  }
  if (ast.from) {
    const fromArr = Array.isArray(ast.from) ? ast.from : [ast.from];
    for (const fromItem of fromArr) {
      if (!fromItem) continue;
      callback(fromItem);
      // ★ 递归进子查询的 from，处理嵌套子查询（如 t1 FROM (t2 FROM (...) t2) t1）
      if (fromItem.expr && fromItem.expr.ast) {
        walkFromClauses(fromItem.expr.ast, callback);
      }
    }
  }
  for (const key of Object.keys(ast)) {
    if (key === 'from') continue; // 已处理
    walkFromClauses(ast[key], callback);
  }
}

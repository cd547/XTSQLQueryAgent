/**
 * DDL 工具
 *
 * 从 `skills/sql-creator-skill-v2/ddl/{table}.sql` 读 DDL，提取列名集合，
 * 联合 `field_config/{table}.json` 的 `field_aliases`。
 *
 * 关键约束：**不同表的相同字段名天然隔离**（per-table Set）。
 *   ❌ 不能把所有表的列拍平成一个 Set
 *      （否则 admin_user.mobile 会被误判为 et.mobile 合法）
 *   ✅ 每张表独立的 Set
 *
 * 数据流：
 *   1. loadColumnsMap(tables) 一次性读所有表的 DDL + field_config
 *   2. extractColumnsFromDDL 按 `-- @@TABLE` 标记严格分段
 *   3. 联合 field_aliases
 *   4. mtime 缓存避免重复读盘
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { getTableDDL } from './toolFuncs.js';
import { loadFieldAliases } from './fieldConfigUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_V2_PATH = path.join(config.skillPath, 'sql-creator-skill-v2');

/**
 * 加载 SQL 中涉及的表的列名集合（含 field_aliases 联合）
 *
 * **重要：返回 Map<table, Set<column>>，不是扁平的 Set**
 *   不同表的同名字段天然隔离（`admin_user.mobile` ≠ `et.mobile`）
 *
 * @param {string[]} tables - 表名列表
 * @returns {Promise<Map<string, Set<string>>>} - {tableName -> Set<columnName>}
 */
export async function loadColumnsMap(tables) {
  const result = new Map();
  if (!tables || tables.length === 0) return result;

  // 1. 一次性读所有表的 DDL（getTableDDL 内部已经 Promise.all 并行）
  //    格式：`-- @@TABLE admin_user\n...\n\n-- @@TABLE edu_teacher\n...`
  const ddlBlocks = await getTableDDL(tables, { short: true });

  // 2. 对每张表，单独提取列名 + 联合 field_aliases
  await Promise.all(tables.map(async (table) => {
    const columns = extractColumnsFromDDL(ddlBlocks, table);
    const aliases = await loadFieldAliases(table);
    // per-table Set：天然隔离，admin_user.mobile 不会污染 et.mobile
    result.set(table, new Set([...columns, ...aliases]));
  }));

  return result;
}

/**
 * 从 DDL 字符串中**仅**提取指定表的列名（按 -- @@TABLE 标记分段）
 *
 * 输入示例（getTableDDL 返回格式）：
 * ```
 * -- @@TABLE admin_user
 * id INT
 * del INT
 * mobile VARCHAR
 *
 * -- @@TABLE edu_teacher
 * id INT
 * del INT
 * teacher_no VARCHAR
 * ```
 *
 * 调用 `extractColumnsFromDDL(ddlBlocks, 'edu_teacher')` 返回：
 *   ['id', 'del', 'teacher_no']
 * （**不会**包含 admin_user 的 mobile）
 *
 * @param {string} ddlBlocks - 多表 DDL 拼接字符串
 * @param {string} tableName - 目标表名
 * @returns {string[]} - 列名列表
 */
export function extractColumnsFromDDL(ddlBlocks, tableName) {
  const lines = ddlBlocks.split('\n');
  const columns = [];
  let inTargetTable = false;

  for (const line of lines) {
    // 1. 进入目标表段
    if (line.trimStart().startsWith(`-- @@TABLE ${tableName}`)) {
      inTargetTable = true;
      continue;
    }
    // 2. 离开目标表段（遇到其他表标记 / 表注释）
    if (line.trimStart().startsWith('-- @@TABLE ') || line.trimStart().startsWith('-- 表 ')) {
      inTargetTable = false;
      continue;
    }
    // 3. 仅在目标表段内提取列名
    if (inTargetTable) {
      // simplifyDDL 后的每行是 "`字段名` 类型" 或 "字段名 类型" 格式
      // 也支持没反引号的情况
      const match = line.match(/^`?(\w+)`?\s+/);
      if (match) {
        const colName = match[1];
        // 过滤掉 DDL 关键字误识别（如 PRIMARY, FOREIGN, UNIQUE, KEY, INDEX）
        if (!/^(PRIMARY|FOREIGN|UNIQUE|KEY|INDEX|CONSTRAINT)$/i.test(colName)) {
          columns.push(colName);
        }
      }
    }
  }
  return columns;
}

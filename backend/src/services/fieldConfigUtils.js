/**
 * field_config 工具
 *
 * 读 `skills/sql-creator-skill-v2/field_config/{table}.json`，提供：
 * - loadFieldAliases: 提取某张表的所有 field_aliases 别名
 *
 * 用途：R1 校验时需把 field_aliases 联合进"合法字段集合"，
 *      避免把 "user_name"（alias）误报为不在 DDL 中。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_V2_PATH = path.join(config.skillPath, 'sql-creator-skill-v2');
const FIELD_CONFIG_PATH = path.join(SKILL_V2_PATH, 'field_config');

const ALIASES_CACHE = new Map(); // {tableName: {mtime, aliasesSet}}

/**
 * 读文件（如不存在返回 null）。单次系统调用，无 TOCTOU 竞态。
 */
async function readFileIfExists(filePath, encoding = 'utf-8') {
  try {
    return await fs.promises.readFile(filePath, encoding);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * 加载某张表的所有 field_aliases 别名
 *
 * 输入示例（admin_user.json）：
 * {
 *   "field_aliases": {
 *     "parent_id": ["上级ID"],
 *     "character_id": ["角色ID"],
 *     "department_id": ["部门ID", "二级部门ID"],
 *     "user": ["用户名"]
 *   }
 * }
 *
 * 输出：['上级ID', '角色ID', '部门ID', '二级部门ID', '用户名']
 *
 * **重要**：别名和 DDL 字段是**两种不同的字段名**，都应加入"合法字段集合"
 *   - DDL 字段：id, parent_id, character_id, mobile, ...
 *   - 别名字段：上级ID, 角色ID, 部门ID, 用户名, ...
 *   - LLM 写 `au.user_name_real`（alias）应视为合法，因为 field_config 声明过
 *
 * @param {string} tableName - 表名（如 'admin_user'）
 * @returns {Promise<string[]>} - 别名数组
 */
export async function loadFieldAliases(tableName) {
  // mtime 缓存
  const filePath = path.join(FIELD_CONFIG_PATH, `${tableName}.json`);
  let mtime = 0;
  try {
    const stat = await fs.promises.stat(filePath);
    mtime = stat.mtimeMs;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }

  const cached = ALIASES_CACHE.get(tableName);
  if (cached && cached.mtime === mtime) {
    return cached.aliases;
  }

  const content = await readFileIfExists(filePath);
  if (!content) {
    ALIASES_CACHE.set(tableName, { mtime, aliases: [] });
    return [];
  }

  const config = JSON.parse(content);
  const aliasesMap = config.field_aliases || {};
  // 拍平所有别名到一个数组
  const aliases = [];
  for (const aliasList of Object.values(aliasesMap)) {
    if (Array.isArray(aliasList)) {
      for (const alias of aliasList) {
        if (typeof alias === 'string' && alias.trim()) {
          aliases.push(alias);
        }
      }
    }
  }

  ALIASES_CACHE.set(tableName, { mtime, aliases });
  return aliases;
}

/**
 * 清空缓存（用于测试）
 */
export function clearAliasesCache() {
  ALIASES_CACHE.clear();
}

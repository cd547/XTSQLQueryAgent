/**
 * Skill 业务域操作（独立模块以便单元测试）
 *
 * 将表名追加到指定业务域文件（domains/{id}.json）的 tables 数组。
 * 失败抛带 code 字段的 Error，便于调用方转为 HTTP 400/500 响应。
 */

import fs from 'fs';
import path from 'path';

const CACHE_TTL_MS = 5000;
let _reverseIndexCache = null;   // { builtAt, tableToDomains: Map<lowerTable, Set<domainId>> }

/**
 * 构建"表名 -> 业务域 id 集合"的反向索引。
 * 内存级缓存 5s 复用，避免每次收藏都遍历所有 domain 文件。
 *
 * @param {string} skillV2Path
 * @returns {Map<string, Set<string>>}
 */
function buildTableToDomainsIndex(skillV2Path) {
  const now = Date.now();
  if (_reverseIndexCache && (now - _reverseIndexCache.builtAt) < CACHE_TTL_MS) {
    return _reverseIndexCache.tableToDomains;
  }

  const indexPath = path.join(skillV2Path, 'domain_router_index.json');
  const tableToDomains = new Map();
  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      for (const domain of index.domains || []) {
        const id = domain.id;
        const file = path.join(skillV2Path, 'domains', `${id}.json`);
        if (!fs.existsSync(file)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
          for (const t of data.tables || []) {
            const key = String(t).toLowerCase();
            if (!tableToDomains.has(key)) tableToDomains.set(key, new Set());
            tableToDomains.get(key).add(id);
          }
        } catch (_) { /* 忽略单个 domain 文件的解析错误 */ }
      }
    } catch (_) { /* 索引文件损坏时返回空 Map */ }
  }
  _reverseIndexCache = { builtAt: now, tableToDomains };
  return tableToDomains;
}

/**
 * 失效反向索引缓存（写操作后调用：addTableToDomains 后应调用一次）
 */
export function invalidateReverseIndex() {
  _reverseIndexCache = null;
}

/**
 * 根据表名数组反查其所属业务域 id 数组（去重 + 顺序稳定）
 * @param {string[]} tableNames
 * @param {string} skillV2Path
 * @returns {string[]}
 */
export function getDomainsForTables(tableNames, skillV2Path) {
  if (!Array.isArray(tableNames) || tableNames.length === 0) return [];
  const idx = buildTableToDomainsIndex(skillV2Path);
  const result = new Set();
  for (const t of tableNames) {
    const key = String(t || '').toLowerCase();
    const ids = idx.get(key);
    if (ids) {
      for (const id of ids) result.add(id);
    }
  }
  return [...result].sort();
}

/**
 * @param {string} tableName - 表名
 * @param {string[]} domainIds - 业务域 id 数组
 * @param {string} skillV2Path - sql-creator-skill-v2 目录绝对路径
 * @param {(base: string, target: string) => boolean} isPathSafeFn - 路径安全检查函数
 * @param {() => import('better-sqlite3').Database} getDbFn - 获取 DB 实例的函数
 * @throws {Error} 带 code 字段
 */
export function addTableToDomains(tableName, domainIds, skillV2Path, isPathSafeFn, getDbFn) {
  const domainIndexPath = path.join(skillV2Path, 'domain_router_index.json');
  if (!fs.existsSync(domainIndexPath)) {
    const err = new Error('domain_router_index.json 不存在');
    err.code = 'DOMAIN_INDEX_MISSING';
    throw err;
  }
  const index = JSON.parse(fs.readFileSync(domainIndexPath, 'utf-8'));
  const validIds = new Set((index.domains || []).map(d => d.id));

  const db = getDbFn();
  const stmt = db.prepare(`
    INSERT INTO skill_logs (operation, file_path, backup_path, old_content, new_content, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const id of domainIds) {
    if (!validIds.has(id)) {
      const err = new Error(`业务域 ${id} 未在 domain_router_index.json 注册`);
      err.code = 'DOMAIN_NOT_FOUND';
      throw err;
    }
    const domainFile = path.join(skillV2Path, 'domains', `${id}.json`);
    if (!isPathSafeFn(skillV2Path, domainFile)) {
      const err = new Error(`Invalid domain id: ${id}`);
      err.code = 'INVALID_DOMAIN_ID';
      throw err;
    }
    if (!fs.existsSync(domainFile)) {
      const err = new Error(`业务域文件缺失: domains/${id}.json`);
      err.code = 'DOMAIN_FILE_MISSING';
      throw err;
    }
    const data = JSON.parse(fs.readFileSync(domainFile, 'utf-8'));
    data.tables = data.tables || [];
    if (!data.tables.includes(tableName)) {
      data.tables.push(tableName);
      fs.writeFileSync(domainFile, JSON.stringify(data, null, 2), 'utf-8');
    }
    stmt.run(
      'add_to_domain',
      `domains/${id}.json`,
      null, '',
      JSON.stringify({ tableName, domainId: id }),
      'success', null
    );
  }
}

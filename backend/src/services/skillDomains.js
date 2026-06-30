/**
 * Skill 业务域操作（独立模块以便单元测试）
 *
 * 将表名追加到指定业务域文件（domains/{id}.json）的 tables 数组。
 * 失败抛带 code 字段的 Error，便于调用方转为 HTTP 400/500 响应。
 */

import fs from 'fs';
import path from 'path';

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

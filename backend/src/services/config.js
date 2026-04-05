import { getDb } from '../db/sqlite.js';

export function getConfig() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('db_config');
  if (!row) throw new Error('数据库未配置');
  return JSON.parse(row.value);
}

export function getLlmConfig() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');
  if (!row) throw new Error('LLM未配置');
  return JSON.parse(row.value);
}
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

export function getAgentConfig() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM configs WHERE key LIKE ?').all('agent_%');
  const config = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

export function updateAgentConfig(key, value) {
  const db = getDb();
  db.prepare('UPDATE configs SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(value, key);
  return getAgentConfig();
}
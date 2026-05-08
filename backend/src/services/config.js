import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';

export function getConfig() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('db_config');
    if (!row) {
      logger.warn('Database config not found');
      return null;
    }
    return JSON.parse(row.value);
  } catch (e) {
    logger.error('Failed to get database config', { error: e.message });
    return null;
  }
}

export function getLlmConfig() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');
    if (!row) {
      logger.warn('LLM config not found');
      return null;
    }
    return JSON.parse(row.value);
  } catch (e) {
    logger.error('Failed to get LLM config', { error: e.message });
    return null;
  }
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
  db.prepare(`INSERT OR REPLACE INTO configs (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`).run(key, value);
  return getAgentConfig();
}

export function getTokenWarningLevel() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('agent_token_warning_level');
    if (!row) {
      // 默认值为30000
      return 30000;
    }
    return parseInt(row.value) || 30000;
  } catch (e) {
    logger.error('Failed to get token warning level', { error: e.message });
    return 30000;
  }
}
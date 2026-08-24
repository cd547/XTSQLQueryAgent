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

// ★ 2026-08-24：DeepSeek Files API 配置文件
//   - allowedTypes: MIME 白名单（前端按钮的 accept 字符串同步生成；后端强校验）
//   - maxSizeMiB: 单文件大小上限（DeepSeek 限制 64 MiB）
//   - expiresAfterSeconds: 有效期秒数（可选；不设则永久）
//   存于 configs 表 key=agent_files_config，value=JSON 字符串（与 agent_* 风格一致）
export const FILES_CONFIG_DEFAULTS = {
  allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  maxSizeMiB: 64,
  expiresAfterSeconds: null,
};

export function getFilesConfig() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('agent_files_config');
    if (!row) {
      return { ...FILES_CONFIG_DEFAULTS };
    }
    const parsed = JSON.parse(row.value);
    // 缺字段补默认（旧 DB 行升级兼容）
    return {
      allowedTypes: Array.isArray(parsed.allowedTypes) ? parsed.allowedTypes : FILES_CONFIG_DEFAULTS.allowedTypes,
      maxSizeMiB: Number.isFinite(parsed.maxSizeMiB) ? parsed.maxSizeMiB : FILES_CONFIG_DEFAULTS.maxSizeMiB,
      expiresAfterSeconds: Number.isFinite(parsed.expiresAfterSeconds) ? parsed.expiresAfterSeconds : FILES_CONFIG_DEFAULTS.expiresAfterSeconds,
    };
  } catch (e) {
    logger.error('Failed to get files config', { error: e.message });
    return { ...FILES_CONFIG_DEFAULTS };
  }
}

export function updateFilesConfig(patch) {
  const db = getDb();
  const current = getFilesConfig();
  // 白名单校验：只接受已知字段，其他丢弃
  const next = { ...current };
  if (Array.isArray(patch?.allowedTypes)) {
    next.allowedTypes = patch.allowedTypes.filter(t => typeof t === 'string' && t.startsWith('image/'));
    if (next.allowedTypes.length === 0) next.allowedTypes = current.allowedTypes;
  }
  if (Number.isFinite(patch?.maxSizeMiB)) {
    // DeepSeek 硬上限 64 MiB
    next.maxSizeMiB = Math.max(1, Math.min(64, Math.floor(patch.maxSizeMiB)));
  }
  if (patch?.expiresAfterSeconds === null || Number.isFinite(patch?.expiresAfterSeconds)) {
    const v = patch.expiresAfterSeconds;
    if (v === null || (v >= 3600 && v <= 2592000)) {
      next.expiresAfterSeconds = v;
    }
  }
  db.prepare(`INSERT OR REPLACE INTO configs (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`)
    .run('agent_files_config', JSON.stringify(next));
  return next;
}
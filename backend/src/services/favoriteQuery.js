/**
 * "我的查询"核心服务
 *
 * 流程：
 *   1. 调 LLM（专用非流式 callLlmForFavorite），输入用户提问 + agent 最终 SQL
 *      → 输出 JSON { optimized_question, table_names }
 *   2. 反查 skillDomains.getDomainsForTables 拿到业务域 id 数组
 *   3. 写入 my_queries 表；(user_id, sql_output) 唯一冲突时更新
 *
 * 决策：
 *   - 业务域识别走 LLM 识别表名 → 反查域文件
 *   - 文字优化范围：只优化 userQuestion（不改 SQL）
 *   - 去重策略：按 (user_id, sql_output) 唯一，更新
 *   - LLM 失败时直接抛错，由调用方返回 500（前端报错）
 */

import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';
import { callLlmForFavorite } from './llm.js';
import { getDomainsForTables } from './skillDomains.js';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';
import fs from 'fs';
import path from 'path';

const SKILL_V2_PATH = `${config.skillPath}/sql-creator-skill-v2`;
const LOGS_PATH = config.logPath;

/**
 * 文件名安全化（与 llm.js 同款，确保两侧清洗规则一致）
 */
function sanitizeUsername(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return cleaned || 'unknown';
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 收藏 LLM 日志按"日期 / 用户"分文件：logs/YYYY-MM-DD/{username}_favorite_llm.log
 */
function favoriteLogFileFor(username) {
  const safe = sanitizeUsername(username);
  const dateDir = path.join(LOGS_PATH, todayKey());
  ensureDir(dateDir, 'favorite log date dir');
  const prefix = safe === 'unknown' ? '_system' : safe;
  return path.join(dateDir, `${prefix}_favorite_llm.log`);
}

/* ============================ 收藏 LLM 调用日志 ============================ */

function writeFavoriteLlmLog(content, username) {
  const now = new Date();
  const timestamp = now.toISOString();
  let logFile;
  try {
    logFile = favoriteLogFileFor(username);
  } catch (e) {
    const dateDir = path.join(LOGS_PATH, todayKey());
    try { ensureDir(dateDir, 'favorite log date dir fallback'); } catch (_) {}
    logFile = path.join(dateDir, '_system_favorite_llm.log');
  }
  const logLine = `${timestamp}: ${content}\n`;
  fs.appendFileSync(logFile, logLine, 'utf-8');
}

// 收藏 LLM 日志缓冲：{ username, content }，flush 时按用户分组聚合
const FAV_LOG_BUFFER = [];
let favFlushTimer = null;

function flushFavLogs() {
  if (FAV_LOG_BUFFER.length === 0) return;
  const flushing = FAV_LOG_BUFFER.splice(0);
  const byUser = new Map();
  for (const item of flushing) {
    const u = item.username || null;
    if (!byUser.has(u)) byUser.set(u, []);
    byUser.get(u).push(item.content);
  }
  for (const [u, lines] of byUser) {
    writeFavoriteLlmLog(lines.join('\n'), u);
  }
}

function queueFavLog(content, immediate = false, username = null) {
  FAV_LOG_BUFFER.push({ username, content });
  if (immediate) {
    if (favFlushTimer) {
      clearTimeout(favFlushTimer);
      favFlushTimer = null;
    }
    flushFavLogs();
  } else if (!favFlushTimer) {
    favFlushTimer = setTimeout(flushFavLogs, 1000);
  }
}

/**
 * 从 LLM 输出文本中提取 JSON 对象。
 * 兼容：
 *   - 被 ```json ... ``` 包裹
 *   - 前/后有非 JSON 文本（如解释性说明）
 * 失败抛 Error（不静默吞错，由调用方决定如何处理）
 */
export function extractJsonObject(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('LLM 返回内容为空');
  }
  // 优先尝试直接 parse
  try {
    return JSON.parse(text);
  } catch (_) { /* fall through */ }
  // 抽取首个 { ... } 块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('LLM 返回内容不含合法 JSON 对象');
  }
  const slice = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new Error(`LLM 返回 JSON 解析失败: ${e.message}`);
  }
}

/**
 * 收藏一条 SQL 到 my_queries
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} [params.username]    登录用户名（用于按用户分文件落盘，缺省走 _system）
 * @param {string} params.userQuestion  用户原始提问
 * @param {string} params.sqlOutput     agent 最终 SQL
 * @param {AbortSignal} [params.signal]
 * @param {(systemPrompt: string, userPrompt: string, signal?: AbortSignal) => Promise<{content: string, usage: object, model: string}>} [params.llmCaller]
 *        可选：自定义 LLM 调用器（仅测试用，生产不传）
 * @param {() => import('better-sqlite3').Database} [params.getDbFn]
 *        可选：自定义 DB 访问器（仅测试用，生产不传）
 * @returns {Promise<{id: number, optimizedQuestion: string, businessDomains: string[]}>}
 */
export async function saveFavoriteQuery({ userId, username, userQuestion, sqlOutput, signal, llmCaller, getDbFn }) {
  if (!userId) throw new Error('userId 必填');
  if (!userQuestion || !userQuestion.trim()) throw new Error('userQuestion 必填');
  if (!sqlOutput || !sqlOutput.trim()) throw new Error('sqlOutput 必填');

  // 1) 调 LLM：得到优化后的提问 + 涉及的表名
  const systemPrompt = `你是一名 SQL 收藏助手。基于用户的提问和最终执行的 SQL，完成两件事：
1. 把用户提问改写成一个简洁、检索友好、不超过 30 字的标题（避免出现 SQL 关键字、列名细节）。
2. 从 SQL 中识别涉及的物理表名（不含 schema 限定符、不含别名），输出为字符串数组。

严格输出 JSON，不要包含解释或 markdown 代码块标记。格式：
{"optimized_question": "string", "table_names": ["t_user", "t_order"]}`;

  const userPrompt = `用户提问：${userQuestion}

最终 SQL：
\`\`\`sql
${sqlOutput}
\`\`\``;

  const caller = typeof llmCaller === 'function' ? llmCaller : callLlmForFavorite;

  // 记录 LLM 请求日志
  queueFavLog(
    '========== Favorite LLM Request ==========\n' +
    `Model: ${caller === callLlmForFavorite ? '(default)' : '(custom)'}\n` +
    `--- System Prompt ---\n${systemPrompt}\n` +
    `--- User Prompt ---\n${userPrompt}\n` +
    '==========================================',
    true,
    username
  );

  const llmResult = await caller(systemPrompt, userPrompt, signal);
  const parsed = extractJsonObject(llmResult.content);

  // 记录 LLM 响应日志
  queueFavLog(
    '========== Favorite LLM Response ==========\n' +
    `Model: ${llmResult.model}\n` +
    `Usage: ${JSON.stringify(llmResult.usage)}\n` +
    `--- Raw Content ---\n${llmResult.content}\n` +
    `--- Parsed JSON ---\n${JSON.stringify(parsed, null, 2)}\n` +
    '==========================================',
    true,
    username
  );

  const optimizedQuestion = typeof parsed.optimized_question === 'string'
    ? parsed.optimized_question.trim()
    : userQuestion.trim();
  const tableNames = Array.isArray(parsed.table_names)
    ? parsed.table_names.map(s => String(s).trim()).filter(Boolean)
    : [];

  logger.info('Favorite: LLM extracted', {
    userId,
    optimizedQuestion,
    tableNames,
    model: llmResult.model,
    usage: llmResult.usage
  });

  // 2) 反查业务域
  const businessDomains = getDomainsForTables(tableNames, SKILL_V2_PATH);

  // 3) 写表；唯一冲突时更新
  const db = typeof getDbFn === 'function' ? getDbFn() : getDb();
  const insertSql = `
    INSERT INTO my_queries (user_id, user_question, optimized_question, sql_output, business_domains, add_time)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, sql_output) DO UPDATE SET
      user_question      = excluded.user_question,
      optimized_question = excluded.optimized_question,
      business_domains   = excluded.business_domains,
      add_time           = CURRENT_TIMESTAMP
  `;
  const stmt = db.prepare(insertSql);
  const result = stmt.run(
    userId,
    userQuestion.trim(),
    optimizedQuestion,
    sqlOutput.trim(),
    JSON.stringify(businessDomains)
  );

  // SQLite ON CONFLICT...DO UPDATE 时 result.lastInsertRowid 是新写入行的 id；
  // 若是 UPDATE，则 lastInsertRowid 在 better-sqlite3 中为 0，需手动查
  let id = result.lastInsertRowid;
  if (!id) {
    const row = db.prepare('SELECT id FROM my_queries WHERE user_id = ? AND sql_output = ?').get(userId, sqlOutput.trim());
    id = row?.id;
  }

  return {
    id,
    optimizedQuestion,
    businessDomains
  };
}

/**
 * 批量检查哪些 SQL 已被当前用户收藏。
 * 入参 sqlOutputs 数组去空去重，返回按 sqlOutput 索引的对象 map。
 * 不存在的 sqlOutput 不会出现在 map 中（调用方按"出现"判断 matched）。
 *
 * @param {number} userId
 * @param {string[]} sqlOutputs
 * @param {() => import('better-sqlite3').Database} [getDbFn]
 * @returns {Map<string, {id, optimizedQuestion, businessDomains, addTime}>}
 */
export function checkFavorites(userId, sqlOutputs, getDbFn) {
  if (!userId) return new Map();
  if (!Array.isArray(sqlOutputs) || sqlOutputs.length === 0) return new Map();

  // 去空 + 去重
  const unique = [...new Set(sqlOutputs.map(s => (s || '').trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();

  const db = typeof getDbFn === 'function' ? getDbFn() : getDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, sql_output, optimized_question, business_domains, add_time
    FROM my_queries
    WHERE user_id = ? AND sql_output IN (${placeholders})
  `).all(userId, ...unique);

  const result = new Map();
  for (const r of rows) {
    let domains = [];
    try { domains = JSON.parse(r.business_domains || '[]'); } catch (_) { domains = []; }
    result.set(r.sql_output, {
      id: r.id,
      optimizedQuestion: r.optimized_question,
      businessDomains: domains,
      addTime: r.add_time
    });
  }
  return result;
}

/**
 * 取消收藏（按 user_id + sql_output 唯一删除）。
 * 返回 true 表示删了一条；false 表示记录不存在。
 *
 * @param {number} userId
 * @param {string} sqlOutput
 * @param {() => import('better-sqlite3').Database} [getDbFn]
 * @returns {boolean}
 */
export function deleteFavoriteQuery(userId, sqlOutput, getDbFn) {
  if (!userId) return false;
  if (!sqlOutput || !sqlOutput.trim()) return false;
  const db = typeof getDbFn === 'function' ? getDbFn() : getDb();
  const result = db.prepare('DELETE FROM my_queries WHERE user_id = ? AND sql_output = ?')
    .run(userId, sqlOutput.trim());
  return result.changes > 0;
}

/**
 * 从收藏中随机抽取建议问题。
 * - admin：跨用户随机
 * - 普通用户：仅自己
 * - 优先取 optimized_question（LLM 优化后的标题），缺失或空时回退 user_question
 * - 去重：同问题多次收藏只返一次
 * - 不足 count 条时返回所有可用的（不补占位）
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {string} [params.role]   'admin' | 'user' | 其他
 * @param {number} [params.count] 默认 4
 * @param {() => import('better-sqlite3').Database} [params.getDbFn]
 * @returns {string[]}
 */
export function getFavoriteSuggestions({ userId, role, count = 4, getDbFn } = {}) {
  if (!userId) return [];
  const db = typeof getDbFn === 'function' ? getDbFn() : getDb();

  // 优化标题优先，缺失回退原始提问；过滤空字符串与纯空白
  // admin 跨用户；普通用户仅自己
  const isAdmin = role === 'admin';
  const whereUser = isAdmin ? '' : 'WHERE user_id = ?';
  const sql = `
    SELECT q FROM (
      SELECT
        COALESCE(NULLIF(TRIM(optimized_question), ''), TRIM(user_question)) AS q
      FROM my_queries
      ${whereUser}
    )
    WHERE q != '' AND q IS NOT NULL
    GROUP BY q
    ORDER BY RANDOM()
    LIMIT ?
  `;

  let rows;
  if (isAdmin) {
    rows = db.prepare(sql).all(count);
  } else {
    rows = db.prepare(sql).all(userId, count);
  }
  return rows.map(r => r.q).filter(Boolean);
}

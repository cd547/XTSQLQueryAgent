import { getLlmConfig, getAgentConfig } from './config.js';
import { logger } from '../logger.js';
import { loadTableIndex, loadSkillMd, tools } from './toolFuncs.js';
import { getDb } from '../db/sqlite.js';
import { countMessagesTokens } from './tokenizer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = config.logPath;

/**
 * 把任意用户名清洗为文件系统安全的形式：
 *   - 仅保留 [a-zA-Z0-9_-]，其它字符替换为 _
 *   - 长度上限 50 字符
 *   - 空结果回退为 "unknown"（保证日志文件不会因为边界值缺失）
 */
function sanitizeUsername(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
  return cleaned || 'unknown';
}

/**
 * 计算当前日期键（YYYY-MM-DD），用于按天分子目录。
 */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 计算用户 LLM 日志文件绝对路径：logs/YYYY-MM-DD/{username}_llm.log
 * 边界：usernane 为空时落 _system_llm.log（与 Winston 系统日志风格一致）
 */
function llmLogFileFor(username) {
  const safe = sanitizeUsername(username);
  const dateDir = path.join(LOGS_PATH, todayKey());
  ensureDir(dateDir, 'llm log date dir');
  // 当无法归属用户（如未登录、系统调用）时统一走 _system_ 命名
  const prefix = safe === 'unknown' ? '_system' : safe;
  return path.join(dateDir, `${prefix}_llm.log`);
}

/* ============================ 超时配置（BUG-7 修复） ============================ */

/**
 * 三层超时（详见 CODE_REVIEW_2026-06-26.md BUG-7）：
 *   T1 客户端断开 —— 已有，query.js res.on('close') 触发
 *   T2 单轮 LLM fetch 上限（120s）—— 本文件实现
 *   T3 整体 SSE 上限（5min）—— query.js 实现
 *   T4 单次 reader.read 上限（30s）—— 本文件实现
 *
 * 设计理由：
 *   - 工具循环最多 30 轮，每轮独立计时（单轮挂死不会让整体跟着挂）
 *   - T2 (120s) 覆盖 LLM 思考 + 流式返回总时间；主流 API 慢响应 60-90s
 *   - T4 (30s) 防御 stream 中途不发 chunk 的"半挂起"
 *   - T3 (5min) 防御 30 轮全部接近超时边界的极端情况
 */
export const LLM_TIMEOUTS = {
  FETCH_MS: 120_000,    // T2: 单轮 LLM API 调用上限
  READ_MS:   30_000,    // T4: 单次流式 read 上限
};

/**
 * 合并外部 abort signal 与单次操作超时。
 *
 * @param {AbortSignal} externalSignal - 来自外层（客户端断开、整体超时）
 * @param {number}      timeoutMs      - 本次操作超时（毫秒）
 * @param {string}      label          - 日志与错误消息标识
 * @returns {{
 *   signal: AbortSignal,        // 合并后的 signal，传给 fetch / reader.read
 *   cancel: () => void,         // 操作完成后调用，清理 timer 与 listener
 *   isExternalAbort: () => boolean,  // 区分 abort 是外部触发还是超时触发
 * }}
 */
export function withTimeout(externalSignal, timeoutMs, label) {
  const controller = new AbortController();
  const startedAt = Date.now();

  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`${label} timeout after ${timeoutMs}ms`));
    logger.warn(`${label} timed out`, { timeoutMs, elapsedMs: Date.now() - startedAt });
  }, timeoutMs);

  // externalSignal 可选：未传时只保留内部超时能力，不挂外部 abort 监听
  let onExternalAbort = null;
  if (externalSignal && typeof externalSignal.addEventListener === 'function') {
    onExternalAbort = () => {
      clearTimeout(timeoutId);
      controller.abort(externalSignal.reason);
    };
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timeoutId);
      if (onExternalAbort && externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    },
    isExternalAbort: () => !!(externalSignal && externalSignal.aborted),
  };
}

/**
 * 给一个不接受 signal 的异步操作（如 reader.read()）加超时。
 * 超时或外部 abort 时会调用 onAbort 钩子（用于释放资源，比如 reader.cancel()）。
 *
 * @template T
 * @param {() => Promise<T>} fn            - 待包装的异步操作
 * @param {AbortSignal}     externalSignal - 外部 abort signal
 * @param {number}          timeoutMs      - 超时（毫秒）
 * @param {string}          label          - 日志与错误消息标识
 * @param {() => void}      [onAbort]      - 外部 abort / 超时触发时调用（清理资源）
 * @returns {Promise<T>}
 */
export async function withPromiseTimeout(fn, externalSignal, timeoutMs, label, onAbort) {
  let timeoutId;
  let externalListener = null;
  const cleanup = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (externalListener && externalSignal) {
      externalSignal.removeEventListener('abort', externalListener);
    }
  };
  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanup();
      if (onAbort) try { onAbort(); } catch (_) {}
      logger.warn(`${label} timed out`, { timeoutMs });
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
      externalListener = () => {
        cleanup();
        if (onAbort) try { onAbort(); } catch (_) {}
        reject(externalSignal.reason);
      };
      externalSignal.addEventListener('abort', externalListener, { once: true });
    }

    fn().then(
      (v) => { cleanup(); resolve(v); },
      (e) => { cleanup(); reject(e); }
    );
  });
}

function writeLlmLog(content, username) {
  // 按"日期 / 用户"分文件落盘
  //  - 路径：logs/YYYY-MM-DD/{username}_llm.log（username 缺失则 _system_llm.log）
  //  - 用户名经 sanitizeUsername 清洗（保留 a-zA-Z0-9_-，超 50 截断）
  //  - 仍走 fs.appendFileSync（项目当前部署是单进程，不引入锁；与原实现行为一致）
  const now = new Date();
  const timestamp = now.toISOString();
  let logFile;
  try {
    logFile = llmLogFileFor(username);
  } catch (e) {
    // 路径解析/目录创建失败 → 回退到 _system_llm.log，避免日志写入整链路挂掉
    const dateDir = path.join(LOGS_PATH, todayKey());
    try { ensureDir(dateDir, 'llm log date dir fallback'); } catch (_) {}
    logFile = path.join(dateDir, '_system_llm.log');
  }
  const logLine = `${timestamp}: ${content}\n`;
  try {
    fs.appendFileSync(logFile, logLine, 'utf-8');
  } catch (e) {
    // 日志写入失败不应该让 LLM 调用挂掉，但要让用户能排查（web/electron 是否同目录、权限、磁盘等）
    // eslint-disable-next-line no-console
    console.error(`[writeLlmLog] failed to write ${logFile}:`, e.message);
  }
}

/**
 * 启发式：从 responseText 中剥离被 LLM 误倒进 content 字段的 thinking
 *
 * 触发条件（同时满足）：
 *   1. 含有 ``` 代码块
 *   2. 第一个 ``` 之前的文字 > 100 字符（远超正常 lead-in）
 *   3. 含 thinking 标记词（"让我"、"等等"、"我注意到"等）
 *   4. 含多行（≥2 个换行，说明是叙述性文字）
 *
 * @param {string} responseText - 流式累积的 content 字段
 * @returns {{ content: string, extraThinking: string }}
 */
function splitThinkingFromContent(responseText) {
  if (!responseText || typeof responseText !== 'string' || !responseText.includes('```')) {
    return { content: responseText || '', extraThinking: '' };
  }
  const firstCodeBlockIdx = responseText.indexOf('```');
  const before = responseText.substring(0, firstCodeBlockIdx).trim();
  const after = responseText.substring(firstCodeBlockIdx);
  const isLongPrefix = before.length > 100;
  const hasThinkingMarker = /(让我|等等|我发现|我注意到|我决定|实际上|让我再想|让我先|我先|继续|我开始|我准备|让我再)/.test(before);
  const hasMultipleLines = (before.match(/\n/g) || []).length >= 2;
  if (isLongPrefix && hasThinkingMarker && hasMultipleLines) {
    return { content: after.trim(), extraThinking: before };
  }
  return { content: responseText, extraThinking: '' };
}

// LLM 日志缓冲：每条记录带 username（"日期 / 用户"分文件场景下，按用户聚合后再 flush）
// 结构：{ username, content } — flush 时按 username 分组聚合，再走 writeLlmLog
const LOG_BUFFER = [];
let flushTimer = null;

function flushLogs() {
  if (LOG_BUFFER.length === 0) return;
  const flushing = LOG_BUFFER.splice(0);
  // 按 username 分组聚合后批量写盘，减少 appendFileSync 次数（系统级合并到 _system）
  const byUser = new Map();
  for (const item of flushing) {
    const u = item.username || null;
    if (!byUser.has(u)) byUser.set(u, []);
    byUser.get(u).push(item.content);
  }
  for (const [u, lines] of byUser) {
    writeLlmLog(lines.join('\n'), u);
  }
}

// 进程级全局缓存：记录最近一次 LLM 调用的完整 messages 数组。
// 当前仅供开发期调试接口 GET /api/query/messages 使用（前端未调用）。
// 注意：此处没有按 userId 区分，任何调用方都会拿到最后一个提问者的内容。
let lastMessages = null;

export function getLastMessages() {
  return lastMessages;
}

// ============================================================
// 工具调用注册表（用于程序化拦截重复调用，规则 10）
// ============================================================
// 会话级状态：跟踪已调用过的工具及其关键参数，避免 LLM 重复获取
// 已有信息（schema/ddl/get_tables/tag 确认/域路由）。跨多次 invoke 持久，
// 会话删除或 llm_messages 清空时通过 clearSessionRegistry 释放。
const sessionToolRegistries = new Map();

function getOrCreateRegistry(sessionId) {
  if (!sessionId) return null;
  if (!sessionToolRegistries.has(sessionId)) {
    sessionToolRegistries.set(sessionId, {
      getTablesCalled: false,
      getDomainIndexCalled: false,
      slicedDomains: new Set(),       // 已通过 get_sliced_index 加载过的域 ID
      tableSchema: new Set(),
      // get_table_ddl 注册表：tableName -> Set<'short=0'|'short=1'>
      // 必须按 (table, short) 组合判断重复，因为 short=0(完整DDL含索引/外键) 与 short=1(仅列定义) 返回内容不同
      tableDdl: new Map(),
      termConfirmed: new Set(),
      // request_user_choice 注册表：key = id (uc_xxx) —— 记录已问过哪些问题
      // 用于 checklist 显示 + 拦截完全相同 (question, options) 组合的重复调用（Q-09 = B）
      userChoiceAsked: new Map(),     // id -> {question, options, multiSelect, header, signature}
    });
  }
  return sessionToolRegistries.get(sessionId);
}

function normalizeTableNames(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter(n => typeof n === 'string' && n.trim()))].sort();
}

function buildChecklist(reg) {
  if (!reg) return '（空）';
  const domainIndexFlag = reg.getDomainIndexCalled ? '已调用' : '未调用';
  const slicedDomainsList = [...reg.slicedDomains].sort().join(', ') || '无';
  const schemaList = [...reg.tableSchema].sort().join(', ') || '无';
  const ddlShort0 = [];
  const ddlShort1 = [];
  for (const [t, shorts] of reg.tableDdl.entries()) {
    if (shorts.has('short=0')) ddlShort0.push(t);
    if (shorts.has('short=1')) ddlShort1.push(t);
  }
  const ddlShort0List = ddlShort0.sort().join(', ') || '无';
  const ddlShort1List = ddlShort1.sort().join(', ') || '无';
  const tablesFlag = reg.getTablesCalled ? '已调用' : '未调用';
  return [
    `- get_domain_index: ${domainIndexFlag}`,
    `- get_sliced_index 已覆盖的域: ${slicedDomainsList}`,
    `- get_tables: ${tablesFlag}`,
    `- 已获取 field_config 的表: ${schemaList}`,
    `- 已获取 DDL (short=0, 完整含索引/外键) 的表: ${ddlShort0List}`,
    `- 已获取 DDL (short=1, 仅列定义) 的表: ${ddlShort1List}`,
  ].join('\n');
}

/**
 * 构建"已调用工具 + 参数"摘要消息（用于本轮 LLM 请求，不持久化到 history）。
 * 目的：让 LLM 在生成 tool_call 决策前明确看到本会话已调用的工具及关键参数，
 *       避免大模型因"长上下文注意力衰减"造成的重复调用。
 * 关键：仅作为 LLM 请求参数（requestMessages）的一部分追加，**绝不** push 到累积的
 *       messages 数组，避免污染 history / 数据库 / 调试接口的 lastMessages。
 * @param {object|null} reg - 会话工具调用注册表
 * @returns {{role: 'system', content: string} | null} 没有已调用工具时返回 null
 */
function buildToolCallChecklistMessage(reg) {
  if (!reg) return null;
  const parts = [];
  if (reg.getDomainIndexCalled) parts.push('get_domain_index:✓');
  if (reg.getTablesCalled) parts.push('get_tables:✓');
  if (reg.slicedDomains.size > 0) parts.push(`get_sliced_index:[${[...reg.slicedDomains].sort().join(',')}]`);
  if (reg.tableSchema.size > 0) parts.push(`get_table_schema:[${[...reg.tableSchema].sort().join(',')}]`);
  if (reg.tableDdl.size > 0) {
    const s0 = [];
    const s1 = [];
    for (const [t, shorts] of reg.tableDdl.entries()) {
      if (shorts.has('short=0')) s0.push(t);
      if (shorts.has('short=1')) s1.push(t);
    }
    if (s0.length > 0) parts.push(`get_table_ddl(s0):[${s0.sort().join(',')}]`);
    if (s1.length > 0) parts.push(`get_table_ddl(s1):[${s1.sort().join(',')}]`);
  }
  if (reg.termConfirmed.size > 0) {
    const items = [...reg.termConfirmed].map(s => s.replace('::', '@'));
    parts.push(`request_tag_confirmation:[${items.join(',')}]`);
  }
  if (reg.userChoiceAsked && reg.userChoiceAsked.size > 0) {
    // 显示所有 userChoiceAsked 项（id + question 预览 50 字符），不截断
    // 不同 question 都允许，重复由 checkAndFilterDuplicateCall 拦截
    const items = [...reg.userChoiceAsked.entries()].map(([id, v]) => {
      const q = String(v?.question || '').slice(0, 50).replace(/[|:]/g, ' ');
      return `${id}:"${q}"`;
    });
    parts.push(`request_user_choice:[${items.join('|')}]`);
  }
  if (parts.length === 0) return null;
  return {
    role: 'system',
    content: `[已调用] ${parts.join(' | ')}\n\n` +
      `核对清单：相同工具+相同关键参数（table_names/domain_ids/term+table）请直接复用历史结果，避免重复调用。`
  };
}

/**
 * 检查工具调用是否重复，并对部分重复的参数进行过滤。
 * @returns {{block: boolean, args: object, message?: string, notice?: string}}
 *   - block=true: 整次调用被拦截，message 为返回给 LLM 的提示
 *   - block=false: 允许调用；args 为（可能过滤后的）参数；notice 为可选的附加提示
 */
function checkAndFilterDuplicateCall(toolName, args, sessionId) {
  const reg = getOrCreateRegistry(sessionId);
  if (!reg) return { block: false, args };

  if (toolName === 'get_tables') {
    if (reg.getTablesCalled) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】get_tables 在本会话中已被调用过一次，table_index 数据已存在于你的上下文中。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止再次调用 get_tables。`
      };
    }
    return { block: false, args };
  }

  if (toolName === 'get_domain_index') {
    if (reg.getDomainIndexCalled) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】get_domain_index 在本会话中已被调用过一次，业务域列表已存在于你的上下文中。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有域列表，禁止再次调用 get_domain_index。`
      };
    }
    return { block: false, args };
  }

  if (toolName === 'get_sliced_index') {
    const requestedDomains = normalizeTableNames(args.domain_ids);
    if (requestedDomains.length === 0) return { block: false, args };
    const dupes = requestedDomains.filter(d => reg.slicedDomains.has(d));
    const fresh = requestedDomains.filter(d => !reg.slicedDomains.has(d));

    if (dupes.length === requestedDomains.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】get_sliced_index 中所有域在本会话中都已被加载过: ${dupes.join(', ')}。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止重复加载相同域。\n` +
          `如需加载尚未覆盖的域，请重新传入只包含新域的 domain_ids 参数。`
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, domain_ids: fresh },
        notice:
          `ℹ️ 自动过滤已加载域: ${dupes.join(', ')}。仅对 [${fresh.join(', ')}] 执行 get_sliced_index。\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}`
      };
    }
    return { block: false, args };
  }

  if (toolName === 'get_table_schema') {
    const requested = normalizeTableNames(args.table_names);
    if (requested.length === 0) return { block: false, args };
    const target = reg.tableSchema;
    const dupes = requested.filter(n => target.has(n));
    const fresh = requested.filter(n => !target.has(n));

    if (dupes.length === requested.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】工具 get_table_schema 中的所有表在本会话中都已被获取过: ${dupes.join(', ')}。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止重复调用 get_table_schema。\n` +
          `如需获取尚未在清单中的表，请重新传入只包含新表的 table_names 参数。`
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, table_names: fresh },
        notice:
          `ℹ️ 自动过滤重复表（已在清单中）: ${dupes.join(', ')}。仅对 [${fresh.join(', ')}] 执行 get_table_schema。\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}`
      };
    }
    return { block: false, args };
  }

  if (toolName === 'get_table_ddl') {
    // get_table_ddl 必须按 (table, short) 组合判断重复：
    //   short=0 → 完整 DDL 含索引/外键；short=1 → 仅列定义。两种返回内容不同，不应相互替代。
    const requested = normalizeTableNames(args.table_names);
    if (requested.length === 0) return { block: false, args };
    const short = (args.short === 0 || args.short === '0') ? 0 : 1;
    const shortKey = `short=${short}`;
    const dupes = requested.filter(n => {
      const shorts = reg.tableDdl.get(n);
      return shorts && shorts.has(shortKey);
    });
    const fresh = requested.filter(n => {
      const shorts = reg.tableDdl.get(n);
      return !shorts || !shorts.has(shortKey);
    });

    if (dupes.length === requested.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】工具 get_table_ddl 中所有 (table, ${shortKey}) 组合在本会话中都已被获取过: ${dupes.join(', ')}。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止重复调用 get_table_ddl。\n` +
          `如需获取尚未在清单中的 (table, short) 组合，请重新传入只包含新表的 table_names 参数；` +
          `如需 short=0/1 之外的版本（如已用 short=1 查过，但需要 short=0 的完整 DDL），需明确传入 short=0。`
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, table_names: fresh, short },
        notice:
          `ℹ️ 自动过滤重复 (table, ${shortKey}) 组合（已在清单中）: ${dupes.join(', ')}。仅对 [${fresh.join(', ')}] 执行 get_table_ddl。\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}`
      };
    }
    return { block: false, args };
  }

  if (toolName === 'request_tag_confirmation') {
    const termsRaw = args.term;
    const terms = Array.isArray(termsRaw) ? termsRaw : (termsRaw ? [termsRaw] : []);
    const table = args.table || '';
    const dupes = terms.filter(t => reg.termConfirmed.has(`${t}::${table}`));
    const fresh = terms.filter(t => !reg.termConfirmed.has(`${t}::${table}`));
    if (terms.length === 0) return { block: false, args };

    if (dupes.length === terms.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】request_tag_confirmation 中所有术语（table=${table}）在本会话中都已请求过确认: ${terms.join(', ')}。\n` +
          `请勿重复请求。`
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, term: fresh },
        notice: `ℹ️ 自动过滤已确认术语（table=${table}）: ${dupes.join(', ')}。仅对新术语 [${fresh.join(', ')}] 执行。`
      };
    }
    return { block: false, args };
  }

  if (toolName === 'request_user_choice') {
    // Q-09 = B：拦截完全相同 (question, options, multi_select) 组合的重复调用
    // 不同问题/不同选项都允许——只拦"完全相同"，与 request_tag_confirmation 同构
    const sig = computeUserChoiceSignature(args);
    let isDupe = false;
    for (const [, v] of reg.userChoiceAsked) {
      if (v && v.signature === sig) { isDupe = true; break; }
    }
    if (isDupe) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】request_user_choice 中完全相同的问题/选项/类型在本会话中已被问过: "${String(args?.question || '').slice(0, 80)}"。\n` +
          `请基于用户上次回复继续生成 SQL；如需追问不同问题，请使用不同 question 或 options。`
      };
    }
    return { block: false, args };
  }

  return { block: false, args };
}

/**
 * 记录一次成功执行的工具调用。必须在工具真正执行成功后调用。
 *
 * @param {string} toolName - 工具名
 * @param {object} args - LLM 传入的 args
 * @param {string} sessionId - 会话 ID
 * @param {string|null} [overrideId=null] - 覆盖 id（request_user_choice 用，从 tool.func 返回的 {id, marker, payload} 中提取）
 *   用于保证 registry 内 id 与 marker 内 id 一致（reviewer #2 修复）
 */
function recordToolCall(toolName, args, sessionId, overrideId = null) {
  const reg = getOrCreateRegistry(sessionId);
  if (!reg) return;
  if (toolName === 'get_tables') {
    reg.getTablesCalled = true;
  } else if (toolName === 'get_domain_index') {
    reg.getDomainIndexCalled = true;
  } else if (toolName === 'get_sliced_index') {
    normalizeTableNames(args.domain_ids).forEach(d => reg.slicedDomains.add(d));
  } else if (toolName === 'get_table_schema') {
    normalizeTableNames(args.table_names).forEach(n => reg.tableSchema.add(n));
  } else if (toolName === 'get_table_ddl') {
    // 按 (table, short) 组合记录，允许同一表同时记录 short=0 和 short=1
    const short = (args.short === 0 || args.short === '0') ? 0 : 1;
    const shortKey = `short=${short}`;
    normalizeTableNames(args.table_names).forEach(n => {
      if (!reg.tableDdl.has(n)) reg.tableDdl.set(n, new Set());
      reg.tableDdl.get(n).add(shortKey);
    });
  } else if (toolName === 'request_tag_confirmation') {
    const termsRaw = args.term;
    const terms = Array.isArray(termsRaw) ? termsRaw : (termsRaw ? [termsRaw] : []);
    const table = args.table || '';
    terms.forEach(t => reg.termConfirmed.add(`${t}::${table}`));
  } else if (toolName === 'request_user_choice') {
    // ★ 优先用 overrideId（来自 tool.func 的结构化返回），fallback 到 args.id
    // 没有 overrideId 时记录 "uc_unknown_<timestamp>" 标记（防止 id 冲突）
    const id = overrideId
      || (args && args.id)
      || ('uc_unknown_' + Date.now());
    const options = Array.isArray(args?.options) ? args.options : [];
    const signature = `${String(args?.question || '').trim()}|${options.join('||')}|${!!args?.multi_select}`;
    reg.userChoiceAsked.set(id, {
      question: args?.question || '',
      options,
      multiSelect: !!args?.multi_select,
      header: args?.header || '',
      signature
    });
  }
}

/**
 * 计算 request_user_choice 的 signature（用于 checkAndFilterDuplicateCall）
 */
function computeUserChoiceSignature(args) {
  const question = String(args?.question || '').trim();
  const options = Array.isArray(args?.options) ? args.options : [];
  return `${question}|${options.join('||')}|${!!args?.multi_select}`;
}

/**
 * 清除会话的工具调用注册表。在会话删除或 LLM 消息清空时调用。
 */
export function clearSessionRegistry(sessionId) {
  if (!sessionId) return;
  sessionToolRegistries.delete(sessionId);
  logger.info('Cleared tool call registry for session', { sessionId });
}

/**
 * 导出当前会话的信息清单快照（供调试或日志）。
 */
export function getSessionChecklist(sessionId) {
  const reg = getOrCreateRegistry(sessionId);
  if (!reg) return '（无 sessionId）';
  return buildChecklist(reg);
}

function queueLog(content, immediate = false, username = null) {
  // username 由调用方（generateSQLWithLangChainStreamGen_BAK）注入，
  // 写到 LOG_BUFFER 时一起打包，flushLogs 按用户分组聚合后再写盘
  LOG_BUFFER.push({ username, content });
  if (immediate) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLogs();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, 1000);
  }
}

function getProviderConfig(provider, model) {
  const configs = {
    openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' },
    deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
    minimax: { baseURL: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' },
    ollama: { baseURL: 'http://localhost:11434', model: 'llama3.2' }
  };
  const cfg = configs[provider];
  if (!cfg) throw new Error(`不支持的provider: ${provider}`);
  return {
    baseURL: cfg.baseURL,
    llmModel: model || cfg.model
  };
}

function saveMessagesToDb(sessionId, messages) {
  try {
    const db = getDb();
    const messagesJson = JSON.stringify(messages);
    
    // 异步计算 token 数
    const messageTokens = countMessagesTokens(messages);
    
    const existing = db.prepare('SELECT id FROM llm_messages WHERE session_id = ?').get(sessionId);
    if (existing) {
      db.prepare('UPDATE llm_messages SET messages = ?, message_tokens = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?')
        .run(messagesJson, messageTokens, sessionId);
    } else {
      db.prepare('INSERT INTO llm_messages (session_id, messages, message_tokens) VALUES (?, ?, ?)')
        .run(sessionId, messagesJson, messageTokens);
    }
    logger.debug('Saved messages to database', { sessionId, messageCount: messages.length, messageTokens });
  } catch (e) {
    logger.error('Failed to save messages to database', { error: e.message });
  }
}

export function loadMessagesFromDb(sessionId) {
  try {
    const db = getDb();
    const record = db.prepare('SELECT messages, message_tokens FROM llm_messages WHERE session_id = ?').get(sessionId);
    if (record && record.messages) {
      return {
        messages: JSON.parse(record.messages),
        messageTokens: record.message_tokens || 0
      };
    }
    return null;
  } catch (e) {
    logger.error('Failed to load messages from database', { error: e.message });
    return null;
  }
}

// 备份原有函数
// username: 触发该 LLM 调用的登录用户名（来自 req.user.username），
//   透传到 queueLog 写到 logs/YYYY-MM-DD/{username}_llm.log。
//   缺失/空值时统一走 _system_llm.log。
//
// [DEAD-CODE 2026-07-15] history 形参当前未在函数体内被消费：
//   - query.js:325-339 的 historyText 装载逻辑已被临时禁用（`if (false && sessionId)`）
//   - 真实 LLM context 历史来自 llm_messages.messages（loadMessagesFromDb）
//   - 恢复方法：在本函数体内把 history 注入到 system message 或 user message 之前
//     （注意：会影响 DeepSeek prefix cache，因为 system 变了）
export async function* generateSQLWithLangChainStreamGen_BAK(question, history = '', signal, sessionId = null, username = null) {
  logger.info('generateSQLWithLangChainStreamGen_BAK called (backup)', { question, historyLength: history?.length, sessionId, username });
  
  let config;
  try {
    config = getLlmConfig();
  } catch (e) {
    throw new Error('LLM未配置，请先在配置面板设置LLM Provider和API Key');
  }
  
  const { provider, apiKey, model } = config;
  
  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;
  
  const skillMd = await loadSkillMd();

  const toolsDefinition = tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.lc_kwargs.params || { type: 'object', properties: {}, required: [] }
    }
  }));

  const toolsMap = new Map(tools.map(t => [t.name, t]));
  //const tableIndex = loadTableIndex();

  const systemMessage = `你是XTSQLQueryAgent。严格遵守以下规则，随后根据用户问题生成SQL。

## SKILL.md 内容（只读）
${skillMd}`;

  let messages;
  
  // 如果有 sessionId，尝试从数据库加载历史消息
  if (sessionId) {
    const savedResult = loadMessagesFromDb(sessionId);
    const savedMessages = savedResult?.messages;
    if (savedMessages && savedMessages.length > 0) {
      logger.info('Loaded messages from database', { sessionId, messageCount: savedMessages.length });
      // 更新 system 消息（可能有更新）并添加新用户消息
      messages = savedMessages;
      // 替换系统消息（保持最新）
      const systemIndex = messages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        messages[systemIndex] = { role: 'system', content: systemMessage };
      }
      // 添加新的用户消息
      messages.push({ role: 'user', content: question });
    } else {
      messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: question }
      ];
    }
  } else {
    messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: question }
    ];
  }

  const agentConfig = getAgentConfig();
  let maxToolCalls = parseInt(agentConfig.agent_max_tool_calls || '30', 10);
  // ★ 记录初始 maxToolCalls 用于 Round 编号：Round = 已用掉多少轮（从 0 开始递增）
  //   历史 Bug：用 `31 - maxToolCalls` 计算，当 admin 配置 > 31 时出现负数（Round -9, -8, ...）
  const maxToolCallsInitial = maxToolCalls;
  let responseText = '';
  let sql = '';
  // ★ request_user_choice 终止信号：检测到该工具被调用后，置为 payload，跳出 while 循环
  // 程序硬控：LLM 调用该工具后，工具循环立即终止（不再调用 LLM）
  // 详见 project_memory.md "TURN 1 终止边界"
  let pendingUserChoice = null;

  while (maxToolCalls > 0) {
    // 每轮 LLM 请求前，临时向 messages 追加"已调用工具清单"消息（仅用于本轮请求，不持久化）。
    // 目的：让 LLM 在生成 tool_call 决策前明确看到本会话已调用的工具 + 参数，
    //       避免因长上下文注意力衰减造成的重复调用（详见 project_memory.md）。
    // 不持久化：清单消息只放在 requestMessages，原始 messages 数组不被修改，
    //           避免污染 history / DB / 调试接口的 lastMessages。
    const checklistMsg = sessionId
      ? buildToolCallChecklistMessage(getOrCreateRegistry(sessionId))
      : null;

    // 明确记录『当时调用情况』到 log（仅本轮 LLM 请求使用，不存 DB，不累积到 messages）：
    //   - 没有 checklistMsg 时记录『(无)』，便于知道本轮没有清单消息
    //   - 有 checklistMsg 时用 BEGIN/END 标记包裹，便于 grep 抓取
    if (checklistMsg) {
      queueLog(
        `📋 [Round ${(maxToolCallsInitial - maxToolCalls)}] 本轮 LLM 请求末尾追加的『已调用工具清单』消息（仅本轮使用，不存 DB）:\n` +
        `--- BEGIN checklist (requestMessages 末尾) ---\n` +
        `${checklistMsg.content}\n` +
        `--- END checklist ---`,
        true,
        username
      );
    } else {
      queueLog(`📋 [Round ${(maxToolCallsInitial - maxToolCalls)}] 本轮 LLM 请求无『已调用工具清单』（首轮或无 sessionId）`, true, username);
    }

    // 剥离"无工具调用"的 assistant 消息中的 reasoning_content
    //
    // DeepSeek 官方规则（thinking_mode 文档）：
    //   - 两个 user 之间如果未进行工具调用 → assistant 的 reasoning_content 无需参与上下文拼接
    //     （传入 API 也会被忽略）
    //   - 两个 user 之间如果进行了工具调用 → assistant 的 reasoning_content **必须**回传 API，
    //     否则 API 返回 400 错误（"The `reasoning_content` in the thinking mode must be passed back to the API."）
    //
    // 历史教训：之前一刀切全剥，导致工具调用场景第二轮 LLM 请求报 400，
    //   任务链断裂模型"断片"，后续思考/工具调用无法连贯执行。
    //
    // 保留：所有 tool_calls 的 assistant.reasoning_content（多轮推理链必需）
    // 剥除：无 tool_calls 的 assistant.reasoning_content（节省 token + 减少注意力污染）
    const requestMessages = (checklistMsg ? [...messages, checklistMsg] : messages).map(m => {
      if (m.role === 'assistant' && m.reasoning_content && !m.tool_calls) {
        const { reasoning_content, ...rest } = m;
        return rest;
      }
      return m;
    });

    // 工具剪枝：一次性工具调用过后，从 LLM 请求的 tools 数组中移除以节省 token
    // - get_domain_index：调用后业务域列表已在 history 中，后续不需要
    // - get_sliced_index：调用后已加载的域在 history 中，后续不需要
    // 注意：toolsMap（用于执行工具的查找）保持不变，仅影响 LLM 看到哪些工具可选
    const pruneReg = sessionId ? getOrCreateRegistry(sessionId) : null;
    const prunedTools = pruneReg
      ? toolsDefinition.filter(t => {
          if (t.function.name === 'get_domain_index' && pruneReg.getDomainIndexCalled) return false;
          if (t.function.name === 'get_sliced_index' && pruneReg.slicedDomains.size > 0) return false;
          return true;
        })
      : toolsDefinition;
    const prunedNames = toolsDefinition
      .filter(t => !prunedTools.includes(t))
      .map(t => t.function.name);
    if (prunedNames.length > 0) {
      queueLog(
        `✂️ [Round ${(maxToolCallsInitial - maxToolCalls)}] 本轮 LLM 请求已剪枝工具（不再传入）: ${prunedNames.join(', ')}`,
        true
      );
    }

    const requestParams = {
      model: llmModel,
      messages: requestMessages,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      tools: prunedTools,
      thinking: {
        type: 'enabled'
      }
    };

    if (signal?.aborted) {
      yield { type: 'error', content: '请求已被用户中断' };
      return;
    }

    queueLog('generateSQLWithLangChainStreamGen_BAK Round ' + (maxToolCallsInitial - maxToolCalls) + ' Request:\n' + JSON.stringify(requestParams, null, 2), true, username);

    try {
      const tFetch = withTimeout(signal, LLM_TIMEOUTS.FETCH_MS, 'LLM fetch');
      let fetchResponse;
      try {
        fetchResponse = await fetch(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestParams),
          signal: tFetch.signal
        });
      } catch (e) {
        if (e.name === 'AbortError' || /timeout/i.test(e.message || '')) {
          if (tFetch.isExternalAbort()) {
            throw e;  // 外部断开，原样抛出
          }
          throw new Error(`LLM 响应超时（>${LLM_TIMEOUTS.FETCH_MS / 1000}s），请稍后重试`);
        }
        throw e;
      } finally {
        tFetch.cancel();
      }

      if (!fetchResponse.ok) {
        const errorJson = await fetchResponse.json();
        throw new Error(errorJson.error?.message || fetchResponse.statusText);
      }

      // 流式处理响应
      const reader = fetchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const streamToolCalls = [];
      responseText = '';
      let reasoningContent = '';
while (true) {
        let readResult;
        try {
          readResult = await withPromiseTimeout(
            () => reader.read(),
            signal,
            LLM_TIMEOUTS.READ_MS,
            'LLM stream read',
            () => reader.cancel().catch(() => {})  // 超时/取消时释放 stream 资源
          );
        } catch (e) {
          if (e.name === 'AbortError' || /timeout/i.test(e.message || '')) {
            if (signal.aborted) {
              throw e;  // 外部断开，原样抛出
            }
            throw new Error(`LLM 流式响应中断（>${LLM_TIMEOUTS.READ_MS / 1000}s 无新数据），请稍后重试`);
          }
          throw e;
        }
        const { done, value } = readResult;

        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        if (done) {
          buffer = '';
          break;
        } else {
          buffer = lines.pop() || '';
        }
        
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              const usage = data.usage;
              if (usage) {
                // ★ DeepSeek prefix cache 命中率（默认开启）：
                //   prompt_cache_hit_tokens - 命中缓存的 token 数（按缓存价计费）
                //   prompt_cache_miss_tokens - 未命中 token 数（按原价计费）
                // 不记录到 SSE 事件（前端不需要），仅写日志用于监控 prefix cache 实际效果。
                const cacheHit = usage.prompt_cache_hit_tokens || 0;
                const cacheMiss = usage.prompt_cache_miss_tokens || 0;
                const cacheTotal = cacheHit + cacheMiss;
                const hitRate = cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(1) : '0.0';
                queueLog(
                  `📊 [Round ${(maxToolCallsInitial - maxToolCalls)}] LLM usage: ` +
                  `prompt=${usage.prompt_tokens || 0} completion=${usage.completion_tokens || 0} total=${usage.total_tokens || 0} | ` +
                  `prefix_cache: hit=${cacheHit} miss=${cacheMiss} hit_rate=${hitRate}%`,
                  true, username
                );
                yield { type: 'usage', usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } };
              }
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                responseText += content;
                yield { type: 'chunk', content: content };
              }
                            // 提取 reasoning_content（DeepSeek API 要求）
              const reasoning = data.choices?.[0]?.delta?.reasoning_content || '';
              if (reasoning) {
                reasoningContent += reasoning;
                // 实时 yield 思考过程 delta，避免长思考阶段前端长时间无输出
                yield { type: 'reasoning_chunk', content: reasoning };
              }
              
              // 检查工具调用
              const toolCalls = data.choices?.[0]?.delta?.tool_calls;
              if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  const toolIndex = tc.index;
                  if (toolIndex !== undefined) {
                    // 确保数组有足够的长度
                    while (streamToolCalls.length <= toolIndex) {
                      streamToolCalls.push({
                        index: streamToolCalls.length,
                        id: '',
                        function: { name: '', arguments: '' }
                      });
                    }

                    // 更新现有的工具调用
                    const existing = streamToolCalls[toolIndex];

                    // 更新 id
                    if (tc.id) {
                      existing.id = tc.id;
                    }

                    // 更新函数名
                    if (tc.function?.name) {
                      existing.function.name = tc.function.name;
                    }

                    // 累积参数
                    if (tc.function?.arguments) {
                      existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
                    }
                  }
                }
              }
            } catch (e) { logger.debug('JSON parse/split failed', { error: e.message }); }
          }
        }
      }

      // 启发式后处理：从 responseText 中剥离被 LLM 误倒进 content 的 thinking
      // 背景：DeepSeek LLM 偶尔不遵守字段分离，把整段思考写进 content，导致前端"答案气泡"显示大段 thinking
      // 修复：流结束后检测并剥离（splitThinkingFromContent），把 thinking 追加到 reasoningContent
      const { content: cleanContent, extraThinking } = splitThinkingFromContent(responseText);
      const finalResponseText = cleanContent;
      const finalReasoningContent = extraThinking
        ? (reasoningContent ? reasoningContent + '\n\n' + extraThinking : extraThinking)
        : reasoningContent;

      // 如果发生了剥离，向前端发出 message_final 事件以更新 assistant 消息
      if (extraThinking) {
        yield { type: 'message_final', content: finalResponseText, extraThinking };
      }

      // 思考过程已在流式过程中实时 yield reasoning_chunk 给前端
      // 此处仅 yield reasoning_done 用于 DB 持久化（历史回显需要），UI 不再消费
      if (finalReasoningContent) {
        yield { type: 'reasoning_done', content: `💭 LLM思考过程:\n${finalReasoningContent.slice(0, 10000)}` };
      }

      // 过滤出有实际工具名称的工具调用
      const validToolCalls = streamToolCalls.filter(tc => tc.function?.name && tc.function.name.trim());

      // 流式响应结束，输出工具调用日志
      for (const tc of validToolCalls) {
        const toolName = tc.function.name;
        queueLog(`🔧 调用工具: ${toolName} 参数:${JSON.stringify(tc.function.arguments)}`, true);
        let logMsg = `🔧 调用工具: ${toolName}`;
        try {
          const parsedArgs = JSON.parse(tc.function.arguments || '{}');
          if (Object.keys(parsedArgs).length > 0) {
            logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
          }
        } catch (e) { logger.debug('JSON parse/split failed', { error: e.message }); }
        yield { type: 'tool', log: logMsg };
      }

      // 保存 assistant 消息，需要包含 tool_calls
      // 使用清理后的 finalResponseText（剥离了 thinking）和 finalReasoningContent（追加了被剥离的 thinking）
      const assistantMsg = {
        role: 'assistant',
        content: finalResponseText || '',
        reasoning_content: finalReasoningContent || '',
      };
      if (validToolCalls.length > 0) {
        // 为每个 tool_call 确保有 id
        validToolCalls.forEach((tc, idx) => {
          if (!tc.id) {
            tc.id = `call_${Date.now()}_${idx}`;
          }
        });
        assistantMsg.tool_calls = validToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || '{}'
          }
        }));
      }
      messages.push(assistantMsg);
      // 同步一份到全局缓存（仅供开发期 GET /api/query/messages 调试接口使用）
      lastMessages = JSON.parse(JSON.stringify(messages));
      
      // 保存到数据库（如果有 sessionId）
      if (sessionId) {
        saveMessagesToDb(sessionId, messages);
      }

      if (validToolCalls.length > 0) {
        // 阶段 1：同步预处理（参数解析 + 重复调用检查）
        // 必须在并行执行前一次性完成，避免同一会话内两个相同工具的检查互相穿透
        const prepared = validToolCalls.map((toolCall) => {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          const toolCallId = toolCall.id || `call_${Date.now()}_${validToolCalls.indexOf(toolCall)}`;
          const tool = toolsMap.get(toolName);

          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(toolArgs);
          } catch (e) {
            console.warn(`工具 ${toolName} 参数解析失败: ${e.message}, 参数: ${toolArgs}`);
          }

          if (!tool) {
            return { toolCall, toolName, toolCallId, tool: null, dupCheck: null };
          }
          const dupCheck = checkAndFilterDuplicateCall(toolName, parsedArgs, sessionId);
          return { toolCall, toolName, toolCallId, tool, dupCheck };
        });

        // 阶段 2：并行执行工具（互不依赖的 IO 密集型操作）
        //   同步工具也会被 await 正确处理（Promise.resolve 包装）
        const execResults = await Promise.all(prepared.map(async (p) => {
          if (!p.tool || (p.dupCheck && p.dupCheck.block)) {
            return { ...p, rawResult: null, toolMessageContent: null, userChoiceId: null, execError: null };
          }
          try {
            const effectiveArgs = p.dupCheck.args;
            const notice = p.dupCheck.notice;
            const rawResult = await Promise.resolve(p.tool.func(effectiveArgs));

            // ★ request_user_choice 特殊处理：tool.func 返回结构化对象 {id, marker, payload}
            //   - userChoiceId：从对象提取 id，用于 recordToolCall 写入 registry
            //   - toolMessageContent：从对象提取 marker（字符串），用于阶段 3 push 到 messages
            //   - 其他工具：toolMessageContent 默认 = rawResult（兼容）
            let userChoiceId = null;
            let toolMessageContent = rawResult;
            if (p.toolName === 'request_user_choice' && rawResult && typeof rawResult === 'object' && rawResult.marker) {
              userChoiceId = rawResult.id;
              toolMessageContent = rawResult.marker;
            }

            recordToolCall(p.toolName, effectiveArgs, sessionId, userChoiceId);
            return { ...p, rawResult, toolMessageContent, userChoiceId, execError: null, notice };
          } catch (e) {
            return { ...p, rawResult: null, toolMessageContent: null, userChoiceId: null, execError: e };
          }
        }));

        // 阶段 3：按原始 tool_calls 顺序写回 messages（保证 LLM 看到的 tool 顺序与调用顺序一致）
        for (const p of execResults) {
          if (!p.tool) continue;
          const toolCall = p.toolCall;
          const toolName = p.toolName;
          const toolCallId = p.toolCallId;
          const toolArgs = toolCall.function.arguments || '{}';

          if (p.dupCheck && p.dupCheck.block) {
            queueLog(`🚫 拦截重复调用: ${toolName} sessionId=${sessionId} args=${toolArgs}`, true, username);
            yield { type: 'tool_return', log: `🚫 拦截重复调用: ${toolName}\n参数: ${toolArgs}\n${p.dupCheck.message}` };
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: p.dupCheck.message
            });
            continue;
          }

          if (p.execError) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: `Error: ${p.execError.message}`
            });
            continue;
          }

          // ★ 优先用 p.toolMessageContent（request_user_choice 已拆为 marker 字符串）
          //   fallback 到原 notice+rawResult 逻辑
          const resultContent = p.toolMessageContent
            || (p.notice ? `${p.notice}\n\n${p.rawResult}` : p.rawResult);
          yield { type: 'tool_return', log: `📋 工具 ${toolName} 返回:\n${typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent)}` };
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: resultContent
          });

          // ★ 检测 request_user_choice 工具 → 设置终止信号
          // p.rawResult 是结构化对象 {id, marker, payload}，提取 marker 用于正则解析
          if (p.toolName === 'request_user_choice' && p.rawResult && typeof p.rawResult === 'object' && p.rawResult.marker) {
            const marker = p.rawResult.marker || '';
            const match = marker.match(/<!--user_choice:(\{[\s\S]*?\})-->/);
            if (match) {
              try {
                pendingUserChoice = JSON.parse(match[1]);
                logger.info('user_choice tool detected, terminating TURN 1', {
                  sessionId, id: pendingUserChoice.id, question: pendingUserChoice.question
                });
              } catch (e) {
                logger.warn('user_choice marker parse failed', { sessionId, error: e.message, raw: marker.slice(0, 200) });
                // 解析失败：fall through，不终止（LLM 继续正常流程）
              }
            }
          }
        }

        // ★ 跳出 while 循环：检测到 request_user_choice 后 TURN 1 终止
        if (pendingUserChoice) break;

        maxToolCalls--;
        continue;
      }

      break;      
    } catch (e) {
      if (e.name === 'AbortError') {
        yield { type: 'error', content: '请求已被用户中断' };
      } else {
        yield { type: 'error', content: e.message };
      }
      return;
    }
  }

  // ★ request_user_choice 终止分支：TURN 1 在工具循环处硬性结束
  // LLM 调用 request_user_choice 后：
  //   1) 持久化 messages（含 tool marker，Turn 2 要 load）
  //   2) 写日志（payload 详情 + dbSaveOk 状态）
  //   3) yield done 携带 userChoiceRequest 事件字段
  //   4) DB 写失败时降级（不弹窗，让 LLM 继续）
  // 详见 project_memory.md "TURN 1 终止边界" + "程序硬控原则"
  if (pendingUserChoice) {
    let dbSaveOk = true;
    if (sessionId) {
      try {
        saveMessagesToDb(sessionId, messages);
      } catch (e) {
        // 现有 saveMessagesToDb 内部已有 try/catch + error 日志
        // 但仍可能因异常路径未覆盖（死锁/超时）走到这里
        dbSaveOk = false;
        logger.error('CRITICAL: saveMessagesToDb failed for user_choice flow', {
          sessionId, error: e.message
        });
      }
    }

    queueLog(
      `🔔 TURN 1 终止 - user_choice 请求: id=${pendingUserChoice.id} question="${String(pendingUserChoice.question || '').slice(0, 80)}" options=${JSON.stringify(pendingUserChoice.options)} multi_select=${!!pendingUserChoice.multi_select} dbSaveOk=${dbSaveOk}`,
      true, username
    );
    flushLogs();

    // 降级处理：DB 写失败 → 不弹窗，让 LLM 继续
    if (!dbSaveOk) {
      logger.warn('DB save failed, falling back to LLM continuation', { sessionId });
      yield {
        type: 'done',
        sql: '',
        message: responseText + '\n\n（系统提示：用户交互持久化失败，请基于已有信息继续）',
        userChoiceRequest: null  // null 告诉前端不弹窗
      };
      return;
    }

    // 正常路径：yield done 携带 userChoiceRequest
    yield {
      type: 'done',
      sql: '',
      message: responseText,
      userChoiceRequest: pendingUserChoice
    };
    return;
  }

  // 返回 markdown 格式的结果
  const message = responseText;

  queueLog(`=== BAK 完成 SQL: ${sql || responseText}`, true, username);
  flushLogs();
  yield { type: 'done', sql: '', message };
}

// （已废弃：generateSQLWithLangChainStreamGen 从未被任何代码调用，2026-06 阶段性优化清理）
// （已废弃：generateSQLWithLangChainStreamGenV2 从未被任何代码调用，2026-06 阶段性优化清理）

/* ============================ "我的查询"专用非流式 LLM ============================ */

/**
 * 非流式单轮 LLM 调用（专用于"我的查询"等轻量任务）
 *
 * 与流式 BAK 函数的差异：
 *   - stream=false，一次性返回完整文本
 *   - 强制 response_format=json_object，约束模型输出合法 JSON
 *   - 当 provider === 'deepseek' 时，强制使用 FAVORITE_LLM_MODEL 环境变量或 'deepseek-chat'，
 *     避免在小任务上消耗 deepseek-v4-flash 快速模型配额
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {AbortSignal} [signal]
 * @returns {Promise<{content: string, usage: object, model: string}>}
 * @throws 任何非 2xx 响应或 fetch 错误；调用方应直接 500 给前端
 */
export async function callLlmForFavorite(systemPrompt, userPrompt, signal) {
  const cfg = getLlmConfig();
  if (!cfg) {
    throw new Error('LLM 未配置');
  }
  const provider = cfg.provider;
  // 强制覆盖 model：deepseek 走非快速模型
  const model = provider === 'deepseek'
    ? (process.env.FAVORITE_LLM_MODEL || 'deepseek-chat')
    : cfg.model;
  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;
  const apiKey = cfg.apiKey;

  const tFetch = withTimeout(signal, LLM_TIMEOUTS.FETCH_MS, 'callLlmForFavorite fetch');
  let res;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        stream: false,
        response_format: { type: 'json_object' }
      }),
      signal: tFetch.signal
    });
  } catch (e) {
    if (e.name === 'AbortError' || /timeout/i.test(e.message || '')) {
      if (tFetch.isExternalAbort()) throw e;
      throw new Error(`LLM 响应超时（>${LLM_TIMEOUTS.FETCH_MS / 1000}s）`);
    }
    throw e;
  } finally {
    tFetch.cancel();
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson?.error?.message || detail;
    } catch (_) { /* ignore */ }
    throw new Error(`LLM 调用失败 (${res.status}): ${detail}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const usage = json.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return { content, usage, model: llmModel };
}

export { loadSkillMd };
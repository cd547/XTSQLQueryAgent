import { getLlmConfig, getAgentConfig } from './config.js';
import { logger } from '../logger.js';
import { loadTableIndex, loadSkillMd, tools } from './toolFuncs.js';
import { getDb } from '../db/sqlite.js';
import { countMessagesTokens } from './tokenizer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = config.logPath;

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

function writeLlmLog(content) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const logFile = path.join(LOGS_PATH, `llm_${dateStr}.log`);
  const timestamp = now.toISOString();
  const logLine = `${timestamp}: ${content}\n`;
  fs.appendFileSync(logFile, logLine, 'utf-8');
}

const LOG_BUFFER = [];
let flushTimer = null;

function flushLogs() {
  if (LOG_BUFFER.length === 0) return;
  const flushing = LOG_BUFFER.splice(0);
  const content = flushing.join('\n');
  writeLlmLog(content);
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
      tableDdl: new Set(),
      termConfirmed: new Set(),
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
  const ddlList = [...reg.tableDdl].sort().join(', ') || '无';
  const tablesFlag = reg.getTablesCalled ? '已调用' : '未调用';
  return [
    `- get_domain_index: ${domainIndexFlag}`,
    `- get_sliced_index 已覆盖的域: ${slicedDomainsList}`,
    `- get_tables: ${tablesFlag}`,
    `- 已获取 field_config 的表: ${schemaList}`,
    `- 已获取 DDL 的表: ${ddlList}`,
  ].join('\n');
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

  if (toolName === 'get_table_schema' || toolName === 'get_table_ddl') {
    const requested = normalizeTableNames(args.table_names);
    if (requested.length === 0) return { block: false, args };
    const target = toolName === 'get_table_schema' ? reg.tableSchema : reg.tableDdl;
    const dupes = requested.filter(n => target.has(n));
    const fresh = requested.filter(n => !target.has(n));

    if (dupes.length === requested.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】工具 ${toolName} 中的所有表在本会话中都已被获取过: ${dupes.join(', ')}。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止重复调用 ${toolName}。\n` +
          `如需获取尚未在清单中的表，请重新传入只包含新表的 table_names 参数。`
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, table_names: fresh },
        notice:
          `ℹ️ 自动过滤重复表（已在清单中）: ${dupes.join(', ')}。仅对 [${fresh.join(', ')}] 执行 ${toolName}。\n` +
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

  return { block: false, args };
}

/**
 * 记录一次成功执行的工具调用。必须在工具真正执行成功后调用。
 */
function recordToolCall(toolName, args, sessionId) {
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
    normalizeTableNames(args.table_names).forEach(n => reg.tableDdl.add(n));
  } else if (toolName === 'request_tag_confirmation') {
    const termsRaw = args.term;
    const terms = Array.isArray(termsRaw) ? termsRaw : (termsRaw ? [termsRaw] : []);
    const table = args.table || '';
    terms.forEach(t => reg.termConfirmed.add(`${t}::${table}`));
  }
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

function queueLog(content, immediate = false) {
  LOG_BUFFER.push(content);
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
export async function* generateSQLWithLangChainStreamGen_BAK(question, history = '', signal, sessionId = null) {
  logger.info('generateSQLWithLangChainStreamGen_BAK called (backup)', { question, historyLength: history?.length, sessionId });
  
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
${skillMd}

## 用户问题`;

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
  let responseText = '';
  let sql = '';
  
  while (maxToolCalls > 0) {
    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      tools: toolsDefinition,
      thinking: {
        type: 'enabled'
      }
    };

    if (signal?.aborted) {
      yield { type: 'error', content: '请求已被用户中断' };
      return;
    }

    queueLog('generateSQLWithLangChainStreamGen_BAK Round ' + (31 - maxToolCalls) + ' Request:\n' + JSON.stringify(requestParams, null, 2), true);

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

      // 输出LLM的思考过程（reasoning）
      if (reasoningContent) {
        yield { type: 'LLM', log: `💭 LLM思考过程:\n${reasoningContent.slice(0, 10000)}` };
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
      const assistantMsg = {
        role: 'assistant',
        content: responseText || '',
        reasoning_content: reasoningContent || '',
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
            return { ...p, rawResult: null, execError: null };
          }
          try {
            const effectiveArgs = p.dupCheck.args;
            const notice = p.dupCheck.notice;
            const rawResult = await Promise.resolve(p.tool.func(effectiveArgs));
            recordToolCall(p.toolName, effectiveArgs, sessionId);
            return { ...p, rawResult, execError: null, notice };
          } catch (e) {
            return { ...p, rawResult: null, execError: e };
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
            queueLog(`🚫 拦截重复调用: ${toolName} sessionId=${sessionId} args=${toolArgs}`, true);
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

          const resultContent = p.notice ? `${p.notice}\n\n${p.rawResult}` : p.rawResult;
          yield { type: 'tool_return', log: `📋 工具 ${toolName} 返回:\n${resultContent}` };
          messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: resultContent
          });
        }

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

  // 返回 markdown 格式的结果
  const message = responseText;

  queueLog(`=== BAK 完成 SQL: ${sql || responseText}`, true);
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
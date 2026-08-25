import { getLlmConfig, getAgentConfig } from "./config.js";
import { isVisionModel } from "./vision.js";
import { logger } from "../logger.js";
import {
  loadTableIndex,
  loadSkillMd,
  tools,
  LLM_TOOLS,
  formatTableInfoCompact,
  sliceTableIndexByDomains,
  buildSystemMessage,
} from "./toolFuncs.js";
import { getDb } from "../db/sqlite.js";
import { countMessagesTokens } from "./tokenizer.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { ensureDir } from "../utils/fs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = config.logPath;

/**
 * 把任意用户名清洗为文件系统安全的形式：
 *   - 仅保留 [a-zA-Z0-9_-]，其它字符替换为 _
 *   - 长度上限 50 字符
 *   - 空结果回退为 "unknown"（保证日志文件不会因为边界值缺失）
 */
function sanitizeUsername(name) {
  if (!name || typeof name !== "string") return "unknown";
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  return cleaned || "unknown";
}

/**
 * 修复 LLM tool_call arguments 字符串中"字符串值"内的裸 ASCII 双引号。
 *
 * LLM 经常在 question/options 等自由文本字段里直接引用用户原话：
 *   {"q": "您说的"内部"是指？"}          ← 非法 JSON（结构分隔符被破坏）
 *
 * 状态机策略：
 *   - 跟踪是否在字符串值内（inString）
 *   - 遇到 " 时如果不在字符串内 → 进入字符串（保留）
 *   - 在字符串内遇到 "：peek 下一个非空白字符
 *       - 是 , ] } :  或 EOF → 字符串结束（保留）
 *       - 否则 → 字符串内的裸引号 → 替换为右中文引号 "
 *   - 跳过转义序列 \" \\ \/ \n \t 等，避免误判
 *
 * 不会破坏：
 *   - 合法 JSON（结构边界是 , ] } : 或 EOF）
 *   - 已转义的引号 \"（跳过整段转义序列）
 *
 * 仅在 JSON.parse 失败的 catch 块内调用，正常情况不动原始字符串。
 */
// ★ Phase 2 Step 2: 纯加法 export（供 agentHelpers.js 复用，不动实现）
export function fixBareQuotesInJsonArgs(s) {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // 跳过转义序列
    if (inString && c === '\\' && i + 1 < s.length) {
      result += c + s[i + 1];
      i += 2;
      continue;
    }
    if (c === '"') {
      if (!inString) {
        inString = true;
        result += c;
      } else {
        // peek 下一个非空白字符
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = j < s.length ? s[j] : '';
        // 字符串结束标志
        if (next === ',' || next === ']' || next === '}' || next === ':' || next === '') {
          inString = false;
          result += c;
        } else {
          // 字符串内裸引号 → 替换为右中文引号
          result += '\u201D';
        }
      }
    } else {
      result += c;
    }
    i++;
  }
  return result;
}

/**
 * 计算当前日期键（YYYY-MM-DD），用于按天分子目录。
 */
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 计算用户 LLM 日志文件绝对路径：logs/YYYY-MM-DD/{username}_llm.log
 * 边界：usernane 为空时落 _system_llm.log（与 Winston 系统日志风格一致）
 */
function llmLogFileFor(username) {
  const safe = sanitizeUsername(username);
  const dateDir = path.join(LOGS_PATH, todayKey());
  ensureDir(dateDir, "llm log date dir");
  // 当无法归属用户（如未登录、系统调用）时统一走 _system_ 命名
  const prefix = safe === "unknown" ? "_system" : safe;
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
  FETCH_MS: 120_000, // T2: 单轮 LLM API 调用上限
  READ_MS: 30_000, // T4: 单次流式 read 上限
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
    logger.warn(`${label} timed out`, {
      timeoutMs,
      elapsedMs: Date.now() - startedAt,
    });
  }, timeoutMs);

  // externalSignal 可选：未传时只保留内部超时能力，不挂外部 abort 监听
  let onExternalAbort = null;
  if (externalSignal && typeof externalSignal.addEventListener === "function") {
    onExternalAbort = () => {
      clearTimeout(timeoutId);
      controller.abort(externalSignal.reason);
    };
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timeoutId);
      if (onExternalAbort && externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
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
export async function withPromiseTimeout(
  fn,
  externalSignal,
  timeoutMs,
  label,
  onAbort,
) {
  let timeoutId;
  let externalListener = null;
  const cleanup = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (externalListener && externalSignal) {
      externalSignal.removeEventListener("abort", externalListener);
    }
  };
  return new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanup();
      if (onAbort)
        try {
          onAbort();
        } catch (_) {}
      logger.warn(`${label} timed out`, { timeoutMs });
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    if (
      externalSignal &&
      typeof externalSignal.addEventListener === "function"
    ) {
      externalListener = () => {
        cleanup();
        if (onAbort)
          try {
            onAbort();
          } catch (_) {}
        reject(externalSignal.reason);
      };
      externalSignal.addEventListener("abort", externalListener, {
        once: true,
      });
    }

    fn().then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      },
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
    try {
      ensureDir(dateDir, "llm log date dir fallback");
    } catch (_) {}
    logFile = path.join(dateDir, "_system_llm.log");
  }
  const logLine = `${timestamp}: ${content}\n`;
  try {
    fs.appendFileSync(logFile, logLine, "utf-8");
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
// ★ Phase 2 Step 3: 纯加法 export
export function splitThinkingFromContent(responseText) {
  if (
    !responseText ||
    typeof responseText !== "string" ||
    !responseText.includes("```")
  ) {
    return { content: responseText || "", extraThinking: "" };
  }
  const firstCodeBlockIdx = responseText.indexOf("```");
  const before = responseText.substring(0, firstCodeBlockIdx).trim();
  const after = responseText.substring(firstCodeBlockIdx);
  const isLongPrefix = before.length > 100;
  const hasThinkingMarker =
    /(让我|等等|我发现|我注意到|我决定|实际上|让我再想|让我先|我先|继续|我开始|我准备|让我再)/.test(
      before,
    );
  const hasMultipleLines = (before.match(/\n/g) || []).length >= 2;
  if (isLongPrefix && hasThinkingMarker && hasMultipleLines) {
    return { content: after.trim(), extraThinking: before };
  }
  return { content: responseText, extraThinking: "" };
}

// LLM 日志缓冲：每条记录带 username（"日期 / 用户"分文件场景下，按用户聚合后再 flush）
// 结构：{ username, content } — flush 时按 username 分组聚合，再走 writeLlmLog
const LOG_BUFFER = [];
let flushTimer = null;

export function flushLogs() {
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
    writeLlmLog(lines.join("\n"), u);
  }
}

// 进程级全局缓存：记录最近一次 LLM 调用的完整 messages 数组。
// 当前仅供开发期调试接口 GET /api/query/messages 使用（前端未调用）。
// 注意：此处没有按 userId 区分，任何调用方都会拿到最后一个提问者的内容。
let lastMessages = null;

export function getLastMessages() {
  return lastMessages;
}

// ★ Phase 2 B1: setter（与 getLastMessages 对偶，供 responsesApi.js 同步 lastMessages 全局缓存）
//   ★ 深拷贝原因（与 CC path L1558 `lastMessages = JSON.parse(JSON.stringify(messages))` 1:1 对齐）：
//     CC 路径不深拷贝会让调试接口 GET /api/query/messages 返回"未来轮次"消息
//     （因为 messages 后续会被 push 新 tool 消息，原引用 lastMessages 也跟着变），
//     深拷贝隔离让 GET 始终返回"调用 setter 那一刻的快照"
export function setLastMessages(messages) {
  lastMessages = JSON.parse(JSON.stringify(messages));
}

// ============================================================
// 工具调用注册表（用于程序化拦截重复调用，规则 10）
// ============================================================
// 会话级状态：跟踪已调用过的工具及其关键参数，避免 LLM 重复获取
// 已有信息（schema/ddl/get_tables/tag 确认/域路由）。跨多次 invoke 持久，
// 会话删除或 llm_messages 清空时通过 clearSessionRegistry 释放。
const sessionToolRegistries = new Map();

export function getOrCreateRegistry(sessionId) {
  if (!sessionId) return null;
  if (!sessionToolRegistries.has(sessionId)) {
    sessionToolRegistries.set(sessionId, {
      getTablesCalled: false,
      // F18 (2026-08): get_domain_index 已迁移至 system 消息内嵌，不再作为 LLM 工具调用。
      //   - 工具本身在 toolFuncs.js 仍保留为"已废弃"定义，用于兼容旧会话 history
      //   - 剪枝 / 重复调用拦截 / checklist 均已移除（域清单在 system 中永久可见）
      slicedDomains: new Set(), // 已通过 get_sliced_index 加载过的域 ID
      tableSchema: new Set(),
      // F10: get_table_ddl 已合并到 get_table_schema（v4 起 DDL 物理结构 +
      //   索引/外键 全部并入 schema 的 fields 子结构），工具本身从 registry
      //   中移除。LLM 只需调用一次 get_table_schema 即可获得物理+语义全量信息。
      termConfirmed: new Set(),
      // request_user_choice 注册表：key = id (uc_xxx) —— 记录已问过哪些问题
      // 用于 checklist 显示 + 拦截完全相同 (question, options) 组合的重复调用（Q-09 = B）
      userChoiceAsked: new Map(), // id -> {question, options, multiSelect, header, signature}
      // validate_sql_fields 注册表：追踪 LLM 是否调用 + 通过状态
      // 状态显示器（buildToolCallChecklistMessage）展示给 LLM 让其"看到"自己已调/未调/通过/失败
      // 注意：仅用于 LLM 上下文提示，**不强制拦截**——LLM 可自由跳过（参见 plan D-12 仅 LLM 自检）
      //
      // === 问题级独立状态（per-question）===
      // validateSqlFields* 是"本问题独立"的状态：每次新 user 消息到来时由
      // resetPerQuestionRegistryFlags 重置。理由：checklist 里的"✓passed"是
      // 上一问题的 SQL 校验结果，跟当前问题无关，残留会误导 LLM 误判"已通过，
      // 不要再调"，进而漏掉对新 SQL 的校验。
      // 同一问题内的 Round 1+ 不重置（校验失败重写场景需要这些状态来提示 LLM）。
      validateSqlFieldsCalled: false,
      validateSqlFieldsPassed: false,
      validateSqlFieldsErrorCount: 0,
      // F23 (2026-08): get_call_history 累积的"已调用工具"快照。
      //   - 由 llm.js 工具执行循环自动写入（每调一个非 get_call_history 工具就 push）
      //   - 由 get_call_history 工具拦截器读取并返回给 LLM
      //   - 持久化到 history 避免 prefix cache 中断（每轮 LLM 看到稳定的累积 tool 消息）
      //   - resetRegistryForNewQuestion 在新问题时清空
      //   - 防重复：同工具同参数不重复登记（即使 LLM 误调重复也只记录一次）
      callHistory: [],
      // F23 (2026-08): get_call_history 循环检测计数器。
      //   - LLM 看到历史里的 synthetic get_call_history 后可能模仿调用；
      //   - 若连续两轮 LLM 只调用 get_call_history（无其他工具），强制 break 跳出循环。
      //   - resetRegistryForNewQuestion 在新问题时清零。
      gchLoopCount: 0,
    });
  }
  return sessionToolRegistries.get(sessionId);
}

/**
 * 重置注册表里的"问题级独立"标志。
 *
 * 调用时机：每次新 user 消息到来时（即 runSqlAgent 入口）。
 * 不重置会话级持久状态（slicedDomains / tableSchema /
 * termConfirmed / userChoiceAsked / getTablesCalled），因为这些
 * 跟踪的是"已加载到 history 的数据"，数据本身跨问题仍然有效，重取会浪费 token。
 * （getDomainIndexCalled 已在 F18 移除：域清单已嵌入 system 永久可见）
 *
 * 历史 Bug 2026-07-28：未做此重置时，Q1 校验通过的"✓passed"会残留在 Q2/Q3 的
 * checklist 里，误导 LLM 跳过本轮 SQL 校验。
 */
// ★ Phase 2 Step 3: 纯加法 export
export function resetPerQuestionRegistryFlags(reg) {
  if (!reg) return;
  reg.validateSqlFieldsCalled = false;
  reg.validateSqlFieldsPassed = false;
  reg.validateSqlFieldsErrorCount = 0;
}

/**
 * 检测"本次 user 消息是否是 request_user_choice 中断后的续问"。
 *
 * 判定依据：加载的历史消息中，最后一条 user 消息（即本次问题）紧邻的前一条
 * 必须是 tool 消息且内容含 `<!--user_choice:` 标记 —— 表示上一轮以
 * `request_user_choice` 中断（用户作答后前端合成一条 user 消息继续同一问题）。
 *
 * @param {Array} messages - 已加载并追加本次 user 消息后的 messages 数组
 * @returns {boolean}
 */
export function detectUserChoiceContinuation(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) return false;
  const prev = messages[lastUserIdx - 1];
  if (!prev || prev.role !== "tool") return false;
  const content = typeof prev.content === "string" ? prev.content : "";
  return content.includes("<!--user_choice:");
}

/**
 * 每次新 user 消息（= 一次 /generate 调用）时重置"问题级"状态。
 *
 * - validateSqlFields* 始终重置（本问题内的校验计数）。
 * - 域路由相关状态（slicedDomains / tableSchema /
 *   termConfirmed / userChoiceAsked / getTablesCalled）：
 *   * 新问题 → 全部清空，允许模型重新 get_sliced_index 路由新域；
 *   * request_user_choice 中断后的续问 → 保留（同一问题继续，无需重新路由）。
 *   （F18: getDomainIndexCalled 已移除，域清单永久在 system 中可见）
 *
 * @param {object|null} reg - 会话工具调用注册表
 * @param {Array} messages - 已加载并追加本次 user 消息后的 messages 数组
 */
export function resetRegistryForNewQuestion(reg, messages) {
  if (!reg) return;
  resetPerQuestionRegistryFlags(reg);
  if (detectUserChoiceContinuation(messages)) {
    logger.info("user_choice 续问：保留域路由状态", {
      slicedDomains: [...reg.slicedDomains],
    });
    return;
  }
  // 新问题：清空域路由相关"问题级"状态，允许重新路由新业务域
  // （F18: getDomainIndexCalled 不再维护；新问题由"可用业务域"在 system 永久可见，
  //   模型不会重复调用 get_domain_index）
  reg.slicedDomains.clear();
  reg.tableSchema.clear();
  reg.termConfirmed.clear();
  reg.userChoiceAsked.clear();
  reg.getTablesCalled = false;
  // F23 (2026-08): get_call_history 累积清空（新问题历史从零开始）
  reg.callHistory = [];
  // F23 (2026-08): get_call_history 循环计数器清零
  reg.gchLoopCount = 0;
  logger.info("新问题：已清空域路由状态");
}

function normalizeTableNames(arr) {
  if (!Array.isArray(arr)) return [];
  return [
    ...new Set(arr.filter((n) => typeof n === "string" && n.trim())),
  ].sort();
}

function buildChecklist(reg) {
  if (!reg) return "（空）";
  // F18: get_domain_index 已从 registry 移除（域清单内嵌 system），
  //   checklist 不再展示该条目。
  const slicedDomainsList = [...reg.slicedDomains].sort().join(", ") || "无";
  const schemaList = [...reg.tableSchema].sort().join(", ") || "无";
  const tablesFlag = reg.getTablesCalled ? "已调用" : "未调用";
  return [
    `- get_sliced_index 已覆盖的域: ${slicedDomainsList}`,
    `- get_tables: ${tablesFlag}`,
    `- 已获取 schema（含 DDL/索引/外键）的表: ${schemaList}`,
  ].join("\n");
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
// ★ Phase 2 Step 3: 纯加法 export
export function buildToolCallChecklistMessage(reg) {
  if (!reg) return null;
  const parts = [];
  // F18: get_domain_index 不再追踪（域清单在 system 中永久可见）
  if (reg.getTablesCalled) parts.push("get_tables:✓");
  if (reg.slicedDomains.size > 0)
    parts.push(`get_sliced_index:[${[...reg.slicedDomains].sort().join(",")}]`);
  if (reg.tableSchema.size > 0)
    parts.push(`get_table_schema:[${[...reg.tableSchema].sort().join(",")}]`);
  if (reg.termConfirmed.size > 0) {
    const items = [...reg.termConfirmed].map((s) => s.replace("::", "@"));
    parts.push(`request_tag_confirmation:[${items.join(",")}]`);
  }
  if (reg.userChoiceAsked && reg.userChoiceAsked.size > 0) {
    // 显示所有 userChoiceAsked 项（id + question 预览 50 字符），不截断
    // 不同 question 都允许，重复由 checkAndFilterDuplicateCall 拦截
    const items = [...reg.userChoiceAsked.entries()].map(([id, v]) => {
      const q = String(v?.question || "")
        .slice(0, 50)
        .replace(/[|:]/g, " ");
      return `${id}:"${q}"`;
    });
    parts.push(`request_user_choice:[${items.join("|")}]`);
  }
  // validate_sql_fields：显示 LLM 自检状态（可重复调用，不受"禁止重复调用"约束）
  //   passed=true: LLM 至少一次校验通过 → 可输出 SQL
  //   passed=false: 上次校验有 N 个 errors → LLM 应重写 SQL 后再次调用直到通过
  //   called=false: LLM 还没调用 → 应在输出 SQL 前调用
  //   注：本工具**不被剪枝**也不被"重复调用"拦截，是稳定工具（不剪枝，可反复调用）
  //   状态范围：per-question（由 resetPerQuestionRegistryFlags 在每次新 user
  //   消息时重置），与上面的会话级持久状态（slicedDomains 等）不同。
  if (reg.validateSqlFieldsCalled) {
    const status = reg.validateSqlFieldsPassed
      ? "✓passed"
      : `✗failed(${reg.validateSqlFieldsErrorCount} errors)`;
    parts.push(`validate_sql_fields:${status}`);
  }
  if (parts.length === 0) return null;
  return {
    role: "system",
    // 精简版 checklist：只列出已调用工具，重复调用约束交给 SKILL.md 第 9 节
    // + checkAndFilterDuplicateCall 程序拦截。约 30 tokens（原 200 tokens）
    content: `🔁 已调用: ${parts.join(" | ")}`,
  };
}

/**
 * 检查工具调用是否重复，并对部分重复的参数进行过滤。
 * @returns {{block: boolean, args: object, message?: string, notice?: string}}
 *   - block=true: 整次调用被拦截，message 为返回给 LLM 的提示
 *   - block=false: 允许调用；args 为（可能过滤后的）参数；notice 为可选的附加提示
 */
export function checkAndFilterDuplicateCall(toolName, args, sessionId) {
  const reg = getOrCreateRegistry(sessionId);
  if (!reg) return { block: false, args };

  if (toolName === "get_tables") {
    if (reg.getTablesCalled) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】get_tables 在本会话中已被调用过一次，table_index 数据已存在于你的上下文中。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止再次调用 get_tables。`,
      };
    }
    return { block: false, args };
  }

  // F18: get_domain_index 已废弃（description 显式标记），
  //   不再拦截重复调用（registry 中也无对应标志位）。
  //   若 LLM 仍调用本工具 → 正常执行返回域列表（无害，等价于 system 中已有内容）。

  if (toolName === "get_sliced_index") {
    const requestedDomains = normalizeTableNames(args.domain_ids);
    if (requestedDomains.length === 0) return { block: false, args };
    const dupes = requestedDomains.filter((d) => reg.slicedDomains.has(d));
    const fresh = requestedDomains.filter((d) => !reg.slicedDomains.has(d));

    if (dupes.length === requestedDomains.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】get_sliced_index 中所有域在本会话中都已被加载过: ${dupes.join(", ")}。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止重复加载相同域。\n` +
          `如需加载尚未覆盖的域，请重新传入只包含新域的 domain_ids 参数。`,
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, domain_ids: fresh },
        notice:
          `ℹ️ 自动过滤已加载域: ${dupes.join(", ")}。仅对 [${fresh.join(", ")}] 执行 get_sliced_index。\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}`,
      };
    }
    return { block: false, args };
  }

  if (toolName === "get_table_schema") {
    const requested = normalizeTableNames(args.table_names);
    if (requested.length === 0) return { block: false, args };
    const target = reg.tableSchema;
    const dupes = requested.filter((n) => target.has(n));
    const fresh = requested.filter((n) => !target.has(n));

    if (dupes.length === requested.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】工具 get_table_schema 中的所有表在本会话中都已被获取过: ${dupes.join(", ")}。\n\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}\n\n` +
          `请直接复用已有信息，禁止重复调用 get_table_schema。\n` +
          `如需获取尚未在清单中的表，请重新传入只包含新表的 table_names 参数。`,
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, table_names: fresh },
        notice:
          `ℹ️ 自动过滤重复表（已在清单中）: ${dupes.join(", ")}。仅对 [${fresh.join(", ")}] 执行 get_table_schema。\n` +
          `📋 已有信息清单:\n${buildChecklist(reg)}`,
      };
    }
    return { block: false, args };
  }

  if (toolName === "request_tag_confirmation") {
    const termsRaw = args.term;
    const terms = Array.isArray(termsRaw)
      ? termsRaw
      : termsRaw
        ? [termsRaw]
        : [];
    const table = args.table || "";
    const dupes = terms.filter((t) => reg.termConfirmed.has(`${t}::${table}`));
    const fresh = terms.filter((t) => !reg.termConfirmed.has(`${t}::${table}`));
    if (terms.length === 0) return { block: false, args };

    if (dupes.length === terms.length) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】request_tag_confirmation 中所有术语（table=${table}）在本会话中都已请求过确认: ${terms.join(", ")}。\n` +
          `请勿重复请求。`,
      };
    }
    if (dupes.length > 0) {
      return {
        block: false,
        args: { ...args, term: fresh },
        notice: `ℹ️ 自动过滤已确认术语（table=${table}）: ${dupes.join(", ")}。仅对新术语 [${fresh.join(", ")}] 执行。`,
      };
    }
    return { block: false, args };
  }

  if (toolName === "request_user_choice") {
    // Q-09 = B：拦截完全相同 (question, options, multi_select) 组合的重复调用
    // 不同问题/不同选项都允许——只拦"完全相同"，与 request_tag_confirmation 同构
    const sig = computeUserChoiceSignature(args);
    let isDupe = false;
    for (const [, v] of reg.userChoiceAsked) {
      if (v && v.signature === sig) {
        isDupe = true;
        break;
      }
    }
    if (isDupe) {
      return {
        block: true,
        message:
          `⚠️ 【重复调用已被程序拦截】request_user_choice 中完全相同的问题/选项/类型在本会话中已被问过: "${String(args?.question || "").slice(0, 80)}"。\n` +
          `请基于用户上次回复继续生成 SQL；如需追问不同问题，请使用不同 question 或 options。`,
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
// ★ Phase 2 Step 2: 纯加法 export
export function recordToolCall(toolName, args, sessionId, overrideId = null) {
  const reg = getOrCreateRegistry(sessionId);
  if (!reg) return;
  if (toolName === "get_tables") {
    reg.getTablesCalled = true;
  } else if (toolName === "get_sliced_index") {
    normalizeTableNames(args.domain_ids).forEach((d) =>
      reg.slicedDomains.add(d),
    );
  } else if (toolName === "get_table_schema") {
    normalizeTableNames(args.table_names).forEach((n) =>
      reg.tableSchema.add(n),
    );
  } else if (toolName === "request_tag_confirmation") {
    const termsRaw = args.term;
    const terms = Array.isArray(termsRaw)
      ? termsRaw
      : termsRaw
        ? [termsRaw]
        : [];
    const table = args.table || "";
    terms.forEach((t) => reg.termConfirmed.add(`${t}::${table}`));
  } else if (toolName === "request_user_choice") {
    // v3: args.questions[] 数组（新契约）
    //   - 多个 question 合并为 composite signature 防同 args 重复
    //   - 用 overrideId（来自 tool.func 的 {ids:[...]}）作主 id
    // 兼容旧版 args（万一 LLM 还用旧 schema）
    const id = overrideId || (args && args.id) || "uc_unknown_" + Date.now();
    const questions = Array.isArray(args?.questions) ? args.questions : null;
    let signature,
      primaryQuestion,
      primaryOptions,
      primaryMultiSelect,
      primaryHeader;
    if (questions && questions.length > 0) {
      signature = questions
        .map(
          (q) =>
            `${String(q?.question || "").trim()}|${(Array.isArray(q?.options) ? q.options : []).join("||")}|${!!q?.multi_select}`,
        )
        .join(";;;");
      primaryQuestion = questions[0]?.question || "";
      primaryOptions = Array.isArray(questions[0]?.options)
        ? questions[0].options
        : [];
      primaryMultiSelect = !!questions[0]?.multi_select;
      primaryHeader = questions[0]?.header || "";
    } else {
      // 兼容旧版
      primaryOptions = Array.isArray(args?.options) ? args.options : [];
      primaryQuestion = args?.question || "";
      primaryMultiSelect = !!args?.multi_select;
      primaryHeader = args?.header || "";
      signature = `${String(primaryQuestion).trim()}|${primaryOptions.join("||")}|${primaryMultiSelect}`;
    }
    reg.userChoiceAsked.set(id, {
      question: primaryQuestion,
      options: primaryOptions,
      multiSelect: primaryMultiSelect,
      header: primaryHeader,
      questions: questions || undefined, // v3 新字段，标记新契约
      signature,
    });
  }
}

/**
 * 计算 request_user_choice 的 signature（用于 checkAndFilterDuplicateCall）
 * v3: 支持 questions[] 数组（composite signature）
 */
function computeUserChoiceSignature(args) {
  const questions = Array.isArray(args?.questions) ? args.questions : null;
  if (questions && questions.length > 0) {
    return questions
      .map(
        (q) =>
          `${String(q?.question || "").trim()}|${(Array.isArray(q?.options) ? q.options : []).join("||")}|${!!q?.multi_select}`,
      )
      .join(";;;");
  }
  // 兼容旧版
  const question = String(args?.question || "").trim();
  const options = Array.isArray(args?.options) ? args.options : [];
  return `${question}|${options.join("||")}|${!!args?.multi_select}`;
}

/**
 * 清除会话的工具调用注册表。在会话删除或 LLM 消息清空时调用。
 */
export function clearSessionRegistry(sessionId) {
  if (!sessionId) return;
  sessionToolRegistries.delete(sessionId);
  logger.info("Cleared tool call registry for session", { sessionId });
}

/**
 * 导出当前会话的信息清单快照（供调试或日志）。
 */
export function getSessionChecklist(sessionId) {
  const reg = getOrCreateRegistry(sessionId);
  if (!reg) return "（无 sessionId）";
  return buildChecklist(reg);
}

/**
 * 折叠已消费的 get_sliced_index tool result，降低已消费历史区的 token 开销与注意力稀释。
 *
 * 折叠策略：
 *   - "当前消费区"（最后一个含 tool_calls 的 assistant 及其之后）不折叠，LLM 需完整信息选表
 *   - "已消费历史区"（该 assistant 之前）：用精简版卡片替换，去掉 related_tables
 *     （schema 的 virtual_associations 可替代），保留 name/description/tags/business_constraints/business_rules
 *     （business_rules/constraints 与 field_config 不完全一致，部分表 field_config 为空）
 *
 * 折叠边界：只折叠 messages 中"最后一个含 tool_calls 的 assistant 之前"的 tool 消息（已消费历史区）。
 *   - 之后的 tool result 属于当前消费区，即将被下一轮 LLM 消费，必须完整
 *
 * 缓存：单请求级 cache-aside。foldedCache 由调用方传入，作用域为单次 /generate 调用。
 *   - key = tool_call_id，value = 折叠后 content
 *   - 缓存命中直接用，丢失则重新加载原始数据折叠并写入缓存
 *   - 函数作用域天然隔离多用户，不可能窜
 *
 * DeepSeek thinking_mode 协议兼容性：
 *   - 只改 tool 消息的 content 字段，不改 role / tool_call_id 结构
 *   - assistant.tool_calls 和 reasoning_content 保持不变（协议要求完整回传）
 *
 * @param {Array} messages - 累积的 messages 数组
 * @param {Map} foldedCache - 折叠缓存（单请求级，由调用方创建并传入）
 * @returns {Array} 折叠后的新数组（不修改原数组）
 */
// ★ Phase 2 Step 3: 纯加法 export
export async function compactConsumedToolResults(messages, foldedCache) {
  if (!Array.isArray(messages) || messages.length === 0 || !foldedCache)
    return messages;

  // 找到最后一个有 tool_calls 的 assistant 位置
  let lastToolCallIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (
      messages[i].role === "assistant" &&
      messages[i].tool_calls &&
      messages[i].tool_calls.length > 0
    ) {
      lastToolCallIdx = i;
      break;
    }
  }
  // 没有历史 tool_call，或只有当前轮（lastToolCallIdx=0 时前面无历史）→ 不折叠
  if (lastToolCallIdx <= 0) return messages;

  // 构建 tool_call_id → {toolName, args} 映射（只看 lastToolCallIdx 之前的 assistant）
  const toolCallInfo = new Map();
  for (let i = 0; i < lastToolCallIdx; i++) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id && tc.function?.name) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {}
          toolCallInfo.set(tc.id, { name: tc.function.name, args });
        }
      }
    }
  }

  let compactedCount = 0;
  const result = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    // 仅折叠 lastToolCallIdx 之前的 tool 消息
    if (i >= lastToolCallIdx || m.role !== "tool") {
      result.push(m);
      continue;
    }

    const info = m.tool_call_id ? toolCallInfo.get(m.tool_call_id) : null;
    if (!info || info.name !== "get_sliced_index") {
      result.push(m);
      continue;
    }

    // ★ 2026-08-13 修复（A19）：折叠前跳过"被拦截/失败"的 tool 消息。
    //   原逻辑只看参数 domain_ids 就重新生成真实表列表，会把"已剪枝/重复拦截"等
    //   错误消息"复活"成真实结果，让 LLM 误以为工具调用成功。
    const rawContent = typeof m.content === "string" ? m.content.trim() : "";
    if (/^(Error:|🚫)/.test(rawContent)) {
      result.push(m);
      continue;
    }

    // cache-aside: 命中直接用
    if (foldedCache.has(m.tool_call_id)) {
      result.push({ ...m, content: foldedCache.get(m.tool_call_id) });
      compactedCount++;
      continue;
    }

    // 缓存丢失：从 tool_calls 参数提取 domain_ids，重新加载原始数据折叠
    const domainIds = info.args?.domain_ids;
    if (!Array.isArray(domainIds) || domainIds.length === 0) {
      // 参数解析失败，不折叠（保持原 content）
      result.push(m);
      continue;
    }

    try {
      const sliced = await sliceTableIndexByDomains(domainIds);
      if (!sliced.tables || sliced.tables.length === 0) {
        result.push(m);
        continue;
      }
      const foldedContent = formatTableInfoCompact(sliced.tables);
      foldedCache.set(m.tool_call_id, foldedContent);
      result.push({ ...m, content: foldedContent });
      compactedCount++;
    } catch (e) {
      logger.warn("compactConsumedToolResults: fold failed, keep original", {
        tool_call_id: m.tool_call_id,
        error: e.message,
      });
      result.push(m);
    }
  }

  if (compactedCount > 0) {
    logger.debug("Compacted consumed tool results", {
      compactedCount,
      lastToolCallIdx,
      totalMessages: messages.length,
    });
  }

  return result;
}

// ★ Phase 2 Step 2: 纯加法 export
export function queueLog(content, immediate = false, username = null) {
  // username 由调用方（runSqlAgent）注入，
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

// ★ Phase 2 修复（Step 3 偏差遗漏）：纯加法 export
//   原因：getLlmConfig() 返回的 config 不含 baseURL 字段（DB 只存 provider/apiKey/model）
//   原 runSqlAgent L1115 调 getProviderConfig(provider, model) 从静态表派生 baseURL，
//   responsesApi.js 同样需要这个函数。1 行 export 关键词，无实现改动。
export function getProviderConfig(provider, model) {
  const configs = {
    openai: { baseURL: "https://api.openai.com/v1", model: "gpt-4o" },
    deepseek: {
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    },
    minimax: { baseURL: "https://api.minimax.chat/v1", model: "abab6.5s-chat" },
    ollama: { baseURL: "http://localhost:11434", model: "llama3.2" },
  };
  const cfg = configs[provider];
  if (!cfg) throw new Error(`不支持的provider: ${provider}`);
  return {
    baseURL: cfg.baseURL,
    llmModel: model || cfg.model,
  };
}

// ★ Phase 2 Step 2: 纯加法 export
export function saveMessagesToDb(sessionId, messages, apiMode = "chat_completions") {
  try {
    const db = getDb();
    const messagesJson = JSON.stringify(messages);

    // 异步计算 token 数
    const messageTokens = countMessagesTokens(messages);

    const existing = db
      .prepare("SELECT id FROM llm_messages WHERE session_id = ?")
      .get(sessionId);
    if (existing) {
      // ★ v5.14：只在新 apiMode 与现有不同时更新（保留历史会话的首次模式）
      //   避免每次 save 都覆盖、让前端看到稳定值
      db.prepare(
        "UPDATE llm_messages SET messages = ?, message_tokens = ?, api_mode = CASE WHEN api_mode IS NULL OR api_mode = '' THEN ? ELSE api_mode END, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?",
      ).run(messagesJson, messageTokens, apiMode, sessionId);
    } else {
      db.prepare(
        "INSERT INTO llm_messages (session_id, messages, message_tokens, api_mode) VALUES (?, ?, ?, ?)",
      ).run(sessionId, messagesJson, messageTokens, apiMode);
    }
    logger.debug("Saved messages to database", {
      sessionId,
      messageCount: messages.length,
      messageTokens,
    });
  } catch (e) {
    logger.error("Failed to save messages to database", { error: e.message });
  }
}

export function loadMessagesFromDb(sessionId) {
  try {
    const db = getDb();
    const record = db
      .prepare(
        "SELECT messages, message_tokens, api_mode FROM llm_messages WHERE session_id = ?",
      )
      .get(sessionId);
    if (record && record.messages) {
      const rawMessages = JSON.parse(record.messages);
      // ★ 2026-07-29: 修复"继续"时报 tool_calls 契约错误
      //   根因：saveMessagesToDb 在 line 1483 时机太早（assistant push 后、tool 响应入栈前），
      //         用户在工具执行过程中点停止时，DB 中最后一条 assistant 消息可能含未完整响应的 tool_calls。
      //         喂给 LLM 时 DeepSeek 拒绝：
      //         "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'"
      //   修复：load 时 sanitize —— 给缺失响应的 tool_call_id 补 synthetic tool 响应，
      //         内容标记为"用户中断,工具未完成"，让 LLM 看到完整契约又不丢失上下文。
      return {
        messages: sanitizeMessagesForLLM(rawMessages),
        messageTokens: record.message_tokens || 0,
        apiMode: record.api_mode || "chat_completions",  // ★ v5.14：返回 api_mode 供前端展示
      };
    }
    return null;
  } catch (e) {
    logger.error("Failed to load messages from database", { error: e.message });
    return null;
  }
}

/**
 * 修复"中断导致 messages 含未完成 tool_calls"问题
 *
 * 场景：用户在 LLM 工具执行过程中点停止时，由于 saveMessagesToDb 时机太早
 *   （line 1483: assistant push 后立刻 save,tool 响应在 line 1722/1743/1770 才入栈），
 *   DB 中的 messages 数组可能含：
 *     [..., assistant(tool_calls=[A,B]), tool(A)]   ← B 缺响应
 *   这种状态喂给 LLM 会报 tool_calls 契约错误。
 *
 * 修复策略：给缺失响应的 tool_call_id 补 synthetic tool 响应
 *   - 位置：紧跟所有已有的 tool 响应之后（按 tool_calls 顺序）
 *   - 内容：'[用户中断,工具未完成,调用未返回结果]'
 *   - 为什么是补响应而不是删 tool_calls：
 *       删 tool_calls 会让 LLM 失去"我做过这个工具调用"的信息；
 *       补响应让 LLM 明确知道中断状态，可基于已有信息继续或重新调用。
 *
 * @param {Array} messages 原始 messages 数组
 * @returns {Array} 补全后的 messages 数组（如果原数组已合法，原样返回）
 */
function sanitizeMessagesForLLM(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  // 从后往前找最后一个含 tool_calls 的 assistant 消息
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m?.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length > 0
    ) {
      lastAssistantIdx = i;
      break;
    }
  }

  // 没有含 tool_calls 的 assistant 消息,无需处理
  if (lastAssistantIdx === -1) return messages;

  const lastAssistant = messages[lastAssistantIdx];
  const toolCalls = lastAssistant.tool_calls;

  // 收集所有 tool_call_id 和已有响应的 tool_call_id
  const respondedIds = new Set();
  for (let i = lastAssistantIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role === "tool" && m.tool_call_id) {
      respondedIds.add(m.tool_call_id);
    }
  }

  // 找出未响应的 tool_call
  const unresponded = toolCalls.filter(
    (tc) => tc.id && !respondedIds.has(tc.id),
  );

  if (unresponded.length === 0) {
    return messages; // 全部有响应,消息数组合法,直接返回
  }

  logger.warn(
    "Sanitizing incomplete assistant tool_calls (interrupted mid-execution)",
    {
      lastAssistantIdx,
      unrespondedToolCallIds: unresponded.map((tc) => tc.id),
      respondedCount: respondedIds.size,
      totalCount: toolCalls.length,
    },
  );

  // 构造补全后的 messages 数组
  // 1) 复制到最后一个 assistant 之前的所有消息
  // 2) 复制最后一个 assistant 消息本身
  // 3) 复制 assistant 之后的所有 tool 响应（保持原顺序）
  // 4) 给未响应的 tool_call_id 补 synthetic 响应（按 tool_calls 顺序）
  const sanitized = [];
  for (let i = 0; i <= lastAssistantIdx; i++) {
    sanitized.push(messages[i]);
  }
  for (let i = lastAssistantIdx + 1; i < messages.length; i++) {
    if (messages[i]?.role === "tool") {
      sanitized.push(messages[i]);
    } else {
      // 遇到非 tool 消息,停止（防御性：正常情况不会有）
      break;
    }
  }
  for (const tc of unresponded) {
    sanitized.push({
      role: "tool",
      tool_call_id: tc.id,
      content: "[用户中断,工具未完成,调用未返回结果]",
    });
  }

  return sanitized;
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
//
// ★ F16 重命名（原名：generateSQLWithLangChainStreamGen_BAK，2026-08）
//   改名原因：
//     1. 原名含 "LangChain" 误导 —— 本函数不依赖 LangChain 框架
//        （无 AgentExecutor / ChatModel / langchain 运行时），仅 toolFuncs.js
//        的工具声明用 @langchain/core/tools 的 DynamicTool schema。
//     2. 原名含 "_BAK" 误导 —— "BAK" 后缀是 2026-06 阶段性优化清理的历史包袱，
//        原非 BAK 版本（generateSQLWithLangChainStreamGen / V2）当时被删除，
//        留下的 _BAK 才是唯一活跃入口，但"备份"语义早已名存实亡。
//   名称选择："runSqlAgent" —— 动词在前（匹配 loadSkillMd / validateSqlFields
//   项目惯例），"Agent" 反映多轮 tool-calling 循环本质，"Sql" 标注领域。
//   历史可追溯：原名仍出现在 git log / docs/执行流程.md / docs/superpowers/
//   reviews/ 与 plans/ 中（本注释作为锚点，git blame 可定位到此处）。
// ★ 2026-08-24：构建 user 消息。
//   - 无 fileIds → 与旧版一致返回 { role:'user', content: string }
//   - 有 fileIds → 走 DeepSeek 多模态 content 数组格式（[{type:'text',text}, {type:'file',file_id}, ...]）
//     文档：https://api-docs.deepseek.com/zh-cn/guides/files_api#%E5%9C%A8%E5%AF%B9%E8%AF%9D%E8%AF%B7%E6%B1%82%E4%B8%AD%E4%BD%BF%E7%94%A8%E5%B7%B2%E4%B8%8A%E4%BC%A0%E7%9A%84%E6%96%87%E4%BB%B6
//   注：当前 Responses API 路径（responsesApi.js）独立拼装 input items，暂不处理 file_ids
//     （仅 deepseek-v4-flash-vision-exp 支持，本项目目前主要走 chat_completions）。
export function buildUserMessage(question, fileIds) {
  const ids = Array.isArray(fileIds) ? fileIds.filter(id => typeof id === 'string' && id.length > 0) : [];
  if (ids.length === 0) {
    return { role: 'user', content: question };
  }
  return {
    role: 'user',
    content: [
      { type: 'text', text: question },
      ...ids.map((id) => ({ type: 'file', file_id: id })),
    ],
  };
}

export async function* runSqlAgent(
  question,
  history = "",
  signal,
  sessionId = null,
  username = null,
  reasoningConfig,  // ★ 用户控件：{ enabled: boolean, effort: 'low'|'medium'|'high' }。undefined → 向后兼容 (enabled)
  fileIds = null,   // ★ 2026-08-24：DeepSeek Files API 文件 id 列表（仅 deepseek-v4-flash-vision-exp 模型支持）
) {
  logger.info("runSqlAgent called", {
    question,
    historyLength: history?.length,
    sessionId,
    username,
  });

  let config;
  try {
    config = getLlmConfig();
  } catch (e) {
    throw new Error("LLM未配置，请先在配置面板设置LLM Provider和API Key");
  }

  const { provider, apiKey, model } = config;

  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;

  // ★ 2026-08-24 vision：非 vision 模型时静默丢 fileIds + log warn
  //   - 前端 ChatInput 已做二次确认（用户同意后 onSend 才会发 fileIds）
  //   - 后端再守一道：万一前端用了老版本或别的入口绕过确认，这里兜底
  //   - 不抛错：用户已经看过二次确认 → 期望行为就是"只发文本"，warning 即可
  if (Array.isArray(fileIds) && fileIds.length > 0 && !isVisionModel(model)) {
    logger.warn('fileIds ignored: model does not support vision', {
      model,
      fileIdsCount: fileIds.length,
      // 不打印具体 id，避免日志含敏感 file_id
    });
    fileIds = null;
  }

  const skillMd = await loadSkillMd();

  // F18: 发送给 LLM 的 tools 用 LLM_TOOLS（已过滤 get_domain_index）。
  //   toolsMap 用完整 tools 构建（兜底执行：旧会话 history 中若有 get_domain_index
  //   tool_call，toolsMap 仍能命中执行函数，避免"未知工具"错误）。
  const toolsDefinition = LLM_TOOLS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.lc_kwargs.params || {
        type: "object",
        properties: {},
        required: [],
      },
    },
  }));

  const toolsMap = new Map(tools.map((t) => [t.name, t]));
  //const tableIndex = loadTableIndex();

  // ★ F18：system 拼接走 toolFuncs.buildSystemMessage 共享函数（CC/RA 单一来源）
  //   内部会重新读 domain_router_index.json，拼接 "## 可用业务域" 小节。
  const systemMessage = await buildSystemMessage(skillMd);

  let messages;

  // 如果有 sessionId，尝试从数据库加载历史消息
  if (sessionId) {
    const savedResult = loadMessagesFromDb(sessionId);
    const savedMessages = savedResult?.messages;
    if (savedMessages && savedMessages.length > 0) {
      logger.info("Loaded messages from database", {
        sessionId,
        messageCount: savedMessages.length,
      });
      // 更新 system 消息（可能有更新）并添加新用户消息
      messages = savedMessages;
      // 替换系统消息（保持最新）
      const systemIndex = messages.findIndex((m) => m.role === "system");
      if (systemIndex >= 0) {
        messages[systemIndex] = { role: "system", content: systemMessage };
      }
      // 添加新的用户消息（★ 2026-08-24：支持 file_ids 多模态 content 数组）
      messages.push(buildUserMessage(question, fileIds));
    } else {
      messages = [
        { role: "system", content: systemMessage },
        buildUserMessage(question, fileIds),
      ];
    }
  } else {
    messages = [
      { role: "system", content: systemMessage },
      buildUserMessage(question, fileIds),
    ];
  }

  // ★ 每次新 user 消息（= 一次 invoke）重置"问题级"状态：
  //   - validateSqlFields* 始终重置，避免上一问题的"✓passed"残留在 checklist 误导 LLM；
  //   - 域路由状态（get_sliced_index / schema / tag / choice 计数）
  //     仅在新问题时清空（允许重新路由新业务域）；request_user_choice 中断后的
  //     续问（用户作答）保留状态，同一问题继续无需重新路由。
  //     （F18: get_domain_index 已不在 registry 跟踪；域清单在 system 中永久可见）
  resetRegistryForNewQuestion(getOrCreateRegistry(sessionId), messages);

  const agentConfig = getAgentConfig();
  let maxToolCalls = parseInt(agentConfig.agent_max_tool_calls || "30", 10);
  // ★ 记录初始 maxToolCalls 用于 Round 编号：Round = 已用掉多少轮（从 0 开始递增）
  //   历史 Bug：用 `31 - maxToolCalls` 计算，当 admin 配置 > 31 时出现负数（Round -9, -8, ...）
  const maxToolCallsInitial = maxToolCalls;
  let responseText = "";
  let sql = "";
  // ★ request_user_choice 终止信号：检测到该工具被调用后，跳出 while 循环
  // v2 (2026-07-15): 改单值为数组，支持本轮多次调用（链式弹窗）
  //   - LLM 可在一次推理中调 1-3 次 request_user_choice（详见 SKILL.md "多问题上限与链式语义"）
  //   - 程序按 validToolCalls 原始顺序收集（不被并行执行乱序影响）
  //   - 超过 MAX_USER_CHOICE_PER_TURN 的部分丢弃（SKILL.md 上限 = 3，前端弹窗链过长用户疲劳）
  let pendingUserChoiceList = [];
  const MAX_USER_CHOICE_PER_TURN = 3;

  // 折叠缓存（单请求级）：跨 LLM 轮次复用折叠结果，请求结束自动 GC。
  // 作用域为本次 /generate 调用，函数闭包天然隔离多用户，不可能窜。
  // cache-aside: 缓存命中直接用，丢失则重新折叠并写入缓存。
  const foldedCache = new Map();

  while (maxToolCalls > 0) {
    // ★ 本轮 round 编号（前端用于"数轴式"轮次展示）
    //   从 0 开始递增；maxToolCallsInitial 是入口处记录的初始值
    //   每轮 LLM 入口处计算一次，整轮内复用
    const currentRound = maxToolCallsInitial - maxToolCalls;
    // F23 (2026-08): get_call_history 工具由系统在每轮 LLM 响应后强制注入到
    //   assistant.tool_calls 最前面（见下方"强制注入"段）。它作为 tool 消息
    //   持久化在 messages 数组中，每轮新增的 tool message 字节稳定，prefix
    //   cache 可跨轮命中（之前用 checklistMsg 临时追加在末尾，每轮字节变导致
    //   末尾 prefix cache 中断，命中率从 90% 跌到 22%）。这里不再构造临时
    //   checklistMsg，buildToolCallChecklistMessage 函数保留为兼容旧历史/日志
    //   解析的旁路导出。
    // 旧 checklist 路径（2026-08-20 之前）：临时向 messages 末尾追加 role:system
    //   消息，每次内容都变 → 末尾 prefix cache 必中断 → 命中率 22.6%。
    // 新 get_call_history 路径：作为 tool 消息按顺序累积，字节稳定 → 命中率高。

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
    // 折叠已消费的 get_sliced_index tool result（去掉 related_tables，保留 rules/constraints），
    // 降低已消费历史区的 token 开销与注意力稀释。不修改原 messages 数组。
    const compactedMessages = await compactConsumedToolResults(
      messages,
      foldedCache,
    );
    const requestMessages = compactedMessages.map((m) => {
      if (m.role === "assistant" && m.reasoning_content && !m.tool_calls) {
        const { reasoning_content, ...rest } = m;
        return rest;
      }
      return m;
    });

    // 工具剪枝：一次性工具调用过后，从 LLM 请求的 tools 数组中移除以节省 token
    // - get_sliced_index：调用后已加载的域在 history 中，后续不需要
    //   （F18：get_domain_index 已从剪枝列表移除——域清单永久在 system 中可见，
    //     不需要"调用后剪枝"，且工具本身已标"已废弃"）
    // 注意：toolsMap（用于执行工具的查找）保持不变，仅影响 LLM 看到哪些工具可选
    //
    // ★ validate_sql_fields：不再剪枝（含 Round 0）
    //   历史 Bug 2026-07-28：Round 0 剪枝导致 LLM 在跨问题场景（Q3）跳过早轮工具调用、
    //   直接调 validate_sql_fields 时被误拦，错误返回'已剪枝'，且错误信息误导 LLM
    //   放弃后续校验 → 最终 SQL 未经验证直接输出。
    //   修复：始终携带 validate_sql_fields，让 LLM 在任何轮次可自由调用。token 代价
    //   ~600 字符（工具定义），相对正确性收益可接受。
    // 关联：项目记忆 project_memory.md 'Engineering Conventions' 需要更新。
    // ★ 工具剪枝已禁用（2026-08-18）：DeepSeek prefix cache 要求 requestParams
    //   字节级稳定才能跨轮命中。"已调过的工具下次不传"的设计虽然省 ~200 tokens 定义，
    //   但让 tools 数组从 5 → 4 → 3 递减，每轮 cache hash 都变。
    //   禁掉剪枝后，5 个工具永远不变，cache 完美命中，多花的 ~200 tokens 在 cache 命中后
    //   实际是 0 cost（已缓存部分不重复计费）。
    //   关联：project_memory.md "F22: 禁掉 tools 数组剪枝以稳定 prefix cache"
    const prunedTools = toolsDefinition;
    const prunedNames = [];
    if (prunedNames.length > 0) {
      queueLog(
        `✂️ [Round ${maxToolCallsInitial - maxToolCalls}] 本轮 LLM 请求已剪枝工具（不再传入）: ${prunedNames.join(", ")}`,
        true,
      );
    }

    // ★ 用户控件：Chat Completions API 的 thinking 字段
    //   DeepSeek 文档：type=enabled 时顶层同时传 reasoning_effort (low/medium/high)
    //     https://api-docs.deepseek.com/zh-cn/api/create-chat-completion
    //   官方示例: { thinking: { type: "enabled" }, reasoning_effort: "low" }
    //   - undefined: 向后兼容旧调用 (enabled + medium)
    //   - enabled=false: type=disabled,不附带 reasoning_effort
    //   - enabled=true:  type=enabled + 顶层 reasoning_effort
    //     强度映射：'low'|'medium'|'high'，未识别值回落 medium
    const VALID_EFFORTS = new Set(['low', 'medium', 'high']);
    const buildThinking = (cfg) => {
      if (cfg === null || cfg === undefined) {
        return { thinking: { type: 'enabled' }, reasoning_effort: 'medium' };
      }
      if (cfg.enabled === false) {
        return { thinking: { type: 'disabled' } };
      }
      const effort = VALID_EFFORTS.has(cfg.effort) ? cfg.effort : 'medium';
      return { thinking: { type: 'enabled' }, reasoning_effort: effort };
    };
    const requestParams = {
      model: llmModel,
      messages: requestMessages,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      tools: prunedTools,
      ...buildThinking(reasoningConfig),
    };

    if (signal?.aborted) {
      yield { type: "error", content: "请求已被用户中断", round: currentRound };
      return;
    }

    queueLog(
      "runSqlAgent Round " +
        (maxToolCallsInitial - maxToolCalls) +
        " Request:\n" +
        JSON.stringify(requestParams, null, 2),
      true,
      username,
    );

    try {
      const tFetch = withTimeout(signal, LLM_TIMEOUTS.FETCH_MS, "LLM fetch");
      let fetchResponse;
      try {
        fetchResponse = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestParams),
          signal: tFetch.signal,
        });
      } catch (e) {
        if (e.name === "AbortError" || /timeout/i.test(e.message || "")) {
          if (tFetch.isExternalAbort()) {
            throw e; // 外部断开，原样抛出
          }
          throw new Error(
            `LLM 响应超时（>${LLM_TIMEOUTS.FETCH_MS / 1000}s），请稍后重试`,
          );
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
      let buffer = "";
      const streamToolCalls = [];
      responseText = "";
      let reasoningContent = "";
      while (true) {
        let readResult;
        try {
          readResult = await withPromiseTimeout(
            () => reader.read(),
            signal,
            LLM_TIMEOUTS.READ_MS,
            "LLM stream read",
            () => reader.cancel().catch(() => {}), // 超时/取消时释放 stream 资源
          );
        } catch (e) {
          if (e.name === "AbortError" || /timeout/i.test(e.message || "")) {
            if (signal.aborted) {
              throw e; // 外部断开，原样抛出
            }
            throw new Error(
              `LLM 流式响应中断（>${LLM_TIMEOUTS.READ_MS / 1000}s 无新数据），请稍后重试`,
            );
          }
          throw e;
        }
        const { done, value } = readResult;

        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        if (done) {
          buffer = "";
          break;
        } else {
          buffer = lines.pop() || "";
        }

        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
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
                const hitRate =
                  cacheTotal > 0
                    ? ((cacheHit / cacheTotal) * 100).toFixed(1)
                    : "0.0";
                queueLog(
                  `📊 [Round ${maxToolCallsInitial - maxToolCalls}] LLM usage: ` +
                    `prompt=${usage.prompt_tokens || 0} completion=${usage.completion_tokens || 0} total=${usage.total_tokens || 0} | ` +
                    `prefix_cache: hit=${cacheHit} miss=${cacheMiss} hit_rate=${hitRate}%`,
                  true,
                  username,
                );
                yield {
                  type: "usage",
                  usage: {
                    prompt_tokens: usage.prompt_tokens || 0,
                    completion_tokens: usage.completion_tokens || 0,
                    total_tokens: usage.total_tokens || 0,
                    // ★ v5.15：cached_tokens 透传（CC path 来自 usage.prompt_cache_hit_tokens）
                    //   Responses path 来自 usage.input_tokens_details.cached_tokens（已在 responsesApi.js:228 提取）
                    //   前端用 cached_tokens / prompt_tokens 计算 prefix cache 命中率
                    cached_tokens: cacheHit,
                  },
                  round: currentRound,
                };
              }
              const content = data.choices?.[0]?.delta?.content || "";
              if (content) {
                responseText += content;
                yield { type: "chunk", content: content, round: currentRound };
              }
              // 提取 reasoning_content（DeepSeek API 要求）
              const reasoning =
                data.choices?.[0]?.delta?.reasoning_content || "";
              if (reasoning) {
                reasoningContent += reasoning;
                // 实时 yield 思考过程 delta，避免长思考阶段前端长时间无输出
                yield { type: "reasoning_chunk", content: reasoning, round: currentRound };
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
                        id: "",
                        function: { name: "", arguments: "" },
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
                      existing.function.arguments =
                        (existing.function.arguments || "") +
                        tc.function.arguments;
                    }
                  }
                }
              }
            } catch (e) {
              logger.debug("JSON parse/split failed", { error: e.message });
            }
          }
        }
      }

      // 启发式后处理：从 responseText 中剥离被 LLM 误倒进 content 的 thinking
      // 背景：DeepSeek LLM 偶尔不遵守字段分离，把整段思考写进 content，导致前端"答案气泡"显示大段 thinking
      // 修复：流结束后检测并剥离（splitThinkingFromContent），把 thinking 追加到 reasoningContent
      const { content: cleanContent, extraThinking } =
        splitThinkingFromContent(responseText);
      const finalResponseText = cleanContent;
      const finalReasoningContent = extraThinking
        ? reasoningContent
          ? reasoningContent + "\n\n" + extraThinking
          : extraThinking
        : reasoningContent;

      // 如果发生了剥离，向前端发出 message_final 事件以更新 assistant 消息
      if (extraThinking) {
        yield {
          type: "message_final",
          content: finalResponseText,
          extraThinking,
          round: currentRound,
        };
      }

      // 思考过程已在流式过程中实时 yield reasoning_chunk 给前端
      // 此处仅 yield reasoning_done 用于 DB 持久化（历史回显需要），UI 不再消费
      if (finalReasoningContent) {
        yield {
          type: "reasoning_done",
          content: `💭 LLM思考过程:\n${finalReasoningContent.slice(0, 10000)}`,
          round: currentRound,
        };
      }

      // 过滤出有实际工具名称的工具调用
      const validToolCalls = streamToolCalls.filter(
        (tc) => tc.function?.name && tc.function.name.trim(),
      );

      // 流式响应结束，输出工具调用日志
      for (const tc of validToolCalls) {
        const toolName = tc.function.name;
        // 后端日志保留完整信息（admin 看后端日志仍可见"🔧 调用工具 + 参数"）
        queueLog(
          `🔧 调用工具: ${toolName} 参数:${JSON.stringify(tc.function.arguments)}`,
          true,
        );
        // ★ 2026-08-17：yield log 恢复两行格式（"🔧 调用工具: xxx\n参数: {...}"）
        //   工具名走独立 toolName 字段给前端（title 拼接用）
        //   前端 ChatMessage 渲染 body 时统一过滤第一行（去掉"🔧 调用工具: xxx"行）
        //   原因：① 即使后端没重启（跑旧代码）也能正常工作 ② 老数据历史回看格式一致 ③ 空参数时仍保留"🔧 调用工具: xxx"行不丢节点
        let logMsg = `🔧 调用工具: ${toolName}`;
        try {
          const parsedArgs = JSON.parse(tc.function.arguments || "{}");
          logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
        } catch (e) {
          logger.debug("JSON parse/split failed", { error: e.message });
        }
        yield { type: "tool", log: logMsg, toolName, round: currentRound };
      }

      // 保存 assistant 消息，需要包含 tool_calls
      // 使用清理后的 finalResponseText（剥离了 thinking）和 finalReasoningContent（追加了被剥离的 thinking）
      // F23 v3 (2026-08): 在 push 前先把 get_call_history 合成到 tool_calls 头部。
      //   - 字节稳定的关键：synthetic tool_call_id 必须是常量字符串（不能含时间戳/随机数），
      //     跨轮同一位置出现相同字节，prefix cache 才能命中。
      //   - LLM_TOOLS 已过滤掉 get_call_history，LLM 看不到此工具（不会主动调），保证 synthetic 是唯一来源。
      //   - F23 v3 条件式注入：仅当 LLM 本轮实际调用了非 get_call_history 工具时才注入。
      //     LLM 不调任何工具（直接回答）时不注入 — 避免 history 中"每轮都调 get_call_history"
      //     的示例让 LLM 模仿调用。LLM 看到"调工具时才出现"会知道这是程序行为不是必调。
      //   - 防重复：若 LLM 因旧 history 误调 get_call_history，跳过注入避免 id 冲突。
      const hasCallHistory = validToolCalls.some(
        (tc) => tc.function?.name === "get_call_history",
      );
      const hasRealToolCall = validToolCalls.some(
        (tc) => tc.function?.name !== "get_call_history",
      );
      if (hasRealToolCall && !hasCallHistory) {
        validToolCalls.unshift({
          id: "synthetic_get_call_history",
          type: "function",
          function: {
            name: "get_call_history",
            arguments: "{}",
          },
        });
      }
      const assistantMsg = {
        role: "assistant",
        content: finalResponseText || "",
        reasoning_content: finalReasoningContent || "",
      };
      if (validToolCalls.length > 0) {
        // 为每个 tool_call 确保有 id（get_call_history 已自带常量 id，跳过）
        validToolCalls.forEach((tc, idx) => {
          if (!tc.id) {
            tc.id = `call_${Date.now()}_${idx}`;
          }
        });
        assistantMsg.tool_calls = validToolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || "{}",
          },
        }));
      }
      messages.push(assistantMsg);
      // 同步一份到全局缓存（仅供开发期 GET /api/query/messages 调试接口使用）
      lastMessages = JSON.parse(JSON.stringify(messages));

      // 保存到数据库（如果有 sessionId）
      // ★ v5.14：CC path 不传 apiMode → 用默认值 'chat_completions'
      if (sessionId) {
        saveMessagesToDb(sessionId, messages);
      }

      if (validToolCalls.length > 0) {
        // 阶段 1：同步预处理（参数解析 + 重复调用检查）
        // 必须在并行执行前一次性完成，避免同一会话内两个相同工具的检查互相穿透
        // ★ 本轮可用的工具名集合（来自本轮实际发给 LLM 的 prunedTools）
        //   一次性工具（get_sliced_index）调用后被剪枝，从这里消失。
        //   LLM 若仍"幻觉"调用被剪枝的工具 → 立即拦截，不进入执行阶段。
        //   （F18: get_domain_index 已移至 system，不在剪枝列表）
        // F23: 显式补入 get_call_history —— 该工具由系统在每轮强制注入，LLM_TOOLS
        //   故意过滤掉（避免 LLM 主动调），因此也不在 prunedTools 中。如果不补入，
        //   后续的"工具已被剪枝"拦截会把它误判为非法调用。
        const availableToolNames = new Set([
          ...prunedTools.map((t) => t.function.name),
          "get_call_history",
        ]);
        const prepared = validToolCalls.map((toolCall) => {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || "{}";
          const toolCallId =
            toolCall.id ||
            `call_${Date.now()}_${validToolCalls.indexOf(toolCall)}`;
          const tool = toolsMap.get(toolName);
          let parseError = null;
          let parsedArgs = {};
          let autoFixed = false;
          try {
            parsedArgs = JSON.parse(toolArgs);
          } catch (e) {
            // ★ 自动修复：仅对 request_user_choice 工具（自由文本字段易带裸 "）
            //   其他工具按原逻辑报错，不动原始字符串
            if (toolName === "request_user_choice") {
              const repaired = fixBareQuotesInJsonArgs(toolArgs);
              try {
                parsedArgs = JSON.parse(repaired);
                autoFixed = true;
                console.warn(
                  `工具 ${toolName} 参数自动修复成功（裸 " → ""），修复后: ${JSON.stringify(parsedArgs)}`,
                );
              } catch (e2) {
                parseError = e.message;
                console.warn(
                  `工具 ${toolName} 参数解析失败且自动修复无效: ${e2.message}, 原参数: ${toolArgs}`,
                );
              }
            } else {
              parseError = e.message;
              console.warn(
                `工具 ${toolName} 参数解析失败: ${e.message}, 参数: ${toolArgs}`,
              );
            }
          }

          if (parseError) {
            return {
              toolCall,
              toolName,
              toolCallId,
              tool: null,
              execError: {
                message:
                  `🚫 【arguments 不是合法 JSON】工具 ${toolName} 的参数解析失败。\n` +
                  `【原因】${parseError}\n` +
                  `【常见错误】question/options 字符串内嵌入了未转义的 ASCII 双引号 \`"\`，会破坏 arguments JSON 语法。\n` +
                  `【修正】字符串内引用用中文引号 \`""\` 或 \`「」\`，或反斜杠转义 \`\\"\`；禁止裸 ASCII 双引号。\n` +
                  `【原 arguments】${toolArgs.slice(0, 500)}\n` +
                  `请重新调用 ${toolName}，确保 arguments 是合法 JSON。`,
              },
              dupCheck: null,
            };
          }

          if (!tool) {
            return {
              toolCall,
              toolName,
              toolCallId,
              tool: null,
              dupCheck: null,
              execError: {
                message:
                  `🚫 【工具不存在】工具 ${toolName} 不在系统注册的工具列表中。\n` +
                  `请检查工具名称是否拼写正确。`,
              },
            };
          }

          // ★ 拦截"幻觉调用"：工具在系统中存在，但本轮已被剪枝（一次性工具调用后从 LLM 请求移除）
          if (!availableToolNames.has(toolName)) {
            return {
              toolCall,
              toolName,
              toolCallId,
              tool: null,
              dupCheck: null,
              execError: {
                message:
                  `🚫 【工具已被本会话剪枝，禁止重复调用】工具 ${toolName} 是一次性工具（调用一次后从后续 LLM 请求中移除以节省 token）。\n` +
                  `该工具的返回结果已经在你的上下文中，请直接复用，禁止再次调用。\n` +
                  `【规则】只调用本轮 LLM 请求 tools 列表中实际存在的工具；列表外的工具一律不可调用，调用会被程序拦截。\n` +
                  `请基于已有上下文继续，**不要**再次调用 ${toolName}。`,
              },
            };
          }
          const dupCheck = checkAndFilterDuplicateCall(
            toolName,
            parsedArgs,
            sessionId,
          );
          return { toolCall, toolName, toolCallId, tool, parsedArgs, autoFixed, dupCheck };
        });

        // 阶段 2：并行执行工具（互不依赖的 IO 密集型操作）
        //   同步工具也会被 await 正确处理（Promise.resolve 包装）
        const execResults = await Promise.all(
          prepared.map(async (p) => {
            // F23: get_call_history 拦截器 —— 跳过 tool.func 调用，直接构造稳定 JSON。
            //   tool.func 的占位返回 ("{called_count:0,...}") 是固定字符串，
            //   而本拦截器构造的内容依赖 reg.callHistory（已调用工具列表），更有意义。
            //   字节稳定性：JSON.stringify 的字段顺序固定（callHistory push 时序固定），
            //   跨轮同位置同内容，prefix cache 命中。
            // F23 v2: 加入 _instruction 字段明确告诉 LLM：
            //   ① 这是系统自动注入的工具（LLM 不需要主动调）
            //   ② 如已掌握所有信息请直接输出最终答案
            //   ③ 防止 LLM 看到历史中的 synthetic tool_call 后模仿进入死循环
            if (p.toolName === "get_call_history") {
              const reg = getOrCreateRegistry(sessionId);
              const callHistory = reg?.callHistory || [];
              const stableContent = JSON.stringify({
                called_count: callHistory.length,
                called_tools: callHistory,
                _instruction:
                  "本工具由系统自动注入，每轮 LLM 响应后程序强制调用一次，LLM 不需要主动调用。" +
                  "如已掌握所有信息请直接输出最终答案；如需继续推理可调用其它工具。" +
                  "重复调用本工具不会获得新信息。",
              });
              return {
                ...p,
                rawResult: stableContent,
                toolMessageContent: stableContent,
                userChoiceId: null,
                execError: null,
              };
            }
            if (!p.tool || (p.dupCheck && p.dupCheck.block)) {
              return {
                ...p,
                rawResult: null,
                toolMessageContent: null,
                userChoiceId: null,
                execError: p.execError || null,  // ★ 保留 prepared 阶段设置的 execError
              };
            }
            try {
              const effectiveArgs = p.dupCheck.args;
              const notice = p.dupCheck.notice;
              const rawResult = await Promise.resolve(
                p.tool.func(effectiveArgs),
              );

              // ★ request_user_choice 特殊处理（v3: questions[] 数组契约）
              //   旧版：tool.func 返 {id, marker, payload} 单 marker
              //   新版：tool.func 返 {markers:[], payloads:[], ids:[], content:"..."}（success）
              //                  或 {error, content:"⚠️..."}（error，让 LLM 修正重试）
              //   - userChoiceId：取 ids[0]（多个 question 时只记第一个为代表）
              //   - toolMessageContent：取 content 字段（success/error 都有），其他工具 fallback 到 rawResult
              //   - 其他工具：toolMessageContent 默认 = rawResult（兼容）
              let userChoiceId = null;
              let toolMessageContent = rawResult;
              if (
                p.toolName === "request_user_choice" &&
                rawResult &&
                typeof rawResult === "object"
              ) {
                if (Array.isArray(rawResult.ids) && rawResult.ids.length > 0) {
                  userChoiceId = rawResult.ids[0];
                  toolMessageContent =
                    rawResult.content ||
                    (Array.isArray(rawResult.markers)
                      ? rawResult.markers.join("")
                      : "");
                } else if (rawResult.id && rawResult.marker) {
                  // 兼容旧版单 marker
                  userChoiceId = rawResult.id;
                  toolMessageContent = rawResult.marker;
                } else if (typeof rawResult.content === "string") {
                  // error 情况
                  toolMessageContent = rawResult.content;
                }
              }
              // ★ validate_sql_fields 特殊处理：tool.func 返 {content, valid, errors, summary}
              //   - content：JSON 序列化的字符串，给 LLM 看的（messages.content 必须是 string/list）
              //   - valid / errors：结构化数据，给下面的 registry 写入用
              //   若 func 错误返回 {error, content:"⚠️..."}：toolMessageContent = content
              if (
                p.toolName === "validate_sql_fields" &&
                rawResult &&
                typeof rawResult === "object"
              ) {
                if (typeof rawResult.content === "string") {
                  toolMessageContent = rawResult.content;
                } else {
                  // 防御：万一 content 字段缺失或类型错
                  toolMessageContent = JSON.stringify(rawResult);
                }
              }

              recordToolCall(
                p.toolName,
                effectiveArgs,
                sessionId,
                userChoiceId,
              );
              // ★ validate_sql_fields: 记录 LLM 是否调用 + 通过状态
              //   用于 buildToolCallChecklistMessage 展示给 LLM，让其"看到"自己已调/未调/通过/失败
              //   注意：仅用于提示，不强制拦截（plan D-12：工具仅 LLM 自检，路由层不兑底）
              if (
                p.toolName === "validate_sql_fields" &&
                rawResult &&
                typeof rawResult === "object"
              ) {
                const reg = getOrCreateRegistry(sessionId);
                if (reg) {
                  reg.validateSqlFieldsCalled = true;
                  reg.validateSqlFieldsPassed = rawResult.valid === true;
                  reg.validateSqlFieldsErrorCount = Array.isArray(
                    rawResult.errors,
                  )
                    ? rawResult.errors.length
                    : 0;
                }
              }
              return {
                ...p,
                rawResult,
                toolMessageContent,
                userChoiceId,
                execError: null,
                notice,
              };
            } catch (e) {
              return {
                ...p,
                rawResult: null,
                toolMessageContent: null,
                userChoiceId: null,
                execError: e,
              };
            }
          }),
        );

        // 阶段 3：按原始 tool_calls 顺序写回 messages（保证 LLM 看到的 tool 顺序与调用顺序一致）
        //   ★ 关键：execError 分支即使 p.tool=null 也要进入（参数解析失败 / 工具被剪枝 / 工具不存在时 tool 是 null）
        for (const p of execResults) {
          if (!p.tool && !p.execError) continue;
          const toolCall = p.toolCall;
          const toolName = p.toolName;
          const toolCallId = p.toolCallId;
          const toolArgs = toolCall.function.arguments || "{}";

          if (p.dupCheck && p.dupCheck.block) {
            queueLog(
              `🚫 拦截重复调用: ${toolName} sessionId=${sessionId} args=${toolArgs}`,
              true,
              username,
            );
            yield {
              type: "tool_return",
              log: `🚫 拦截重复调用: ${toolName}\n参数: ${toolArgs}\n${p.dupCheck.message}`,
              // F23 v3: tool_return 透传 toolName — 前端用其判断是否隐藏 get_call_history
              toolName: p.toolName,
              round: currentRound,
            };
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: p.dupCheck.message,
            });
            continue;
          }

          if (p.execError) {
            const isParseError =
              p.execError.message.includes("不是合法 JSON") ||
              p.execError.message.includes("参数解析失败");
            const errLabel = isParseError
              ? "参数解析失败"
              : "工具不可用";
            yield {
              type: "tool_return",
              log: `🚫 ${errLabel}: ${p.toolName}\n${p.execError.message}`,
              // F23 v3: tool_return 透传 toolName — 前端用其判断是否隐藏 get_call_history
              toolName: p.toolName,
              round: currentRound,
            };
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              content: `Error: ${p.execError.message}`,
            });
            continue;
          }

          // ★ 优先用 p.toolMessageContent（request_user_choice 已拆为 marker 字符串）
          //   fallback 到原 notice+rawResult 逻辑
          const resultContent =
            p.toolMessageContent ||
            (p.notice ? `${p.notice}\n\n${p.rawResult}` : p.rawResult);
          // ★ 自动修复成功：先 yield 一条"已修复"提示给 LLM
          //   让 LLM 知道后续应直接用中文引号 / 反斜杠转义，避免再触发同样的解析失败
          if (p.autoFixed) {
            yield {
              type: "tool_return",
              log: `✅ ${toolName} 参数已自动修复（裸 ASCII 双引号 → 中文右引号）。后续请直接使用中文引号 \`""\` 或 \`「」\`，或反斜杠转义 \`\\"\`；禁止裸 ASCII 双引号。`,
              // F23 v3: tool_return 透传 toolName
              toolName: p.toolName,
              round: currentRound,
            };
          }
          yield {
            type: "tool_return",
            log: `📋 工具 ${toolName} 返回:\n${typeof resultContent === "string" ? resultContent : JSON.stringify(resultContent)}`,
            // F23 v3: tool_return 透传 toolName — 前端用其判断是否隐藏 get_call_history
            toolName: p.toolName,
            round: currentRound,
          };
          messages.push({
            role: "tool",
            tool_call_id: toolCallId,
            content: resultContent,
          });

          // ★ 检测 request_user_choice 工具 → 加入 pendingUserChoiceList（v3: 单调用多 marker）
          //   p.rawResult 结构（v3 新版）：
          //     success: {markers:[m1,m2,...], payloads:[p1,p2,...], ids:[...], content:"..."}
          //     error:   {error, content:"⚠️..."}（不进入此分支，LLM 看到 content 修正重试）
          //   旧版兼容：p.rawResult = {id, marker, payload}（万一 LLM 还用旧 schema 也能工作）
          //   按 validToolCalls 原始顺序 push（保证与 LLM 决策顺序一致）
          //   超过 MAX_USER_CHOICE_PER_TURN (3) 的部分丢弃（已 dupCheck + recordToolCall 记录过）
          if (
            p.toolName === "request_user_choice" &&
            p.rawResult &&
            typeof p.rawResult === "object"
          ) {
            // v3 新版：markers/payloads 数组
            if (
              Array.isArray(p.rawResult.payloads) &&
              p.rawResult.payloads.length > 0
            ) {
              for (const payload of p.rawResult.payloads) {
                if (pendingUserChoiceList.length >= MAX_USER_CHOICE_PER_TURN) {
                  logger.warn(
                    "user_choice dropped: over MAX_USER_CHOICE_PER_TURN",
                    {
                      sessionId,
                      droppedId: payload?.id,
                      currentCount: pendingUserChoiceList.length,
                      max: MAX_USER_CHOICE_PER_TURN,
                      droppedQuestion: String(payload?.question || "").slice(
                        0,
                        80,
                      ),
                    },
                  );
                  continue;
                }
                pendingUserChoiceList.push(payload);
                logger.info("user_choice tool detected (multi)", {
                  sessionId,
                  id: payload.id,
                  question: payload.question,
                  index: pendingUserChoiceList.length,
                  max: MAX_USER_CHOICE_PER_TURN,
                });
                // ★ 诊断 console.log: 用户在终端可直接看到本轮捕获的所有 user_choice
                console.log(
                  `[user_choice] 本轮捕获 #${pendingUserChoiceList.length}/${MAX_USER_CHOICE_PER_TURN}: id=${payload.id} q="${String(payload.question || "").slice(0, 40)}" options=${JSON.stringify(payload.options || [])}`,
                );
              }
            }
            // 兼容旧版：单 marker
            else if (p.rawResult.marker) {
              const marker = p.rawResult.marker || "";
              const match = marker.match(/<!--user_choice:(\{[\s\S]*?\})-->/);
              if (match) {
                try {
                  const parsed = JSON.parse(match[1]);
                  if (pendingUserChoiceList.length < MAX_USER_CHOICE_PER_TURN) {
                    pendingUserChoiceList.push(parsed);
                    logger.info("user_choice tool detected (legacy single)", {
                      sessionId,
                      id: parsed.id,
                      question: parsed.question,
                      index: pendingUserChoiceList.length,
                      max: MAX_USER_CHOICE_PER_TURN,
                    });
                    console.log(
                      `[user_choice] 本轮捕获 #${pendingUserChoiceList.length}/${MAX_USER_CHOICE_PER_TURN} (legacy): id=${parsed.id} q="${String(parsed.question || "").slice(0, 40)}" options=${JSON.stringify(parsed.options || [])}`,
                    );
                  }
                } catch (e) {
                  logger.warn("user_choice marker parse failed", {
                    sessionId,
                    error: e.message,
                    raw: marker.slice(0, 200),
                  });
                }
              }
            }
            // error case: 不动 pendingUserChoiceList, 让 LLM 修正重试
          }
        }

        // F23: 登记本轮成功调用的工具到 reg.callHistory（用于 get_call_history 拦截器读取）。
        //   - 仅登记"成功执行"的工具（execError/dupCheck.block 跳过）—— 失败的调用不应进
        //     callHistory，否则 LLM 下一轮会看到"已调过"假阳性，导致误判"功能不可用"。
        //   - 同 tool_name + args 不重复登记（防御性 dedup，虽然 LLM_TOOLS 已过滤重复调用工具，
        //     但同会话内 LLM 仍可能因 history 残留重调同名工具）。
        //   - 跳过 get_call_history 自身 —— 它的"已调"状态对 LLM 决策无意义。
        //   - 字节稳定：先按 toolName 排序再 dedup，再按时间顺序 push；JSON.stringify 字段
        //     顺序固定 → 跨轮同位置同字节 → prefix cache 命中。
        (() => {
          const reg = getOrCreateRegistry(sessionId);
          if (!reg) return;
          for (const p of execResults) {
            if (!p.toolName || p.toolName === "get_call_history") continue;
            if (p.execError) continue;
            if (p.dupCheck && p.dupCheck.block) continue;
            const sig = `${p.toolName}::${p.toolCall?.function?.arguments || "{}"}`;
            if (reg.callHistory.some((h) => h.sig === sig)) continue;
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(p.toolCall?.function?.arguments || "{}");
            } catch {
              parsedArgs = p.toolCall?.function?.arguments || "";
            }
            reg.callHistory.push({
              sig,
              tool: p.toolName,
              args: parsedArgs,
              called_at_round: currentRound,
            });
          }
        })();

        // F23 v2: get_call_history 循环检测 —— LLM 看到历史中 synthetic tool_call 后
        //   可能模仿调用，若连续两轮 LLM 仅调用 get_call_history（无任何其他工具），
        //   强制 break 跳出循环。
        //   关键：必须判断 LLM "实际调用"（validToolCalls）而非 execution 后的
        //   execResults —— execResults 永远会包含 synthetic get_call_history，
        //   不能用作判断依据。
        //   设计：连续两轮 LLM "只调" get_call_history 才 break（计数 1→2 时 break）。
        //   - 第一轮仅调 get_call_history：仅递增计数（1），仍允许下一轮（给 LLM 看
        //     _instruction 提示的机会）。
        //   - 第二轮仍仅调：计数到 2，push 一条 system 提示后设 gchLoopBreak=true，
        //     外层检查后 break。
        //   - 中间 LLM 调用了其它工具：计数清零（正常流程）。
        let gchLoopBreak = false;
        (() => {
          // LLM 实际调用的工具名（不含 synthetic，因为 synthetic 是在 hasCallHistory
          // 检查后由我们 unshift 的，不在 LLM 原始决策里）
          const llmActualCalls = validToolCalls.filter(
            (tc) => tc.function?.name !== "get_call_history",
          );
          const llmOnlyCalledGch =
            validToolCalls.length > 0 && llmActualCalls.length === 0;

          const reg = getOrCreateRegistry(sessionId);
          if (!reg) return;

          if (llmOnlyCalledGch) {
            reg.gchLoopCount = (reg.gchLoopCount || 0) + 1;
            logger.info("get_call_history loop detection", {
              sessionId,
              currentRound,
              gchLoopCount: reg.gchLoopCount,
            });
            if (reg.gchLoopCount >= 2) {
              logger.warn(
                "LLM stuck in get_call_history loop, forcing end",
                { sessionId, currentRound, gchLoopCount: reg.gchLoopCount },
              );
              // 推一条强提示到 messages（虽然即将 break，但保留语义完整性，
              // 万一上层有兜底逻辑能看到这条 system 消息）
              messages.push({
                role: "system",
                content:
                  "⚠️ [系统提示] 检测到你连续多轮只调用 get_call_history。" +
                  "该工具由系统自动注入，你不需要主动调用它。" +
                  "请直接输出最终答案。",
              });
              pendingUserChoiceList.length = 0; // 清空 user_choice 避免干扰 break
              gchLoopBreak = true;
            }
          } else {
            // LLM 调了其它工具（或没调任何工具），重置计数
            if (reg.gchLoopCount !== 0) {
              logger.info("get_call_history loop reset (LLM called other tool)", {
                sessionId,
                currentRound,
              });
            }
            reg.gchLoopCount = 0;
          }
        })();

        // F23 v2: 命中循环且需 break 时，先 yield 一条终止事件给前端再退出
        if (gchLoopBreak) {
          yield {
            type: "error",
            content:
              "检测到 LLM 重复调用 get_call_history，已强制终止。",
            round: currentRound,
          };
          break;
        }

        // ★ 跳出 while 循环：检测到至少一个 request_user_choice 后 TURN 1 终止
        if (pendingUserChoiceList.length > 0) break;

        maxToolCalls--;
        continue;
      }

      break;
    } catch (e) {
      if (e.name === "AbortError") {
        yield { type: "error", content: "请求已被用户中断", round: currentRound };
      } else {
        yield { type: "error", content: e.message, round: currentRound };
      }
      return;
    }
  }

  // ★ request_user_choice 终止分支：TURN 1 在工具循环处硬性结束
  // LLM 调用 request_user_choice（1-3 次）后：
  //   1) 持久化 messages（含 N 个 tool marker，Turn 2 要 load）
  //   2) 写日志（payload 详情 + dbSaveOk 状态）
  //   3) yield done 携带 userChoiceRequest 数组（v2: 1-3 个元素的数组，方案 A 单次推理多问题）
  //   4) DB 写失败时降级（不弹窗，让 LLM 继续）
  // 详见 project_memory.md "TURN 1 终止边界" + "程序硬控原则"
  if (pendingUserChoiceList.length > 0) {
    let dbSaveOk = true;
    if (sessionId) {
      try {
        saveMessagesToDb(sessionId, messages);
      } catch (e) {
        // 现有 saveMessagesToDb 内部已有 try/catch + error 日志
        // 但仍可能因异常路径未覆盖（死锁/超时）走到这里
        dbSaveOk = false;
        logger.error("CRITICAL: saveMessagesToDb failed for user_choice flow", {
          sessionId,
          error: e.message,
        });
      }
    }

    queueLog(
      `🔔 TURN 1 终止 - user_choice 请求链 (共 ${pendingUserChoiceList.length} 个): ` +
        pendingUserChoiceList
          .map(
            (p, i) =>
              `[${i + 1}] id=${p.id} question="${String(p.question || "").slice(0, 60)}" multi_select=${!!p.multi_select}`,
          )
          .join(" | ") +
        ` dbSaveOk=${dbSaveOk}`,
      true,
      username,
    );
    flushLogs();

    // 降级处理：DB 写失败 → 不弹窗，让 LLM 继续
    if (!dbSaveOk) {
      logger.warn("DB save failed, falling back to LLM continuation", {
        sessionId,
      });
      yield {
        type: "done",
        sql: "",
        message:
          responseText +
          "\n\n（系统提示：用户交互持久化失败，请基于已有信息继续）",
        userChoiceRequest: null, // null 告诉前端不弹窗
      };
      return;
    }

    // 正常路径：yield done 携带 userChoiceRequest 数组（前端按链式弹窗处理）
    console.log(
      `[user_choice] yield done → userChoiceRequest 长度=${pendingUserChoiceList.length}`,
    );
    yield {
      type: "done",
      sql: "",
      message: responseText,
      userChoiceRequest: pendingUserChoiceList, // ★ v2: 数组形式（方案 A）
    };
    return;
  }

  // 返回 markdown 格式的结果
  const message = responseText;

  queueLog(`=== BAK 完成 SQL: ${sql || responseText}`, true, username);
  flushLogs();
  yield { type: "done", sql: "", message };
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
    throw new Error("LLM 未配置");
  }
  const provider = cfg.provider;
  // 强制覆盖 model：deepseek 走非快速模型
  const model =
    provider === "deepseek"
      ? process.env.FAVORITE_LLM_MODEL || "deepseek-chat"
      : cfg.model;
  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;
  const apiKey = cfg.apiKey;

  const tFetch = withTimeout(
    signal,
    LLM_TIMEOUTS.FETCH_MS,
    "callLlmForFavorite fetch",
  );
  let res;
  try {
    res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        stream: false,
        response_format: { type: "json_object" },
      }),
      signal: tFetch.signal,
    });
  } catch (e) {
    if (e.name === "AbortError" || /timeout/i.test(e.message || "")) {
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
    } catch (_) {
      /* ignore */
    }
    throw new Error(`LLM 调用失败 (${res.status}): ${detail}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || "";
  const usage = json.usage || {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  return { content, usage, model: llmModel };
}

export { loadSkillMd };

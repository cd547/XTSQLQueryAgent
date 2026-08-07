// ============================================================
// Phase 2 Step 3: responsesApi.js
// DeepSeek Responses API 路由 handler（与 CC path 1:1 对齐）
// ============================================================
// 设计原则：
//   - 完全独立：仅 import agentHelpers.js + config.js + toolFuncs.js + llm.js（拆分函数 + 共享底层）
//   - 1:1 对齐 CC path：所有 yield 事件类型 + 时机 + 字段名与 [llm.js:1088-2055](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1088-L2055) runSqlAgent 一致
//   - 前端 0 改动：tool/tool_return/LLM/reasoning_chunk 等事件类型不变
//   - 流式分派：handler 接收 res 时已 flushed（路由层 F9 + flushHeaders 已做），handler 不再调
// ============================================================

import { logger } from "../logger.js";
import { getDb } from "../db/sqlite.js";
import {
  initMessagesForRun,
  getPrunedToolsForRun,
  executeToolCallsInStages,
  recordPendingUserChoices,
  saveRunState,
  convertMessagesToInputItems,
} from "./agentHelpers.js";
import {
  LLM_TIMEOUTS, withTimeout, withPromiseTimeout,
  loadSkillMd, splitThinkingFromContent,
  buildToolCallChecklistMessage, compactConsumedToolResults,
  getOrCreateRegistry, resetPerQuestionRegistryFlags,
  queueLog, flushLogs, getProviderConfig,
} from "./llm.js";
import { getLlmConfig, getAgentConfig } from "./config.js";

// ============================================================
// 常量
// ============================================================
const MAX_USER_CHOICE_PER_TURN = 3;
// ★ DeepSeek Responses API 终结事件（不再用 [DONE]）
const RESPONSES_TERMINAL_EVENTS = new Set([
  "response.completed",
  "response.incomplete",
  "response.failed",
]);

// ============================================================
// fetchResponsesStream
// POST /responses + 流式读取 SSE 事件 → yield 标准化的内部事件
// 返回 generator：每个 event = Responses API 原始事件对象
// 终结由 caller 检测 type ∈ RESPONSES_TERMINAL_EVENTS
// ============================================================
async function* fetchResponsesStream({ baseURL, apiKey, llmModel, requestParams, signal }) {
  if (signal?.aborted) {
    throw Object.assign(new Error("Aborted"), { name: "AbortError" });
  }

  const tFetch = withTimeout(signal, LLM_TIMEOUTS.FETCH_MS, "LLM fetch");
  let fetchResponse;
  try {
    fetchResponse = await fetch(`${baseURL}/responses`, {
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
        throw e;
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
    const errorText = await fetchResponse.text().catch(() => fetchResponse.statusText);
    let errorMessage = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorText;
    } catch (_e) { /* 不是 JSON，用原文 */ }
    throw new Error(errorMessage);
  }

  const reader = fetchResponse.body.getReader();
  const decoder = new TextDecoder();
  // ★ F11 修复：buffer + decoder.decode(value, { stream: !done }) + lines.pop()
  let buffer = "";
  try {
    while (true) {
      let readResult;
      try {
        readResult = await withPromiseTimeout(
          () => reader.read(),
          signal,
          LLM_TIMEOUTS.READ_MS,
          "LLM stream read",
          () => reader.cancel().catch(() => {}),
        );
      } catch (e) {
        if (e.name === "AbortError" || /timeout/i.test(e.message || "")) {
          if (signal.aborted) {
            throw e;
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
      } else {
        buffer = lines.pop() || "";
      }
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data);
          // ★ v5.8 诊断：每个解析后的事件都打 debug log
          //   包括 event.type 和 payload 前 500 字符，便于事后排查 DeepSeek 实际响应结构
          logger.debug("[responsesApi] SSE event", {
            type: event.type,
            payload: JSON.stringify(event).slice(0, 500),
          });
          yield event;
          if (event.type && RESPONSES_TERMINAL_EVENTS.has(event.type)) {
            return;
          }
        } catch (e) {
          logger.debug("Responses API JSON parse failed", { error: e.message });
        }
      }
      if (done) return;
    }
  } finally {
    try { reader.releaseLock(); } catch (_e) { /* already released */ }
  }
}

// ============================================================
// translateResponsesEvent
// Responses API 事件 → 内部事件（与 CC path 一致的 yield 事件）
// 工具调用 / responseText / reasoningContent 的累积是 caller 责任
// ============================================================
function translateResponsesEvent(event, { streamToolCalls, responseText, reasoningContent, currentRound, username }) {
  const out = [];
  // ★ v5.8 修复：未知事件类型也记录 raw event 到日志，便于诊断 DeepSeek 实际响应结构
  //   之前 default 静默丢弃，导致 tool_call 相关事件名猜错时看不到 raw payload
  if (event.type && !RESPONSES_TERMINAL_EVENTS.has(event.type) && event.type !== "response.output_text.delta" && event.type !== "response.output_text.done" && event.type !== "response.reasoning_text.delta" && event.type !== "response.reasoning_text.done" && event.type !== "response.function_call_arguments.delta" && event.type !== "response.output_item.added" && event.type !== "response.completed" && event.type !== "response.failed" && event.type !== "response.incomplete") {
    logger.debug("[responsesApi] 未知 event.type", {
      type: event.type,
      payload: JSON.stringify(event).slice(0, 1000),
    });
  }
  switch (event.type) {
    case "response.output_text.delta": {
      const delta = event.delta || "";
      if (delta) {
        responseText += delta;
        out.push({ type: "chunk", content: delta, round: currentRound });
      }
      break;
    }
    case "response.output_text.done": {
      break;
    }
    case "response.reasoning_text.delta": {
      const delta = event.delta || "";
      if (delta) {
        reasoningContent += delta;
        out.push({ type: "reasoning_chunk", content: delta, round: currentRound });
      }
      break;
    }
    case "response.reasoning_text.done": {
      break;
    }
    case "response.function_call_arguments.delta": {
      const itemId = event.item_id;
      const delta = event.delta || "";
      if (itemId !== undefined) {
        let existing = streamToolCalls.get(itemId);
        if (!existing) {
          existing = { id: itemId, function: { name: "", arguments: "" } };
          streamToolCalls.set(itemId, existing);
        }
        if (delta) {
          existing.function.arguments = (existing.function.arguments || "") + delta;
        }
      }
      break;
    }
    case "response.output_item.added": {
      if (event.item?.type === "function_call" && event.item?.id) {
        const itemId = event.item.id;
        let existing = streamToolCalls.get(itemId);
        if (!existing) {
          existing = { id: itemId, function: { name: "", arguments: "" } };
          streamToolCalls.set(itemId, existing);
        }
        // ★ v5.8 防御：DeepSeek Responses API item.name 可能在以下位置之一
        //   - 扁平: event.item.name
        //   - 嵌套: event.item.function.name
        //   - 函数式: event.item.name 直接为 function name（OpenAI Responses 规范）
        const itemName = event.item.name || event.item.function?.name || "";
        if (itemName && !existing.function.name) {
          existing.function.name = itemName;
        }
      }
      break;
    }
    case "response.completed": {
      const usage = event.response?.usage;
      if (usage) {
        const prompt = usage.input_tokens || 0;
        const completion = usage.output_tokens || 0;
        const total = prompt + completion;
        const cacheHit = usage.input_tokens_details?.cached_tokens || 0;
        const cacheMiss = prompt - cacheHit;
        const cacheTotal = prompt;
        const hitRate = cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(1) : "0.0";
        logger.info(
          `📊 [Round ${currentRound}] LLM usage (Responses API): ` +
          `prompt=${prompt} completion=${completion} total=${total} | ` +
          `prefix_cache: hit=${cacheHit} miss=${cacheMiss} hit_rate=${hitRate}%`,
          { username },
        );
        out.push({
          type: "usage",
          usage: {
            prompt_tokens: prompt,
            completion_tokens: completion,
            total_tokens: total,
            // ★ v5.15：cached_tokens 透传（Responses path 来自 usage.input_tokens_details.cached_tokens）
            //   CC path 来自 usage.prompt_cache_hit_tokens（已在 llm.js:1442 提取）
            //   前端用 cached_tokens / prompt_tokens 计算 prefix cache 命中率
            cached_tokens: cacheHit,
          },
          round: currentRound,
        });
      }
      break;
    }
    case "response.failed": {
      const errMsg = event.response?.error?.message || "Responses API failed";
      out.push({ type: "error", content: errMsg, round: currentRound });
      break;
    }
    case "response.incomplete": {
      out.push({
        type: "error",
        content: "Responses API incomplete: response truncated (max_output_tokens reached)",
        round: currentRound,
      });
      break;
    }
    default:
      break;
  }
  return { events: out, responseText, reasoningContent };
}

// ============================================================
// DB 持久化工具（与 CC path L755-816 1:1）
// ============================================================
async function persistUsageToDb({ sessionId, usage, round }) {
  if (!sessionId) return;
  try {
    const db = getDb();
    // ★ v5.15：cached_tokens 字段（Responses path 来自 usage.input_tokens_details.cached_tokens，
    //   已在 v5.15 yield 处提取到 usage.cached_tokens）—— 与 CC path query.js:482 INSERT 1:1 对齐
    db.prepare('INSERT INTO messages (session_id, role, content, prompt_tokens, completion_tokens, total_tokens, cached_tokens, round) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sessionId, 'usage', `Round token: ${usage.total_tokens} (prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, cached: ${usage.cached_tokens || 0})`, usage.prompt_tokens, usage.completion_tokens, usage.total_tokens, usage.cached_tokens || 0, round);
  } catch (e) {
    logger.error('保存usage失败', { error: e.message });
  }
}

async function persistLogToDb({ sessionId, type, content, round }) {
  if (!sessionId || !content) return;
  try {
    const db = getDb();
    db.prepare('INSERT INTO messages (session_id, role, content, sql, results, round) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, type, content, '', '', round);
  } catch (e) {
    logger.error('保存单条日志失败', { error: e.message });
  }
}

async function persistAssistantFinal({ sessionId, content, sql, promptTokens, completionTokens, totalTokens, elapsedMs, round, interrupted }) {
  if (!sessionId) return false;
  try {
    const db = getDb();
    const wasInterrupted = interrupted ? 1 : 0;
    let contentForDb = content;
    if (wasInterrupted && !contentForDb) {
      contentForDb = '(已中断)';
    }
    if (!contentForDb) return false;
    db.prepare('INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, round, interrupted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sessionId, 'assistant', contentForDb, sql || '', '', promptTokens, completionTokens, totalTokens, elapsedMs, round, wasInterrupted);
    return true;
  } catch (e) {
    logger.error('保存最终消息失败', { error: e.message });
    return false;
  }
}

async function updateSessionTokens({ sessionId, totalTokens }) {
  if (!sessionId || totalTokens <= 0) return;
  try {
    const db = getDb();
    const current = db.prepare('SELECT total_tokens FROM sessions WHERE id = ?').get(sessionId);
    const newTotal = (current?.total_tokens || 0) + totalTokens;
    db.prepare('UPDATE sessions SET total_tokens = ? WHERE id = ?').run(newTotal, sessionId);
  } catch (e) {
    logger.error('更新会话token失败', { error: e.message });
  }
}

// ============================================================
// _runSqlAgentResponsesStreamGen
// 主 generator：与 runSqlAgent 1:1 对齐（业务循环）
// 8 参数签名（allTools / systemMessage / cfg 是新加的，generator 内部使用）
// toolsMap 基于完整 allTools 构建，循环内复用
// ============================================================
async function* _runSqlAgentResponsesStreamGen({
  question, historyText, signal, sessionId, username,
  allTools, systemMessage, cfg, maxToolCalls: maxToolCallsInput,
}) {
  logger.info("runSqlAgentResponses called", {
    question, historyLength: historyText?.length, sessionId, username,
  });

  // 每次新 user 消息（= 一次 invoke）重置"问题级独立"标志
  resetPerQuestionRegistryFlags(getOrCreateRegistry(sessionId));

  // 1) LLM config（与 runSqlAgent L1118 1:1 对齐：从 config.js 取）
  let config;
  try {
    config = cfg || getLlmConfig();
  } catch (e) {
    throw new Error("LLM未配置，请先在配置面板设置LLM Provider和API Key");
  }
  if (!config) {
    throw new Error("LLM未配置，请先在配置面板设置LLM Provider和API Key");
  }
  // baseURL / llmModel 从 getProviderConfig 派生（与 runSqlAgent L1115-1118 等价）
  // ★ getProviderConfig 在 llm.js 是 export，从静态表查（deepseek/openai/ollama 三家）
  //   DB 存的 config 只有 provider/apiKey/model，不含 baseURL
  const { provider, apiKey, model } = config;
  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;

  // 2) System message：直接使用（路由层已拼好）
  // 跳过 loadSkillMd 调用

  // 3) Tools definition（allTools = DynamicTool[]，转换格式）
  // ★ allTools 是必传参数（路由层从 toolFuncs.js 传入）；不在 responsesApi.js 内部 import tools
  //   原因：tools 在 llm.js 是 const，不是 export；为保持 responsesApi.js 独立性，依赖 ctx 传入
  if (!allTools || !Array.isArray(allTools)) {
    throw new Error("runSqlAgentResponsesHandler: allTools must be a non-empty array");
  }
  // ★ v5.7 修复：tools 字段格式从 OpenAI Chat Completions 嵌套格式
  //   {type:'function', function:{name, description, parameters}}
  //   改为 OpenAI Responses API 扁平格式
  //   {type:'function', name, description, parameters}
  //   DeepSeek 报告 `tools[0]: missing field 'name'` 是因为序列化的 JSON 字段路径是 tools[0].name（扁平），
  //   而我传了 tools[0].function.name（嵌套）→ 顶层缺 name 字段
  const toolsDefinition = allTools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.lc_kwargs?.params || {
      type: "object",
      properties: {},
      required: [],
    },
  }));

  // toolsMap 基于完整 allTools 构建（key = t.name），循环内复用
  const toolsMap = new Map(allTools.map((t) => [t.name, t]));

  // 4) Messages 初始化
  let messages = initMessagesForRun({ sessionId, question, systemMessage });

  // 5) Round 计数 / 终止信号
  // ★ Phase 2 决策：max_tool_calls 从参数传入（路由层从 DB 查 agent_max_tool_calls）
  //   原因：getAgentConfig 在 config.js（已 import），但为减少跨文件调用、便于测试，
  //   改为 ctx 传入。default 30 与 CC path L1184 1:1 对齐。
  let maxToolCalls = parseInt(maxToolCallsInput || "30", 10);
  const maxToolCallsInitial = maxToolCalls;
  let responseText = "";
  let pendingUserChoiceList = [];
  const MAX_USER_CHOICE = MAX_USER_CHOICE_PER_TURN;

  // 6) 折叠缓存
  const foldedCache = new Map();

  while (maxToolCalls > 0) {
    const currentRound = maxToolCallsInitial - maxToolCalls;

    if (signal?.aborted) {
      yield { type: "error", content: "请求已被用户中断", round: currentRound };
      return;
    }

    // 6.1) 已调用工具清单消息
    const checklistMsg = sessionId
      ? buildToolCallChecklistMessage(getOrCreateRegistry(sessionId))
      : null;

    // 6.2) Compact consumed tool results + 剥离无 tool_calls 的 reasoning_content
    const compactedMessages = await compactConsumedToolResults(messages, foldedCache);
    const requestMessages = (
      checklistMsg ? [...compactedMessages, checklistMsg] : compactedMessages
    ).map((m) => {
      if (m.role === "assistant" && m.reasoning_content && !m.tool_calls) {
        const { reasoning_content, ...rest } = m;
        return rest;
      }
      return m;
    });

    // 6.3) Tools 剪枝
    const { prunedTools } = getPrunedToolsForRun({
      toolsDefinition,
      sessionId,
      currentRound,
    });

    // 6.4) 构造 Responses API 请求参数
    //   ★ v5.6 修复：input 字段从 chat 格式 messages 转为 Responses API 格式 input items
    //     - chat 格式 {role, content} → Responses API 格式 {type:'message', role, content:[{type:'input_text'|'output_text', text}]}
    //     - assistant.tool_calls → function_call items
    //     - tool 消息 → function_call_output items
    //     - system 消息跳过（instructions 字段已传第一条 system 消息，避免重复）
    //   顶层字段（DeepSeek 2026-08 文档）：
    //     - model / stream / temperature / max_output_tokens / tools / instructions 全部支持
    //     - parallel_tool_calls / max_tool_calls / previous_response_id / store / stream_options 静默忽略（保留无害）
    const inputItems = convertMessagesToInputItems(requestMessages);
    const requestParams = {
      model: llmModel,
      input: inputItems,
      instructions: systemMessage,
      temperature: 0,
      stream: true,
      max_output_tokens: 20000,
      tools: prunedTools,
      reasoning: { effort: "high" },
      parallel_tool_calls: true,
    };

    queueLog(
      `runSqlAgentResponses Round ${currentRound} Request:\n` +
      JSON.stringify(requestParams, null, 2),
      true,
      username,
    );

    try {
      // 6.5) 调用 Responses API + 流式累积
      const streamToolCalls = new Map();
      let reasoningContent = "";
      responseText = "";

      for await (const event of fetchResponsesStream({
        baseURL, apiKey, llmModel, requestParams, signal,
      })) {
        if (signal?.aborted) break;
        const result = translateResponsesEvent(event, {
          streamToolCalls, responseText, reasoningContent, currentRound, username,
        });
        for (const ev of result.events) {
          yield ev;
        }
        responseText = result.responseText;
        reasoningContent = result.reasoningContent;
        if (event.type && RESPONSES_TERMINAL_EVENTS.has(event.type)) {
          break;
        }
      }

      // 6.6) splitThinkingFromContent 后处理
      const { content: cleanContent, extraThinking } =
        splitThinkingFromContent(responseText);
      const finalResponseText = cleanContent;
      const finalReasoningContent = extraThinking
        ? (reasoningContent ? reasoningContent + "\n\n" + extraThinking : extraThinking)
        : reasoningContent;

      if (extraThinking) {
        yield {
          type: "message_final",
          content: finalResponseText,
          extraThinking,
          round: currentRound,
        };
      }
      if (finalReasoningContent) {
        yield {
          type: "reasoning_done",
          content: `💭 LLM思考过程:\n${finalReasoningContent.slice(0, 10000)}`,
          round: currentRound,
        };
      }

      // 6.7) 过滤出有效工具调用
      const validToolCalls = Array.from(streamToolCalls.values()).filter(
        (tc) => tc.function?.name && tc.function.name.trim(),
      );

      for (const tc of validToolCalls) {
        const toolName = tc.function.name;
        queueLog(
          `🔧 调用工具: ${toolName} 参数:${JSON.stringify(tc.function.arguments)}`,
          true,
        );
        let logMsg = `🔧 调用工具: ${toolName}`;
        try {
          const parsedArgs = JSON.parse(tc.function.arguments || "{}");
          if (Object.keys(parsedArgs).length > 0) {
            logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
          }
        } catch (e) {
          logger.debug("JSON parse/split failed", { error: e.message });
        }
        yield { type: "tool", log: logMsg, round: currentRound };
      }

      // 6.8) 保存 assistant 消息
      const assistantMsg = {
        role: "assistant",
        content: finalResponseText || "",
        reasoning_content: finalReasoningContent || "",
      };
      if (validToolCalls.length > 0) {
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
      // 用 helper 5 同步 lastMessages + saveMessagesToDb
      saveRunState({ sessionId, messages });

      if (validToolCalls.length > 0) {
        // 6.9) 工具执行
        const { execResults } = await executeToolCallsInStages({
          validToolCalls, toolsMap, prunedTools,
          sessionId, messages, username, currentRound,
        });

        // 6.10) yield tool_return 事件
        for (const p of execResults) {
          if (!p.tool && !p.execError) continue;
          const toolName = p.toolName;
          const toolArgs = p.toolCall.function.arguments || "{}";

          if (p.dupCheck && p.dupCheck.block) {
            yield {
              type: "tool_return",
              log: `🚫 拦截重复调用: ${toolName}\n参数: ${toolArgs}\n${p.dupCheck.message}`,
              round: currentRound,
            };
            continue;
          }
          if (p.execError) {
            const isParseError = p.execError.message.includes("不是合法 JSON") || p.execError.message.includes("参数解析失败");
            const errLabel = isParseError ? "参数解析失败" : "工具不可用";
            yield {
              type: "tool_return",
              log: `🚫 ${errLabel}: ${p.toolName}\n${p.execError.message}`,
              round: currentRound,
            };
            continue;
          }
          const resultContent = p.toolMessageContent || (p.notice ? `${p.notice}\n\n${p.rawResult}` : p.rawResult);
          if (p.autoFixed) {
            yield {
              type: "tool_return",
              log: `✅ ${toolName} 参数已自动修复（裸 ASCII 双引号 → 中文右引号）。后续请直接使用中文引号 \`""\` 或 \`「」\`，或反斜杠转义 \`\\"\`；禁止裸 ASCII 双引号。`,
              round: currentRound,
            };
          }
          yield {
            type: "tool_return",
            log: `📋 工具 ${toolName} 返回:\n${typeof resultContent === "string" ? resultContent : JSON.stringify(resultContent)}`,
            round: currentRound,
          };
        }

        // 6.11) 检测 request_user_choice 终止信号
        recordPendingUserChoices({
          execResults, pendingUserChoiceList, sessionId,
          MAX_USER_CHOICE_PER_TURN: MAX_USER_CHOICE,
        });
        if (pendingUserChoiceList.length > 0) break;

        maxToolCalls--;
        continue;
      }
      break;
    } catch (e) {
      // ★ v5.10 修复：catch 块不能访问 try 局部变量（streamToolCalls/responseText）
      //   ReferenceError: streamToolCalls is not defined
      //   改用纯字符串描述，避免引用未声明的 try 局部变量
      logger.error("[responsesApi] generator catch error", {
        round: currentRound,
        error: e.message,
        stack: e.stack,
        note: "streamToolCalls/responseText 是 try 局部变量，catch 块不可见 — 见 v5.10 修复",
      });
      if (e.name === "AbortError") {
        yield { type: "error", content: "请求已被用户中断", round: currentRound };
      } else {
        yield { type: "error", content: e.message, round: currentRound };
      }
      return;
    }
  }

  // 7) request_user_choice 终止分支
  if (pendingUserChoiceList.length > 0) {
    let dbSaveOk = true;
    if (sessionId) {
      try {
        saveRunState({ sessionId, messages });
      } catch (e) {
        dbSaveOk = false;
        logger.error("CRITICAL: saveMessagesToDb failed for user_choice flow", { sessionId, error: e.message });
      }
    }
    queueLog(
      `🔔 TURN 1 终止 - user_choice 请求链 (共 ${pendingUserChoiceList.length} 个): ` +
      pendingUserChoiceList.map((p, i) =>
        `[${i + 1}] id=${p.id} question="${String(p.question || "").slice(0, 60)}" multi_select=${!!p.multi_select}`,
      ).join(" | ") +
      ` dbSaveOk=${dbSaveOk}`,
      true,
      username,
    );
    flushLogs();
    if (!dbSaveOk) {
      logger.warn("DB save failed, falling back to LLM continuation", { sessionId });
      yield {
        type: "done",
        sql: "",
        message: responseText + "\n\n（系统提示：用户交互持久化失败，请基于已有信息继续）",
        userChoiceRequest: null,
      };
      return;
    }
    console.log(`[user_choice] yield done → userChoiceRequest 长度=${pendingUserChoiceList.length}`);
    yield {
      type: "done",
      sql: "",
      message: responseText,
      userChoiceRequest: pendingUserChoiceList,
    };
    return;
  }

  // 8) 正常完成
  queueLog(`=== BAK 完成 SQL: ${responseText}`, true, username);
  flushLogs();
  yield { type: "done", sql: "", message: responseText };
}

// ============================================================
// runSqlAgentResponsesHandler
// 路由 handler（与 query.js L404-625 CC path 1:1 对齐）
// ctx 边界：abortController / overallTimer / streamCompleted 由路由层管理
// 不调 res.flushHeaders() + 不发 meta（路由层 F9 已做）
// 保留路由层的 logger.info（运维日志）
// ============================================================
export async function runSqlAgentResponsesHandler(req, res, ctx) {
  const {
    abortController, requestStartTime, overallTimer, streamCompleted,
    sessionId, question, historyText, username,
    tools: toolsInput, cfg, systemMessage, llmCfg, logger: routeLogger,
  } = ctx;

  const log = routeLogger || logger;
  const allTools = toolsInput;

  let fullContent = '';
  let sql = '';
  let message = '';
  const allLogs = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let messageSaved = false;
  let lastRound = 0;
  let userChoiceRequestFromStream = null;

  try {
    const generator = _runSqlAgentResponsesStreamGen({
      question, historyText, signal: abortController.signal, sessionId, username,
      allTools, systemMessage, cfg: llmCfg || cfg,
    });

    for await (const chunk of generator) {
      if (abortController.signal.aborted) break;
      if (typeof chunk.round === 'number') {
        lastRound = chunk.round;
      }

      switch (chunk.type) {
        case 'chunk':
          fullContent += chunk.content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          break;
        case 'usage':
          totalPromptTokens += chunk.usage.prompt_tokens;
          totalCompletionTokens += chunk.usage.completion_tokens;
          totalTokens += chunk.usage.total_tokens;
          await persistUsageToDb({ sessionId, usage: chunk.usage, round: chunk.round || 0 });
          break;
        case 'LLM':
        case 'tool':
        case 'tool_return': {
          const logContent = chunk.log || '';
          allLogs.push(logContent);
          res.write(`data: ${JSON.stringify({ type: chunk.type, log: logContent, round: chunk.round || 0 })}\n\n`);
          await persistLogToDb({ sessionId, type: chunk.type, content: logContent, round: chunk.round || 0 });
          break;
        }
        case 'reasoning_chunk':
          res.write(`data: ${JSON.stringify({ type: 'reasoning_chunk', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          break;
        case 'message_final':
          res.write(`data: ${JSON.stringify({ type: 'message_final', content: chunk.content, extraThinking: chunk.extraThinking, round: chunk.round || 0 })}\n\n`);
          break;
        case 'reasoning_done':
          await persistLogToDb({ sessionId, type: 'LLM', content: chunk.content, round: chunk.round || 0 });
          break;
        case 'error':
          res.write(`data: ${JSON.stringify({ type: 'error', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          break;
        case 'done':
          sql = chunk.sql || '';
          message = chunk.message || '';
          if (chunk.userChoiceRequest && !userChoiceRequestFromStream) {
            userChoiceRequestFromStream = chunk.userChoiceRequest;
          }
          break;
      }
    }

    // SQL 回退提取
    if (!sql || sql.trim() === '') {
      const contentToExtract = message || fullContent;
      const sqlMatch = contentToExtract.match(/```sql\s*([\s\S]*?)```/i) || contentToExtract.match(/```mysql\s*([\s\S]*?)```/i);
      if (sqlMatch) {
        sql = sqlMatch[1].trim();
      } else {
        const sqlLineMatch = contentToExtract.match(/SQL[:：]\s*[\n\r]?([\s\S]*?)(?:\n\n|\n$|$)/i);
        if (sqlLineMatch) {
          sql = sqlLineMatch[1].trim();
        }
      }
    }

    if (!message || message.trim() === '') {
      message = fullContent;
    }

    log.info('Stream done, sending final result', { sql: sql?.substring(0, 50), message: message?.substring(0, 50), totalTokens });

    const elapsedMs = Date.now() - requestStartTime;

    // 保存最终消息
    const wasInterrupted = abortController.signal.aborted;
    let contentForDb = fullContent || message;
    if (wasInterrupted && !contentForDb) {
      contentForDb = '(已中断)';
    }
    if (sessionId && contentForDb) {
      messageSaved = await persistAssistantFinal({
        sessionId, content: contentForDb, sql,
        promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens,
        elapsedMs, round: lastRound, interrupted: wasInterrupted,
      });
      await updateSessionTokens({ sessionId, totalTokens });
    }

    const doneData = {
      type: 'done',
      sql,
      message,
      sessionId,
      totalTokens,
      elapsedMs,
    };
    if (userChoiceRequestFromStream) {
      doneData.user_choice_request = userChoiceRequestFromStream;
    }
    const confirmMatch = message.match(/<!--confirm_tag_add:(\{[^}]+\})-->/);
    if (confirmMatch) {
      try {
        const confirmData = JSON.parse(confirmMatch[1]);
        doneData.confirm_tag_add = confirmData;
      } catch (e) {
        log.warn('confirm_tag_add parse failed', { error: e.message });
      }
    }

    ctx.streamCompleted = true;
    clearTimeout(overallTimer);
    res.write(`data: ${JSON.stringify(doneData)}\n\n`);
  } catch (error) {
    ctx.streamCompleted = true;
    clearTimeout(overallTimer);
    log.error('Stream query failed', { error: error.message, stack: error.stack });

    const isAbort = abortController.signal.aborted
      || error.name === 'AbortError'
      || /aborted|abort|timeout/i.test(error.message || '');
    if (isAbort && !messageSaved && sessionId) {
      try {
        const elapsedMs = Date.now() - requestStartTime;
        const contentForDb = fullContent || message || '(已中断)';
        await persistAssistantFinal({
          sessionId, content: contentForDb, sql,
          promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens,
          elapsedMs, round: lastRound, interrupted: true,
        });
        messageSaved = true;
        await updateSessionTokens({ sessionId, totalTokens });
        log.info('Partial assistant message saved (interrupted)', {
          sessionId, contentLength: fullContent.length, totalTokens, elapsedMs, round: lastRound,
          isEmptyContent: !fullContent && !message,
        });
      } catch (saveErr) {
        log.error('保存中断 partial 消息失败', { error: saveErr.message });
      }
    }

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: error.message, interrupted: isAbort })}\n\n`);
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
}
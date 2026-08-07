// ============================================================
// Phase 2 Step 2: agentHelpers.js
// 5 个 helper 函数（1:1 抽取 runSqlAgent inline 逻辑）
// ============================================================
// ★ v5.12 修复：getToolName 提为顶层 helper（修复前在 getPrunedToolsForRun 内部是局部变量）
//   原因：executeToolCallsInStages 也要读 tool name（availableToolNames / toolName 提取），
//   共享同一 schema 抽象避免两处分别写 fallback 逻辑漂移。
//   兼容两种 tool schema：
//     嵌套（CC path / OpenAI Chat Completions）：{type:'function', function:{name, ...}}
//     扁平（Responses path / OpenAI Responses API）：{type:'function', name, ...}
function getToolName(t) {
  return t?.function?.name || t?.name || "";
}
// 设计原则：
//   - 不修改 runSqlAgent 任何代码（双份共存约束）
//   - 纯函数：ctx 参数显式传入，无闭包依赖
//   - 不导出与 llm.js 重复的 import 符号（避免循环依赖）
//   - executeToolCallsInStages 不在内部调 saveRunState
//     （避免与 5.2 节 yield tool 前的 saveRunState 双重写盘，12 轮审计修订）
//
// ★ responsesApi.js 完全独立约束：
//   agentHelpers.js 是 llm.js 的纯函数化重构 + 与 responsesApi.js 共用的中间层。
//   responsesApi.js 只 import 本文件（不直接 import llm.js），保证"新 API 完全独立"。
// ============================================================

import {
  loadMessagesFromDb,
  saveMessagesToDb,
  getOrCreateRegistry,
  fixBareQuotesInJsonArgs,
  checkAndFilterDuplicateCall,
  recordToolCall,
  queueLog,
  flushLogs,
  setLastMessages,
} from "./llm.js";
import { logger } from "../logger.js";

// ============================================================
// helper 1: initMessagesForRun
// 源：llm.js L1131-1165（1:1 抽取）
// 职责：从 DB 加载历史消息（如有）+ 拼接 system+user 消息 → 返回初始 messages 数组
// ============================================================
export function initMessagesForRun(ctx) {
  // ctx: { sessionId, question, systemMessage }
  const { sessionId, question, systemMessage } = ctx;
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
      // 添加新的用户消息
      messages.push({ role: "user", content: question });
    } else {
      messages = [
        { role: "system", content: systemMessage },
        { role: "user", content: question },
      ];
    }
  } else {
    messages = [
      { role: "system", content: systemMessage },
      { role: "user", content: question },
    ];
  }
  return messages;
}

// ============================================================
// helper 2: getPrunedToolsForRun
// 源：llm.js L1271-1295（1:1 抽取）
// 职责：按 sessionId 注册表剪枝一次性工具（get_domain_index / get_sliced_index）
// 返回：{ prunedTools, prunedNames }
// ============================================================
export function getPrunedToolsForRun(ctx) {
  // ctx: { toolsDefinition, sessionId, currentRound }
  //   currentRound = maxToolCallsInitial - maxToolCalls（由调用方计算）
  const { toolsDefinition, sessionId, currentRound } = ctx;
  const pruneReg = sessionId ? getOrCreateRegistry(sessionId) : null;
  // ★ v5.9 修复：filter 回调兼容两种 tool schema（嵌套 + 扁平）
  //   复用 v5.12 顶层 helper getToolName，避免与 executeToolCallsInStages 漂移
  const prunedTools = pruneReg
    ? toolsDefinition.filter((t) => {
        const toolName = getToolName(t);
        if (toolName === "get_domain_index" && pruneReg.getDomainIndexCalled)
          return false;
        if (toolName === "get_sliced_index" && pruneReg.slicedDomains.size > 0)
          return false;
        return true;
      })
    : toolsDefinition;
  const prunedNames = toolsDefinition
    .filter((t) => !prunedTools.includes(t))
    .map((t) => getToolName(t));
  if (prunedNames.length > 0) {
    queueLog(
      `✂️ [Round ${currentRound}] 本轮 LLM 请求已剪枝工具（不再传入）: ${prunedNames.join(", ")}`,
      true,
    );
  }
  return { prunedTools, prunedNames };
}

// ============================================================
// helper 5: saveRunState
// 源：llm.js L1556-1572（push assistantMsg 后立即调）+ L1960-1983（TURN 1 终止分支）
// 职责：同步 lastMessages 全局缓存 + saveMessagesToDb 持久化
// 注：不在 helper 3 内部调，由 generator 在合适时机调（避免重复写盘）
// ============================================================
export function saveRunState(ctx) {
  // ctx: { sessionId, messages, apiMode }
  const { sessionId, messages, apiMode } = ctx;
  // 同步一份到全局缓存（仅供开发期 GET /api/query/messages 调试接口使用）
  // ★ 深拷贝（与 CC path L1567 1:1 对齐）
  setLastMessages(messages);
  // 保存到数据库（如果有 sessionId）
  if (sessionId) {
    // ★ v5.14：Responses path 传 apiMode='responses_api'
    //   saveMessagesToDb 后端默认 chat_completions，Responses path 显式覆盖
    saveMessagesToDb(sessionId, messages, apiMode || "responses_api");
  }
}

// ============================================================
// helper 4: recordPendingUserChoices
// 源：llm.js L1871-1942（1:1 抽取，原本内联在 executeToolCallsInStages 阶段 3 内）
// 职责：从 execResults 中检测 request_user_choice 工具的 payload，
//       按 MAX_USER_CHOICE_PER_TURN 限制 push 到 pendingUserChoiceList
// 注：MAX_USER_CHOICE_PER_TURN 从 ctx 传入（不依赖 llm.js 的 inline const）
// ============================================================
export function recordPendingUserChoices(ctx) {
  // ctx: {
  //   execResults,            // executeToolCallsInStages 返回的 execResults
  //   pendingUserChoiceList,  // mutated: 累积 pending user choice payload
  //   sessionId,
  //   MAX_USER_CHOICE_PER_TURN,
  // }
  const { execResults, pendingUserChoiceList, sessionId, MAX_USER_CHOICE_PER_TURN } = ctx;

  for (const p of execResults) {
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
                droppedQuestion: String(payload?.question || "").slice(0, 80),
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
}

// ============================================================
// helper 3: executeToolCallsInStages
// 源：llm.js L1574-1943（1:1 抽取，原本内联在 runSqlAgent while 循环 validToolCalls 分支内）
// 职责：3 阶段处理 validToolCalls（同步预处理 → 并行执行 → 按顺序写回 messages + yield tool_return）
// 返回：{ hadToolCalls: boolean, execResults: Array }
// ★ 不在内部调 saveRunState（避免重复写盘，caller 在合适时机调 saveRunState）
// ★ 不在内部调 recordPendingUserChoices（caller 在写回 messages 之后单独调）
// ============================================================
export async function executeToolCallsInStages(ctx) {
  // ctx: {
  //   validToolCalls,        // LLM 返回的 tool_calls（已经过 fetchResponsesStream 处理）
  //   toolsMap,              // Map<string, DynamicTool>（generator 初始化时构建一次）
  //   prunedTools,           // 本轮实际发给 LLM 的 prunedTools（用于 availableToolNames）
  //   sessionId,
  //   messages,              // mutated: push assistantMsg 不在 helper 里（由 caller 在调 helper 前 push）
  //                              //          push tool msg 在阶段 3
  //   username,
  //   currentRound,
  // }
  const { validToolCalls, toolsMap, prunedTools, sessionId, messages, username, currentRound } = ctx;

  // 阶段 1：同步预处理（参数解析 + 重复调用检查）
  // 必须在并行执行前一次性完成，避免同一会话内两个相同工具的检查互相穿透
  // ★ 本轮可用的工具名集合（来自本轮实际发给 LLM 的 prunedTools）
  //   一次性工具（get_domain_index / get_sliced_index）调用后被剪枝，从这里消失。
  //   LLM 若仍"幻觉"调用被剪枝的工具 → 立即拦截，不进入执行阶段。
  // ★ v5.12 修复：prunedTools 在 Responses path 是扁平 schema，复用顶层 getToolName
  const availableToolNames = new Set(
    prunedTools.map((t) => getToolName(t)),
  );
  const prepared = validToolCalls.map((toolCall) => {
    // ★ v5.12 修复：validToolCalls 来源 streamToolCalls.values()，在 Responses path
    //   是嵌套 schema（generator L535-541 显式包了 function.name/arguments），
    //   但仍然走 getToolName 抽象保持兼容性（与 L245 共享）
    const toolName = getToolName(toolCall);
    const toolArgs = toolCall.function?.arguments || toolCall.arguments || "{}";
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
        // ★ validate_sql_fields 特殊处理
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
  //   ★ 不 yield tool_return 事件——caller（generator）负责 yield（helper 是纯函数，不做流式分派）
  //   ★ 仅写回 messages（mutated）和 dupCheck/execError 拦截信息
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
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: resultContent,
    });
  }

  return { hadToolCalls: validToolCalls.length > 0, execResults };
}

// ============================================================
// helper 6: convertMessagesToInputItems
// 源：Phase 2 v5.6 修复
// 职责：把 chat 格式 messages [{role, content, tool_calls?, tool_call_id?}] 转
//       Responses API 格式 input items [{type:'message', role, content:[{type:'input_text', text}]} | {type:'function_call', ...} | {type:'function_call_output', ...}]
// ★ Responses API input 字段约定（DeepSeek 2026-08 文档）：
//   - input 是字符串 或 输入 item 列表
//   - input 与 instructions 至少传一个；instructions = 第一条 system 消息
//   - message item 角色支持 user/assistant/system/developer（developer 视同 system）
//   - content 是 input_text / output_text 块数组（不是字符串）
//   - function_call_output 替代 Chat Completions 的 tool 消息
// ★ 不转换 system message：调用方传 systemMessage 给 instructions 字段即可
//   （避免与 messages 里的 system 重复，DeepSeek 文档明示 instructions 是第一条 system 消息）
// ★ 跳过 tool_calls 处理：本轮发送的 input items 中 assistant tool_calls 通过 type:'function_call'
//   表示（OpenAI Responses API 规范）。但 DeepSeek 文档显示 function_call item "归并到相邻 assistant 消息"，
//   简化处理：直接展开为 message + function_call items，让 DeepSeek 服务端自动归并
// ============================================================
export function convertMessagesToInputItems(messages) {
  const items = [];
  for (const m of messages) {
    if (m.role === "system") {
      // ★ 跳过 system：调用方用 instructions 字段传第一条 system 消息
      continue;
    }
    if (m.role === "user") {
      items.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: String(m.content || "") }],
      });
      continue;
    }
    if (m.role === "assistant") {
      // ★ v5.13 修复：reasoning_text 必须回传（DeepSeek Responses API thinking mode）
      //   Round 0 assistant 有 reasoning_content → 转成 type:'reasoning' item
      //   DeepSeek 文档（2026-08）：
      //     - reasoning item 支持，plain-text content 归并到相邻 assistant 消息
      //     - 但 thinking mode 下跨轮调用必须把上一轮 reasoning_text 回传（不传会 4xx 报错）
      //   OpenAI Responses 规范：reasoning item 结构 { type:'reasoning', content:[{type:'reasoning_text', text}] }
      if (m.reasoning_content && String(m.reasoning_content).trim()) {
        items.push({
          type: "reasoning",
          content: [{ type: "reasoning_text", text: String(m.reasoning_content) }],
        });
      }
      // 1) assistant 的 content（如果非空）
      const content = String(m.content || "");
      if (content) {
        items.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: content }],
        });
      }
      // 2) assistant 的 tool_calls → function_call items
      if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          items.push({
            type: "function_call",
            id: tc.id,
            call_id: tc.id,  // DeepSeek Responses API 同时要求 call_id（OpenAI Responses 规范）
            name: tc.function?.name,
            arguments: tc.function?.arguments || "{}",
          });
        }
      }
      continue;
    }
    if (m.role === "tool") {
      // ★ Chat Completions 的 tool 消息 → Responses API 的 function_call_output
      //   DeepSeek 文档：function_call_output 字段结构：{ call_id, output }
      items.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: String(m.content || ""),
      });
      continue;
    }
    // 未知 role：兜底为 user message（防御性，正常不会出现）
    items.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: String(m.content || "") }],
    });
  }
  return items;
}
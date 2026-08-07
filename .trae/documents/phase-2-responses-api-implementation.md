# Phase 2 实施计划：SQL Agent 迁移至 DeepSeek Responses API

> **来源**：本计划基于 [`docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md)（12 + 13 轮审计修订，约 1530 行）。
> **本计划目标**：把 1530 行架构设计**落地为可执行清单**，列出每个 step 的具体文件 + 行号 + 关键函数 + 测试方法。
> **仅改文档**：本计划本身**不是**代码改动，**只有** Step 1-6 落地时才会创建/修改代码。

---

## Context（为什么做这个改动）

Phase 1 完成了 DeepSeek API 的 `apiMode` 透传 + GET 兜底（F13，[test-llm-config-apimode.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-llm-config-apimode.mjs) 9 个 case 覆盖）。当前路由层 F14 占位符（[query.js:388-401](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L401)）在用户切到 `responses_api` 时返回 "暂未实现" 错误。

Phase 2 的目标：**完整实现** Responses API 路径，让 `apiMode='responses_api'` 可用，行为与 Chat Completions 路径**1:1 对齐**（含 tool_call 并行、reasoning 可见、user_choice 弹窗、SQL 回退提取、confirm_tag_add 解析、F9 sessionId 提前下发、F11 UTF-8/SSE 行切分修复）。

**关键设计原则**（已锁）：
1. **新 API 完全独立**：新建 [responsesApi.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/responsesApi.js) + [agentHelpers.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/agentHelpers.js)，**不动** runSqlAgent 任何代码。
2. **代码 0 复制**：6 个 helper 1:1 抽取 runSqlAgent inline 逻辑，**双份共存**（不是迁移），保证新 handler 与原行为完全一致。
3. **前端 0 改动**：事件类型对齐 [App.jsx:840-1052](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L840-L1052) 现有 case（`chunk` / `LLM` / `tool` / `tool_return` / `reasoning_chunk` / `reasoning_done` / `message_final` / `error` / `done`），模仿 CC path log 风格。

---

## 前置条件（已验证 OK）

- ✅ [llm.js:335](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L335) `lastMessages` 全局 + [L337-339](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L337-L339) `getLastMessages()` export 存在
- ✅ [llm.js:1131-1165](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1131-L1165) `initMessagesForRun` inline 逻辑
- ✅ [llm.js:1262-1280](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1262-L1280) `getPrunedToolsForRun` inline 逻辑
- ✅ [llm.js:885](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L885) `baseURL = "https://api.deepseek.com"` + [L1318](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1318) + [L2071](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L2071) 两次 fetch 调用
- ✅ [llm.js:1349-1383](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1349-L1383) F11 修复模式（buffer + decode stream + lines.pop）
- ✅ [llm.js:1180](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1180) `MAX_USER_CHOICE_PER_TURN = 3`
- ✅ [query.js:388-401](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L401) F14 占位符
- ✅ 21 个 test-*.mjs 文件在 backend/ 根目录（用 `node test-xxx.mjs` 直接跑，无 jest/vitest）

**待创建**：
- `backend/src/services/agentHelpers.js`（~570 行：6 个 helper）
- `backend/src/services/responsesApi.js`（~600 行：5 个函数 + handler）

**待新增**：
- `backend/src/services/llm.js` L339 后新增 `setLastMessages()` setter（紧挨 getLastMessages，纯加法）
- `backend/test-agent-helpers-execution.mjs`（helper 端到端测试，必需）
- `backend/test-run-sql-agent-responses-handler.mjs`（handler E2E 测试）

---

## 实施步骤（10 个 step，~7h 总工时）

### Step 0: 准备（无代码改动）✅ 已完成

13 轮审计修订已落进 [计划文档](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md)。所有架构决策锁定。

### Step 1: 新增 `setLastMessages` setter（~5min）

**目标文件**：[backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js)

**改动**：在 [L337-339](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L337-L339) 紧挨插入：

```js
// ★ Phase 2 B1: setter（与 getLastMessages 对偶，供 responsesApi.js 同步 lastMessages 全局缓存）
//   ★ 深拷贝原因（与 CC path L1558 `lastMessages = JSON.parse(JSON.stringify(messages))` 1:1 对齐）：
//     CC 路径不深拷贝会让调试接口 GET /api/query/messages 返回"未来轮次"消息
//     （因为 messages 后续会被 push 新 tool 消息，原引用 lastMessages 也跟着变），
//     深拷贝隔离让 GET 始终返回"调用 setter 那一刻的快照"
export function setLastMessages(messages) {
  lastMessages = JSON.parse(JSON.stringify(messages));
}
```

**为什么必要**：[issue #6 B1](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md) 要求新 handler 与 CC path 行为一致，CC path 内部 `lastMessages = JSON.parse(JSON.stringify(messages))`（L1558），新 handler 调 setter。

**测试**：手动验证 `setLastMessages([{role:'user',content:'x'}])` + `getLastMessages()` 返回相同内容。

---

### Step 2: 创建 `agentHelpers.js`（~570 行，~1.5h）

**新文件**：[backend/src/services/agentHelpers.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/agentHelpers.js)

**6 个 helper**（按依赖顺序）：

| # | 函数名 | 源 inline 行号 | 关键依赖 | 返回值 |
|---|---|---|---|---|
| 1 | `initMessagesForRun` | [L1131-1165](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1131-L1165) | `loadMessagesFromDb` | `Array` |
| 2 | `getPrunedToolsForRun` | [L1262-1280](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1262-L1280) | `getOrCreateRegistry` | `{prunedTools, prunedNames}` |
| 3 | `executeToolCallsInStages` | [L1565-1933](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1565-L1933) | `toolsMap` + `messages`（mutated）| `{hadToolCalls, execResults}` |
| 4 | `recordPendingUserChoices` | [L1854-1932](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1854-L1932) | `pendingUserChoiceList`（mutated）| `void` |
| 5 | `saveRunState` | [L1556-1563](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1556-L1563) + [L1960-1974](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1960-L1974) | `setLastMessages` (新) + `saveMessagesToDb` | `void` |

**关键技术约束**（12 + 13 轮审计锁定）：
- **纯函数**：所有 ctx 参数显式传入，无闭包依赖
- **不修改** runSqlAgent 任何代码
- **不导出** 与 llm.js 重复的 import 符号（避免循环依赖）
- **`executeToolCallsInStages` 不在内部调 `saveRunState`**（避免与 5.2 节 yield tool 前的 saveRunState 双重写盘）— 这是 12 轮审计修订

**import 列表**（从 llm.js 复用）：
```js
import {
  loadMessagesFromDb,
  saveMessagesToDb,
  getOrCreateRegistry,
  setLastMessages,  // 新增于 Step 1
} from "./llm.js";
```

**关键函数签名**（5.5.4 节已锁定）：
```js
export async function executeToolCallsInStages(ctx) {
  // ctx: { validToolCalls, toolsMap, sessionId, availableToolNames, messages, pendingUserChoiceList, username, currentRound, question }
  return { hadToolCalls, execResults };
}
```

**验证**：
- 文件创建后跑 `node -e "import('./src/services/agentHelpers.js').then(m => console.log(Object.keys(m)))"` 看 6 个 export
- **不跑**功能测试（Step 6 才跑）

---

### Step 3: 创建 `responsesApi.js`（~600 行，~2.5h）

**新文件**：[backend/src/services/responsesApi.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/responsesApi.js)

**5 个函数**：

| # | 函数名 | 职责 | 行数 |
|---|---|---|---|
| 1 | `fetchResponsesStream` | 调 DeepSeek Responses API（endpoint + headers + body + 流式读取）| ~140 |
| 2 | `translateResponsesEvent` | 1 个 Responses SSE event → 内部 yield event（4.4 节）| ~80 |
| 3 | `buildResponsesBody` | 构造 Responses API request body（从 messages + tools + model）| ~60 |
| 4 | `_runSqlAgentResponsesStreamGen` | 主 generator（5.2 节伪代码 ~370 行 → 真实代码）| ~280 |
| 5 | `runSqlAgentResponsesHandler` | 路由 handler 入口（5.1 节伪代码 ~280 行 → 真实代码 ~330 行）| ~330 |

**关键技术约束**（13 轮审计锁定）：

1. **fetch 端点**：`https://api.deepseek.com/responses`（**不是** `/chat/completions`）
2. **body schema**：与 CC 不同（4.1 节 + 4.2 节已列差异表）
3. **事件类型**：模仿 CC path log 风格：
   - `{type:'tool', log:'🔧 调用工具: xxx\n参数: {...}', round}`（CC path [L1515-1530](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1515-L1530) 1:1）
   - `{type:'tool_return', log:'📋 工具 xxx 返回: ...', round}`（CC path [L1844-1848](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1844-L1848) 1:1）
4. **reasoning 三者并存**（13 轮方案 1）：
   - yield `{type:'reasoning_done', content: '💭 LLM思考过程:\n...', round}` 在每轮推理结束
   - assistantMsg.reasoning_content 字段存 DB（与 CC path L1538 字段名一致）
   - `done` 事件带 `reasoning: finalReasoning` 字段
5. **`saveRunState` 时机**：`messages.push(assistantMsg)` 之后立即调（与 CC path L1556-1563 顺序 1:1，**不**是工具执行后）
6. **`availableToolNames` 字段名**：`prunedTools.map(t => t.function.name)`（与 CC path [L1571-1573](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1571-L1573) 1:1，**不是** `t.name`）
7. **handler 必备变量**：`userChoiceRequestFromStream`（11 轮审计"副 1 修复"误判，13 轮恢复）
8. **handler 收尾两步**：
   - SQL 回退提取（`message || fullContent` 正则，与 [query.js:494-506](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L494-L506) 1:1）
   - confirm_tag_add 解析（`<!--confirm_tag_add:({...})-->` 正则，与 [query.js:570-578](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L570-L578) 1:1）
9. **F9 + F11 修复模式**：
   - meta 事件**由路由层**在 `res.flushHeaders()` 之后、for-await 之前发（[query.js:374-381](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L374-L381) 模式），handler **接收** res 时已是 flushed 状态，**不再调** flushHeaders / **不再发** meta
   - F11 修复：`let buffer = '';` + `decoder.decode(value, { stream: !done })` + `lines.pop()`
10. **handler for-await 必加 case**：
    - `chunk` / `reasoning_chunk` / `reasoning_done`（写 DB 不写 SSE）/ `message_final` / `tool` / `tool_return` / `LLM` / `usage` / `error` / `done`（设局部变量，不写 SSE）
11. **handler 签名（必经参数）**：
    ```js
    runSqlAgentResponsesHandler(req, res, ctx) {
      // ctx = {
      //   abortController: 路由层已创建 + 已绑定 res.on('close') + OVERALL_TIMEOUT_MS timer
      //   requestStartTime: Date.now()  // 路由层 L316 创建
      //   overallTimer: setTimeout(...)  // 路由层 L360 创建
      //   streamCompleted: false         // 路由层 L355 创建
      //   sessionId: ...                 // 路由层获取（可能为 null）
      //   question: ...                  // 用户问题
      //   historyText: ...               // 当前 dead-code 占位
      //   username: req.user.username
      //   tools: toolsDefinition          // 路由层已加载（与 CC path L1115-1128 1:1）
      //   cfg: agentConfig               // 路由层已加载
      //   systemMessage: ...              // 路由层已拼装（与 CC path L1131-1132 1:1）
      //   llmCfg: llmCfgForDispatch      // 路由层已 getLlmConfig()
      //   logger: ...                    // 路由层共享 logger
      // }
    }
    ```
    **不创建** abortController / overallTimer / streamCompleted——这些**生命周期管理**由路由层负责（与 CC path 1:1 对齐，CC path 路由层 L355-372 创建 + L582-625 catch 块清理）

12. **generator 签名（必经参数）**：
    ```js
    async function* _runSqlAgentResponsesStreamGen({
      question, historyText, signal, sessionId, username,
      allTools,        // ★ DynamicTool[]（从 ctx.tools 传入，与 CC path L1115-1128 1:1）
      systemMessage,   // ★ 已拼装的 systemMessage（与 CC path L1131-1132 1:1）
      cfg,             // ★ agentConfig（含 max_tool_calls 等）
    }) {
      // ★ historyText 在 generator 内**不直接使用**（与 CC path L334 [DEAD-CODE 2026-07-15] 1:1 对齐）
      //   历史从 DB loadMessagesFromDb 加载，不依赖传入 historyText 占位
      //   保留参数是 signature 对齐 CC path（CC path L405 接收 history 也不使用）
      ...
    }
    ```
    **关键**：handler 调用 generator 时**必须**传这 8 个参数（其中 3 个是新加的 `allTools`/`systemMessage`/`cfg`），否则 generator 内部 `initMessagesForRun` / `getPrunedToolsForRun` / `executeToolCallsInStages` 会因变量未定义抛 ReferenceError。
13. **toolsMap 构建时机（★ 致命问题 2 修复）**：
    - **generator 初始化阶段**（while 循环外、循环内复用）由 `allTools` 构建一次 `toolsMap = new Map(allTools.map(t => [t.name, t]))`
    - 传给 `executeToolCallsInStages` 的 ctx.toolsMap 直接用此 Map（helper 内部**不**重新构建）
    - **不传** `allTools` 给 helper（避免重复构建 Map + 类型不一致）

**主 generator 关键代码模式**（5.2 节伪代码 → 真实代码）：

```js
// ★ 关键技术约束 12：签名固定 8 参数（其中 allTools/systemMessage/cfg 是新加的）
export async function* _runSqlAgentResponsesStreamGen({
  question, historyText, signal, sessionId, username,
  allTools, systemMessage, cfg,
}) {
  // ★ 关键技术约束 13：toolsMap 在 generator 初始化阶段构建一次（循环外）
  //   Map key = t.name（DynamicTool 直接有 .name，不需要 .function.name 包装）
  //   与 helper 5.5.4 的 ctx.toolsMap 期望类型一致：Map<string, DynamicTool>
  // ★ toolsMap 基于完整 allTools 构建（key = t.name），剪枝不影响 mapping，
  //   因为 prunedTools 是 allTools 的子集（[getPrunedToolsForRun] 只过滤不增删元素），
  //   且 prunedTools 中 t.name === allTools 中对应元素的 t.name，key 值不变，
  //   故循环内可直接复用 toolsMap，**无需**按架构计划 5.2 节另外构建 toolsMapForExec
  const toolsMap = new Map(allTools.map(t => [t.name, t]));

  // 初始化（与 runSqlAgent L1131-1168 1:1，**用 helper**）
  const messages = initMessagesForRun(sessionId, question, systemMessage);
  let maxToolCalls = cfg.max_tool_calls || 30;
  // ★ 12 轮审计修订：toolsDefinition 在 while 外，tools 在 while 内每轮重算
  //   allTools 是 DynamicTool[]，toolsDefinition 是 OpenAI 工具 schema 格式（{type, function:{name,...}}）
  //   两者的 name 字段位置不同（allTools[i].name vs toolsDefinition[i].function.name），
  //   **不能**直接 `allTools` 传给 `getPrunedToolsForRun`，必须先转 toolsDefinition
  const toolsDefinition = allTools.map(/* 1:1 with L1115-1128：把 DynamicTool 转 OpenAI schema */);
  let pendingUserChoiceList = [];
  const MAX_USER_CHOICE_PER_TURN = 3;

  while (maxToolCalls > 0) {
    const { prunedTools, prunedNames } = getPrunedToolsForRun(toolsDefinition, sessionId);
    // 调 fetchResponsesStream + translateResponsesEvent
    // 累积 pendingToolCalls Map（并行）
    // 累加 roundAssistantContent / roundReasoningContent
    // 每轮 LLM 入口 + 出口各 yield 一次

    // ★ toolsMap 直接复用（构造一次，循环内复用）
    const { execResults } = await executeToolCallsInStages({
      ..., toolsMap, availableToolNames: new Set(prunedTools.map(t => t.function.name)), messages, ...
    });
  }

  // 终结 yield done（带 reasoning 字段 + 可选 userChoiceRequest）
}
```

**handler 关键代码模式**（5.1 节伪代码 → 真实代码，**独立重写**不"复用 query.js 代码"）：

```js
// ★ 路由层已做完：abortController 创建 + res.on('close') 绑定 + OVERALL_TIMEOUT_MS timer
//   + res.flushHeaders() + res.write('meta') + streamCompleted=false
//   handler 接收 res 时已是 flushed + meta 已发，handler 不再调 flushHeaders / 不再发 meta
// ★ 关键技术约束 11：handler 签名固定为 (req, res, ctx)
export async function runSqlAgentResponsesHandler(req, res, ctx) {
  const {
    abortController, requestStartTime, overallTimer, streamCompleted,
    sessionId, question, historyText, username,
    tools, cfg, systemMessage, llmCfg, logger,
  } = ctx;

  // ★ 业务逻辑状态（与 CC path [query.js:406-420](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L406-L420) 1:1）
  let fullContent = '', sql = '', message = '', reasoning = '';
  const allLogs = [];
  let totalPromptTokens = 0, totalCompletionTokens = 0, totalTokens = 0;
  let messageSaved = false, lastRound = 0;
  let userChoiceRequestFromStream = null;  // 13 轮恢复（与 CC path L420 1:1）

  try {
    // ★ handler 在 try 块开始时创建 generator（关键技术约束 12）
    //   必须传 8 个参数：5 个原 + 3 个新（allTools/systemMessage/cfg）
    //   ctx.tools = toolsDefinition（与 CC path L1115-1128 1:1，DynamicTool[]）
    const generator = _runSqlAgentResponsesStreamGen({
      question, historyText, signal: abortController.signal, sessionId, username,
      allTools: ctx.tools,           // ★ DynamicTool[]
      systemMessage: ctx.systemMessage,
      cfg: ctx.cfg,
    });
    for await (const chunk of generator) {
      if (abortController.signal.aborted) break;
      if (typeof chunk.round === 'number') lastRound = chunk.round;
      // ★ 用 switch 而非 if/else if（与 CC path L431-490 if/else if 有意差异，便于 review）
      switch (chunk.type) {
        case 'chunk': /* SSE 写 + 累加 fullContent */ break;
        case 'reasoning_chunk': /* SSE 写 */ break;
        case 'reasoning_done': /* 写 DB 不写 SSE（与 CC path L469-477 1:1）*/ break;
        case 'message_final': /* SSE 写 */ break;
        case 'tool':
        case 'tool_return':
        case 'LLM': /* SSE 写 + allLogs.push + 写 DB（与 CC path L448-465 1:1）*/ break;
        case 'usage': /* SSE 写 + 累加 token + 写 DB */ break;
        case 'error': /* SSE 写 */ break;
        case 'done':
          // ★ 13 轮方案 1：1:1 复制 CC path L482-490 done 处理 + 额外加 reasoning 行
          sql = chunk.sql || '';
          message = chunk.message || '';
          reasoning = chunk.reasoning || '';  // ★ B 选项：13 轮方案 1
          if (chunk.userChoiceRequest && !userChoiceRequestFromStream) {
            userChoiceRequestFromStream = chunk.userChoiceRequest;
          }
          break;
      }
    }

    // 收尾：SQL 回退提取 + 落库 + 写最终 doneData（与 CC path L493-578 1:1）
    if (!sql || sql.trim() === '') { /* regex on message || fullContent（与 L494-506 1:1）*/ }
    if (!message || message.trim() === '') message = fullContent;  // 与 L509-511 1:1
    // ... save assistantMsg with reasoning_content 字段（B 选项 + 与 CC path L533-534 字段名 1:1）
    //     + reasoning_content = reasoning  // ★ 13 轮方案 1
    //     + update sessions total_tokens
    const doneData = {
      type: 'done',
      sql,
      message,
      sessionId,
      totalTokens,
      elapsedMs: Date.now() - requestStartTime,
      reasoning,  // ★ B 选项
    };
    if (userChoiceRequestFromStream) doneData.user_choice_request = userChoiceRequestFromStream;
    const confirmMatch = message.match(/<!--confirm_tag_add:(\{[^}]+\})-->/);
    if (confirmMatch) { try { doneData.confirm_tag_add = JSON.parse(confirmMatch[1]); } catch (e) {} }
    ctx.streamCompleted = true; clearTimeout(overallTimer);  // ★ 用 ctx.streamCompleted / ctx.overallTimer（路由层创建）
    res.write(`data: ${JSON.stringify(doneData)}\n\n`);
  } catch (e) {
    // partial 落库（与 CC path L582-625 1:1，**注意**当前文件那行写 `streamCompleted = true` 是改的 ctx.streamCompleted）
    ctx.streamCompleted = true; clearTimeout(overallTimer);
    // ... isAbort + partial 落库（与 CC path L593-619 1:1）...
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: e.message, interrupted: isAbort })}\n\n`);
    }
  }
  if (!res.writableEnded) res.end();
}
```

**★ 关键修订说明（对比旧文档）**：
- **删除**旧伪代码中的 `res.flushHeaders()` + `res.write('meta')` 两行（路由层 L374 + L381 已做，重复调会抛 ERR_HTTP_HEADERS_SENT）
- **删除**"复用 [query.js:404-625](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L404-L625) 业务逻辑"描述——实际 handler 是**独立重写**（不再 import query.js 任何代码，不复制 220 行）
- **handler 调用 helper**：`initMessagesForRun` / `getPrunedToolsForRun` / `executeToolCallsInStages` / `recordPendingUserChoices` / `saveRunState`——6 个 helper 承担代码复用，handler 只负责流式分派 + 收尾
- **`switch` vs if/else if**：handler 用 switch（可读性更好），与 CC path [query.js:431-490](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L431-L490) if/else if 是**有意差异**（便于代码 review）

**验证**：
- 文件创建后跑 `node -e "import('./src/services/responsesApi.js').then(m => console.log(Object.keys(m)))"` 看 5 个 export
- **不跑**功能测试（Step 5-6 才跑）

---

### Step 4: 替换 F14 占位符为 5 行委派（~5min）

**目标文件**：[backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js)

**改动位置**：[L388-401](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L401)

**改动**：把整个 11 行 placeholder 替换为 5 行委派：

```js
// ★ Phase 2: apiMode 路由分发（Q2 选 C：单行委派 + 新文件封装）
// ★ 动态 import 原因（不接受静态 import 建议）：
//   1. 与"新 API 完全独立"原则一致——不启动 responses_api 模式时不加载 responsesApi.js + agentHelpers.js
//      （节省 ~1200 行模块初始化 + 启动时间；普通用户用 chat_completions 完全不感知）
//   2. ESM 动态 import 有模块缓存（首次后性能等价静态 import），无运行时开销
//   3. 静态 import 会强制 query.js 加载 responsesApi.js → 间接加载 agentHelpers.js
//      → 间接触发 llm.js 全量 export 评估 → 可能拖慢路由注册
//   4. 测试场景：用动态 import 可在 test 中 mock responsesApi.js 单独测试
if (llmCfgForDispatch?.apiMode === 'responses_api') {
  const { runSqlAgentResponsesHandler } = await import('../services/responsesApi.js');
  return runSqlAgentResponsesHandler(req, res, {
    abortController, requestStartTime, overallTimer, streamCompleted,
    sessionId, question, historyText, username: req.user?.username,
    tools: toolsDefinition, cfg: agentConfig, systemMessage, llmCfg: llmCfgForDispatch, logger,
  });
}
```

**完整 ctx 参数表**（对应 Step 3 handler 签名）：
| 参数 | 来源 | 必传 |
|---|---|---|
| `abortController` | 路由层 L356 创建（已绑定 res.on('close') + OVERALL_TIMEOUT_MS timer） | ✅ |
| `requestStartTime` | 路由层 L316 创建（`Date.now()`） | ✅ |
| `overallTimer` | 路由层 L360 创建（`setTimeout` 句柄） | ✅ |
| `streamCompleted` | 路由层 L355 创建（`let streamCompleted = false`） | ✅ |
| `sessionId` | 路由层获取（可能为 null） | ✅ |
| `question` | 用户问题 | ✅ |
| `historyText` | 路由层 L336 创建（dead-code 占位，未来使用） | ✅ |
| `username` | `req.user?.username` | ✅ |
| `tools` | `toolsDefinition`（与 CC path L1115-1128 1:1 在路由层加载） | ✅ |
| `cfg` | `agentConfig`（`getAgentConfig()`） | ✅ |
| `systemMessage` | 路由层拼装（与 CC path L1131-1132 1:1） | ✅ |
| `llmCfg` | `llmCfgForDispatch`（路由层 L389 `getLlmConfig()`） | ✅ |
| `logger` | 路由层共享 logger 实例 | ✅ |

**关键约束**：
- 委派**前**保留 `llmCfgForDispatch = getLlmConfig()`（[query.js:389](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L389)）
- 委派**前**保留 `logger.info('API mode dispatch → responses_api ...')` 调用（[query.js:392-396](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L392-L396)）——运维日志**不能丢**
- 委派**后** `return` 立即退出（与 placeholder 行为一致）
- **不修改**原 try/catch 代码（[L404-625](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L404-L625)）
- **不修改**F9 meta 事件（[L374-381](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L374-L381)）——**路由层已发** meta，handler **不再发**
- **不创建** abortController / overallTimer / streamCompleted——这些**生命周期管理**由路由层负责（[L355-372](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L355-L372)），handler 只接收 + 修改 ctx.streamCompleted + clearTimeout(overallTimer)

**验证**：跑 `node -e "import('./src/routes/query.js')"` 不报 import 错误。

---

### Step 5: 写 helper 端到端测试（必需，9.2 修订，~1h）

**新文件**：[backend/test-agent-helpers-execution.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-agent-helpers-execution.mjs)

**测试策略**（13 轮审计 9.2 修订锁定）：
- **必须**：6 个 helper 真实调用 + 边界场景
- **必须**：与 inline 路径做"diff 断言"（mock 同一 LLM 输出 + 同一工具状态，对比 execResults 数组完全一致）
- **必须**：覆盖 `executeToolCallsInStages` 这个最大 helper（~370 行，1:1 复制遗漏概率最高）

**测试框架**：[test-llm-config-apimode.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-llm-config-apimode.mjs) 风格：
- `node:assert` + 自建 `ok(name, cond, hint)` helper
- `process.exit(failed > 0 ? 1 : 0)` 退出码
- mock 依赖：手动 mock `loadMessagesFromDb` / `saveMessagesToDb` / `getOrCreateRegistry`（不引入 jest mock）

**至少覆盖**：
- Case 1: `initMessagesForRun` 有/无 sessionId
- Case 2: `getPrunedToolsForRun` 剪枝正确性（getDomainIndexCalled + slicedDomains.size > 0 两种剪枝）
- Case 3: `executeToolCallsInStages` 并行 1/2/3 工具
- Case 4: `executeToolCallsInStages` 3 类错误（参数解析失败 / 工具不存在 / 工具被剪枝）
- Case 5: `recordPendingUserChoices` v3 marker 数组 + 旧版单 marker 兼容
- Case 6: `saveRunState` 有/无 sessionId
- Case 7: helper 路径 vs inline 路径 diff（mock 同一输入，对比 `messages` 数组最终态）

**验证**：`node test-agent-helpers-execution.mjs` 全 pass。

---

### Step 6: 写 handler 端到端测试（~1h）

**新文件**：[backend/test-run-sql-agent-responses-handler.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-run-sql-agent-responses-handler.mjs)

**测试策略**：
- mock `fetch`（用 globalThis 注入 fake fetch，模拟 DeepSeek Responses SSE 流）
- 用 [event-source-stream](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/node_modules) 解析 SSE 输出
- 验证 handler yield 的所有事件类型 + 顺序

**至少覆盖**：
- Case 1: 单轮 LLM 响应（无 tool_call）→ yield 序列：`meta` → `chunk` × N → `usage` → `done`
- Case 2: 单轮 LLM 响应 + 1 个 tool_call + 工具执行 → yield 序列：`meta` → `chunk` × N → `tool` → `tool_return` → `usage` → `done`
- Case 3: 多轮 tool_call（2 轮）→ yield 序列含 2 个 `tool` + 2 个 `tool_return`
- Case 4: user_choice 终止 → yield 含 `done.user_choice_request`
- Case 5: reasoning_done 三者并存（13 轮方案 1）→ 验证 `done.reasoning` 字段 + `assistantMsg.reasoning_content` 字段 + 1 条 `role='LLM'` 消息落库
- Case 6: confirm_tag_add 解析 → `done.confirm_tag_add` 字段
- Case 7: 用户中断 → partial 落库（interrupted=1）
- Case 8: SQL 回退提取（`message` 含 ```sql...``` 代码块但 generator yield sql=''）

**验证**：`node test-run-sql-agent-responses-handler.mjs` 全 pass。

---

### Step 7: 路由分发测试（~30min）

**新文件**：[backend/test-route-apimode-dispatch-responses.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-route-apimode-dispatch-responses.mjs)

**至少覆盖**：
- Case 1: `apiMode='responses_api'` + POST `/api/query/generate` → 路由委派到 `runSqlAgentResponsesHandler`
- Case 2: `apiMode='chat_completions'` + POST `/api/query/generate` → 路由走原 `runSqlAgent`（0 行为变化）

**参考**：[test-route-apimode-dispatch.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-route-apimode-dispatch.mjs) 现有测试模式

**验证**：`node test-route-apimode-dispatch-responses.mjs` 全 pass。

---

### Step 8: 跑全部 21 个现有测试 + 3 个新测试（~30min）

**命令**：
```bash
cd d:\Ai_Program_Files\XTSQLQueryAgent\backend
for f in test-*.mjs; do echo "=== $f ==="; node "$f" || echo "FAIL: $f"; done
```

**必须**：
- 21 个现有 test 全 pass（不能破坏 F9 / F11 / F13 等已有修复）
- 3 个新 test（Step 5/6/7）全 pass

**失败处理**：
- 现有 test 失败 → **立即停** Step 8，**不进入** Step 9。**重点检查** 21 个 test 是否都用了 `runSqlAgent`（不应该触发 responsesApi.js），如发现 test 误触发，**不能改 test**，**必须改** responsesApi.js 行为（保持与 inline 1:1）
- 新 test 失败 → 改 helper / handler 实现

**关键**：[F10 gotcha](file:///d:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent--p2-134ba0d11f3e551fa484/project_memory.md) — Edit 工具在 Windows 上有"声称成功但实际未更新"问题，**每个 Edit 后必须 Read 验证**。

---

### Step 9: 集成测试（端到端，~30min）

**步骤**：
1. **启动后端**：`cd backend && npm run dev`
2. **启动前端**：`cd frontend && npm run dev`
3. **配置切换**：
   - 登录 admin
   - 改 LLM 配置 `apiMode='responses_api'`，保存
   - 验证 `GET /api/llm-config` 返回 `apiMode: 'responses_api'`（与 F13 测试一致）
4. **E2E 跑通**：
   - 简单问题（无工具调用）："查询 users 表前 5 条"
   - 复杂问题（触发工具调用 + reasoning）："查询最近 7 天订单总金额"
   - 多轮问题（确认 user_choice / request_user_choice 行为）
5. **验证**：
   - 前端实时显示 chunk + reasoning_chunk + tool + tool_return
   - DB 历史回显包含"💭 LLM思考过程"独立 log 行（13 轮方案 1）
   - 切回 `apiMode='chat_completions'` 后 0 行为变化

**失败处理**：
- 行为差异 → 检查 5.1 / 5.2 伪代码对齐（13 轮审计约束）
- 性能差异 → 跑 2 个相同 query 计时对比

---

### Step 10: 写部署文档（~20min）

**更新文件**：[docs/执行流程.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/执行流程.md) 第 4 节 + [README.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/README.md)（如有）

**内容**：
- 新增 `apiMode='responses_api'` 配置说明
- Responses API 适用场景（与 Chat Completions 差异）
- 性能对比数据（Step 9 实测）
- 回滚步骤（5.2 节回滚方案）

---

## 关键文件清单（按修改顺序）

| Step | 动作 | 文件 | 行数变化 | 工时 |
|---|---|---|---|---|
| 1 | 新增 | [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js) | +3 | 5min |
| 2 | 新建 | [backend/src/services/agentHelpers.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/agentHelpers.js) | +570 | 1.5h |
| 3 | 新建 | [backend/src/services/responsesApi.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/responsesApi.js) | +600 | 2.5h |
| 4 | 修改 | [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js) | -11 +5 = -6 | 5min |
| 5 | 新建 | [backend/test-agent-helpers-execution.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-agent-helpers-execution.mjs) | +200 | 1h |
| 6 | 新建 | [backend/test-run-sql-agent-responses-handler.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-run-sql-agent-responses-handler.mjs) | +200 | 1h |
| 7 | 新建 | [backend/test-route-apimode-dispatch-responses.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-route-apimode-dispatch-responses.mjs) | +80 | 30min |
| 8 | 验证 | 21 现有 + 3 新 test | — | 30min |
| 9 | 验证 | E2E | — | 30min |
| 10 | 更新 | docs/执行流程.md + README.md | +50 | 20min |
| **合计** | — | — | **+1697** | **~7h** |

---

## 验证（端到端测试方法）

### 单元测试

```bash
cd d:\Ai_Program_Files\XTSQLQueryAgent\backend
node test-agent-helpers-execution.mjs           # Step 5
node test-run-sql-agent-responses-handler.mjs  # Step 6
node test-route-apimode-dispatch-responses.mjs # Step 7
```

### 集成测试

```bash
cd d:\Ai_Program_Files\XTSQLQueryAgent\backend
for f in test-*.mjs; do echo "=== $f ==="; node "$f" || echo "FAIL"; done
```

**预期**：21 个现有 test + 3 个新 test = 24 个全 pass。

### 端到端测试

1. 后端：`npm run dev`
2. 前端：`npm run dev`
3. admin → 改 LLM 配置 `apiMode='responses_api'` → 保存
4. 提问 3 类问题（无工具 / 单工具 / 多轮 + user_choice）
5. 验证：
   - 实时显示完整
   - 历史回显含 reasoning
   - token 计数正确
   - 与 `apiMode='chat_completions'` 0 行为差异

---

## 风险与回滚

### 风险（已在计划文档 §10 锁定）

1. **F10 Edit 工具缓存问题**：每个 Edit 后必须 Read 验证
2. **现有 21 test 触发 helper 代码**：helper 路径不写盘（5.5.4 修订），理论上不会触发，但需要 24 个 test 全 pass 验证
3. **F9 + F11 修复模式在 responsesApi.js 必须 1:1 复制**：meta 事件 + buffer + decode stream + lines.pop
4. **13 轮方案 1 三者并存冗余**：DB 多一份独立 log 消息，30% 冗余可接受
5. **工具事件 log 格式 1:1 对齐 CC path**：emoji 前缀 / 换行 / 参数 JSON 序列化必须字符级一致

### 回滚（计划文档 §10 + §11）

```bash
# 回滚 F14 路由分发
git checkout HEAD -- backend/src/routes/query.js
# 删除新文件
rm backend/src/services/agentHelpers.js
rm backend/src/services/responsesApi.js
rm backend/test-agent-helpers-execution.mjs
rm backend/test-run-sql-agent-responses-handler.mjs
rm backend/test-route-apimode-dispatch-responses.mjs
# llm.js 新增的 setLastMessages 是纯加法，回滚后无副作用
```

**回滚后**：`apiMode='responses_api'` 自动 fallback 到 F14 占位符，UI 显示"暂未实现"。

---

## 关联文档

- **架构设计**：[docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md)（1530 行，12 + 13 轮审计修订）
- **F9 修复**（sessionId 提前下发）：[query.js:376-381](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L376-L381)
- **F11 修复**（UTF-8 / SSE 行切分）：[llm.js:1349-1383](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1349-L1383)
- **F13 测试**（apiMode 透传）：[test-llm-config-apimode.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/test-llm-config-apimode.mjs)
- **F14 占位符**（本次替换）：[query.js:388-401](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L401)
- **项目记忆**：[project_memory.md](file:///c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent--p2-134ba0d11f3e551fa484/project_memory.md)（含 13 项关键决策）

---

**计划文件**：[.trae/documents/phase-2-responses-api-implementation.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/.trae/documents/phase-2-responses-api-implementation.md)
**创建时间**：2026-08-07
**预计完成**：2026-08-07 ~ 2026-08-08（~7h）
**核心约束**：代码 0 复制（双份共存）、前端 0 改动、CC path 1:1 对齐

---

## 修订记录

| 日期 | 版本 | 修订人 | 修订内容 |
|---|---|---|---|
| 2026-08-07 | v1 | agent | 初版（基于 13 轮审计修订，~6.5h 估算）|
| 2026-08-07 | v2 | agent | **5 项严重错误修复**：① 删除 Step 3 handler 伪代码的重复 `res.flushHeaders()` + `meta`（路由层 L374 + L381 已做，handler 再调会抛 ERR_HTTP_HEADERS_SENT）；② 把"复用 query.js L404-625"改为"独立重写 + 调 helper"（消除自相矛盾）；③ Step 4 委派代码补充完整 ctx 参数表（13 个参数）+ 显式标注来源；④ Step 4 关键约束强调保留 `logger.info`（运维日志不能丢）；⑤ Step 3 关键技术约束新增 #11（handler 签名 ctx 边界 + abortController/overallTimer/streamCompleted 生命周期由路由层负责）。+ 3 项小修复：⑥ getLastMessages 行号 L336-338 → L337-339；⑦ Step 3 handler 行数估计 280 → 330；⑧ 工时调整 6.5h → 7h。|
| 2026-08-07 | v3 | agent | **2 项致命问题修复 + 1 项设计决策保留**：① 关键技术约束新增 #12（generator 签名固定 8 参数，其中 `allTools`/`systemMessage`/`cfg` 是新加的——旧文档缺失这三参数会导致 generator 内部 `initMessagesForRun` / `getPrunedToolsForRun` / `executeToolCallsInStages` 抛 ReferenceError，整个 Responses API 路径失效）；② 关键技术约束新增 #13（toolsMap 在 generator 初始化阶段构建一次，Map key 用 `t.name` 而非 `t.function.name`——helper ctx.toolsMap 期望 `Map<string, DynamicTool>`）+ 主 generator 代码示例补全 + handler 伪代码 for-await 行补完整参数调用（`allTools: ctx.tools`、`systemMessage: ctx.systemMessage`、`cfg: ctx.cfg`）；③ 拒绝"动态 import → 静态 import"建议：动态 import 与"新 API 完全独立"原则一致（不启动 responses_api 不加载 ~1200 行）+ ESM 模块缓存保证性能 + 测试可独立 mock，故保留动态 import 并加 4 条理由注释。|
| 2026-08-07 | v4 | agent | **2 项问题修复**：① `setLastMessages` 加深拷贝（`lastMessages = JSON.parse(JSON.stringify(messages))`）——与 CC path L1558 行为 1:1 对齐，**避免**调试接口 GET /api/query/messages 返回"未来轮次"消息（引用别名问题：原引用跟着 messages 后续 push 变化），附 4 行注释说明深拷贝原因；② 删除 helper 列表中 `handleToolCallErrors` 条目（已合并到 `executeToolCallsInStages` 内部，作为独立条目会误导开发者以为需要额外实现/调用），保留 5 个有效 helper（`initMessagesForRun` / `getPrunedToolsForRun` / `executeToolCallsInStages` / `recordPendingUserChoices` / `saveRunState`）。|
| 2026-08-07 | v5 | agent | **1 项不一致修复 + 1 项保留决策**：① Step 3 主 generator 代码示例中 toolsMap 构造处新增 4 行注释——明确"剪枝不影响 mapping，因为 prunedTools 是 allTools 的子集，[getPrunedToolsForRun] 只过滤不增删元素，key 值不变，循环内可直接复用 toolsMap，无需按架构计划 5.2 节另外构建 toolsMapForExec"，消除与架构计划可能存在的认知偏差；② **保留** historyText 命名（不统一为 architecture 计划的 `history`）——用户确认 historyText 是历史保留的死变量（[DEAD-CODE 2026-07-15]），架构/实施文档命名差异属于文档风格差异，**不影响**实施行为，且避免无谓的命名 churn。|

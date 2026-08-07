# Phase 2 — `runSqlAgentResponses` 实施计划

> **状态**：⏸️ 计划修订中（Step 1 audit 完成，发现 7 个新发现 + 5 个新代码层发现；用户拍板"抽取 helper 策略"，需修订 5/6/9/10/12 节后继续）
> **创建时间**：2026-08-06
> **最近修订**：2026-08-07（Step 1 audit 完成 + 用户拍板"抽取 helper 策略"）
> **关联 F16**：[`generateSQLWithLangChainStreamGen_BAK` → `runSqlAgent` 重命名](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1066-L1085)
> **关联 F14**：[路由侧 `apiMode` 分流占位](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401)

---

## 修订记录

| 日期 | 修订人 | 内容 |
|---|---|---|
| 2026-08-06 | agent | 初版：13 节完整计划，含 3 个开放问题（Q1/Q2/Q3）|
| 2026-08-07 | agent | **Q1 解决**：`executeToolCall` 不依赖 `id` 字段，工具查表只用 `name`。Responses API 的 `call_id` 字段在 `translateResponsesEvent` 第 4.4 节**做 1 行映射** → `id`，所有内部代码（`executeToolCall`、消息累积、下一轮发送）**0 改动** |
| 2026-08-07 | agent | **Q2 选 B**：保留两套 try 块，**0 改动原 try 块代码**。确立"完全独立"原则。**已被 C 方案替代（见下条）** |
| 2026-08-07 | agent | **Q2 升级为 C**：用户追问"能否不改动，完全新写个？" → 改用方案 C。**新增独立文件** `backend/src/services/responsesApi.js` 封装 `runSqlAgentResponsesHandler`，F14 位置**单行委派**（5 行），原 try 块 0 改动。**封装代替重复**：130 行业务逻辑集中在新文件 + 一个导出函数，**review 友好 + 可测性好 + 文件级隔离** |
| 2026-08-07 | agent | **Q3 选 A**：多轮断连/失败行为**完全对齐 CC**。`runSqlAgentResponsesHandler` 沿用 CC 的"不重试 + messages 不持久化 + catch 块写 error+done 事件"模式。**0 新增复杂度**，**0 行为差异**，完全符合 1.4 节"完全独立"原则（行为对齐也是独立性的体现） |
| 2026-08-07 | agent | **Issue #2 解决**：明确范围——本计划**只**处理调用点 ① 主 SQL 生成。②③④（session 命名 / `/generate` 收藏 / `/explain-analyze`）**本计划不动**，继续走 CC 路径，Phase 3+ 再说。1.1 现状加 4 个调用点范围表 + 硬约束加第 8 条 |
| 2026-08-07 | agent | **Issue #1 修复**：`pendingToolCall`（单数）→ `pendingToolCalls`（Map）。LLM 单轮可并行调多个工具（如 `get_table_schema` + `get_domain_index`），单数变量会被覆盖导致工具静默丢失。**修复方案**：用 `Map<call_id, ToolCall>` 按 call_id 分桶累积（与 CC path L1438-1458 `streamToolCalls` 数组行为对齐）。同时**顺手**把 4.3 节 `parseResponsesStream` 改成 `async function*` 协议（与 5.3 节方案 A 一致）|
| 2026-08-07 | agent | **Issue #3 解决**：1.1 节加 F9 / F11 关联修复段（带 file:line 锚点 + 历史 bug 说明），1.4 节硬约束加 2 条（#9 继承 F9 / #10 继承 F11），4.3/5.3/7.3 节显式引用 F9 / F11 修复位置，风险表加 Issue #3 解决行 |
| 2026-08-07 | agent | **Issue #4 解决**：async generator 不自动响应 abort signal，需手动检查。**修复要点**：① 4.3 节 `if (signal?.aborted)` 已在 Issue #1 修订时加（已存在）；② 5.3 节伪代码补 abort 检查与 4.3 一致；③ 5.2 节主函数加 abort 链路说明（fetch 传播为主、显式检查为冗余安全网、错误传播路径）。**核心机制**：fetch 的 signal 传播是主机制，async generator 内的显式检查是冗余安全网（防 signal 传播延迟）|
| 2026-08-07 | agent | **Issue #5 修正**（plan 假设错误，不是代码 bug）：① 删除 `extractSqlFromContent` 共享函数引用（**实际不存在**）；② 5.2 节 `done` 事件 `sql=""` 与 CC 一致（[llm.js:2025](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L2025) 实证）；③ SQL 提取实际在前端（[markdownRenderers.jsx:70-95](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/components/markdownRenderers.jsx#L70-L95) `hasNestedFence` + `react-markdown` + `react-syntax-highlighter`）；④ 新增真正共享的 `splitThinkingFromContent`（[llm.js:289-310](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L289-L310)）；⑤ 5.2 节主函数收尾加 thinking 剥离 + `message_final` 事件 yield（与 CC path L1480-1496 行为完全对齐）|
| 2026-08-07 | agent | **Issue #6 解决**（B1 方案，与用户确认后）：`lastMessages` 是 `GET /api/query/messages` 调试接口的进程级缓存（[query.js:212-235](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L212-L235)，生产 404 屏蔽），用户希望 Phase 2 与 CC 行为完全一致。**改动**：① llm.js **新增** 1 个 export 函数 `setLastMessages`（紧挨 [L337-339](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L337-L339)），**纯加法 0 改动**；② 5.2 节主函数收尾调 `setLastMessages(messages)`（与 CC path [L1558](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1558) 行为完全对齐）；③ 6 节共享代码表加 `setLastMessages` 行；④ 风险表加 Issue #6 解决行。**B1 vs B2/B3 关键论证**：B1 加 setter 是"暴露已有能力"，不是"修改原代码"——`runSqlAgent` 函数体 0 改动，符合 1.4 节"完全独立"原则 |
| 2026-08-07 | agent | **Step 1 audit 完成 + 抽取 helper 策略**（用户拍板）：审计发现 7 个 DeepSeek 文档新发现（事件数/usage 字段/max_tool_calls 忽略/parallel_tool_calls 始终开启等）+ 5 个代码层新发现（3 个"共享函数"实际不存在/工具执行是 Promise.all 并行/request_user_choice 终止信号/saveMessagesToDb 每轮都写/zod 转换已在 LangChain 内部）。**用户决策**："把这些代码变成方法，老的 runSqlAgent 先不动，如果以后有机会可以替换成这些方法。" → **新增独立文件** `backend/src/services/agentHelpers.js`，把 `runSqlAgent` 内部的 inline 逻辑抽取为 6 个可复用 helper，**0 改动** `runSqlAgent`（继续用 inline，未来 Phase 3+ 可选迁移）。**关键意义**：Phase 2 handler 从 870 行降至 ~300 行，重复代码量大幅减少；bug 修复只需改 1 处 helper；未来可平滑迁移 `runSqlAgent` 到 helper（行为不变）|
| 2026-08-07 | agent | **外部 AI 审计错误修复**（5 真 + 1 误报 + 2 副）：[核验文档](file:///d:/Ai_Program_Files/XTSQLQueryAgent/.trae/documents/plan-error-verification.md)。① **错误 1 真**：5.2 节 L671-700 重写——手写"依次执行"违反"复用 helper"原则，改用 `executeToolCallsInStages`，复用 3 阶段（prepared/Promise.all execResults/写回 messages）行为。② **错误 2 真**：5.2 节工具执行后**必须**调 `saveRunState`（CC path L1556-1563 每轮都存）。③ **错误 3 真**：5.2 节工具执行后**必须**调 `recordPendingUserChoices` + `if (pendingUserChoiceList.length > 0) break`（CC path L1854-1932 + L1936-1937）。④ **错误 4 真**：4.4 节 `usage.total_tokens` DeepSeek 不提供，改用 `input_tokens + output_tokens` 计算（[DeepSeek 官方文档](https://api-docs.deepseek.com/zh-cn/guides/responses_api/)）。⑤ **错误 5 误报**：5.2 节 L726 `maxToolCalls--` 与 CC path L1939 行为一致（if/else 后才递减，无 tool_calls 时 break 跳过），无需修改。⑥ **错误 6 真**：5.2 节 `case 'tool_call_done'` 加防御——若 arguments 为 undefined 保留已累积 delta。⑦ **副 1 真**：5.1 节删除未使用变量 `userChoiceRequestFromStream`。⑧ **副 2 真**：Step 6 文档同步加 `executeToolCallsInStages` helper 职责说明。⑨ **helper 设计微调**：5.5.4 节 `executeToolCallsInStages` 返回 `{hadToolCalls, execResults}`（方案 A）供 5.2 节 yield tool_result 事件；5.2 节加 `let currentRound = 0;` 声明。 |
| 2026-08-07 | agent | **外部 AI 二轮审计错误修复**（3 真 + 1 副）：[核验文档](file:///d:/Ai_Program_Files/XTSQLQueryAgent/.trae/documents/plan-error-verification.md)。① **错误 1 真**：5.2 节 L545-546 调了不存在的 `buildMessagesForLLM` / `getPrunedToolsForRound` → 改成 `initMessagesForRun` / `getPrunedToolsForRun`（来自 agentHelpers.js，5.5.1 / 5.5.2 节）。4.1 / 4.2 节 JSDoc 同步更新。② **错误 2 真**：5.2 节变量声明段加 `let pendingUserChoiceList = [];`（executeToolCallsInStages 内部 push + recordPendingUserChoices 收集 + 跳出循环）。③ **错误 3 真**：4.1 节 L218 `parameters: zodToJsonSchema(t.schema)` → 改用 `t.lc_kwargs.params`（LangChain 内部转换，与 CC path L1120 一致，0 额外依赖）。④ **次要问题真**：5.2 节末尾 L768 `setLastMessages(messages)` 重复（每轮 `saveRunState` 已写 + CC path 只在每轮写不在最后写）→ 删除。 |
| 2026-08-07 | agent | **外部 AI 三轮审计错误修复**（3 真 + 2 副）：[核验文档](file:///d:/Ai_Program_Files/XTSQLQueryAgent/.trae/documents/plan-error-verification.md)。① **错误 1 真**：5.2 节 L550 `const tools = getPrunedToolsForRun(...)` 在 while 循环外，CC path 是**每轮**重算（[llm.js:1262-1286](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1262-L1286)）→ 移到 while 循环内，while 外加 `const toolsDefinition = ...` 一次性定义。② **错误 2 真**（AI 描述有偏差但问题存在）：5.2 节 `initMessagesForRun(sessionId, question, skillMd)` 传 skillMd 错（CC path L1131-1132 用**字面字符串** `${prefix}${skillMd}`，**不存在** `buildSystemMessage` 函数）→ 改成传 systemMessage 字面字符串。③ **错误 3 真**：5.2 节 `getPrunedToolsForRun(/* toolsDefinition */, sessionId)` 缺参数 → while 外加 `const toolsDefinition = tools.map(...)` + `const toolsMap = new Map(tools.map(...))`（与 CC path L1115-1128 1:1 一致）。④ **次要 1 真**：5.1 节 L476 调 `resetPerQuestionRegistryFlags` 与 5.2 节 L545 重复 → 5.1 节删除（保留 5.2 节，符合 CC path 设计：reset 在 generator 入口不在路由 handler）。⑤ **次要 2 真**：5.2 节用 `MAX_USER_CHOICE_PER_TURN` 但未声明 → 加 `const MAX_USER_CHOICE_PER_TURN = 3;`（与 CC path L1180 完全一致）。 |
| 2026-08-07 | agent | **12 轮审计：与代码现状交叉验证 + 用户拍板 8 项决策**：[核验文档](file:///d:/Ai_Program_Files/XTSQLQueryAgent/.trae/documents/plan-error-verification.md)。本次核心是修计划文档本身（**不改代码**），修订 5.1 / 5.2 / 5.5.4 / 5.5.6 / 8 / 9.2 / 10 节。**8 项决策**（用户拍板）：① 工具事件类型**模仿 CC path log 风格**（yield `{type:'tool', log:'🔧 调用工具: xxx'}` + `{type:'tool_return', log:'📋 工具 xxx 返回: ...'}`），与 [App.jsx:840-1052](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L840-L1052) 现有 case 完全匹配，前端 0 改动。② 恢复 `userChoiceRequestFromStream` 变量（不能删——`done` 事件不能立即写 SSE，必须 for-await 结束后写最终 `doneData` 时附加 `user_choice_request` 字段）。③ 加 `reasoning_done` 事件 yield 在每轮推理结束（Q5 决策：**同时**保留 `done.reasoning` 字段 + assistantMsg.reasoning_content 字段存 DB；不再单独 yield reasoning_done 走独立 log 消息通道，**B 选项副作用**：历史回显不再展示"💭 LLM思考过程"独立 log 行，改为 assistant 消息子字段）。④ 5.1 伪代码补 SQL 回退提取 + confirm_tag_add 解析（与 CC path query.js:494-506 + L570-578 1:1 对齐）。⑤ Q5 选 B（`done` 事件保留 `reasoning` 字段）。⑥ `saveRunState` 调用时机改到 `messages.push(assistantMsg)` 之后、yield tool_call **之前**（与 CC path L1556-1563 1:1 对齐——CC path 在 L1562 saveMessagesToDb 是在 L1565 工具执行**之前**调用，这是 CC path 自身的设计需 1:1 复制）。⑦ `availableToolNames` 字段名 `t.name` → `t.function.name`（与 CC path L1571-1573 `prunedTools.map(t => t.function.name)` 1:1 对齐）。⑧ 9.2 节加 helper 端到端测试必要性说明（258 个现有测试只覆盖 inline 路径，**不**触发 helper 代码；helper 回归必须**单独**写一组走 helper 路径的端到端测试）。
| 2026-08-07 | agent | 13 轮审计修订：Q5 选 B 副作用修正（方案 1：恢复 reasoning_done 事件）。原因：12 轮选 B 时错误删除 reasoning_done 事件 yield，导致历史回显看不到"💭 LLM思考过程"独立 log 行（核心功能缺失）。修正：① 5.2 节 generator 恢复 yield reasoning_done 事件（与 CC path llm.js:1501-1507 1:1）；② 5.1 节 handler for-await 加 case 'reasoning_done'（与 CC path query.js:469-479 1:1：写 DB 不写 SSE）；③ assistantMsg.reasoning_content 字段（B 选项）保留；④ done 事件 reasoning 字段（B 选项）保留。三者并存：独立 log 消息（让历史回显显示思考过程行）+ assistant 字段（让未来前端可单独读）+ done 事件（让调试可观测）。唯一代价：30% 冗余（DB 多一份独立 log 消息）。10 节风险表删除 Q5 选 B 副作用行。

---

## 1. 背景

### 1.1 现状

`runSqlAgent`（[llm.js:1079](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1079)）使用 DeepSeek **Chat Completions API**（`/chat/completions`）作为 SQL 生成的核心入口。该函数是多轮 tool-calling agent，通过 `async function*` 协议 yield 11 种事件给前端流式显示。

用户配置 LLM 时可选择 **API 名称**（`apiMode`）：
- `chat_completions`（默认）→ 走 `runSqlAgent`
- `responses_api` → 当前是 [占位错误](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401)，返回 "暂未实现" 提示

**项目内 DeepSeek LLM 调用点共 4 处**，其中 ① 是本计划目标，其余 3 处**本计划不动**：

| # | 调用点 | 文件:行 | 当前 API 模式 | **Phase 2 范围** |
|---|---|---|---|---|
| **①** | **主 SQL 生成** | [llm.js:1079 `runSqlAgent`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1079) | CC（`/chat/completions`）| ✅ **改造目标**：新增 Responses 版本 |
| ② | session 自动命名 | [session.js:225](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/session.js#L225) | CC（`/chat/completions`，模型 `deepseek-chat` v3.5）| ❌ **本计划不动** |
| ③ | `/generate` 收藏 LLM 调用 | [llm.js:2058 `callLlmForFavorite`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L2058) | CC（`/chat/completions`，模型 `deepseek-chat` v3.5）| ❌ **本计划不动** |
| ④ | `/explain-analyze` AI 分析 | [query.js:912](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L912) | CC（`/chat/completions`）| ❌ **本计划不动** |

> **明确范围声明**（2026-08-07 用户拍板）：本计划**只**处理 ① 主 SQL 生成，②③④ 继续走 Chat Completions API。后续是否扩展到其他调用点，**未来 Phase 3+ 再说**。
>
> **理由**：
> - 1.4 节"完全独立"原则：每个调用点独立评估风险/价值
> - ②③④ 是轻量级辅助功能（命名 / 收藏 / EXPLAIN 分析），用户切到 Responses 模式的概率低
> - ② ③还使用 `deepseek-chat` v3.5（Responses API 不支持），需要先做模型升级才能迁移
> - 范围控制在 1 个调用点 = 风险/工时都最小

> **关键关联修复**（Phase 2 必须继承，否则会回退到对应 bug 状态）：
>
> | 修复 | 位置 | 修复内容 | Phase 2 继承点 |
> |---|---|---|---|
> | **F9** sessionId 提前下发 | [query.js:376-381](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L376-L381) | meta 事件（带 sessionId）在 generator 创建**之前**就发给前端 | 路由层在调用 `runSqlAgentResponsesHandler` 之前**已写** meta 事件（C 方案设计天然继承，handler 内部**不**写 meta）|
> | **F11** UTF-8 / SSE 行切分 | [query.js:974-979](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L974-L979) | 流式读 `body` 必须用 `buffer + decoder.decode(value, {stream: !done}) + lines.pop()` 模式 | `parseResponsesStream` 4.3 节**必须**复用此模式（详见 4.3 / 5.3）|
>
> **F9 历史 Bug**：用户 abort 时 generator 未启动 → sessionId 永远不到前端 → 消息丢失 + 关联会话失败
> **F11 历史 Bug**：SSE 事件跨 chunk 切分（如一行 `data: {...}` 跨两次 `reader.read()`）→ 简单 `JSON.parse(line)` 失败 → 流中断
> 两个修复都在 CC path 上验证过有效，**Phase 2 不能回退**。

### 1.2 目标

实施 **Phase 2**：为调用点 ①（主 SQL 生成）实现 Responses API 版本。完成后用户选择 `apiMode='responses_api'` 时，**真正**走 Responses 路径。②③④ 调用点的 `apiMode` 暂时**无效**（只走 CC 路径），未来 Phase 3+ 再说。

### 1.3 硬约束（再次确认）

| # | 约束 | 理由 |
|---|---|---|
| 1 | `runSqlAgent` 0 改动 | 继续作为默认稳定路径，0 回归风险 |
| 2 | `runSqlAgentResponses` 与 `runSqlAgent` 函数签名一致 | 路由层 0 改动（除了 F14 替换 placeholder）|
| 3 | 路由层 0 改动（**仅** F14 占位符位置加 5 行委派；原 try 块 0 改动）| 完全独立原则（1.4 节）：新 path 委派到独立 handler 函数，**新逻辑全在新文件** `responsesApi.js` |
| 4 | 前端 0 改动 | 内部 yield 事件契约完全一致 |
| 5 | 不做模型校验 | F14 阶段已确认（未来更多模型支持，校验会过期）|
| 6 | `docs/superpowers/reviews/` 与 `docs/superpowers/specs/` 不动 | 历史 review/spec 改了就失真 |
| 7 | `docs/执行流程.md` 第 4 章节更新 | 这是 active 维护的执行流程文档 |
| 8 | **仅处理调用点 ① 主 SQL 生成** | ②③④（session 命名 / 收藏 / EXPLAIN 分析）**本计划不动**，继续走 CC 路径（详见 1.1 节范围声明）|
| 9 | **必须继承 F9 sessionId 提前下发模式** | meta 事件在 generator 之前写，abort 场景下前端能拿到 sessionId（详见 1.1 节关联修复）|
| 10 | **必须继承 F11 UTF-8 / SSE 行切分修复模式** | `parseResponsesStream` 复用 `buffer + decoder.decode(value, {stream: !done}) + lines.pop()` 模式，防止 SSE 跨 chunk 丢数据（详见 1.1 节关联修复）|

### 1.4 核心设计原则：**"能不改动就不动 + 完全独立"**（2026-08-07 用户拍板 + C 方案升级）

本次实施**最优先**的设计原则，由用户明确指定：

> **"这次增加 Responses API 的核心原则是能不改动原来的方法尽量不用动。这个新的 api 和原来的完全独立。"**
>
> —— 2026-08-07 用户追问："这里能否不改动，完全新写个？"

具体含义：

| 维度 | 要求 | C 方案实现 |
|---|---|---|
| **函数层** | `runSqlAgent` 0 改动 | 0 改动（F16 已 rename，函数体 0 动）|
| **路由层** | 路由 `/generate` 现有 CC 路径 0 改动 | F14 占位符位置**单行委派**（5 行）→ 调 `runSqlAgentResponsesHandler` |
| **新文件** | 新逻辑**集中到一个新文件** | 新增 `backend/src/services/responsesApi.js`，**只** 1 个导出函数 `runSqlAgentResponsesHandler` |
| **变量层** | L403+ 现有 try 块的 `fullContent` / `sql` / `message` / `allLogs` 等 0 改动 | 同名字段在 `runSqlAgentResponsesHandler` **独立**定义（接受代码重复，但封装在新文件内）|
| **共享层** | 仅 import 已存在的工具函数（`getLlmConfig` / `loadSkillMd` / `buildMessagesForLLM` / `executeToolCall` 等）| 这些函数本身**不动**，仅增加新调用方 |
| **测试层** | 现有 258 个测试 0 改动 | 新测试**只**测新 handler，**不**触碰 CC 路径测试 |
| **回滚层** | 用户可随时切回 `chat_completions`，CC 路径 100% 还原 | 即使 Responses handler 全错，CC 路径 1 行业务代码 0 动；回滚 = 删 if 块 + 删新文件 |

**C 方案相对 B 方案的关键差异**（**封装代替重复**）：

| 维度 | B（已废弃）| **C（当前）** |
|---|---|---|
| 新代码位置 | 在 query.js 里加 130 行 try 块 | **新文件** `responsesApi.js`（130 行集中）|
| 路由改动 | 替换 F14 占位为 130 行新代码 | 替换 F14 占位为 **5 行委派** |
| 变量作用域 | 散在 query.js 里 | 封装在 handler 函数内 |
| 业务逻辑重复 | 100% 复制 | 100% 复制（接受），但**集中在新文件**，**单函数封装** |
| 后续 CC path 业务变更 | 需手动同步到 Responses | **不需同步**（CC path 改动不影响 Responses handler）|
| review 难度 | 在 query.js 里 review 130 行 | 在新文件 review 130 行，**与现有 query.js 隔离** |
| 单元测试 | mock req/res + try 块 | mock req/res + 单函数调用，**测试更纯粹** |

**接受代价**：

- 130 行业务逻辑（for-await + SSE 写入 + DB 写入 + catch）**在新文件里存在一份**
- 与 CC path 的 query.js L403+ 实现**逻辑等价但物理重复**
- 后续如果重构 CC path（如抽取 helper），**不强制**同步到 Responses handler

**违反原则的红线**：
- ❌ 抽 for-await 到 query.js 和 responsesApi.js **共享** helper（动到原代码）
- ❌ 把 CC path 变量提到外面共享（动到原代码）
- ❌ 修改 L403+ 现有 try 块的 catch 逻辑（动到原代码）
- ❌ 在 query.js 里直接加 130 行（违反"新代码进新文件"）

**对"0 改动 runSqlAgent"的精确理解**（2026-08-07 用户拍板后明确）：

> "把这些代码变成方法，老的 runSqlAgent 先不动，如果以后有机会可以替换成这些方法。"
> —— 2026-08-07 用户拍板

精确解读：
- ✅ **新增**独立文件 `backend/src/services/agentHelpers.js`，从 `runSqlAgent` 内部抽取 6 个**纯函数** helper
- ✅ `runSqlAgent` 函数体（L1079-2026）**0 改动**——继续用 inline 逻辑
- ✅ llm.js **新增** `import` 引用（用于 agentHelpers 内部调已 export 的工具函数）
- ✅ llm.js **新增** `import { ... } from './agentHelpers.js'` 引用（**仅占位**，**不**使用）—— 未来 Phase 3+ 迁移时直接调
- ❌ **不**修改 `runSqlAgent` 函数体
- ❌ **不**删 inline 逻辑（保留作为对比验证）
- ❌ **不**在 runSqlAgent 内调新 helper（保持函数体原样）

**为什么这种策略不违反"完全独立"原则**：
- "0 改动 runSqlAgent" = 函数体不动一个字
- "新增 agentHelpers.js" = **新文件**，不污染现有代码
- helper 是**纯函数**（输入 → 输出，无副作用，无 module-level 状态依赖）—— 复用 0 风险
- helper 单元测试通过 = 与原 inline 行为等价（**回归安全**）
- 未来 Phase 3+ 可**可选地**让 `runSqlAgent` 也用 helper（行为不变，0 回归）

---

## 2. 关键差异表（Chat Completions vs Responses API）

| 维度 | Chat Completions（当前）| Responses API（目标）|
|---|---|---|
| **端点** | `/chat/completions` | `/responses` |
| **System 消息** | `messages: [{role:'system', content}]` | 顶层 `instructions: "..."` 字段 |
| **思考参数** | `thinking: {type: 'enabled'}` | `reasoning: {effort: 'high'}`（**参数名不同**）|
| **max_tokens** | `max_tokens` | `max_output_tokens` |
| **工具调用 ID 字段** | `tool_calls[].id` | `function_call_arguments.delta` 的 `call_id` |
| **工具结果消息** | `messages: [{role:'tool', tool_call_id, content}]` | `input: [{type:'function_call_output', call_id, output}]` |
| **工具调用消息** | `messages: [{role:'assistant', tool_calls: [...]}]` | `input: [{type:'function_call', call_id, name, arguments}]` |
| **工具定义格式** | `{type:'function', function:{name, description, parameters}}`（嵌套）| `{type:'function', name, description, parameters}`（**嵌套去一层**）|
| **思考事件** | `delta.reasoning_content`（与 text 同帧）| `response.reasoning_text.delta`（**独立事件**）|
| **完成标志** | `data: [DONE]` | `response.completed` 事件（含 `usage`）|
| **失败标志** | HTTP 4xx/5xx 或流中 error | `response.failed` 事件 + 4xx/5xx |
| **不完整标志** | 无（依赖 finish_reason）| `response.incomplete` 事件（token 上限触发）|

---

## 3. 事件翻译表（Responses → 内部契约）

| Responses API 事件 | 内部 yield 事件 | 处理 |
|---|---|---|
| `response.output_text.delta` | `{type:'chunk', content: event.delta}` | 透传 + 累加 `roundAssistantContent` |
| `response.reasoning_text.delta` | `{type:'reasoning_chunk', content: event.delta}` | 透传 + 累加 `roundReasoningContent` |
| `response.function_call_arguments.delta` | **不直接 yield** | 累积到 `pendingToolCalls` Map（key 为 `call_id`，支持并行）|
| `response.output_item.done` (item.type=function_call) | **不直接 yield** | 整组参数就绪，触发工具执行流程（push assistantMsg + 写盘 + yield tool/tool_return）|
| 工具执行完成 | `{type:'tool_return', log: '📋 工具 xxx 返回: ...', round}` + `{type:'tool', log: '🔧 调用工具: xxx\n参数: {...}', round}` | **模仿 CC path log 风格**（[llm.js:1517-1530](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1517-L1530) + [llm.js:1844-1848](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1844-L1848)）—— yield 顺序：先 `tool`（调），后 `tool_return`（返），与 CC path 1:1 |
| `splitThinkingFromContent` 触发剥离 | `{type:'message_final', content, extraThinking, round}` | 通知前端更新 assistant 消息文本（仅在剥离发生时 yield）|
| 推理过程完整结束 | `{type:'reasoning_done', content: '💭 LLM思考过程:\n...', round}` | **★ 13 轮审计恢复**（方案 1）：与 CC path [llm.js:1501-1507](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1501-L1507) 1:1，handler 写 DB **不**写 SSE（UI 通过 reasoning_chunk 实时显示，此事件仅供历史回显）|
| `response.completed` | `{type:'usage', prompt_tokens, completion_tokens, total_tokens, round}` + `{type:'done', sql, message, reasoning, totalTokens, ...}` | 终结（含 B 选项的 `reasoning` 字段）|
| `response.failed` | `{type:'error', content: event.response.error.message}` + `{type:'done', error:true}` | 终结 |
| `response.incomplete` | `{type:'error', content:'Response incomplete (token limit)'}` + `{type:'done', error:true}` | 终结 |
| 任何 `error` 事件 | `{type:'error', content}` | 透传 |

**字段名约定**：内部事件的 `id` 字段统一指向工具调用的唯一标识符。
- Chat Completions 来源：`tool_calls[].id`
- Responses API 来源：`call_id`（**字段名差异，1 行映射解决**——见 4.4 节 `translateResponsesEvent`）
- **对前端透明**（前端用 `id` 配对 tool_call 和 tool_result，不关心来源）

**`id` 字段作用范围**（已 audit）：
- ✅ 用于多轮 history 配对：`assistantMsg.tool_calls[].id` ↔ `toolMsg.tool_call_id`
- ✅ 写日志：`[llm.js:1541-1545](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1541-L1545)` 防御性补 id
- ❌ **不**用于工具查表：工具查表只用 `name`（[llm.js:1580](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1580) `toolsMap.get(toolName)`）
- ❌ **不**用于工具执行：工具执行通过 `toolName` 查 `tool.func`（[llm.js:1686-1688](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1686-L1688)）

**结论**：`id` 字段名差异**只在 API 边界做 1 次映射**，内部代码完全不变。

**12 轮审计修订（关键 5 点）**：

1. **工具事件类型对齐前端契约**：原计划 yield `{type:'tool_call', id, name, arguments}` + `{type:'tool_result', id, name, result}` 违反 [App.jsx:859](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L859) "前端 0 改动"硬约束。**修正**：yield CC path 同款 `{type:'tool', log: '🔧 调用工具: xxx\n参数: {...}'}` + `{type:'tool_return', log: '📋 工具 xxx 返回: result'}`（只读 `data.log` 字段，前端现有 case 直接消费）。

2. **`userChoiceRequest` 透传路径不变**：TURN 1 终止时 generator yield `done` 携带 `userChoiceRequest: pendingUserChoiceList`（与 [llm.js:2011-2016](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L2011-L2016) 1:1），handler 在 for-await 中捕获到 `userChoiceRequestFromStream` 局部变量，**for-await 结束后**写最终 `doneData.user_choice_request`（与 CC path [query.js:566-568](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L566-L568) 1:1）。

3. **Q5 选 B + 13 轮修正（方案 1）**：
   - `done` 事件 yield 时附加 `reasoning: finalReasoning` 字段
   - assistantMsg 在 `messages.push` 时附加 `reasoning_content: finalReasoning` 字段（与 CC path [llm.js:1538](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1538) 字段名一致）
   - **★ 13 轮恢复**：yield `reasoning_done` 事件（content: '💭 LLM思考过程:\n...', round）→ handler 写 DB（role='LLM'，**不**写 SSE）
   - **三者并存**：① 独立 log 消息（让历史回显显示"💭 LLM思考过程"行）；② assistantMsg.reasoning_content 字段（让未来前端可单独读）；③ done 事件 reasoning 字段（让调试可观测）
   - **唯一代价**：30% 冗余（DB 多一份独立 log 消息，但保持 CC path 1:1 行为 + 思考过程可见性）

4. **`message_final` 事件保留**：与 CC path [llm.js:1489-1497](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1489-L1497) 1:1，在 `splitThinkingFromContent` 触发剥离时 yield。

5. **5.1 伪代码补两个收尾步骤**（与 CC path [query.js:494-506](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L494-L506) + [L570-578](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L570-L578) 1:1）：
   - **SQL 回退提取**：for-await 结束后，若 `sql` 为空，从 `message || fullContent` 用正则 ` ```sql ... ``` ` / ` ```mysql ... ``` ` / `SQL:...` 兜底提取
   - **confirm_tag_add 解析**：写最终 `doneData` 之前，regex `<!--confirm_tag_add:({...})-->` 解析成 `doneData.confirm_tag_add` 字段

---

## 4. 辅助函数（4 个）

### 4.1 `getToolsForResponsesApi(tools)`

```js
/**
 * 把 DynamicTool[] 转成 Responses API 工具定义格式
 * @param {Array<DynamicTool>} tools - 来自 getPrunedToolsForRound 的工具实例
 * @returns {Array<{type: 'function', name: string, description: string, parameters: object}>}
 */
function getToolsForResponsesApi(tools) {
  return tools.map(t => ({
    type: 'function',
    name: t.name,
    description: t.description,
    // ★ 二轮 AI 审计错误 3 修复：直接复用 LangChain 内部的 t.lc_kwargs.params
    //   CC path 用同样方式转换 Zod → JSON Schema（[llm.js:1120](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1120)）
    //   不需要 zod-to-json-schema 库，与 CC 路径行为完全一致
    //   原写法 parameters: zodToJsonSchema(t.schema) → 错误：① 需要额外装库 ② 转换结果可能与 CC 不一致
    parameters: t.lc_kwargs.params,
  }));
}
```

**难点**：DynamicTool.schema 是 Zod schema，需要转 JSON schema。需先 audit 现有 Chat Completions 路径如何转换（如有），优先复用。

### 4.2 `messagesToInputItems(messages)`

```js
/**
 * 把 Chat Completions 风格 messages 转成 Responses API 的 {instructions, input}
 * @param {Array} messages - 现有 initMessagesForRun 输出
 * @returns {{instructions: string, input: Array}}
 */
function messagesToInputItems(messages) {
  const instructionsParts = [];
  const inputItems = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      instructionsParts.push(msg.content);
    } else if (msg.role === 'user') {
      inputItems.push({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: msg.content }],
      });
    } else if (msg.role === 'assistant') {
      // 普通文本响应
      if (msg.content) {
        inputItems.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.content }],
        });
      }
      // 工具调用
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          inputItems.push({
            type: 'function_call',
            call_id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,  // 已是 JSON 字符串
          });
        }
      }
    } else if (msg.role === 'tool') {
      inputItems.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  return {
    instructions: instructionsParts.join('\n\n'),
    input: inputItems,
  };
}
```

### 4.3 `parseResponsesStream(body, signal)`

```js
/**
 * 流式消费 Responses API 返回，按事件翻译
 * ★ 硬约束 10 继承 F11 修复：buffer + decoder.decode(value, {stream: !done}) 模式
 *   防止 SSE 跨 chunk 切分（参考 query.js:974-979 F11 修复，CC path 已验证）
 * ★ Issue #1 修复要求：async function* 协议（与 5.3 节方案 A 一致），主函数 for await 直接 yield
 */
async function* parseResponsesStream(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      // ★ Issue #4 修复：每轮 read 前显式检查 abort signal
      //   async generator 不会自动响应 signal.aborted，需手动 break
      //   与 query.js:968-971 EXPLAIN analyze 修复模式一致
      if (signal?.aborted) {
        yield { internalType: 'error', content: '请求已被用户中断' };
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;

      // ★ F11 修复模式
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      if (done) {
        buffer = '';
      } else {
        buffer = lines.pop() || '';
      }

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            // Responses API 不用 [DONE]，是 response.completed 事件
            // 这里只是防御，正常情况下不会进入
            continue;
          }
          try {
            const event = JSON.parse(data);
            const internal = translateResponsesEvent(event);
            if (internal) yield internal;  // ★ 直接 yield（async generator 协议）
          } catch (e) {
            // 静默（流式偶发 JSON 解析失败是正常的，不影响整体）
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

### 4.4 `translateResponsesEvent(event)`

```js
/**
 * 纯函数：把单个 Responses API 事件转成内部事件
 * 返回 null 表示"内部状态变化，不 yield"（如 tool_call delta 累积）
 */
function translateResponsesEvent(event) {
  const type = event.type;

  if (type === 'response.output_text.delta') {
    return { internalType: 'chunk', content: event.delta };
  }
  if (type === 'response.reasoning_text.delta') {
    return { internalType: 'reasoning_chunk', content: event.delta };
  }
  if (type === 'response.function_call_arguments.delta') {
    return {
      internalType: 'tool_call_delta',
      call_id: event.call_id,
      name: event.name,           // 可能在 delta 事件中
      arguments: event.delta,
    };
  }
  if (type === 'response.output_item.done' && event.item?.type === 'function_call') {
    return {
      internalType: 'tool_call_done',
      toolCall: {
        // ★ 关键：call_id → id 映射（Q1 解决方案）
        //   Responses API 字段名是 call_id，Chat Completions 是 id
        //   内部代码（包括 executeToolCall、消息累积、下一轮发送）
        //   都用 id 字段，这里做一次性映射，后续 0 改动
        id: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments,  // 累积后的完整 JSON 字符串
      },
    };
  }
  if (type === 'response.completed') {
    // ★ Issue #1 修复（错误 4）：DeepSeek Responses API 的 usage 字段
    //   只返回 input_tokens / output_tokens（**不**像 Chat Completions API 提供 total_tokens）。
    //   total_tokens 需要手动计算：input_tokens + output_tokens
    //   文档：https://api-docs.deepseek.com/zh-cn/guides/responses_api/
    const inputTokens = event.response?.usage?.input_tokens || 0;
    const outputTokens = event.response?.usage?.output_tokens || 0;
    return {
      internalType: 'usage',
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    };
  }
  if (type === 'response.failed') {
    return {
      internalType: 'error',
      content: event.response?.error?.message || 'Unknown failure',
    };
  }
  if (type === 'response.incomplete') {
    return { internalType: 'error', content: 'Response incomplete (token limit or max_output_tokens reached)' };
  }
  if (type === 'error') {
    return { internalType: 'error', content: event.message || 'Unknown error' };
  }

  return null;  // 其他事件类型（response.created / response.in_progress 等）忽略
}
```

---

## 5. 主结构：新文件 `responsesApi.js` + 1 个导出 handler

> **C 方案要点**：不暴露 LLM 级的 `runSqlAgentResponses` async generator 给路由层。所有响应式逻辑（SSE 写入、DB 写入、catch）都封装在 `runSqlAgentResponsesHandler` 内，对路由层**只**呈现 1 个函数 + 5 行委派。

### 5.0 新文件结构

**新文件 1**：`backend/src/services/agentHelpers.js`（**Step 1.5 抽取的 6 个 helper**）

```js
// 6 个 export helper（从 runSqlAgent inline 逻辑 1:1 抽取，纯函数，无 module-level 状态）
export function initMessagesForRun(sessionId, question, systemMessage) { ... }       // 见 5.5.1
export function getPrunedToolsForRun(toolsDefinition, sessionId) { ... }            // 见 5.5.2
export function getToolCallId(toolCall, validToolCalls, idx) { ... }                 // 见 5.5.3
export async function executeToolCallsInStages(ctx) { ... }                          // 见 5.5.4（3 阶段 ~370 行）
export function recordPendingUserChoices(execResults, pendingUserChoiceList, sessionId, maxPerTurn) { ... }  // 见 5.5.5
export function saveRunState(sessionId, messages) { ... }                            // 见 5.5.6
```

**新文件 2**：`backend/src/services/responsesApi.js`（Phase 2 主文件）

```js
import {
  initMessagesForRun,
  getPrunedToolsForRun,
  executeToolCallsInStages,
  recordPendingUserChoices,
  saveRunState,
} from './agentHelpers.js';

// 4 个内部辅助函数（不导出，私有）
function getToolsForResponsesApi(tools) { ... }                          // 见 4.1
function messagesToInputItems(messages) { ... }                          // 见 4.2
async function* parseResponsesStream(body, signal) { ... }              // 见 4.3（async generator）
function translateResponsesEvent(event) { ... }                          // 见 4.4

// 1 个内部 LLM-level generator（不导出）
async function* _runSqlAgentResponsesStreamGen(question, history, signal, sessionId, username) {
  // 见 5.2 节伪代码（带 yield 设计）
}

// ★ 1 个导出 handler：路由层唯一入口
export async function runSqlAgentResponsesHandler(req, res, sessionId, username, abortController) {
  // 见 5.1 节伪代码
}
```

### 5.1 导出函数 `runSqlAgentResponsesHandler` 伪代码（C 方案核心）

```js
export async function runSqlAgentResponsesHandler(
  req, res, sessionId, username, abortController
) {
  logger.info("runSqlAgentResponsesHandler called", { sessionId, username });

  // ★ 1. 共享 setup（与 CC path 相同的 helper import，0 改动）
  //   ★ 三轮 AI 审计次要 1 修复：resetPerQuestionRegistryFlags 移到 5.2 节 generator 内部
  //     避免与 5.2 节 L545 重复调用。handler 调 generator 前不直接做问题级状态重置
  //     （与 CC path runSqlAgent 一致：reset 在 generator 入口而非路由 handler）
  const question = req.body.question;
  const historyText = req.body.historyText || "";
  const signal = abortController.signal;

  const cfg = getLlmConfig();
  const skillMd = loadSkillMd();

  // ★ 2. 内部 LLM-level generator（封装，不导出）
  const generator = _runSqlAgentResponsesStreamGen(
    question, historyText, signal, sessionId, username
  );

  // ★ 3. 完整 for-await 循环（与 CC path 逻辑等价，封装在新文件内）
  let fullContent = '';
  let sql = '';
  let message = '';
  let reasoning = '';
  const allLogs = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let messageSaved = false;
  let lastRound = 0;
  // ★ 12 轮审计修订：恢复 userChoiceRequestFromStream 变量（11 轮审计"副 1 修复"判断错误）
  //   原因：generator 的 `done` 事件携带 `userChoiceRequest: pendingUserChoiceList`（TURN 1 终止时），
  //   但 done 事件**不能**在 for-await 中立即写 SSE（会与最终 doneData 重复），必须先
  //   捕获到局部变量，for-await 结束后写最终 `doneData.user_choice_request`。
  //   与 CC path [query.js:420](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L420) + L487-489 + L566-568 1:1 对齐。
  let userChoiceRequestFromStream = null;

  try {
    for await (const chunk of generator) {
      if (abortController.signal.aborted) break;

      // 统一更新 lastRound：所有 chunk 都来自 generator 内部计算的 currentRound
      if (typeof chunk.round === 'number') {
        lastRound = chunk.round;
      }

      // ★ 4. 类型分派（与 CC path [query.js:431-490](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L431-L490) 逻辑等价）
      //   ★ 12 轮审计修订：事件类型已统一为 CC path 风格（tool/tool_return/LLM），前端 0 改动
      //   ★ 这部分代码与 query.js L431-490 业务逻辑一致
      //   ★ 是"重复"但封装在新文件内（符合 1.4 节"接受代价"）
      switch (chunk.type) {
        case 'chunk':
          fullContent += chunk.content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          break;
        case 'reasoning_chunk':
          // 实时流式思考过程：只透传给前端，不入 DB，不累计到 fullContent
          res.write(`data: ${JSON.stringify({ type: 'reasoning_chunk', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          break;
        case 'reasoning_done':
          // ★ 13 轮审计恢复（方案 1）：与 CC path [query.js:469-479](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L469-L479) 1:1
          //   思考过程结束：单条入 DB（历史回显用），**不**传给 UI（UI 已通过 reasoning_chunk 实时显示）
          if (sessionId && chunk.content) {
            try {
              const db = getDb();
              db.prepare('INSERT INTO messages (session_id, role, content, sql, results, round) VALUES (?, ?, ?, ?, ?, ?)')
                .run(sessionId, 'LLM', chunk.content, '', '', chunk.round || 0);
            } catch (e) {
              logger.error('保存reasoning失败', { error: e.message });
            }
          }
          break;
        case 'message_final':
          // 后处理：剥离 LLM 误倒进 content 的 thinking 后，更新前端 assistant 消息
          res.write(`data: ${JSON.stringify({ type: 'message_final', content: chunk.content, extraThinking: chunk.extraThinking, round: chunk.round || 0 })}\n\n`);
          break;
        case 'tool':
        case 'tool_return':
        case 'LLM': {
          // ★ 12 轮审计修订：与 [App.jsx:859-904](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L859-L904) 现有 case 完全匹配
          //   前端只读 data.log 字段；tool 还含 request_tag_confirmation 弹窗解析（暂不在 Responses 范围）
          const logContent = chunk.log || '';
          allLogs.push(logContent);
          res.write(`data: ${JSON.stringify({ type: chunk.type, log: logContent, round: chunk.round || 0 })}\n\n`);

          // 实时保存每条日志到数据库（带 round 字段，用于历史回显的"轮次轴"展示）
          if (sessionId && logContent) {
            try {
              const db = getDb();
              db.prepare('INSERT INTO messages (session_id, role, content, sql, results, round) VALUES (?, ?, ?, ?, ?, ?)')
                .run(sessionId, chunk.type, logContent, '', '', chunk.round || 0);
            } catch (e) {
              logger.error('保存单条日志失败', { error: e.message });
            }
          }
          break;
        }
        case 'usage':
          totalPromptTokens += chunk.usage.prompt_tokens;
          totalCompletionTokens += chunk.usage.completion_tokens;
          totalTokens += chunk.usage.total_tokens;
          // 每轮 API 调用都保存 token 记录（带 round 字段）
          if (sessionId) {
            try {
              const db = getDb();
              db.prepare('INSERT INTO messages (session_id, role, content, prompt_tokens, completion_tokens, total_tokens, round) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(sessionId, 'usage', `Round token: ${chunk.usage.total_tokens} (prompt: ${chunk.usage.prompt_tokens}, completion: ${chunk.usage.completion_tokens})`, chunk.usage.prompt_tokens, chunk.usage.completion_tokens, chunk.usage.total_tokens, chunk.round || 0);
            } catch (e) {
              logger.error('保存 usage 失败', { error: e.message });
            }
          }
          break;
        case 'error':
          res.write(`data: ${JSON.stringify({ type: 'error', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          break;
        case 'done':
          // ★ 12 轮审计修订：done 事件只设局部变量，**不**立即写 SSE
          sql = chunk.sql || '';
          message = chunk.message || '';
          reasoning = chunk.reasoning || '';  // B 选项保留
          // ★ 12 轮审计修订：捕获 userChoiceRequest 事件字段（来自 generator 终止分支 yield）
          if (chunk.userChoiceRequest && !userChoiceRequestFromStream) {
            userChoiceRequestFromStream = chunk.userChoiceRequest;
          }
          break;
      }
    }

    // ★ 6. 收尾处理（与 CC path [query.js:493-578](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L493-L578) 等价）
    logger.info('Stream done, sending final result', { sql: sql?.substring(0, 50), message: message?.substring(0, 50), totalTokens });

    // ★ 6.1 SQL 回退提取（CC path [query.js:494-506](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L494-L506) 1:1）
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

    // ★ 6.2 message 兜底（CC path [query.js:509-511](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L509-L511) 1:1）
    if (!message || message.trim() === '') {
      message = fullContent;
    }

    // ★ 6.3 计算耗时
    const elapsedMs = Date.now() - requestStartTime;

    // ★ 6.4 保存最终消息到数据库（CC path [query.js:518-552](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L518-L552) 1:1）
    const wasInterrupted = abortController.signal.aborted ? 1 : 0;
    let contentForDb = fullContent || message;
    if (wasInterrupted && !contentForDb) {
      contentForDb = '(已中断)';
    }
    if (sessionId && contentForDb) {
      try {
        const db = getDb();
        // ★ 12 轮审计修订：assistantMsg.reasoning_content 字段（与 CC path L1538 一致，Q5 选 B）
        //   B 选项把 reasoning 通过此字段存 DB，替代 CC path 的 reasoning_done 独立 log 消息
        db.prepare('INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, round, interrupted, reasoning_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(sessionId, 'assistant', contentForDb, sql || '', '', totalPromptTokens, totalCompletionTokens, totalTokens, elapsedMs, lastRound, wasInterrupted, reasoning);
        messageSaved = true;
      } catch (e) {
        logger.error('保存最终消息失败', { error: e.message });
      }
      // 更新会话 token
      if (sessionId && totalTokens > 0) {
        try {
          const db = getDb();
          const current = db.prepare('SELECT total_tokens FROM sessions WHERE id = ?').get(sessionId);
          const newTotal = (current?.total_tokens || 0) + totalTokens;
          db.prepare('UPDATE sessions SET total_tokens = ? WHERE id = ?').run(newTotal, sessionId);
        } catch (e) {
          logger.error('更新会话 token 失败', { error: e.message });
        }
      }
    }

    // ★ 6.5 构造最终 doneData（CC path [query.js:554-578](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L554-L578) 1:1）
    const doneData = {
      type: 'done',
      sql,
      message,
      sessionId,
      totalTokens,
      elapsedMs,
      // ★ 12 轮审计修订：B 选项保留 reasoning 字段（前端不读但可观测）
      reasoning,
    };

    if (userChoiceRequestFromStream) {
      doneData.user_choice_request = userChoiceRequestFromStream;
    }

    // ★ 6.6 confirm_tag_add 解析（CC path [query.js:570-578](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L570-L578) 1:1）
    const confirmMatch = message.match(/<!--confirm_tag_add:(\{[^}]+\})-->/);
    if (confirmMatch) {
      try {
        const confirmData = JSON.parse(confirmMatch[1]);
        doneData.confirm_tag_add = confirmData;
      } catch (e) {
        logger.warn('confirm_tag_add parse failed', { error: e.message });
      }
    }

    streamCompleted = true; clearTimeout(overallTimer);
    res.write(`data: ${JSON.stringify(doneData)}\n\n`);

  } catch (e) {
    // ★ 7. catch 块（与 CC path [query.js:582-625](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L582-L625) 等价：partial 保存 + done 错误事件）
    streamCompleted = true; clearTimeout(overallTimer);
    logger.error('Stream query failed', { error: e.message, stack: e.stack });

    // 流中断 partial 落库（CC path [query.js:593-619](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L593-L619) 1:1）
    const isAbort = abortController.signal.aborted
      || e.name === 'AbortError'
      || /aborted|abort|timeout/i.test(e.message || '');
    if (isAbort && !messageSaved && sessionId) {
      try {
        const db = getDb();
        const elapsedMs = Date.now() - requestStartTime;
        const contentForDb = fullContent || message || '(已中断)';
        // ★ 12 轮审计修订：catch 块落库也带 reasoning_content 字段
        db.prepare('INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, round, interrupted, reasoning_content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(sessionId, 'assistant', contentForDb, sql || '', '', totalPromptTokens, totalCompletionTokens, totalTokens, elapsedMs, lastRound, 1, reasoning);
        messageSaved = true;
        // 累计 token
        if (totalTokens > 0) {
          const current = db.prepare('SELECT total_tokens FROM sessions WHERE id = ?').get(sessionId);
          const newTotal = (current?.total_tokens || 0) + totalTokens;
          db.prepare('UPDATE sessions SET total_tokens = ? WHERE id = ?').run(newTotal, sessionId);
        }
        logger.info('Partial assistant message saved (interrupted)', {
          sessionId, contentLength: fullContent.length, totalTokens, elapsedMs, round: lastRound,
          isEmptyContent: !fullContent && !message
        });
      } catch (saveErr) {
        logger.error('保存中断 partial 消息失败', { error: saveErr.message });
      }
    }

    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: e.message, interrupted: isAbort })}\n\n`);
    }
  }

  if (!res.writableEnded) {
    res.end();
  }
}
```

### 5.2 内部 LLM-level generator（`_runSqlAgentResponsesStreamGen`，不导出）伪代码

```js
async function* _runSqlAgentResponsesStreamGen(
  question, history, signal, sessionId, username
) {
  logger.info("_runSqlAgentResponsesStreamGen called", {
    question, historyLength: history?.length, sessionId, username,
  });

  // ★ 共享：与 runSqlAgent 完全相同的 setup
  resetPerQuestionRegistryFlags(getOrCreateRegistry(sessionId));
  const cfg = getLlmConfig();
  const { apiKey, baseURL, model } = cfg;
  const skillMd = loadSkillMd();

  // ★ 三轮 AI 审计错误 2 + 3 修复（关键）：
  //   - systemMessage 用**字面字符串**模板（与 CC path L1131-1132 完全一致）
  //     注意：项目内**不存在** `buildSystemMessage` 函数，CC path 用的是模板字符串直接拼接
  //   - toolsDefinition 一次性从 tools 转 CC 格式（与 CC path L1115-1126 完全一致）
  //   - toolsMap 也是一次性建立
  //   - 工具**剪枝**（prunedTools）不在这里算，移到 while 循环内每轮重算（错误 1 修复）
  const toolsDefinition = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.lc_kwargs.params || { type: 'object', properties: {}, required: [] },
    },
  }));
  const toolsMap = new Map(tools.map((t) => [t.name, t]));
  const systemMessage = `你是XTSQLQueryAgent。严格遵守以下规则，随后根据用户问题生成SQL。\n${skillMd}`;

  // ★ 二轮 AI 审计错误 1 修复：调 initMessagesForRun helper（代替不存在的 buildMessagesForLLM / getPrunedToolsForRound）
  //   5.5.1 节 initMessagesForRun 第 3 个参数是已构建的 systemMessage（已构建的字面字符串，不是 skillMd）
  const messages = initMessagesForRun(sessionId, question, systemMessage);

  // ★ 12 轮审计修订：变量声明集中放在函数顶部，方便 review
  let maxToolCalls = cfg.max_tool_calls || 30;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let finalSql = '';
  let finalMessage = '';
  let finalReasoning = '';
  let currentRound = 0;
  // ★ 二轮 AI 审计错误 2 修复：pendingUserChoiceList 未声明 → 加声明
  //   用途：executeToolCallsInStages 内部将 request_user_choice 工具结果 push 进去
  //   收集后由 recordPendingUserChoices 处理（v3 marker 数组 + 旧版单 marker 兼容）
  //   与 CC path L1897 行为完全一致
  let pendingUserChoiceList = [];
  // ★ 三轮 AI 审计次要 2 修复：MAX_USER_CHOICE_PER_TURN 常量声明
  //   用途：recordPendingUserChoices 内部丢弃超过上限的 user_choice 工具结果
  //   与 CC path L1180 `const MAX_USER_CHOICE_PER_TURN = 3;` 完全一致
  //   上限 = 3（详见 SKILL.md "多问题上限与链式语义"，前端弹窗链过长用户疲劳）
  const MAX_USER_CHOICE_PER_TURN = 3;

  while (maxToolCalls > 0) {
    currentRound++;
    // ★ 三轮 AI 审计错误 1 修复：每轮重算工具剪枝（与 CC path L1262-1286 完全一致）
    //   一次性工具（get_domain_index / get_sliced_index）调用后从 LLM 看到的工具列表移除
    //   历史教训：Round 0 剪枝 validate_sql_fields 导致 LLM 跳过早轮工具调用
    //   （[llm.js:1254-1261](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1254-L1261) 历史 bug）
    //   helper 5.5.2 节已实现 1:1 复制 CC path 剪枝逻辑（含 validate_sql_fields 永不剪枝）
    const tools = getPrunedToolsForRun(toolsDefinition, sessionId);
    // ★ Responses API 特有：转换 messages → input items
    const { instructions, input } = messagesToInputItems(messages);
    const responsesTools = getToolsForResponsesApi(tools);
    const requestBody = {
      model,
      instructions,
      input,
      tools: responsesTools,
      stream: true,
      reasoning: { effort: 'high' },
      temperature: 0,
    };

    // ★ 发起请求（带 abort signal）
    let response;
    try {
      response = await fetch(`${baseURL}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') {
        yield { type: 'error', content: '请求已被用户中断' };
      } else {
        yield { type: 'error', content: `Fetch failed: ${e.message}` };
      }
      yield { type: 'done', sql: '', message: '', error: true };
      return;
    }

    if (!response.ok) {
      const errText = await response.text();
      yield { type: 'error', content: `HTTP ${response.status}: ${errText}` };
      yield { type: 'done', sql: '', message: '', error: true };
      return;
    }

    // ★ 流式消费 + 翻译（async generator 协议天然支持 yield）
    //   用 Map<call_id, ToolCall> 支持并行 tool call（与 CC path 的 streamToolCalls 数组对齐）
    //   关键：不能用单数 pendingToolCall —— LLM 单轮可并行调多个工具（CC path L1438-1458 已支持）
    //
    // ★ Issue #4：abort signal 链路
    //   - 主机制：fetch 的 signal 传播（5.2 L524 传 signal 给 fetch）
    //     用户 abort → fetch.abort → response.body 流关闭 → reader.read() 抛 AbortError 或返回 done
    //   - 显式检查（冗余安全网）：4.3 节 async generator 内的 `if (signal?.aborted)`
    //     防止 fetch 的 signal 传播延迟期间循环仍继续跑
    //   - 错误传播：4.3 节 yield `{internalType: 'error'}` + return → 主函数 for-await 收到 error
    //     → 设 errored=true → 退出 for-await → 走 done+return 路径
    const pendingToolCalls = new Map();   // call_id → { id, name, arguments }
    let roundAssistantContent = '';
    let roundReasoningContent = '';
    let toolCalledThisRound = false;
    let errored = false;

    for await (const internal of parseResponsesStream(response.body, signal)) {
      switch (internal.internalType) {
        case 'chunk':
          roundAssistantContent += internal.content;
          yield { type: 'chunk', content: internal.content };  // ★ 立即 yield
          break;
        case 'reasoning_chunk':
          roundReasoningContent += internal.content;
          yield { type: 'reasoning_chunk', content: internal.content };
          break;
        case 'tool_call_delta':
          // ★ 并行 tool call 累积：按 call_id 分桶
          //   单数 pendingToolCall 会被第二个工具覆盖，导致第一个工具静默丢失
          if (!pendingToolCalls.has(internal.call_id)) {
            pendingToolCalls.set(internal.call_id, {
              id: internal.call_id,
              name: internal.name || '',
              arguments: '',
            });
          }
          pendingToolCalls.get(internal.call_id).arguments += internal.arguments;
          break;
        case 'tool_call_done':
          // ★ Issue #6 修复（错误 6）：防御性检查——若 done 事件的 arguments 为空/undefined，
          //   保留已累积的 delta，避免覆盖丢失。
          //   正常情况下 done 事件携带完整 arguments，delta 累积作废；
          //   异常情况下（DeepSeek 后端 bug / 网络丢包）保留 delta 是更安全的选择。
          {
            const existing = pendingToolCalls.get(internal.toolCall.id);
            const finalArgs = internal.toolCall.arguments !== undefined
              ? internal.toolCall.arguments
              : (existing?.arguments || '');
            pendingToolCalls.set(internal.toolCall.id, {
              id: internal.toolCall.id,
              name: internal.toolCall.name || existing?.name || '',
              arguments: finalArgs,
            });
          }
          toolCalledThisRound = true;
          break;
        case 'usage':
          totalPromptTokens += internal.prompt_tokens;
          totalCompletionTokens += internal.completion_tokens;
          yield { type: 'usage', ... };
          break;
        case 'error':
          errored = true;
          break;
      }
    }

    if (errored) {
      yield { type: 'done', sql: '', message: '', error: true };
      return;
    }

    // ★ 工具调用：执行 + 投喂下一轮（支持并行 N 个工具）
    if (pendingToolCalls.size > 0) {
      // ★ 12 轮审计修订：与 CC path L1533-1556 顺序 1:1 对齐
      //   1) 构造 assistantMsg（含 tool_calls 字段 + reasoning_content 字段，B 选项）
      //   2) push assistantMsg → 写盘 → 5.1 节 handler 也能拿到（lastMessages 同步）
      //   3) yield 工具调用日志（CC path log 风格）
      //   4) 调用 helper executeToolCallsInStages（3 阶段：prepared / execResults / 写回 messages）
      //   5) yield 工具返回日志
      //   6) 收集 user_choice 决定是否 break

      // ★ 12 轮审计修订：构造 assistantMsg（与 CC path L1535-1555 1:1，Q5 选 B 加 reasoning_content 字段）
      //   CC path L1541-1545 防御性补 id（这里 helper 内部会做，可省略）
      //   CC path L1547-1554 构造 tool_calls 数组（CC 风格的 {id, type, function:{name, arguments}}）
      const validToolCalls = [...pendingToolCalls.values()].map(tc => ({
        id: tc.id,
        function: { name: tc.name, arguments: tc.arguments },
      }));
      const assistantMsg = {
        role: "assistant",
        content: roundAssistantContent || "",
        reasoning_content: roundReasoningContent || "",  // ★ B 选项：reasoning 字段
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

      // ★ 12 轮审计修订：saveRunState 时机改到 "push assistantMsg 之后、yield tool 之前"
      //   与 CC path L1556-1563 1:1 对齐（L1556 push → L1558 lastMessages → L1562 saveMessagesToDb）
      //   CC path 的设计：DB 保存 "有 assistantMsg + 无 tool_message" 状态，多轮中断时
      //   下次 load 仍能看到 assistant 决策（即使 tool 结果丢失）。**这个设计 1:1 复制**。
      saveRunState(sessionId, messages);

      // ★ 12 轮审计修订：yield 工具调用日志（CC path L1515-1531 风格）
      //   yield 顺序：先 `tool`（调），后 `tool_return`（返）—— 与 CC path 1:1
      for (const tc of validToolCalls) {
        const toolName = tc.function.name;
        const toolArgs = tc.function.arguments || "{}";
        let logMsg = `🔧 调用工具: ${toolName}`;
        try {
          const parsedArgs = JSON.parse(toolArgs);
          if (Object.keys(parsedArgs).length > 0) {
            logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
          }
        } catch (e) {
          // 参数不是合法 JSON 时不附加参数行（与 CC path L1522-1529 行为一致）
        }
        yield { type: 'tool', log: logMsg, round: currentRound };
      }

      // ★ 调用 helper（3 阶段：prepared / Promise.all execResults / 写回 messages）
      //   复用 5.5.4 节 executeToolCallsInStages，0 行为变化
      //   重要：CC path 内部 [llm.js:1571-1573](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1571-L1573) 用 `prunedTools.map(t => t.function.name)`
      //   本节 12 轮审计修订：字段名 `t.name` → `t.function.name`（helper 5.5.2 返回的是 toolsDefinition 类型的项，结构 `{type, function:{name,...}}`）
      const prunedTools = tools;  // 简化：tools 在 while 顶部已重算过
      const toolsMapForExec = new Map(prunedTools.map(t => [t.function.name, t]));
      const { execResults } = await executeToolCallsInStages({
        validToolCalls,
        toolsMap: toolsMapForExec,
        sessionId,
        availableToolNames: new Set(prunedTools.map(t => t.function.name)),
        messages,                      // helper 内部 push tool 消息
        pendingUserChoiceList,         // helper 内部 push user_choice
        username,
        currentRound,
        question,
      });

      // ★ yield 工具返回日志（CC path L1844-1848 风格）
      for (const r of execResults) {
        const resultContent = r.rawResult !== null && r.rawResult !== undefined
          ? (typeof r.rawResult === "string" ? r.rawResult : JSON.stringify(r.rawResult))
          : "(无结果)";
        yield {
          type: 'tool_return',
          log: `📋 工具 ${r.toolName} 返回:\n${resultContent}`,
          round: currentRound,
        };
      }

      // ★ 12 轮审计修订：saveRunState 已在上方（push assistantMsg 之后）调用，**不**在此处再调
      //   CC path 也只在 assistantMsg push 后调一次，**不**在 tool 消息写回后调

      // ★ pendingUserChoiceList 收集
      recordPendingUserChoices(execResults, pendingUserChoiceList, sessionId, MAX_USER_CHOICE_PER_TURN);

      // ★ TURN 1 终止：检测到至少一个 request_user_choice 后跳出 while
      //   与 CC path L1936-1937 行为完全一致
      if (pendingUserChoiceList.length > 0) break;

      pendingToolCalls.clear();
    } else {
      // ★ 12 轮审计修订：与 CC path L2021-2025 行为完全对齐
      //   1. 不提取 SQL（CC path 也是 sql=""，SQL 提取在 handler 5.1.6.1 步兜底）
      //   2. 用 splitThinkingFromContent 剥离 thinking（CC path L1480-1481）
      //   3. 如果发生剥离，yield message_final 事件更新前端消息（CC path L1489-1496）
      //   4. reasoning 直接累加到 finalReasoning（Q5 选 B：done 事件带 reasoning 字段 + assistantMsg.reasoning_content 字段 + reasoning_done 事件三者并存）
      //   ★ 13 轮审计修正：12 轮错误地删除 reasoning_done yield；13 轮恢复（与 CC path L1501-1507 1:1）
      const { content: cleanContent, extraThinking } = splitThinkingFromContent(roundAssistantContent);
      finalSql = '';
      finalMessage = cleanContent;
      finalReasoning = extraThinking
        ? roundReasoningContent
          ? roundReasoningContent + '\n\n' + extraThinking
          : extraThinking
        : roundReasoningContent;
      if (extraThinking) {
        yield {
          type: 'message_final',
          content: finalMessage,
          extraThinking,
          round: currentRound,
        };
      }
      // ★ 13 轮审计恢复（方案 1）：与 CC path [llm.js:1501-1507](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1501-L1507) 1:1
      //   此处 yield reasoning_done 用于 DB 持久化（历史回显需要），UI 不再消费（reasoning_chunk 已实时显示）
      //   content 含 emoji + 10000 字符截断（与 CC path L1504 1:1）
      if (finalReasoning) {
        yield {
          type: 'reasoning_done',
          content: `💭 LLM思考过程:\n${finalReasoning.slice(0, 10000)}`,
          round: currentRound,
        };
      }
      break;
    }

    maxToolCalls--;
  }

  // ★ 终结事件（Q5 选 B：done 事件带 reasoning 字段）
  //   - sql 永远为空（与 CC path L2025 一致），SQL 提取在 handler 兜底
  //   - message = cleanContent（已剥离 thinking）
  //   - reasoning = finalReasoning（含可能追加的 extraThinking）
  //   - userChoiceRequest 仅 TURN 1 终止分支设置（CC path L2011-2016 1:1）
  yield {
    type: 'done',
    sql: finalSql,
    message: finalMessage,
    reasoning: finalReasoning,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    // TURN 1 终止：pendingUserChoiceList 非空时携带 userChoiceRequest 字段
    ...(pendingUserChoiceList.length > 0 ? { userChoiceRequest: pendingUserChoiceList } : {}),
  };
}
```

### 5.3 流式 yield 时机（已解决：C 方案选 A）

**采用方案 A**：`parseResponsesStream` 改为 `async function*`，直接 yield 内部事件。

> ★ **硬约束 10 继承 F11 修复**：下面的 `buffer += decoder.decode(value, {stream: !done})` 模式直接复用 [query.js:974-979](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L974-L979) F11 修复。`done` 时 `buffer = ''`，否则 `buffer = lines.pop() || ''`，**不能简化**（SSE 跨 chunk 切分会触发 F11 历史 bug）
> ★ **硬约束 9 继承 F9 修复**：abort signal 在每轮 `reader.read()` **之前**显式检查（参考 [query.js:968-971](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L968-L971) F11 同位置 abort 检查模式）

```js
// 4.3 节：async function* parseResponsesStream
async function* parseResponsesStream(body, signal) {
  let buffer = '';
  const decoder = new TextDecoder();
  const reader = body.getReader();

  try {
    while (true) {
      // ★ Issue #4 修复：每轮 read 前显式检查 abort signal
      //   async generator 不会自动响应 signal.aborted，需手动 break
      //   主要机制是 fetch 的 signal 传播关闭 body.stream（4.3 节"硬约束 9 继承 F9"）
      //   本检查是冗余安全网，避免 signal 传播延迟
      if (signal?.aborted) {
        yield { internalType: 'error', content: '请求已被用户中断' };
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      if (done) buffer = '';
      else buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          const translated = translateResponsesEvent(event);
          if (translated !== null) {
            yield translated;  // ★ 天然支持 yield
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

**优势**：
- async generator 协议天然支持 yield，**无需** events[] 累积
- 主函数 `for await (const internal of parseResponsesStream(...))` 简洁
- 复用 F11 修复的 buffer + `stream: !done` 模式

---

## 5.5 helper 详细定义（Step 1.5 抽取的 6 个 agent helper）

> **关键约束**（1.4 节红线 + 用户拍板）：
> - helper 内部代码 = `runSqlAgent` 对应 inline 逻辑 **1:1 复制**（仅改缩进 + 提取变量为参数 + 改 closure 为 ctx）
> - **0 行为变化**：每个 return 路径 / 副作用顺序 / 错误处理**完全一致**
> - helper **不依赖** module-level 状态（除已 export 的函数）
> - helper **测试通过** = 与原 inline 行为等价（回归安全）

### 5.5.1 `initMessagesForRun`

**源 inline 代码**：[llm.js:1146-1165](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1146-L1165)

**签名**：
```js
/**
 * 初始化 LLM 调用的 messages 数组。
 * - sessionId 有值 + DB 有历史 → 加载历史 + 替换 system + push 新 user
 * - sessionId 有值 + DB 无历史 → 全新 system + user
 * - sessionId 无值 → 全新 system + user
 * @param {string|null} sessionId
 * @param {string} question
 * @param {string} systemMessage
 * @returns {Array<{role, content, ...}>}
 */
export function initMessagesForRun(sessionId, question, systemMessage) {
  let messages;
  if (sessionId) {
    const savedResult = loadMessagesFromDb(sessionId);
    const savedMessages = savedResult?.messages;
    if (savedMessages && savedMessages.length > 0) {
      logger.info("Loaded messages from database", {
        sessionId,
        messageCount: savedMessages.length,
      });
      messages = savedMessages;
      const systemIndex = messages.findIndex((m) => m.role === "system");
      if (systemIndex >= 0) {
        messages[systemIndex] = { role: "system", content: systemMessage };
      }
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
```

**依赖 import**（`loadMessagesFromDb` + `logger` 都已 export / 全局可用）

### 5.5.2 `getPrunedToolsForRun`

**源 inline 代码**：[llm.js:1263-1280](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1263-L1280)

**签名**：
```js
/**
 * 按 registry 状态剪枝一次性工具。
 * - get_domain_index 调用过 → 移除
 * - get_sliced_index 加载过域 → 移除
 * - validate_sql_fields **永不剪枝**（L1254-1261 历史 Bug 教训）
 * @param {Array<{type, function: {name, ...}}>} toolsDefinition
 * @param {string|null} sessionId
 * @returns {Array}
 */
export function getPrunedToolsForRun(toolsDefinition, sessionId) {
  const pruneReg = sessionId ? getOrCreateRegistry(sessionId) : null;
  const prunedTools = pruneReg
    ? toolsDefinition.filter((t) => {
        if (t.function.name === "get_domain_index" && pruneReg.getDomainIndexCalled) return false;
        if (t.function.name === "get_sliced_index" && pruneReg.slicedDomains.size > 0) return false;
        return true;
      })
    : toolsDefinition;
  return prunedTools;
}
```

### 5.5.3 `getToolCallId`

**源 inline 代码**：[llm.js:1577-1579](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1577-L1579)

**签名**：
```js
/**
 * 获取或生成 tool_call_id（防御性 fallback）。
 * - 优先用 LLM 返回的 id
 * - 缺失时生成 `call_${Date.now()}_${idx}`（与 LLM 实际格式无关，纯内部标识）
 * @param {Object} toolCall - 来自 validToolCalls
 * @param {Array} validToolCalls - 用于生成 fallback 时的 index
 * @param {number} idx - 当前 toolCall 在 validToolCalls 中的 index
 * @returns {string}
 */
export function getToolCallId(toolCall, validToolCalls, idx) {
  return toolCall.id || `call_${Date.now()}_${idx}`;
}
```

### 5.5.4 `executeToolCallsInStages`（最大 helper，~370 行）

**源 inline 代码**：[llm.js:1565-1933](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1565-L1933)（3 阶段：prepared / execResults / 写回 messages）

**签名**（**★ Issue #1 修复（错误 1）**：helper 返回 `{hadToolCalls, execResults}`，让 5.2 节主函数能 yield tool/tool_return 事件）：
```js
/**
 * 3 阶段工具执行：prepared / execResults / 写回 messages
 * 复用 runSqlAgent L1565-1933 完整逻辑，0 行为变化。
 *
 * ★ Issue #1 修复（错误 1）：必须返回 execResults
 *   helper 内部已 push tool 消息到 ctx.messages，但 yield tool/tool_return 事件
 *   必须在主 generator 上下文（5.2 节）执行。helper 返回 execResults 数组
 *   供主函数 for 循环 yield，详见 5.2 节。
 *
 * ★ 12 轮审计修订：helper **不**在内部调 saveRunState / setLastMessages
 *   原因：CC path 的 L1556-1563 saveMessagesToDb 是在 L1565 工具执行**之前**调用
 *   （即 "push assistantMsg 之后"），helper 复制的是 L1565 之后逻辑，**不**包含 L1558-1562。
 *   saveRunState 的责任交给 5.2 节主函数在 yield tool 之前调（与 CC path 顺序 1:1）。
 *   这避免了 helper 与主函数双重写盘（**不**行为差异）。
 *
 * @param {Object} ctx
 * @param {Array} ctx.validToolCalls - 本轮 LLM 返回的 tool_calls（含 id/function）
 * @param {Map<string, DynamicTool>} ctx.toolsMap - 工具名 → DynamicTool
 * @param {string|null} ctx.sessionId
 * @param {Set<string>} ctx.availableToolNames - 本轮 LLM 看到的工具名（剪枝后，**必须是 .function.name 集合**）
 * @param {Array} ctx.messages - **会被修改**：push 工具结果（role: 'tool'）
 * @param {Array} ctx.pendingUserChoiceList - **会被修改**：push user_choice payload
 * @param {string|null} ctx.username - 仅用于日志
 * @param {number} ctx.currentRound - 仅用于日志
 * @param {string|null} ctx.question - 用于 LLM 看 checklist（pass-through 内部调 buildToolCallChecklistMessage）
 * @returns {Promise<{hadToolCalls: boolean, execResults: Array}>}
 *   - hadToolCalls: 是否本轮有 tool_calls（与 validToolCalls.length > 0 等价）
 *   - execResults: 工具执行结果数组（每项含 toolCallId/toolName/rawResult/execError/dupCheck）
 *                  主函数用 for 循环 yield tool/tool_return 事件给前端（CC path log 风格）
 */
export async function executeToolCallsInStages(ctx) {
  // 阶段 1: prepared（参数解析 + 重复检查 + 工具被剪枝检查）~110 行
  //   重要：CC path L1571-1573 availableToolNames = new Set(prunedTools.map(t => t.function.name))
  //   helper 复制时严格保持：ctx.availableToolNames 已是 t.function.name 集合，**不**再加工
  // 阶段 2: execResults（Promise.all 并行执行 + request_user_choice 特殊处理 + recordToolCall）~110 行
  // 阶段 3: 写回 messages + request_user_choice 收集（H4 后续调 recordPendingUserChoices）~150 行
  //   重要：阶段 3 只 push tool message 到 ctx.messages，**不**调 saveRunState
  // 总 ~370 行，1:1 复制 runSqlAgent L1565-1933

  // ★ 末尾 return
  return {
    hadToolCalls: ctx.validToolCalls.length > 0,
    execResults,  // 阶段 2 累积的 execResults 数组
  };
}
```

**关键点**：
- **并行执行**：`Promise.all(prepared.map(...))` 保持原行为（[L1670-1779](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1670-L1779)）
- **自动修复**：`fixBareQuotesInJsonArgs`（仅 `request_user_choice` 工具）
- **3 类错误**：参数解析失败 / 工具不存在 / 工具被本轮剪枝
- **重复调用检查**：`checkAndFilterDuplicateCall`
- **特殊工具处理**：`request_user_choice`（v3 marker 数组）/ `validate_sql_fields`（`{content, valid, errors, summary}`）
- **写回顺序**：按 `validToolCalls` 原始顺序（保证 LLM 看到的 tool 顺序与调用顺序一致）
- **★ 12 轮审计修订**：**不**在 helper 内部调 saveRunState（避免与 5.2 节 yield 前的 saveRunState 双重写盘）。saveRunState 由 5.2 节在 `messages.push(assistantMsg)` 之后立即调（与 CC path L1556-1563 顺序 1:1）

### 5.5.5 `recordPendingUserChoices`

**源 inline 代码**：[llm.js:1854-1932](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1854-L1932)

**签名**：
```js
/**
 * 从 execResults 中收集 request_user_choice payload 到 pendingUserChoiceList。
 * 支持 v3 多 marker + 旧版单 marker 兼容。
 * @param {Array} execResults - 来自 executeToolCallsInStages
 * @param {Array} pendingUserChoiceList - **会被修改**：push payload
 * @param {string|null} sessionId - 仅用于日志
 * @param {number} maxPerTurn - 上限（CC path 用 3，Phase 2 handler 也用 3）
 * @returns {number} 新增的 userChoice 数量
 */
export function recordPendingUserChoices(execResults, pendingUserChoiceList, sessionId, maxPerTurn = 3) {
  // 1:1 复制 runSqlAgent L1854-1932
}
```

### 5.5.6 `saveRunState`

**源 inline 代码**：[llm.js:1556-1563](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1556-L1563) + [L1960-1974](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1960-L1974)

**签名**（**★ 12 轮审计修订**：补充 helper 内部**不**含 `messages.push(assistantMsg)` 的说明）：
```js
/**
 * 每轮 LLM 响应后保存状态：
 * - setLastMessages(messages) - 全局缓存（开发调试用，Issue #6 B1）
 * - saveMessagesToDb(sessionId, messages) - DB 持久化（如有 sessionId）
 *
 * ★ 12 轮审计修订：helper 内部**不**包含 `messages.push(assistantMsg)`
 *   原因：CC path 顺序是 L1556 push → L1558 setLastMessages → L1562 saveMessagesToDb
 *   helper 抽取的是 L1558-1563 + L1960-1974（即 setLastMessages + saveMessagesToDb 两步），
 *   不包含 push 操作。**push 的责任在调用方**（5.2 节主函数），
 *   保证调用顺序与 CC path 1:1（push → saveRunState → yield tool → 工具执行）。
 *
 * ★ 12 轮审计修订：helper 复制 CC path L1960-1974 的 user_choice 路径
 *   （TURN 1 终止分支也调 saveMessagesToDb 持久化 tool marker，
 *    Turn 2 load 时能看到）。Phase 2 handler 由 5.2 节在 pendingUserChoiceList.length > 0
 *   break 后**额外**调一次（详见 5.2 节 break 后的逻辑）。
 *
 * @param {string|null} sessionId
 * @param {Array} messages - 假设**已**包含本轮 assistantMsg（push 责任在调用方）
 */
export function saveRunState(sessionId, messages) {
  setLastMessages(messages);
  if (sessionId) {
    try {
      saveMessagesToDb(sessionId, messages);
    } catch (e) {
      // 现有 saveMessagesToDb 内部已有 try/catch + error 日志
      // 但仍可能因异常路径未覆盖（死锁/超时）走到这里
      logger.error("saveRunState: saveMessagesToDb failed", {
        sessionId,
        error: e.message,
      });
    }
  }
}
```

**依赖 import**（`setLastMessages` + `saveMessagesToDb` + `logger` 都已 export / 全局可用）

---

## 6. 共享代码依赖

`runSqlAgentResponsesHandler`（新文件 `responsesApi.js`）与 `runSqlAgent`（[llm.js:1079](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1079)）共享以下工具函数（**0 改动**）：

| 共享 | 来源 | 说明 |
|---|---|---|
| `getLlmConfig` | [services/config.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/config.js) | 读 DB 配置 |
| `loadSkillMd` | [services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js) | 读 SKILL.md |
| `getOrCreateRegistry` | services/llm.js | 注册表获取/创建 |
| `resetPerQuestionRegistryFlags` | services/llm.js | 问题级标志重置 |
| `splitThinkingFromContent` | [services/llm.js:289-310](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L289-L310) | 剥离 LLM 输出前的 thinking 内容，返回 `{content, extraThinking}`（Issue #5 修正）|
| `setLastMessages` | **新增** llm.js export（[llm.js:337-339 后](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L337-L339)）| 写 `lastMessages` 缓存。**纯加法**：0 改动 `runSqlAgent` / `getLastMessages` / L1558 / L335。setter 内部 `lastMessages = JSON.parse(JSON.stringify(msgs))` 与 L1558 深拷贝完全一致（Issue #6 解决 B1）|
| `saveMessagesToDb` | services/llm.js | DB 持久化（如有 sessionId）|

**Step 1.5 抽取的 6 个 agent helper**（新文件 `agentHelpers.js`，**新增不修改**）：

| helper | 来源（runSqlAgent inline）| 说明 |
|---|---|---|
| `initMessagesForRun` | [llm.js:1146-1165](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1146-L1165) | 从 DB 加载历史 + 替换 system + push user。**1:1 抽取**（见 5.5.1）|
| `getPrunedToolsForRun` | [llm.js:1263-1280](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1263-L1280) | 按 registry 状态过滤一次性工具。**1:1 抽取**（见 5.5.2）|
| `getToolCallId` | [llm.js:1577-1579](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1577-L1579) | 防御性 fallback id 生成。**1:1 抽取**（见 5.5.3）|
| `executeToolCallsInStages` | [llm.js:1565-1933](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1565-L1933) | 3 阶段工具执行（prepared / Promise.all execResults / 写回 messages）。**1:1 抽取**（见 5.5.4）|
| `recordPendingUserChoices` | [llm.js:1854-1932](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1854-L1932) | 收集 request_user_choice payload（v3 marker 数组 + 旧版兼容）。**1:1 抽取**（见 5.5.5）|
| `saveRunState` | [llm.js:1556-1563](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1556-L1563) + [L1960-1974](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1960-L1974) | setLastMessages + saveMessagesToDb 封装。**1:1 抽取**（见 5.5.6）|

**关键 audit 结果**（Step 1 audit 已完成）：

| Audit 点 | 结论 |
|---|---|
| `executeToolCall`（之前假设的）| **不存在函数**——实际是 inline 3 阶段逻辑（L1565-1933）。已抽取为 `executeToolCallsInStages` helper |
| `buildMessagesForLLM`（之前假设的）| **不存在函数**——实际是 inline（L1146-1165）。已抽取为 `initMessagesForRun` helper |
| `getPrunedToolsForRound`（之前假设的）| **不存在函数**——实际是 inline（L1263-1280）。已抽取为 `getPrunedToolsForRun` helper |
| Zod → JSON Schema 转换 | **已在 LangChain 内部**：CC path 用 `t.lc_kwargs.params`（[llm.js:1120](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1120)），**不需要** `zod-to-json-schema` 库 |
| 工具执行是否串行？ | **是并行**（`Promise.all`，[llm.js:1672](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1672)）。Phase 2 helper 必须保持并行 |
| `request_user_choice` 终止信号 | **必须实现**：[llm.js:1935-1936](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1935-L1936) 检测到 `pendingUserChoiceList.length > 0` 时 break |
| `saveMessagesToDb` 调用时机 | **每轮循环后都写**（[llm.js:1562](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1562)），不只是终态。Phase 2 helper 必须保持 |
| DeepSeek 文档：完整事件数 | **16+** 个（plan 之前只列 9 个，**新发现 7+ 缺失**）|
| DeepSeek 文档：usage 字段 | `input_tokens` / `output_tokens` + `input_tokens_details.cached_tokens` + `output_tokens_details.reasoning_tokens`（plan 之前误用 `prompt_tokens`/`completion_tokens`）|
| DeepSeek 文档：`max_tool_calls` | **忽略**（DeepSeek 始终并行工具调用，token 限制走 `max_output_tokens`）|
| DeepSeek 文档：`parallel_tool_calls` | **始终开启**（LLM 可在一轮内并行调多个工具）|
| DeepSeek 文档：`stream_options` | **不支持**（不能加 `include_usage: true`）|

---

## 7. F14 路由侧改动（Q2 选 C：**单行委派 + 新文件封装**）

### 7.1 总体策略：完全独立 + 0 改动原 try 块

依据第 1.4 节"完全独立"原则（C 方案）：
- F14 占位符**位置不变**（L388-400）
- 占位符**逻辑替换**为：**单行委派** → 调 `runSqlAgentResponsesHandler(req, res, sessionId, username, abortController)`
- **原 try 块（L403+）0 改动**
- 所有新逻辑（for-await / SSE / DB / catch）封装在新文件 `responsesApi.js` 内的 handler 函数中

### 7.2 当前 F14 占位结构（[query.js:388-400](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L400)）

```js
// F14 当前：responses_api 模式占位（早退 + 错误提示）
const llmCfgForDispatch = getLlmConfig();
if (llmCfgForDispatch?.apiMode === 'responses_api') {
  const placeholderMsg = 'Responses API 暂未实现，请切换为 Chat Completions API';
  logger.info('API mode dispatch → responses_api (placeholder)', { ... });
  res.write(`data: ${JSON.stringify({ type: 'error', content: placeholderMsg })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done', sql: '', message: placeholderMsg })}\n\n`);
  res.end();
  return;
}
```

### 7.3 改后结构（**5 行单行委派** + CC path 0 改动）

```js
// ★ F14 + Phase 2：responses_api path 5 行委派 → 独立 handler
//   CC path（L403+）0 改动。完全独立原则（见 1.4 节）。
// ★ 硬约束 9 继承 F9 修复：meta 事件（含 sessionId）已在 L376-381 提前下发，handler 不需再写
const llmCfgForDispatch = getLlmConfig();
if (llmCfgForDispatch?.apiMode === 'responses_api') {
  logger.info('API mode dispatch → responses_api', { sessionId, username: req.user?.username });
  await runSqlAgentResponsesHandler(req, res, sessionId, req.user.username, abortController);
  return;  // ★ 重要：不落入 CC path
}

// ↓↓↓ CC path 0 改动（L403+ 原代码完全不动）↓↓↓
try {
  const generator = runSqlAgent(question, historyText, abortController.signal, sessionId, req.user.username);
  // ... 原代码 100% 不动 ...
} catch (e) { /* 原代码 100% 不动 */ }
```

**F14 位置总改动量：13 行 → 5 行有效改动**（删 7 行 placeholder + 加 5 行委派）。

### 7.4 新文件结构（**封装代替重复**）

新增 [`backend/src/services/responsesApi.js`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/responsesApi.js)（**待创建**）：

```
backend/src/services/responsesApi.js
├─ 4 个内部辅助函数（不导出）
│   ├─ getToolsForResponsesApi(tools)              # 见 4.1
│   ├─ messagesToInputItems(messages)              # 见 4.2
│   ├─ parseResponsesStream(body, signal)          # 见 4.3（async generator）
│   └─ translateResponsesEvent(event)              # 见 4.4
├─ 1 个内部 LLM-level generator（不导出）
│   └─ _runSqlAgentResponsesStreamGen(...)         # 见 5.2 伪代码
└─ 1 个导出 handler（路由层唯一入口）
    └─ runSqlAgentResponsesHandler(req, res, ...)  # 见 5.1 伪代码
```

**文件规模预估**：
- 4 个辅助函数：~120 行
- LLM-level generator：~150 行
- Handler（for-await + SSE + DB + catch）：~130 行
- **总计约 400 行新代码，全部在 1 个新文件**

### 7.5 重复代码清单（**接受**的代价）

虽然新代码封装在新文件，但**业务逻辑**与 CC path 物理重复（不能共享 helper）：

| 重复项 | 行数（估） | 来源 | 位置 |
|---|---|---|---|
| 变量定义 | ~10 行 | query.js L405-419 | responsesApi.js handler |
| for-await 类型分派 | ~60 行 | query.js L421-470 | responsesApi.js handler |
| SSE 写入 | ~5 行 | query.js L463+ | responsesApi.js handler |
| for-await 后处理 | ~40 行 | query.js L470+ | responsesApi.js handler |
| catch 块 | ~20 行 | query.js L520+ | responsesApi.js handler |
| **小计** | **~130 行** | （CC path 现有）| （Responses handler 重复）|

**接受理由**（详见 1.4 节）：
- 0 改动原 try 块 = 0 回归风险
- 完全隔离 = Responses 出错不影响 CC
- **集中在新文件**，review 友好

### 7.6 同步策略（避免后续 drift）

| 场景 | 应对 |
|---|---|
| CC path 业务逻辑变更 | 不自动同步到 Responses handler。**记录**到 [docs/执行流程.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/执行流程.md) 后续章节 |
| 用户切到 Responses API 后发现行为不一致 | 临时回切到 CC API，立即排查 |
| Responses handler 自身 bug | 不影响 CC 0 改动；handler 内修复 |

**长期方案**（**不在本计划**）：如果 Responses handler 跑稳了，**未来某个 Phase** 可以考虑把 for-await 抽到共享 helper。但**今天不抽**，遵守"完全独立"原则。

### 7.7 回滚方案（如 Phase 2 出问题）

```bash
# 1. 删除新文件
rm backend/src/services/responsesApi.js

# 2. 还原 F14 位置（5 行委派 → 13 行 placeholder）
#    编辑 query.js L388-400，把 if 块还原成原占位逻辑

# 3. 验证 CC path 不受影响
npm test  # 现有 258 个测试应全部通过
```

回滚成本：**2 个文件 + 1 个文件**，**约 30 分钟**。

---

## 8. 测试策略

### 8.1 新测试清单（6 个文件）

| 测试文件 | 覆盖范围 | 断言数（估计）|
|---|---|---|
| `test-agent-helpers.mjs`（**Step 1.5 回归保护**）| 6 个 agent helper 单元测试：initMessagesForRun / getPrunedToolsForRun / getToolCallId / executeToolCallsInStages / recordPendingUserChoices / saveRunState。**核心**：与原 inline 行为等价 | ~30 |
| `test-responses-messages-conversion.mjs` | `messagesToInputItems` 7 种消息类型：system/user/assistant+text/assistant+tool_calls/tool、空 messages、多 system 拼接 | ~15 |
| `test-responses-tools-conversion.mjs` | `getToolsForResponsesApi` 工具转换：基本转换、空数组、嵌套 schema | ~8 |
| `test-responses-stream-parser.mjs` | `parseResponsesStream` + `translateResponsesEvent` 16+ 事件类型 + F11 buffer 模式 + `async function*` yield 协议 | ~25 |
| `test-run-sql-agent-responses-handler.mjs` | **`runSqlAgentResponsesHandler` 端到端**：mock `req`/`res` + mock `_runSqlAgentResponsesStreamGen` + 验证 SSE 写入 + 变量累积 + 收尾逻辑 + **单轮并行 2 工具 case**（Issue #1 验证）| ~17 |
| `test-route-apimode-responses.mjs` | F14 分流 + 5 行委派：`apiMode='responses_api'` 调新 handler、CC path 0 触碰 | ~10 |
| **小计** | | **~105** |

### 8.2 必加的"独立路径隔离"测试

依据 1.4 节"完全独立"原则，新增 4 类专项测试：

| 测试场景 | 验证目标 | 文件 |
|---|---|---|
| **CC path 回归** | F14 + Phase 2 改完后，`apiMode='chat_completions'` 时**完全**走原 try 块，**不**触碰新 handler | 复用现有 `test-route-apimode-dispatch.mjs`，加 2-3 个 case |
| **Responses path 错误隔离** | `apiMode='responses_api'` + handler 抛错 → **不影响** CC path | `test-route-apimode-responses.mjs` |
| **路径互斥** | 同一请求中，CC path 触发 → Responses handler 不应执行（反之亦然）| `test-route-apimode-responses.mjs` |
| **变量作用域隔离** | 各自 path 的 `fullContent` / `sql` 等变量互不污染 | `test-route-apimode-responses.mjs` |

### 8.3 现有 258 个测试 0 改动

依据 1.4 节"测试层"原则：

| 现有测试 | 状态 |
|---|---|
| F9-F16 全部回归测试 | **0 改动** |
| F14 路由侧分流测试 (`test-route-apimode-dispatch.mjs`) | **不**触碰 CC path 行为测试，仅在末尾**追加**"独立路径隔离"case |

### 8.4 测试模式

参考 F11-F16 已有测试：
- 纯函数（`messagesToInputItems` / `translateResponsesEvent`）：直接调用 + 断言返回值
- 流式函数（`parseResponsesStream`，async generator）：mock `ReadableStream` 输入 + 收集 yield 事件
- LLM-level generator（`_runSqlAgentResponsesStreamGen`）：mock `global.fetch` 返回 fake stream
- Handler（`runSqlAgentResponsesHandler`）：mock `req`/`res` + mock 内部 generator + 断言 SSE 写入
- 路由层（F14）：mock `req` / `res` / `getLlmConfig`

---

## 9. 实施顺序

| Step | 内容 | 工时 | 风险 |
|---|---|---|---|
| **0** | **audit** 已完成（Step 1）：读 2 篇 DeepSeek 文档 + 4 个代码层 audit 点（[Step 1 报告](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md#step-1-audit)）| 已完成 | — |
| **1.5** | **抽取 6 个 agent helper**（新文件 `agentHelpers.js`，5.5.1-5.5.6 节）| 3-4h | 中 |
| **2** | 写 4 个 Responses 辅助函数（4.1-4.4：`getToolsForResponsesApi` / `messagesToInputItems` / `parseResponsesStream` / `translateResponsesEvent`）| 2-3h | 中 |
| **3** | 创建新文件 `responsesApi.js`：写 `_runSqlAgentResponsesStreamGen` 内部 LLM-level generator（5.2 节）| 2-3h | 中 |
| **4** | 在 `responsesApi.js` 写 `runSqlAgentResponsesHandler`（for-await + SSE + DB + catch，5.1 节）| 1-2h | 中 |
| **5** | 改 F14 分流：5 行委派（[query.js:388-400](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L400)）| 0.5h | 低 |
| **6** | 写 5+1 个测试文件（4 个 Responses helper 测试 + 1 个 handler 测试 + 1 个 agentHelper 回归测试）| 3-4h | 中 |
| **7** | 更新 `docs/执行流程.md` 第 4 章节 | 0.5h | 低 |
| **总计** | | **~12-17h** | |

### 9.1 Step 1.5 agent helper 抽取清单

> **关键约束**（1.4 节红线）：helper 内部代码 = `runSqlAgent` 对应 inline 逻辑 **1:1 复制**。

| helper | 源 inline | 抽取策略 | 单元测试要点 |
|---|---|---|---|
| `initMessagesForRun` | [L1146-1165](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1146-L1165) | 提取 `messages` 变量为 return value；DB 加载 + 替换 + push 全部保留 | 4 个 case：sessionId=null / sessionId 有 + DB 空 / sessionId 有 + DB 有历史 / system 消息不在 |
| `getPrunedToolsForRun` | [L1263-1280](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1263-L1280) | 提取 `pruneReg` 内部计算 | 3 个 case：sessionId=null / get_domain_index 已调用 / get_sliced_index 加载过域 |
| `getToolCallId` | [L1577-1579](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1577-L1579) | 1:1 复制 | 2 个 case：tc.id 存在 / 不存在 |
| `executeToolCallsInStages` | [L1565-1933](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1565-L1933) | 3 阶段 1:1 复制；ctx 参数化所有隐式依赖 | **核心回归测试**：跑所有现有 258 个测试 + agentHelper-specific 测试（工具不存在/参数解析失败/工具被剪枝/重复调用/并行 2 工具）|
| `recordPendingUserChoices` | [L1854-1932](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1854-L1932) | 1:1 复制 | 4 个 case：v3 多 marker / 旧版单 marker / 超过 maxPerTurn / 非 request_user_choice 工具 |
| `saveRunState` | [L1556-1563](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1556-L1563) + [L1960-1974](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1960-L1974) | 合并两处为单 helper；加 try/catch 包裹 saveMessagesToDb | 3 个 case：sessionId=null / sessionId 有 / saveMessagesToDb 抛错 |

### 9.2 Step 1.5 → Step 2 衔接

| 顺序 | 步骤 | 说明 |
|---|---|---|
| 1.5 → 2 | agentHelper 单元测试**全部通过** | **必须**：跑全部 helper 测试 + 现有 258 个测试**全 pass** 才能进入 Step 2 |
| 2 → 3 | 4 个 Responses 辅助函数 + 单元测试通过 | — |
| 3 → 4 | `_runSqlAgentResponsesStreamGen` 与 `runSqlAgent` **行为对齐**（mock 测试）| — |
| 4 → 5 | handler 端到端测试通过 | — |
| 5 → 6 | F14 路由改完 | — |
| 6 → 7 | 测试全 pass | — |

**★ 12 轮审计修订：测试可信度澄清**

| 现状 | 风险 | 必需补充 |
|---|---|---|
| 现有 258 个测试**只覆盖 `runSqlAgent` inline 路径**，**不**触发 `agentHelpers.js` 里的任何代码 | 跑通 258 个测试**不能**证明 helper 行为与 inline 等价 | **必须**单独写一组"走 helper 路径"的端到端测试：mock `loadMessagesFromDb` / `saveMessagesToDb` / `getOrCreateRegistry` 等依赖，**直接调** 6 个 helper，断言返回值与 inline 1:1 一致 |
| helper 抽取是**双份代码**（inline + helper 共存），不是迁移 | helper 与 inline 物理分离后，inline 改了 helper 不会自动同步 | helper 单元测试**必须**包含一段 inline 实现的"参考断言"作为对照（即使冗余）|
| `executeToolCallsInStages` 是最大 helper（~370 行），含 6+ 个闭包依赖 | 1:1 复制遗漏的概率最高 | **必须**为此 helper 单独写"inline 路径 vs helper 路径"diff 测试（mock 同一 LLM 输出 + 同一工具状态，对比 execResults 数组完全一致）|
| Step 6 测试 6 个文件中 4 个测 Responses helper / 1 个测 handler / 1 个测 F14 委派 | **没有** 1 个测试直接覆盖 agentHelpers.js 的执行 | **必须**新增 `test-agent-helpers-execution.mjs`（独立于 `test-agent-helpers.mjs`），跑通全部 6 个 helper 真实调用 + 边界场景 |

**结论**：1.5 → 2 的"全部测试通过"门禁**必须**包括"helper 端到端测试"（不是单纯的"现有 258 个测试 + helper 单元测试"）。否则 1.5 → 2 准入门禁**形同虚设**。

### 9.3 Step 1 audit checklist（已完成）

- [x] 读 2 篇 DeepSeek 官方文档（create-response + responses_api 流式指南）
- [x] 检查 package.json 是否有 zod-to-json-schema（**无，已用 LangChain 内部 `t.lc_kwargs.params`**）
- [x] 检查 `buildMessagesForLLM` 是否存在（**不存在，已抽取为 `initMessagesForRun`**）
- [x] 检查 `getPrunedToolsForRound` 是否存在（**不存在，已抽取为 `getPrunedToolsForRun`**）
- [x] 检查 `executeToolCall` 是否存在（**不存在，已抽取为 `executeToolCallsInStages`**）
- [x] 检查 assistantMsg.tool_calls 累积格式（**CC 嵌套格式，Responses 顶层 `call_id`，4.4 节做 1 行映射**）

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| ~~`executeToolCall` 实际依赖 `id` 字段~~ | ~~中~~ | ~~高~~ | **已 audit：不依赖**。Q1 在 4.4 节用 1 行 `call_id → id` 映射解决。 |
| DynamicTool → Responses API 工具格式不一致 | 中 | 中 | 写 4.1 时实测；如需调整 `strict` 等字段，加测试 |
| 多轮 `call_id` 在某些 Responses 事件中缺失 | 低 | 中 | 用累积状态兜底（`pendingToolCalls` Map）|
| 推理事件流式顺序与 CC 不同 | 低 | 低 | 前端只关心 chunk/reasoning_chunk 类型，不关心顺序 |
| `splitThinkingFromContent` 在 Responses API 输出失效（4 个触发条件不一定全满足）| 低 | 低 | Step 1 audit 实测；若失效，降级为不做剥离（`extraThinking=""`，不影响 done.sql/message 行为） |
| 流式事件总数 > 16 种，遗漏某些类型 | 中 | 中 | Step 1 列出全部事件类型；遗漏的事件 `translateResponsesEvent` 返回 null（无害）|
| ~~F14 try 块上移后 generator 创建时机问题~~ | ~~低~~ | ~~低~~ | **Q2 选 C：不上移 + 单行委派**。完全独立 + 0 改动原 try 块。 |
| Zod → JSON Schema 转换库未安装 | 中 | 中 | 检查 `package.json`；如缺装 `zod-to-json-schema` 或复用 LangChain 内部工具 |
| **新增**：`call_id` 实际格式与文档示例不符 | 低 | 中 | 写 4.4 时拿一个真实响应样本（curl）核对；如发现差异，调整映射字段名 |
| **新增（Q2 选 C 后）**：handler 130 行业务逻辑与 CC path 物理重复 → 后续 CC path 业务变更可能不同步 | 中 | 低 | 1.4 节同步策略：变更 CC 时手动记录到 docs/执行流程.md 决策日志；不回自动同步到 Responses handler（防止动到原代码）|
| **新增（Q2 选 C 后）**：新文件 ~400 行集中在 1 个文件，code review 一次性 review 量大 | 低 | 低 | 拆 5.0 节子节结构（4 个 helper + 1 个 generator + 1 个 handler），分模块 review |
| **Issue #1 解决**：`pendingToolCall`（单数）→ `pendingToolCalls`（Map），按 `call_id` 分桶累积 | — | — | 5.2 节已修订。LLM 单轮可并行调多个工具（如 `get_table_schema` + `get_domain_index`），单数变量会被覆盖导致工具静默丢失。新方案用 `Map<call_id, ToolCall>` 与 CC path L1438-1458 `streamToolCalls` 数组行为对齐 |
| **Issue #3 解决**：硬约束 9 / 10 强制继承 F9 / F11 修复模式 | — | — | 1.1 节关联修复段 + 1.4 节硬约束 9/10 + 4.3/5.3 节显式引用 F11 + 7.3 节 handler 委派 + 5.3 节 abort 检查。**F9 是 C 方案天然继承**（meta 事件在 route 层写），**F11 是主动约束**（parseResponsesStream 4.3/5.3 节复用 buffer 模式）|
| **Issue #4 解决**：async generator 不自动响应 abort signal | — | — | 4.3 节 `if (signal?.aborted)` 检查（Issue #1 修订时已加）+ 5.3 节伪代码补 abort 检查 + 5.2 节主函数加 abort 链路说明。**主机制**：fetch 的 signal 传播关闭 body.stream；**冗余安全网**：async generator 内显式 `if (signal?.aborted)` 防 signal 传播延迟 |
| **Issue #5 修正**：plan 误把 `extractSqlFromContent` 当成共享函数 | — | — | 实际**不存在**该函数。CC path 的 `done` 事件 `sql=""`（[llm.js:2025](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L2025)），**SQL 提取在前端**（[markdownRenderers.jsx:70-95](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/components/markdownRenderers.jsx#L70-L95)）。同时新增**真正共享的** `splitThinkingFromContent`（[llm.js:289-310](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L289-L310)），用于剥离 thinking + yield `message_final` 事件 |
| **Issue #6 解决**（B1 方案）：Phase 2 也写 `lastMessages`（行为对齐 CC） | — | — | `runSqlAgentResponsesHandler` 调 `setLastMessages(messages)`（新增的 llm.js export setter，**纯加法**，0 改动 `runSqlAgent` / `getLastMessages` / L1558 / L335）。**不**是行为差异。**为什么 B1 是纯加法**：① `runSqlAgent` 函数体不动；② 现有 setter 调用 `lastMessages = JSON.parse(JSON.stringify(msgs))`（与 L1558 深拷贝完全一致）；③ admin 调试 Responses 路径也能看到 lastMessages |
| **Step 1.5 helper 抽取 1:1 复制遗漏** | 中 | 高 | 6 个 helper 全部 + 现有 258 个测试**必须全 pass**（跑测试是唯一回归保护）|
| **Step 1.5 helper 抽取遗漏闭包依赖** | 中 | 高 | 1:1 复制 inline 代码 → 提取变量为 ctx 参数 → **逐个验证** 隐式依赖（closure / module-level 变量）已全部参数化 |
| **Step 1.5 `executeToolCallsInStages` 行为变化** | 中 | 高 | **核心回归测试**：跑 258 个测试 + agentHelper-specific 测试。**回归保护**：helper 与原 inline 是**双份代码**（不是迁移），行为变化仅影响新 helper，原 inline 继续工作 |
| **12 轮审计 / Q1 修复副产物**：工具事件类型对齐前端契约（tool/tool_return + log 风格）| 中 | 中 | 5.1 / 5.2 节伪代码已改为 CC path 风格（`{type:'tool', log:'🔧 调用工具: xxx'}` + `{type:'tool_return', log:'📋 工具 xxx 返回: ...'}`），与 [App.jsx:859-904](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L859-L904) 现有 case 完全匹配。**风险点**：前端 `request_tag_confirmation` 弹窗链路（[App.jsx:863-879](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L863-L879)）依赖 `data.type === 'tool' + logContent.includes('request_tag_confirmation')`——Responses path 的 `tool` 事件 log 字符串**也包含** `request_tag_confirmation`（因为 LLM 调用该工具时 generator 拼装 log 格式与 CC 一致），前端能正常识别。**但**：Phase 2 暂未实现 `request_tag_confirmation` 工具调用，**Phase 2 范围 0 行为影响**（如未来扩展到该工具，需 E2E 测试覆盖）|
| **12 轮审计 / 工具事件 log 格式 1:1 对齐**：5.2 节 L953-967 / L988-998 拼装的 log 字符串**必须**与 CC path [llm.js:1517-1530](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1517-L1530) + [L1844-1848](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1844-L1848) **字符级 1:1 对齐**（emoji 前缀 / 换行 / 参数 JSON 序列化）| 中 | 中 | 单元测试断言 log 字符串与 CC path 完全一致；前端 UI 折叠展示无差异 |
| **12 轮审计 / `userChoiceRequestFromStream` 必须保留**：5.1 节 handler 必须有该变量（不能删）| 高 | 高 | 与 CC path [query.js:420](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L420) 1:1——`done` 事件不能立即写 SSE，必须累积后 for-await 结束写最终 `doneData.user_choice_request` |
| **12 轮审计 / `availableToolNames` 字段名**：helper 5.5.4 输入 `availableToolNames` 必须是 `prunedTools.map(t => t.function.name)` 集合（**不是** `t.name`）| 高 | 高 | 5.2 节 L974-980 已修正：`prunedTools.map(t => t.function.name)`；CC path L1571-1573 1:1 对齐。**测试**：在 helper 单元测试里 mock `toolsDefinition` 含 `t.function.name` 字段，断言"幻觉调用"拦截逻辑正确触发 |
| **12 轮审计 / `saveRunState` 调用时机**：必须在 `messages.push(assistantMsg)` **之后**立即调（CC path L1556-1563 顺序），**不**是在工具执行后 | 中 | 中 | 5.2 节 L945-951 已修正。CC path 的设计：DB 保存"有 assistantMsg + 无 tool_message"状态——这是 CC path 自身设计需 1:1 复制。**测试**：mock `saveMessagesToDb` 在 helper 内部**不**被调，5.2 主函数 yield tool 之前被调 |
| **12 轮审计 / helper 路径不写盘**：5.5.4 `executeToolCallsInStages` 内部**不**调 saveRunState | 中 | 中 | 5.5.4 JSDoc + 关键点已明确。**测试**：mock `saveRunState` / `saveMessagesToDb`，断言 helper 阶段 1-3 都不调 |
| **13 轮审计 / 方案 1 三者并存冗余**：reasoning 内容同时存 3 处（独立 log 消息 + assistantMsg.reasoning_content 字段 + done 事件 reasoning 字段）| 低 | 低 | **接受 30% 冗余**换取**思考过程可见性 + 0 行为差异**。每条 reasoning 截断 10000 字符（CC path L1504 1:1），单条平均 < 1KB，DB 增量可接受。**测试**：单元测试断言每条 reasoning 调用 INSERT 3 次（reasoning_done INSERT + assistantMsg.reasoning_content 字段 + done 事件 SSE 透传），幂等去重**不**做（DB 留冗余可观测）|

---

## 11. 3 个开放问题全部解决（Q1 解决 + Q2=C + Q3=A）

> 2026-08-07 更新：**所有开放问题已解决**，可进入实施阶段。

### ~~Q2：F14 路由侧改动的实现方式~~（已解决，2026-08-07）

**最终方案：C（单行委派 + 新文件封装）**。

依据用户追问"能否不改动，完全新写个？"（2026-08-07），C 方案优于 B 方案：
- 不在 query.js 里复制 130 行 try 块
- 创建独立新文件 `backend/src/services/responsesApi.js`
- 新文件只导出 1 个函数 `runSqlAgentResponsesHandler`
- F14 位置替换为 5 行委派

**核心优势**（详见 1.4 节 + 第 7 节）：
- 0 改动原 try 块 = 0 回归风险
- 完全隔离 = Responses 出错不影响 CC
- **封装代替重复**：130 行集中在新文件，**review 友好**
- 路由改动 130 行 → 5 行

### Q3：多轮 `max_tool_calls` 失败兜底（已解决，2026-08-07，**选 A**）

**最终方案：A（完全对齐 CC 行为）**。

依据用户拍板（2026-08-07），**`runSqlAgentResponsesHandler` 沿用 CC 的"不重试 + messages 不持久化"模式**。

具体含义：

| 维度 | CC 行为（runSqlAgent）| Responses 行为（runSqlAgentResponsesHandler，**对齐**）|
|---|---|---|
| 流中断（断网/abort） | catch → 写 error+done 事件 | **完全相同** |
| messages 数组 | 内存累积，请求结束 GC | **完全相同** |
| 用户重发 | 全新 Round 1 | **完全相同** |
| 跨请求重试 | **不重试** | **不重试** |
| 工具结果缓存 | **不缓存** | **不缓存** |
| messages 持久化 | **不持久化** | **不持久化** |

**为什么选 A**：

- ✅ **0 新增复杂度**：直接照搬现有 catch 逻辑 + 现有流处理
- ✅ **0 行为差异**：两个 API path 行为完全一致
- ✅ **符合 1.4 节"完全独立"原则**（行为对齐也是独立性的体现 — 不会让用户产生"切 API 模式行为变了"的困惑）
- ✅ **0 新增风险**：避免引入重试/缓存/持久化带来的并发问题

**被否定的 B/C 选项**（仅作记录，**不实施**）：

| 选项 | 否决理由 |
|---|---|
| B. 加工具结果缓存 | +1-2h 实现；与 CC 行为不一致；TTL + 内存管理复杂度 |
| C. messages 数组持久化 | +3-5h 实现；需新增 DB 表 + 序列化 + 重试端点；与 CC 行为不一致；与 F9 修复方向（轻量级 session 体验）冲突 |

**留待未来（如有需要）**：
- 跨请求重试 / 持久化是**产品级**决策，**不在 Phase 2 范围**
- 如果未来需要此功能，**两个 API path 同步加**（不打破"完全独立"原则）

---

## 12. 验收标准

实施完成后，下列检查项必须全过：

### 12.1 功能验收

- [ ] 选 `apiMode='responses_api'` + `model='deepseek-v4-flash'` → 真实调通 DeepSeek Responses API
- [ ] 选 `apiMode='chat_completions'` → 行为完全不变（与 Phase 1 一样）
- [ ] 选 `apiMode='responses_api'` + 切回 `chat_completions` → 即时生效
- [ ] 多轮 tool calling 在 Responses API 下正常
- [ ] 推理（reasoning）正常显示
- [ ] abort/超时/网络断连 处理一致

### 12.2 测试验收

- [ ] 5 个新测试文件全过（~73 个新断言）
- [ ] 现有 258 个测试全过（F9-F16 回归）
- [ ] 前端 `npm run build` 通过

### 12.3 文档验收

- [ ] `docs/执行流程.md` 第 4 章节更新：
  - `runSqlAgent` 章节保持不变（标注 "Phase 1 默认稳定路径"）
  - **新增** `runSqlAgentResponsesHandler` 章节：双 path 架构图 + 完全独立原则 + C 方案（新文件 + 单行委派）+ handler 重复代码说明
- [ ] `README.md` 第 7 章节"项目结构"补充 `responsesApi.js`（如有此章节）
- [ ] 本计划文档归档为 `2026-08-06-run-sql-agent-responses-plan.md`（**修订记录完整反映 Q1 解决 + Q2 选 C 升级 + Q3 选 A + 完全独立原则**）

### 12.4 文件清单（C 方案 + Step 1.5 helper 抽取策略）

| 文件 | 状态 | 说明 |
|---|---|---|
| `backend/src/services/agentHelpers.js` | **新建**（Step 1.5）| 6 个 export helper（5.5.1-5.5.6 节）：`initMessagesForRun` / `getPrunedToolsForRun` / `getToolCallId` / `executeToolCallsInStages` / `recordPendingUserChoices` / `saveRunState`。**1:1 复制** `runSqlAgent` inline 逻辑（[L1146-1933](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1146-L1933)）|
| `backend/src/services/responsesApi.js` | **新建**（Step 2-4）| 1 个导出函数 `runSqlAgentResponsesHandler` + 4 个内部 helper（4.1-4.4）+ 1 个内部 LLM-level generator（5.2）。**依赖** `agentHelpers.js` 的 5 个 helper（H3-H5）+ `initMessagesForRun` / `getPrunedToolsForRun` |
| `backend/src/services/llm.js` | 0 改动 `runSqlAgent` | 但**新增** `setLastMessages` export（Issue #6 B1，纯加法）|
| `backend/src/routes/query.js` | 改 1 处 | F14 占位符位置（[L388-400](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L388-L400)）：13 行 placeholder → 5 行委派 |
| `backend/src/routes/config.js` | 0 改动 | F13 已完成 |
| `frontend/src/components/ConfigPanel.jsx` | 0 改动 | F13 已完成 |
| `docs/superpowers/plans/2026-08-06-run-sql-agent-responses-plan.md` | 新建 | 本计划文档（**修订记录完整反映 Q1 解决 + Q2 选 C 升级 + Q3 选 A + Step 1.5 helper 抽取策略**）|
| `docs/执行流程.md` | 改 1 处 | 第 4 章节补充新章节 |
| **总计改动** | **3 文件改 + 2 文件新建** |（`runSqlAgent` 函数体 0 改动 + L403+ CC path try 块 0 改动）|

---

## 13. 关联文档

- [F16 重命名记录](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1067-L1078)
- [F14 路由侧分流](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401)
- [F13 apiMode 配置层](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/config.js#L78-L90)
- [docs/执行流程.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/执行流程.md) 第 4 章
- [DeepSeek Responses API 文档](https://api-docs.deepseek.com/zh-cn/api/create-response)
- [DeepSeek Responses API 流式指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api)

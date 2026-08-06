# Phase 2 — `runSqlAgentResponses` 实施计划

> **状态**：📝 计划中（等用户 review）
> **创建时间**：2026-08-06
> **关联 F16**：[`generateSQLWithLangChainStreamGen_BAK` → `runSqlAgent` 重命名](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1066-L1085)
> **关联 F14**：[路由侧 `apiMode` 分流占位](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401)

---

## 1. 背景

### 1.1 现状

`runSqlAgent`（[llm.js:1079](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1079)）使用 DeepSeek **Chat Completions API**（`/chat/completions`）作为 SQL 生成的核心入口。该函数是多轮 tool-calling agent，通过 `async function*` 协议 yield 11 种事件给前端流式显示。

用户配置 LLM 时可选择 **API 名称**（`apiMode`）：
- `chat_completions`（默认）→ 走 `runSqlAgent`
- `responses_api` → 当前是 [占位错误](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401)，返回 "暂未实现" 提示

### 1.2 目标

实施 **Phase 2**：实现 `runSqlAgentResponses` 函数，使用 DeepSeek **Responses API**（`/responses`）替代 Chat Completions。完成后用户可真正选择 Responses API 模式。

### 1.3 硬约束（再次确认）

| # | 约束 | 理由 |
|---|---|---|
| 1 | `runSqlAgent` 0 改动 | 继续作为默认稳定路径，0 回归风险 |
| 2 | `runSqlAgentResponses` 与 `runSqlAgent` 函数签名一致 | 路由层 0 改动（除了 F14 替换 placeholder）|
| 3 | 路由层 0 改动（除 F14 分流）| 避免影响其他调用方 |
| 4 | 前端 0 改动 | 内部 yield 事件契约完全一致 |
| 5 | 不做模型校验 | F14 阶段已确认（未来更多模型支持，校验会过期）|
| 6 | `docs/superpowers/reviews/` 与 `docs/superpowers/specs/` 不动 | 历史 review/spec 改了就失真 |
| 7 | `docs/执行流程.md` 第 4 章节更新 | 这是 active 维护的执行流程文档 |

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
| `response.function_call_arguments.delta` | **不直接 yield** | 累积到 `pendingToolCall.arguments`（key 为 `call_id`）|
| `response.output_item.done` (item.type=function_call) | `{type:'tool_call', id: call_id, name, arguments}` | 整组工具参数就绪，触发工具执行 |
| 工具执行完成 | `{type:'tool_result', id, name, result}` | yield 工具结果 |
| `response.completed` | `{type:'usage', prompt_tokens, completion_tokens, total_tokens}` + `{type:'done', ...}` | 终结（含 SQL 提取）|
| `response.failed` | `{type:'error', content: event.response.error.message}` + `{type:'done', error:true}` | 终结 |
| `response.incomplete` | `{type:'error', content:'Response incomplete (token limit)'}` + `{type:'done', error:true}` | 终结 |
| 任何 `error` 事件 | `{type:'error', content}` | 透传 |

**字段名约定**：内部事件的 `id` 字段统一指向工具调用的唯一标识符。
- Chat Completions 来源：`tool_calls[].id`
- Responses API 来源：`call_id`
- **对前端透明**（前端用 `id` 配对 tool_call 和 tool_result，不关心来源）

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
    // DynamicTool.schema 是 Zod schema，需要 zod-to-json-schema 转换
    parameters: zodToJsonSchema(t.schema),
  }));
}
```

**难点**：DynamicTool.schema 是 Zod schema，需要转 JSON schema。需先 audit 现有 Chat Completions 路径如何转换（如有），优先复用。

### 4.2 `messagesToInputItems(messages)`

```js
/**
 * 把 Chat Completions 风格 messages 转成 Responses API 的 {instructions, input}
 * @param {Array} messages - 现有 buildMessagesForLLM 输出
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

### 4.3 `parseResponsesStream(body, signal, yieldFn)`

```js
/**
 * 流式消费 Responses API 返回，按事件翻译
 * ★ 复用 F11 修复模式：buffer + stream: !done 防止 UTF-8/行切分丢数据
 */
async function parseResponsesStream(body, signal, yieldFn) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamCompleted = false;

  try {
    while (true) {
      if (signal?.aborted) {
        yieldFn({ internalType: 'error', content: '请求已被用户中断' });
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
            streamCompleted = true;
            continue;
          }
          try {
            const event = JSON.parse(data);
            const internal = translateResponsesEvent(event);
            if (internal) yieldFn(internal);
          } catch (e) {
            // 静默（流式偶发 JSON 解析失败是正常的，不影响整体）
          }
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      yieldFn({ internalType: 'error', content: '请求已被用户中断' });
    } else {
      yieldFn({ internalType: 'error', content: `Stream read error: ${e.message}` });
    }
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
        id: event.item.call_id,
        name: event.item.name,
        arguments: event.item.arguments,  // 累积后的完整 JSON 字符串
      },
    };
  }
  if (type === 'response.completed') {
    return {
      internalType: 'usage',
      prompt_tokens: event.response?.usage?.input_tokens || 0,
      completion_tokens: event.response?.usage?.output_tokens || 0,
      total_tokens: event.response?.usage?.total_tokens || 0,
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

## 5. 主函数 `runSqlAgentResponses`（伪代码）

```js
export async function* runSqlAgentResponses(
  question,
  history = "",
  signal,
  sessionId = null,
  username = null,
) {
  logger.info("runSqlAgentResponses called", {
    question, historyLength: history?.length, sessionId, username,
  });

  // ★ 共享：与 runSqlAgent 完全相同的 setup
  resetPerQuestionRegistryFlags(getOrCreateRegistry(sessionId));
  const cfg = getLlmConfig();
  const { apiKey, baseURL, model } = cfg;
  const skillMd = loadSkillMd();
  const messages = buildMessagesForLLM({ question, skillMd, cfg, history, sessionId });
  const tools = getPrunedToolsForRound(messages, 0);

  let maxToolCalls = cfg.max_tool_calls || 30;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let allLogs = [];
  let finalSql = '';
  let finalMessage = '';
  let finalReasoning = '';

  while (maxToolCalls > 0) {
    // ★ Responses API 特有：转换 messages → input items
    const { instructions, input } = messagesToInputItems(messages);
    const responsesTools = getToolsForResponsesApi(tools);
    const requestBody = {
      model,                                  // 'deepseek-v4-flash'
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

    // ★ 流式消费 + 翻译
    let pendingToolCall = null;
    let roundAssistantContent = '';
    let roundReasoningContent = '';
    let toolCalledThisRound = false;
    let errored = false;

    await parseResponsesStream(response.body, signal, (internal) => {
      switch (internal.internalType) {
        case 'chunk':
          roundAssistantContent += internal.content;
          // 注意：generator 外不能直接 yield（要等外层 for-await 调）
          // 实际实现里要把这些 yield 收集到 events[]，外层 for await 一次性 yield
          break;
        case 'reasoning_chunk':
          roundReasoningContent += internal.content;
          break;
        case 'tool_call_delta':
          if (!pendingToolCall) {
            pendingToolCall = { id: internal.call_id, name: internal.name, arguments: '' };
          }
          pendingToolCall.arguments += internal.arguments;
          break;
        case 'tool_call_done':
          pendingToolCall = internal.toolCall;
          toolCalledThisRound = true;
          break;
        case 'usage':
          totalPromptTokens += internal.prompt_tokens;
          totalCompletionTokens += internal.completion_tokens;
          break;
        case 'error':
          errored = true;
          break;
      }
    });

    if (errored) {
      yield { type: 'done', sql: '', message: '', error: true };
      return;
    }

    // ★ 工具调用：执行 + 投喂下一轮
    if (pendingToolCall) {
      yield {
        type: 'tool_call',
        id: pendingToolCall.id,
        name: pendingToolCall.name,
        arguments: pendingToolCall.arguments,
      };
      // ★ 共享 executeToolCall（需 audit 是否依赖 id 字段，详见 Q1）
      const toolResult = await executeToolCall(pendingToolCall, /* context */);
      yield { type: 'tool_result', id: pendingToolCall.id, name: pendingToolCall.name, result: toolResult };
      // ★ 累积到 messages（用 Chat Completions 格式，下一轮再转 Responses）
      messages.push({ role: 'tool', tool_call_id: pendingToolCall.id, content: JSON.stringify(toolResult) });
    } else {
      // ★ 无工具调用：LLM 给出最终答案
      finalSql = extractSqlFromContent(roundAssistantContent);
      finalMessage = roundAssistantContent;
      finalReasoning = roundReasoningContent;
      break;
    }

    // ★ 实时 yield 流式内容（chunk + reasoning_chunk）
    // 注意：上面在 callback 里只是累加，没 yield；这里一次性 yield 累积的内容
    // （实际实现需要在 parseResponsesStream 的 callback 里 yield，因为它是 async generator）
    // ⚠️ 设计待定：见 5.1 节"流式 yield 时机"

    maxToolCalls--;
  }

  // ★ 终结事件（与 runSqlAgent 一致）
  yield {
    type: 'done',
    sql: finalSql,
    message: finalMessage,
    reasoning: finalReasoning,
    totalTokens: totalPromptTokens + totalCompletionTokens,
  };
}
```

### 5.1 流式 yield 时机（待定）

`parseResponsesStream` 是普通 async 函数，接收 `yieldFn` 回调。但**主函数是 async generator**，需要 yield 给外层 for-await。

**两种实现方案**：

| 方案 | 说明 | 优劣 |
|---|---|---|
| A | `parseResponsesStream` 改成 `async function*`，直接 yield 内部事件；主函数 `for await (const internal of parseResponsesStream(...))` | 简洁，标准 async generator 模式 |
| B | 保留 `parseResponsesStream` 是普通 async 函数 + `yieldFn` 回调；回调里把事件 push 到 `events[]`；主函数消费后 yield | 解耦但繁琐 |

**推荐方案 A**。修改 4.3 函数签名：`async function* parseResponsesStream(...)`，自然 yield 内部事件。

---

## 6. 共享代码依赖

`runSqlAgentResponses` 与 `runSqlAgent` 共享以下逻辑（**0 改动**）：

| 共享 | 来源 | 说明 |
|---|---|---|
| `getLlmConfig` | [services/config.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/config.js) | 读 DB 配置 |
| `loadSkillMd` | [services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js) | 读 SKILL.md |
| `buildMessagesForLLM` | services/llm.js | 构造 LLM context |
| `getPrunedToolsForRound` | services/llm.js | 工具剪枝（按 round 减）|
| `executeToolCall` | services/llm.js | 工具执行（按 name 查 DynamicTool.call）|
| `getOrCreateRegistry` | services/llm.js | 注册表获取/创建 |
| `resetPerQuestionRegistryFlags` | services/llm.js | 问题级标志重置 |
| `extractSqlFromContent` | services/llm.js | 从 LLM 输出提 SQL |

**关键 audit 点**（详见第 9 节）：
- `executeToolCall` 是否使用 `id` 字段？（影响 `call_id` ↔ `id` 映射）
- `buildMessagesForLLM` 是否接受已包含 `tool` 角色消息的数组？（影响多轮 history 累积）
- 现有 Zod → JSON Schema 转换在哪？（影响 `getToolsForResponsesApi` 复用）

---

## 7. F14 路由侧改动

[query.js:384-401](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401) 当前占位逻辑：

```js
// 改前
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

```js
// 改后
const llmCfgForDispatch = getLlmConfig();
// ★ 选 generator：根据 apiMode 选实现
const isResponsesApi = llmCfgForDispatch?.apiMode === 'responses_api';
// ↑ 保留判断，下面 try 块要用

// ...

try {  // ⚠️ try 块要上移（详见 7.1）
  const generator = isResponsesApi
    ? runSqlAgentResponses(question, historyText, abortController.signal, sessionId, req.user.username)
    : runSqlAgent(question, historyText, abortController.signal, sessionId, req.user.username);
  // ... for-await 消费 yield 逻辑不变 ...
} catch (e) { ... }
```

### 7.1 try 块上移（**唯一非平凡改动**）

现有 `try { generator = runSqlAgent(...); for await... }` 结构改为：

```js
try {  // ← 上移 16 行（原 L404 → L388）
  const generator = isResponsesApi
    ? runSqlAgentResponses(...)
    : runSqlAgent(...);
  let fullContent = '';
  // ... 现有变量定义 ...
  for await (const chunk of generator) { /* 不变 */ }
  // ... 现有后处理 ...
} catch (e) { /* 不变 */ }
```

**风险**：try 块上移意味着 `generator` 创建在 try 内。如果 `runSqlAgentResponses` 在 generator 创建时就抛错（实际不会，因为是 async generator，抛错在 `for await` 第一次迭代时），会被 catch 接住。

**替代方案**：保留两套 try 块（一份给 CC、一份给 Responses），代码重复但 try 块 0 改动。

**推荐**：方案 A（上移），更清爽。

---

## 8. 测试策略

| 测试文件 | 覆盖范围 | 断言数（估计）|
|---|---|---|
| `test-responses-messages-conversion.mjs` | `messagesToInputItems` 7 种消息类型：system/user/assistant+text/assistant+tool_calls/tool、空 messages、多 system 拼接 | ~15 |
| `test-responses-tools-conversion.mjs` | `getToolsForResponsesApi` 工具转换：基本转换、空数组、嵌套 schema | ~8 |
| `test-responses-stream-parser.mjs` | `parseResponsesStream` + `translateResponsesEvent` 16+ 事件类型 + F11 buffer 模式 | ~25 |
| `test-run-sql-agent-responses.mjs` | 主函数端到端：mock fetch + 验证 yield 事件序列（单轮无工具、单轮有工具、多轮、思考、错误）| ~15 |
| `test-route-apimode-responses.mjs` | F14 分流：`apiMode='responses_api'` 调新函数、事件契约与 CC 模式一致 | ~10 |
| **小计** | | **~73** |

**测试模式**：参考 F11-F16 已有测试：
- 纯函数（`messagesToInputItems` / `translateResponsesEvent`）：直接调用 + 断言返回值
- 流式函数（`parseResponsesStream`）：mock `ReadableStream` 输入 + 收集 yield 事件
- 主函数（`runSqlAgentResponses`）：mock `global.fetch` 返回 fake stream
- 路由层（F14）：mock `req` / `res` / `getLlmConfig`

---

## 9. 实施顺序

| Step | 内容 | 工时 | 风险 |
|---|---|---|---|
| **1** | **audit** `runSqlAgent` 全文 + `executeToolCall` + Zod→JSON 转换点 | 1-2h | 低 |
| **2** | 写 4 个辅助函数（4.1-4.4）| 2-3h | 中 |
| **3** | 写主函数 `runSqlAgentResponses` | 3-4h | 中 |
| **4** | 改 F14 分流（try 块上移）| 0.5h | 低 |
| **5** | 写 5 个测试文件 | 2-3h | 中 |
| **6** | 更新 `docs/执行流程.md` 第 4 章节 | 0.5h | 低 |
| **总计** | | **~9-13h** | |

### 9.1 Step 1 audit 清单（动手前必看）

- [ ] `executeToolCall` 函数实现：是否使用 `id` 字段？
- [ ] `buildMessagesForLLM`：接受已包含 `tool` 角色消息的数组？
- [ ] DynamicTool 转 JSON Schema 的现有转换在哪？（Chat Completions 路径必然有）
- [ ] `extractSqlFromContent`：在 Responses API 输出中是否同样有效？
- [ ] `getPrunedToolsForRound`：是否对 `tools` 做深拷贝？避免修改原数组？
- [ ] `messagesToInputItems` 的 5 种消息类型覆盖：是否包含 `function` role（OpenAI 旧版）？

---

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `executeToolCall` 实际依赖 `id` 字段 | 中 | **高**（要加 id 映射层）| Step 1 先 audit；如需要，在 `executeToolCall` 内做 `id \|\| call_id` 兼容 |
| DynamicTool → Responses API 工具格式不一致 | 中 | 中 | 写 4.1 时实测；如需调整 `strict` 等字段，加测试 |
| 多轮 `call_id` 在某些 Responses 事件中缺失 | 低 | 中 | 用累积状态兜底（`pendingToolCall`）|
| 推理事件流式顺序与 CC 不同 | 低 | 低 | 前端只关心 chunk/reasoning_chunk 类型，不关心顺序 |
| `extractSqlFromContent` 在 Responses 输出中失效 | 低 | 中 | 复用现有正则；如失效改用更宽松的 |
| 流式事件总数 > 16 种，遗漏某些类型 | 中 | 中 | Step 1 列出全部事件类型；遗漏的事件 `translateResponsesEvent` 返回 null（无害）|
| F14 try 块上移后 generator 创建时机问题 | 低 | 低 | 现有 try 块结构兼容；实测验证 |
| Zod → JSON Schema 转换库未安装 | 中 | 中 | 检查 `package.json`；如缺装 `zod-to-json-schema` 或复用 LangChain 内部工具 |

---

## 11. 待用户拍板的 3 个开放问题

### Q1：`executeToolCall` 是否依赖 `id` 字段？

**没看实现所以不确定**。如果依赖，Responses → Chat Completions 之间的 `id`/`call_id` 字段名差异就**不只是命名**问题，而是要**做映射**。

**建议**：动手前先 audit 这块（Step 1 的子任务），1h 左右。

### Q2：F14 分流的 try 块上移，是否接受？

这是路由侧**唯一非平凡改动**。try 块从 L404 上移到 L388，整整 16 行。**没有任何功能变化**，纯粹是 if-else 包到 try 里。

| 方案 | 说明 |
|---|---|
| **A（上移）** | 1 个 try 块 + 1 个 if-else 选 generator。代码清爽 |
| B（重复） | 保留两套 try 块，代码重复但 try 块 0 改动 |

**建议**：方案 A。

### Q3：多轮 `max_tool_calls` 失败兜底

Responses API 流式断了（断网、abort）时，多轮 `messages` 数组已累积了上一轮的 `tool_call` / `tool_result`。如果不发送这些累积消息就重试，下一轮会丢上下文。

**建议**：与 `runSqlAgent` 共用相同的"累积到 messages 数组"机制（这是天然的，不需要额外处理）。但要确认 `buildMessagesForLLM` 接受已经包含 `tool` 消息的 messages 数组（**Step 1 audit**）。

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

- [ ] `docs/执行流程.md` 第 4 章节更新（含 `runSqlAgent` + `runSqlAgentResponses` 双实现说明）
- [ ] 本计划文档归档为 `2026-08-06-run-sql-agent-responses-plan.md`

---

## 13. 关联文档

- [F16 重命名记录](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1067-L1078)
- [F14 路由侧分流](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L384-L401)
- [F13 apiMode 配置层](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/config.js#L78-L90)
- [docs/执行流程.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/执行流程.md) 第 4 章
- [DeepSeek Responses API 文档](https://api-docs.deepseek.com/zh-cn/api/create-response)
- [DeepSeek Responses API 流式指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api)

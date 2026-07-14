# `request_user_choice` 工具 — Agent ↔ 用户交互表单

**日期**: 2026-07-13（持续修订中）
**状态**: 待审批
**作者**: AI 协作
**关联文件**: `backend/src/services/toolFuncs.js`, `backend/src/services/llm.js`, `backend/src/routes/query.js`, `frontend/src/App.jsx`, `frontend/src/components/UserChoiceDialog.jsx`, `skills/sql-creator-skill-v2/SKILL.md`

**v2 修订**（2026-07-14）：外部 AI 评审指出 12 个问题，全部核实并修复：
- 🔴 #1 tools 数组位置（破坏 prefix cache）→ 修复（§4.1, §4.2, §5.1）
- 🔴 #2 Marker ID 与 registry ID 失联 → 修复（§4.1 返回结构化对象，§5.2.C 新增 overrideId 参数）
- 🟡 #3 saveMessagesToDb 失败降级 → 修复（§5.2.F）
- 🟡 #4 saveMessagesToDb 重复调用（幂等已保证）→ 优化（§5.2.F 注释）
- 🟡 #5 Marker regex 边界 → 加风险 R-50（§7）
- 🟢 #6-#12 小问题 → 加 Enter 键绑定（R-51 风险）、更新 R-39 token 估算、grep 改辅助、registry 清理（R-49 风险）、结构化返回兜底（R-52 风险）

**v3 修订**（2026-07-14）：修正 §2.5 与 §7 风险编号冲突（删除 §2.5 重复 R-47, R-48，重编号 §7 R-47→R-49, R-48→R-50），新增 R-51, R-52。

---

## 1. 目标与范围

### 1.1 目标

让 LLM 在不中断会话的前提下，**主动向用户提问**（带可选选项 + 自由补充），并基于用户回复**继续生成 SQL**。

### 1.2 与现有 `request_tag_confirmation` 的差异

| 维度 | `request_tag_confirmation`（现有） | `request_user_choice`（新增） |
|------|--------------------------------------|----------------------------------|
| 交互方式 | 纯"是/否"二元 | N 选 1 / N 选多 + 自由文本 |
| 提交后行为 | 调 `addTagToTable` 直接落库，**不恢复 LLM** | 调 `/generate` 二次请求，**恢复 LLM** |
| 多轮性质 | 单轮 | 跨多轮（TURN 1..N，无硬限） |
| Marker 提取 | 依赖 LLM 文本中含 marker（脆弱） | 通过 SSE 事件字段传递（程序硬控） |
| 用户取消 | 直接关闭弹窗 | 简洁消息 "用户取消了选择" 送入 TURN 2 |

### 1.3 范围外

- 不修改 `request_tag_confirmation` 的实现（已稳定运行，不破坏）
- 不改数据库 schema
- 不新增 HTTP 端点（复用现有 `/api/query/generate`）
- 不改速率限制策略

---

## 2. 核心设计原则

### 2.1 TURN 1 / TURN 2 模型

TURN 1（已完成时）= LLM 调工具 → 工具 func 返回 marker → **程序立刻终止 SSE 流**。
TURN 2（用户提交后）= 新 `/generate` 请求，`sessionId` 共享 → 后端 `loadMessagesFromDb` 加载上轮完整 messages → 追加新 user message → LLM 继续。

**本质：两次独立的 HTTP 请求，共享 session 与 messages 数组。**

### 2.2 程序硬控原则（关键）

**不依赖 LLM 守规矩**。`request_user_choice` 的所有"特殊处理"（marker 解析、对话终止、DB 写入、日志写入、SSE 字段传递）均由程序完成，**LLM 只负责"调用工具"这一个动作**。

### 2.3 工具稳定/可变分类

`request_user_choice` 是**稳定工具**（不参与剪枝）——理由：同会话内可能多次问不同问题（时间范围、报表口径、模糊字段等），剪枝会过早移除。

**位置**：`tools[]` 数组**第 5 位**（在 `request_tag_confirmation` 之后、`get_domain_index` 之前，属于稳定工具组末尾）。

**为什么不是首位**：DeepSeek prefix cache 按**整个 tools 序列前缀**匹配，**插入到 index 0 会偏移所有现有工具位置**，导致所有现有会话 cache miss。放第 5 位可保持前 4 个稳定工具位置不变（详见 §4.2 详细论证）。

### 2.4 多轮（Multi-turn）通用模型（重要）

**`request_user_choice` 不限定 2 轮**。可能的多轮模式：

```
TURN 1:  LLM 问问题 A   → 弹窗 A  → 用户答 A
TURN 2:  LLM 问问题 B   → 弹窗 B  → 用户答 B
TURN 3:  LLM 问问题 C   → 弹窗 C  → 用户答 C
...
TURN N:  LLM 调业务工具（get_table_ddl 等）→ 生成最终 SQL → 结束
```

每轮结构完全相同：
1. 上一轮以 `userChoiceRequest` 结尾（弹窗打开）
2. 用户提交 → 前端构造新 user message（**简洁 answer**） → 调 `/generate`
3. 后端 `loadMessagesFromDb` 加载**整个**历史 messages（含所有历史的 `user` / `assistant(tool_calls)` / `tool(marker)`）
4. LLM 在 TURN N 看到完整上下文
5. LLM 决策：再问 / 调其他工具 / 生成 SQL
6. 任意一种决策都可能再次触发 `request_user_choice` 弹窗

**为什么这个设计天然支持多轮**：

| 组件 | 多轮是否支持 | 原因 |
|------|-------------|------|
| `pendingUserChoice` 变量 | ✅ | 每次 `/generate` 调用创建独立生成器实例，变量局部 |
| `userChoiceRequest` 前端 state | ✅ | `useEffect([visible])` 每次弹窗打开重置；新 payload 覆盖旧值 |
| `llm_messages.messages` 数组 | ✅ | 每次 TURN 终止时 `saveMessagesToDb` 追加，整个数组落库；下次 `loadMessagesFromDb` 整体加载 |
| `sessionToolRegistries` | ✅ | `Map<sessionId, reg>` 跨请求持久；checklist 自动包含所有轮次工具调用 |
| `messages` 表 user/assistant 行 | ✅ | 每个 TURN 各自落库一行 |
| 日志（`logs/..._llm.log`） | ✅ | 每次 TURN 终止时 `flushLogs()` 追加 |

**轮次上限**：无程序硬限。实际由两个因素决定：
- **模型上下文窗口**：当前项目主 LLM = `deepseek-v4-flash`（V4-Flash，1M context，384K 最大输出，2026-04 发布，见 [llm.js:561](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L561)）；V3（`deepseek-chat`）仅用于收藏 SQL 优化和 session 标题生成（节省 V4 配额）。V4 1M context 下 messages 长度**基本不会超限**。
- **用户体验**：轮次越多用户耐心越低，建议业务层引导 LLM 在 3-5 轮内收敛

**多轮 checklist 全部显示**：随着轮次增多，`userChoiceAsked` 累积的所有条目**都进 checklist**（与其他工具一致：request_tag_confirmation 也不截断）。`messages` 数组中每条 `tool` 角色消息的 marker 同样完整保留，作为深度记忆的兜底。

### 2.5 前端 UX 连贯性（**用户体验硬约束**）

技术实现可能正确，但 UX 容易给用户"断裂感"。**前端必须做 5 件事**让多轮交互感觉连贯（F/G 由消息格式天然支持，不需要额外工作）：

#### A. 弹窗关闭后**立即**显示新 user 气泡（**简洁格式**）

TURN 2 用户提交时，前端**先在聊天区插入一条用户气泡**显示简洁回答，再触发 `/generate`：

```jsx
const handleSubmitUserChoice = (selected, text) => {
  // 简洁格式：直接是用户的答案，不打包成 wrapper
  // 例："近7天" 或 "近7天, 近30天" 或 "近7天 + 华东区"
  const answer = [
    selected.length > 0 ? selected.join(', ') : null,
    text ? text : null
  ].filter(Boolean).join(' + ');

  // 1) 先插入用户气泡（透明度 + 聊天记录连贯）
  appendUserBubble(answer);

  // 2) 关闭弹窗
  setUserChoiceRequest(null);

  // 3) 显示 loading（连续，不等 done）
  setLoading(true);

  // 4) 触发 /generate（question 直接是 answer，不打包）
  generateSQL({ question: answer, sessionId });
};
```

**效果**（messages 数组结构）：

```json
[
  {"role": "user", "content": "查销售总额"},
  {"role": "assistant", "content": "好的，请选择时间范围: 1) 近7天 2) 近30天 3) 近90天", "tool_calls": [...]},
  {"role": "tool", "content": "<!--user_choice:{...}-->"},
  {"role": "user", "content": "近7天, 华东区"},     ← 简洁自然
  {"role": "assistant", "content": "SELECT region, SUM(amount) FROM orders WHERE date >= ..."}
]
```

**为什么简洁格式优于 wrapper**：
- **LLM 自然理解**：assistant 上一条问"时间范围: 1) 近7天 2) 近30天"，user 答"近7天"，LLM 直接懂（无需解析"已选: [...]"）
- **历史回看自然**：聊天区直接是 user/assistant 气泡，无需特殊组件渲染
- **省去 UserChoiceCard / UserChoiceMetaLine**：因为消息本身就是自然对话
- **LLM checklist 仍然有效**：LLM 看到 tool_call 记录，知道问过哪些问题

#### B. Loading 状态连续

**关键**：TURN 1 loading 不在弹窗打开时消失，等弹窗关闭时立刻显示新的 loading，**不让用户看到"loading 消失 → 出现"**。

```jsx
// 弹窗 visible=true 时不隐藏 loading（用户在操作弹窗，不需要 loading）
// 弹窗 visible=false 时立即显示 loading
useEffect(() => {
  if (userChoiceRequest && !userChoiceRequest.visible) {
    setLoading(true);
  }
}, [userChoiceRequest]);
```

#### C. TURN 2 LLM 输出过渡语（不强制）

TURN 2 LLM 看到 user 简洁回答（如"近7天, 华东区"）后，**可以**输出过渡语（"好的，收到您的选择"），也可以**直接**出 SQL。**不强制**——这是 LLM 自由发挥空间，由 SKILL.md 中"自然语言对话"惯例引导。

#### D. 视觉提示"继续上一轮"（可选）

TURN 2 用户气泡加微小角标 `↻ 继续上一轮`，让用户明确感知"这是接着刚才的对话"：

```jsx
<div className="message-bubble user">
  <span className="continue-badge">↻ 继续上一轮</span>
  <div className="message-content">{answer}</div>
</div>
```

#### E. 聊天输入框锁定（UX 约束）

弹窗打开时**禁用聊天输入框**，避免用户中途换问题：

```jsx
<TextArea
  disabled={userChoiceRequest?.visible}
  placeholder={userChoiceRequest?.visible ? '请先完成弹窗中的选择' : '请输入您的问题...'}
/>
```

#### F. 历史回看保真（**存库后再看的体验**）—— **天然支持，无需特殊处理**

**关键洞察**：用 §2.5.A 的简洁格式后，**消息本身就是自然对话**，历史回看直接显示 user/assistant 气泡即可——**无需 UserChoiceCard / UserChoiceMetaLine**。

**messages 数组存储**：
```json
[
  {"role": "user", "content": "查销售总额"},
  {"role": "assistant", "content": "好的，请选择时间范围: 1) 近7天 2) 近30天 3) 近90天", "tool_calls": [...]},
  {"role": "tool", "content": "<!--user_choice:{...}-->"},  // 隐藏，不显示
  {"role": "user", "content": "近7天, 华东区"},
  {"role": "assistant", "content": "SELECT ..."}
]
```

**聊天区显示**（自动隐藏 tool 消息）：
```
[用户气泡]   "查销售总额"
[助手气泡]   "好的，请选择时间范围: 1) 近7天 2) 近30天 3) 近90天"
[用户气泡]   "近7天, 华东区"
[助手气泡]   "SELECT region, SUM(amount) ..."
```

**实施**：
- `UserChoiceCard` **不实现**
- `UserChoiceMetaLine` **不实现**
- `buildDisplayMessages` 转换函数 **不实现**
- 只需确保 tool 消息不显示在聊天区（现有 MessageBubble 已天然过滤 tool role）

#### G. 多轮历史展示（天然支持）

多轮 user_choice 在历史中就是**自然的对话流**——3 轮 user_choice 展示 3 组 Q&A：

```
[用户气泡]   "查销售总额"
[助手气泡]   "好的，请选择时间范围: 1) 近7天 2) 近30天 3) 近90天"
[用户气泡]   "近7天"
[助手气泡]   "已选近7天。是否仅看华东区?"
[用户气泡]   "是, 华东区"
[助手气泡]   "好的。统计维度: 按天/按周/按月?"
[用户气泡]   "按天"
[助手气泡]   "SELECT date, region, SUM(amount) FROM orders WHERE date >= ..."
```

**实施**：与单轮完全相同，无需特殊处理。

#### 不连贯的反例（要避免）

```
TURN 1:
[用户气泡]   "查销售总额"
[加载中...]                                ← 显示
[助手气泡]   "好的，请先确认时间范围"
[弹窗]       "查询哪个时间范围?" [选项...]  ← 弹窗打开，loading 消失
[弹窗关闭]

TURN 2:
                                         ← 短暂空白（loading 还没显示）
[加载中...]                                ← 重新出现 ← 断裂感！
[助手气泡]   "SELECT ..."                  ← 直接出 SQL，无"已收到您的回复"过渡
```

**用户体验**：像两次独立请求，不是一次连续对话。

#### 连贯的正例（要实现）

```
TURN 1:
[用户气泡]   "查销售总额"
[加载中...]                                ← 显示
[助手气泡]   "好的，请先确认时间范围"
[弹窗]       "查询哪个时间范围?" [选项...]  ← 弹窗打开，loading 持续
[弹窗关闭]  → loading **立即**重新显示

TURN 2:
[用户气泡]   "↻ 继续上一轮 近7天, 华东区"
[加载中...]                                ← 连续（用户没看到空白）
[助手气泡]   "好的，已收到您的选择。SELECT region, SUM(amount) ..."
```

**用户体验**：一次连贯的多轮对话。

#### 实施位置

| 改动 | 文件 | 函数 |
|------|------|------|
| 插入用户气泡 | App.jsx | `handleSubmitUserChoice` + 新增 `appendUserBubble` |
| Loading 连续 | App.jsx | `useEffect([userChoiceRequest])` |
| 聊天框锁定 | App.jsx | 现有 TextArea 组件 |
| 角标样式 | App.jsx + .css | 新增 `.continue-badge` |
| 验证 | 手工 + Playwright | 多轮对话流畅性测试 |

### 2.6 Checklist 生命周期（硬约束）

**Checklist 不属于对话历史**——它是**当前 LLM 请求的决策辅助**。

| 位置 | 包含 checklist？ | 理由 |
|------|-----------------|------|
| `requestMessages`（送 API 的数组） | ✅ **末尾追加** | 当前轮的 LLM 需要看到历史工具调用以避免重复 |
| `messages`（累积数组，送下一轮 LLM） | ❌ **绝不** | checklist 是程序生成的，不是 LLM 输出；不能污染 history |
| `llm_messages.messages` 表（DB） | ❌ **绝不** | 同上；DB 应只存真实的 user/assistant/tool 对话 |
| `messages` 表（user/assistant 展示行） | ❌ **绝不** | 同上 |

**核心原则**（计划在 T14 写入 `project_memory.md`，本实施 PR 合并前文件可能不存在）：

1. **不落库** — 清单消息是 LLM 内部决策辅助，绝不能写入 `llm_messages` 表（前端 / 用户对话历史中不出现）
2. **日志中可显式记录**（开发调试用），但**不进入 DB**
3. **不累积** — 清单只对当轮 LLM 请求有效，**不能 push 到累积的 `messages` 数组**，否则下次请求会重复携带（且 LLM 注意力会被历史 checklist 分散）

**反例（错误）**：
```json
// ❌ 错误：TURN 3 的 messages 数组
[
  {"role":"user","content":"原问题"},
  {"role":"system","content":"[已调用] get_tables:✓"},     // TURN 1 的 checklist
  {"role":"assistant","content":"...","tool_calls":[...]},
  {"role":"system","content":"[已调用] ... | get_sliced_index:[crm]"},  // TURN 2 的 checklist
  {"role":"user","content":"TURN 2 简洁回答"},
  {"role":"system","content":"[已调用] ... | request_user_choice:[uc_xxx]"},  // TURN 3 的 checklist
  {"role":"user","content":"TURN 3 简洁回答"}
]
```

**正例（正确）**：
```json
// ✅ 正确：TURN 3 的 messages 数组
[
  {"role":"system","content":"<SKILL.md>"},
  {"role":"user","content":"原问题"},
  {"role":"assistant","content":"...","tool_calls":[...]},
  {"role":"tool","content":"<!--user_choice:{...}-->"},
  {"role":"user","content":"近7天, 华东区"},
  {"role":"assistant","content":"...","tool_calls":[...]},
  {"role":"tool","content":"<!--user_choice:{...}-->"},
  {"role":"user","content":"TURN 3 简洁回答"}
]
// 加上当前轮 requestMessages 末尾临时追加的 checklistMsg（不落 DB）
```

**实施检查点**（写代码时必须逐条验证）：
- [ ] `buildToolCallChecklistMessage(reg)` 调用在 `fetch(API)` 之前
- [ ] `requestMessages = [...messages, checklistMsg]` 用于 API 调用
- [ ] **`messages.push(checklistMsg)` 永远不存在**（**主验证 = 集成测试 IT-19 DB 断言**；grep 仅辅助）
- [ ] `saveMessagesToDb(sessionId, messages)` 保存的是不包含 checklistMsg 的 `messages`
- [ ] `loadMessagesFromDb(sessionId)` 加载的历史 messages 不含 checklist
- [ ] 集成测试断言：`llm_messages.messages` JSON 中无 role=system 且 content 以 `[已调用]` 开头的消息
- [ ] 集成测试断言：DB messages 数组中无 `requestMessages.push` 的痕迹（DB 中保存的是真实对话）

---

## 3. 架构与数据流

### 3.1 TURN 1 完整流程

```
[1] 用户在聊天框输入问题 → 前端 POST /api/query/generate
[2] 后端 /generate:
    ├─ 鉴权、限流
    ├─ 保存 user message 到 messages 表
    ├─ 调 generateSQLWithLangChainStreamGen_BAK (流式生成器)
    └─ for-await 消费生成器 yield 的事件
[3] 生成器第一轮 LLM 调用:
    ├─ 累积 streaming text → responseText
    ├─ 检测到 tool_calls = [request_user_choice(...)]
    ├─ yield 助手消息（含 tool_calls）到 messages 数组
    ├─ saveMessagesToDb(sessionId, messages) ← 完整 messages 落 llm_messages 表
    └─ 进入"阶段 1/2/3"工具执行
[4] 工具执行 (阶段 1/2/3):
    ├─ checkAndFilterDuplicateCall: 不拦截（request_user_choice 不进 dedup 拦截表）
    ├─ recordToolCall: 记入 registry.userChoiceAsked
    ├─ tool.func(params) → 返回 marker 字符串
    ├─ yield { type: 'tool_return', log: ... }
    └─ messages.push({ role: 'tool', tool_call_id, content: marker })
[5] ★ 工具循环内检测 (新增):
    ├─ if (toolName === 'request_user_choice') {
    │     const m = rawResult.match(/<!--user_choice:(\{[\s\S]*?\})-->/);
    │     if (m) try { pendingUserChoice = JSON.parse(m[1]); } catch (e) { ... }
    │   }
    └─ if (pendingUserChoice) break;  // 跳出 for tool_calls
       if (pendingUserChoice) break;  // 跳出 while maxToolCalls
[6] ★ 终止分支 (新增):
    ├─ saveMessagesToDb(sessionId, messages) ← 再存一次（含 tool 消息的 marker）
    ├─ queueLog(`🔔 user_choice: ${JSON.stringify(pendingUserChoice)}`, true, username)
    ├─ flushLogs()
    └─ yield { type: 'done', sql: '', message: responseText, userChoiceRequest: pendingUserChoice };
       return;  // 生成器结束
[7] query.js 消费 done 事件:
    ├─ sql = '', message = LLM 已流式累积的引导文本
    ├─ userChoiceRequestPayload = chunk.userChoiceRequest  ← 从事件字段读取（不靠 regex）
    ├─ contentForDb = fullContent || message  ← DB 入库
    ├─ INSERT INTO messages ... (assistant role, contentForDb, ...)
    └─ doneData = { ..., user_choice_request: userChoiceRequestPayload }
       res.write(`data: ${JSON.stringify(doneData)}\n\n`)
       res.end()
[8] 前端 SSE 处理:
    ├─ data.user_choice_request 存在 → setUserChoiceRequest({ visible: true, ...payload })
    ├─ 弹窗显示在聊天区底部
    └─ 等待用户操作
```

### 3.2 用户响应（每轮通用）

```
[1] 用户在弹窗内:
    - 勾选/单选 options
    - 填写/不填写 free text
    - 点"提交"或"取消"
[2] 前端 handleSubmitUserChoice(selected, text) / handleCancelUserChoice():
    ├─ 构造简洁 answer:
    │   selected.length > 0 ? selected.join(', ') : null
    │   text ? text : null
    │   → 例如 "近7天, 华东区" 或 "近7天" 或 "含退款" 或 "用户取消了选择"
    ├─ appendUserBubble(answer)              ← 先在聊天区插入 user 气泡（UX §2.5.A）
    ├─ setUserChoiceRequest(null)            ← 关闭弹窗
    ├─ setLoading(true)                      ← 立即显示 loading（UX §2.5.B）
    └─ generateSQL({ question: answer, sessionId })  ← 复用现有流式管线
```

**关键**：前端**不**再生成 wrapper 格式（`[用户对选择请求的回复] 问题:...`）——直接用用户的简洁答案。LLM 通过上下文自然关联"刚才问了什么"。

### 3.3 TURN N 完整流程（通用，N ≥ 2）

```
[1] 后端 /generate (TURN N 入口):
    ├─ 鉴权、限流
    ├─ 保存 user message 到 messages 表（answer 简洁答案作为新一行）
    ├─ loadMessagesFromDb(sessionId) → 拿到 TURN 1..N-1 的完整 messages 数组
    ├─ messages = savedMessages  ← 整组替换
    ├─ 替换 system message 为最新
    ├─ messages.push({ role: 'user', content: question })  ← 追加本轮简洁 answer
    └─ 进入 LLM 流式生成
[2] LLM 在 TURN N 看到的 messages 数组:
    [0] system: <最新 SKILL.md>
    [1] user: <TURN 1 原问题>
    [2] assistant: <流式引导文本> + tool_calls [request_user_choice(Q1)]
    [3] tool: <!--user_choice:{Q1}-->
    [4] user: <TURN 2 简洁回答（Q1 回复）>
    [5] assistant: <流式引导文本> + tool_calls [request_user_choice(Q2)]
    [6] tool: <!--user_choice:{Q2}-->
    [7] user: <TURN 3 简洁回答（Q2 回复）>
    ...
    [K-1] user: <TURN N 简洁回答（Q(N-1) 回复）>
[3] LLM 看到 [K] tool 消息（最后一轮）→ 自动理解上一轮发生用户交互
    → 看到 [K+1] user 消息 → 知道用户选择
    → 决策:
       ├─ 调业务工具（get_table_ddl 等） → 继续 TURN N 内部工具循环
       ├─ 调 request_user_choice（再问 Q_N） → 触发 TURN N+1
       └─ 直接生成 SQL → TURN N 正常 done
[4] 决策 (a) 业务工具：
    ├─ 工具执行 → tool 消息 push
    ├─ maxToolCalls-- → 继续下一轮 LLM
    ├─ 可能再次进入工具循环
    └─ 最终 done（无 userChoiceRequest）→ 聊天区显示 SQL
[5] 决策 (b) 再问 Q_N：
    ├─ 工具循环检测 request_user_choice
    ├─ pendingUserChoice = parsed payload
    ├─ break（双层）
    ├─ saveMessagesToDb 落库
    ├─ yield done with userChoiceRequest
    └─ return  ← TURN N 结束，等待用户
[6] 决策 (c) 直接生成 SQL：
    ├─ 正常工具循环退出
    ├─ yield done (无 userChoiceRequest)
    └─ 聊天区显示 SQL  ← 多轮结束
```

---

## 4. 工具契约

### 4.1 工具函数（`toolFuncs.js`）

```js
// 新增导出函数
function makeUserChoiceId() {
  return 'uc_' + Math.random().toString(36).slice(2, 8);
}

function buildUserChoiceMarker(question, options, multiSelect, header) {
  const id = makeUserChoiceId();
  const payload = {
    id,
    question: String(question).slice(0, 500),
    options: (Array.isArray(options) ? options : []).slice(0, 8).map(o => String(o).slice(0, 100)),
    multi_select: !!multiSelect,
    header: String(header || '').slice(0, 12)
  };
  // ★ 返回结构化对象（不直接返回 marker 字符串）—— 让 caller 拿到 id
  return {
    id,
    marker: `<!--user_choice:${JSON.stringify(payload)}-->`,
    payload
  };
}

export function requestUserChoice(question, options, multiSelect, header) {
  return buildUserChoiceMarker(question, options, multiSelect, header);
}

// tools 数组中新增（**插入在 request_tag_confirmation 之后、get_domain_index 之前**，属于稳定工具组末尾）
// 严禁放在 index 0（会破坏现有所有请求的 DeepSeek prefix cache —— 详见 §4.2）
new DynamicTool({
  name: "request_user_choice",
  description: "【需要用户输入】当任务需要用户确认/选择/补充才能继续时调用。弹出选项+自由文本框，用户提交后 LLM 继续。调用后不要再生成任何文字——程序会自动结束当前轮次并弹出对话框。",
  params: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '向用户提问的内容（≤500字）' },
      options: { type: 'array', items: { type: 'string' }, description: '候选选项（1-8 个字符串，每项 ≤100 字）' },
      multi_select: { type: 'boolean', description: 'true=多选（checkbox），false=单选（radio），默认 false' },
      header: { type: 'string', description: '弹窗短标题（≤12 字）' }
    },
    required: ['question', 'options']
  },
  func: (params) => {
    // 解析（string/object 双兼容，与 request_tag_confirmation 一致）
    let question, options, multiSelect, header;
    try {
      if (typeof params === 'object' && params !== null) {
        ({ question, options, multiSelect, header } = params);
      } else if (typeof params === 'string') {
        const parsed = JSON.parse(params);
        question = parsed.question; options = parsed.options;
        multiSelect = parsed.multi_select; header = parsed.header;
      }
    } catch (e) { logger.debug('Parse request_user_choice params failed', { error: e.message }); }

    if (!question || typeof question !== 'string') return '请提供 question(问题) 参数';
    if (!Array.isArray(options) || options.length === 0) return '请提供 options(选项数组) 参数，至少 1 个';
    if (options.length > 8) options = options.slice(0, 8);

    // ★ 关键：tool.func 返回结构化对象 `{id, marker, payload}`
    // - `marker` 用于 LLM 看到的 tool 消息 content
    // - `id` 用于 recordToolCall 写入 registry（保证与 marker 内 id 一致）
    // 如果只返回 marker 字符串，caller 拿不到 id，registry 里会存 "uc_unknown_<timestamp>"，与 marker 内 id 失联
    return requestUserChoice(question, options, multiSelect, header);
  }
})
```

### 4.2 工具位置（关键：保持 DeepSeek prefix cache 命中）

`tools[]` 数组当前顺序（修改前）：
```
1. get_tables              ← 兜底工具（稳定）
2. get_table_schema        ← 稳定
3. get_table_ddl           ← 稳定
4. request_tag_confirmation ← 稳定
5. get_domain_index        ← 可变（剪枝）
6. get_sliced_index        ← 可变（剪枝）
```

**修改后顺序**（**严格按以下顺序**——位置不能错）：
```
1. get_tables              ← 不动
2. get_table_schema        ← 不动
3. get_table_ddl           ← 不动
4. request_tag_confirmation ← 不动
5. request_user_choice     ← ★ 新增（稳定，**插在稳定工具组末尾**）
6. get_domain_index        ← 不动
7. get_sliced_index        ← 不动
```

**为什么放这个位置**：
- **前 4 个稳定工具位置不变** → DeepSeek prefix cache 完全命中（不偏移）
- **放在稳定工具组末尾** → 即使将来新增加 stable tool，新工具仍在末尾，prefix cache 仍命中
- **不放在 index 0**（首位）—— 会**偏移**所有现有请求的工具前缀，导致**所有会话的 prefix cache miss**（包括不使用 `request_user_choice` 的会话），token 消耗激增

**为什么不是 index 0**（之前的错误设计）：当时我误以为"常被调用的放最前"能保 cache。实际上 prefix cache 按**整个前缀序列**匹配，**插入新元素会偏移后续所有位置**——所以"新工具放末尾"才是正确做法。

**§2.2 程序硬控原则 vs DeepSeek prefix cache**：本项目 memory 明确"稳定工具在前、可变工具在后"，**新工具（也属于稳定）必须追加在稳定工具组末尾**，不能放在首位。

**实施时校验**：
```bash
# 验证工具顺序
grep -A1 "new DynamicTool" backend/src/services/toolFuncs.js | grep "name:"
# 期望输出：
# name: "get_tables"
# name: "get_table_schema"
# name: "get_table_ddl"
# name: "request_tag_confirmation"
# name: "request_user_choice"  ← 新增在第 5 位
# name: "get_domain_index"
# name: "get_sliced_index"
```

### 4.3 工具剪枝豁免

`request_user_choice` 不在 `llm.js` 的剪枝逻辑中——只剪 `get_domain_index` 和 `get_sliced_index`，不动它。

---

## 5. 文件级变更清单

### 5.1 `backend/src/services/toolFuncs.js`

**变更类型**：修改
**影响行数**：+55
**变更点**：

1. 新增 `makeUserChoiceId()`、`buildUserChoiceMarker()`、`requestUserChoice()` 导出函数
2. `tools` 数组中**插在 `request_tag_confirmation` 之后、`get_domain_index` 之前**（第 5 位——稳定工具组末尾，**严禁放首位**，否则破坏 prefix cache，详见 §4.2）
3. 文件顶部 import 区域不变（`DynamicTool`, `logger` 已存在）

**风险点**：
- ❌ marker JSON 中含 `</script>` 等 HTML 字符可能破坏后续 DOM（不在本工具场景内，但需注意）
- ✅ marker 用 `<!--...-->` HTML 注释包裹，JSON 序列化天然处理引号
- ⚠️ marker 内的 `}` 后跟 `-->` 可能被非贪婪 regex 误截断（极低概率）；如担心可用 base64 编码（§4.1 实施细节）

### 5.2 `backend/src/services/llm.js`

**变更类型**：修改
**影响行数**：+40（registry 字段 + checklist + 工具循环终止分支）
**变更点**：

#### A. `getOrCreateRegistry` 新增字段（约 +3 行）
```js
sessionToolRegistries.set(sessionId, {
  ...existing,
  userChoiceAsked: new Map(),  // key=id, value={question, options, multiSelect, header}
});
```

#### B. `checkAndFilterDuplicateCall` 新增分支（约 +15 行）
```js
if (toolName === 'request_user_choice') {
  // 不拦截（设计上允许重复），但记录供 checklist 使用
  return { block: false, args };
}
```

注：**不拦截**——业务上允许 LLM 多次问不同问题。但仍要 `recordToolCall` 记入 registry。

#### C. `recordToolCall` 新增分支 + 改造签名（约 +15 行）

**关键**：新增第 4 个参数 `overrideId`——由 caller 从 tool func 的结构化返回中提取的 id（**保证 registry 与 marker 内 id 一致**）。

```js
// 改造签名
function recordToolCall(toolName, args, sessionId, overrideId = null) {
  const reg = getOrCreateRegistry(sessionId);
  // ... 既有逻辑（get_tables/get_table_schema/get_table_ddl/request_tag_confirmation）
  
  if (toolName === 'request_user_choice') {
    // ★ 优先用 overrideId（来自 tool.func 的结构化返回），fallback 到 args.id
    const id = overrideId 
            || (args && args.id) 
            || ('uc_unknown_' + Date.now());
    reg.userChoiceAsked.set(id, {
      question: args?.question || '',
      options: Array.isArray(args?.options) ? args.options : [],
      multiSelect: !!args?.multi_select,
      header: args?.header || ''
    });
  }
}
```

**配套修改**（[llm.js:996-1004](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L996-L1004) 工具执行块）：

```js
// 修改前（所有工具统一）
const rawResult = await Promise.resolve(p.tool.func(effectiveArgs));
recordToolCall(p.toolName, effectiveArgs, sessionId);

// 修改后（request_user_choice 特殊处理）
const rawResult = await Promise.resolve(p.tool.func(effectiveArgs));
let userChoiceId = null;
let toolMessageContent = rawResult;  // 默认 = rawResult（兼容现有工具）

// request_user_choice 返回结构化对象 {id, marker, payload}，需要拆解
if (p.toolName === 'request_user_choice' && rawResult && typeof rawResult === 'object' && rawResult.marker) {
  userChoiceId = rawResult.id;
  toolMessageContent = rawResult.marker;  // LLM 看到的应是 marker 字符串
}

recordToolCall(p.toolName, effectiveArgs, sessionId, userChoiceId);

// ★ 关键：把 toolMessageContent 挂到 execResults 返回对象上，让阶段 3 也能拿到
// （否则局部变量在闭包外不可见，阶段 3 只能拿到 rawResult 对象）
return {
  ...p,
  rawResult,
  toolMessageContent,  // ★ 新增：阶段 3 push tool 消息时使用
  userChoiceId,        // ★ 新增：供 §5.2.E 终止逻辑使用
  execError: null,
  notice: null
};
```

#### D. `buildToolCallChecklistMessage` 新增一行（约 +5 行）
```js
if (reg.userChoiceAsked.size > 0) {
  // 全部显示（与其他工具一致）；id 唯一，question 前 50 字供 LLM 识别
  const items = [...reg.userChoiceAsked.entries()].map(([id, v]) => 
    `${id}:"${String(v.question).slice(0, 50)}"`
  );
  parts.push(`request_user_choice:[${items.join('|')}]`);
}
```

**示例 checklist**（3 轮 user_choice 后）：
```
[已调用] get_tables:✓ | get_sliced_index:[people,finance] | 
get_table_ddl(s1):[order_student] | 
request_user_choice:[uc_abc123:"查询哪个时间范围的销售数据？"|uc_def456:"统计口径是含未付款订单吗？"|uc_ghi789:"请选择报表维度"]
```

#### E. 工具循环内新增终止逻辑（约 +20 行）
位置：`for (const p of execResults)` 块内，工具消息 push 后

```js
// ★ 新增：检测 user_choice 工具 → TURN 1 终止
// p.rawResult 是结构化对象 {id, marker, payload}，提取 marker 用于正则解析
if (toolName === 'request_user_choice' && p.rawResult && typeof p.rawResult === 'object') {
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
```

**外层 while 循环 break**：
```js
if (pendingUserChoice) break;  // 跳出 for tool_calls
...
if (pendingUserChoice) break;  // 跳出 while maxToolCalls（替换原 break）
```

**阶段 3（tool 消息 push）修改**（[llm.js:1039](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1039) 配套修改）：

\`\`\`js
// 修改前（所有工具统一用 rawResult）
const resultContent = p.notice ? `\${p.notice}\
\
\${p.rawResult}` : p.rawResult;

// 修改后（request_user_choice 优先用 §5.2.C 拆解后的 toolMessageContent）
const resultContent = p.toolMessageContent  // ★ request_user_choice 场景：已拆为 marker 字符串
  || (p.notice ? `\${p.notice}\
\
\${p.rawResult}` : p.rawResult);  // 其他工具：原逻辑
\`\`\`

**为什么用 `||` 而非三元**：
- 普通工具：`toolMessageContent = rawResult`（§5.2.C 默认行为），所以 `p.toolMessageContent` 存在
- request_user_choice：`toolMessageContent = rawResult.marker`（字符串），也存在
- 仅当 `rawResult` 是非对象（如 undefined）时 `toolMessageContent = rawResult` 也是 undefined，才 fallback 到原 notice 逻辑

**显式分支版本**（如团队风格偏好显式 if）：
\`\`\`js
let resultContent;
if (p.toolName === 'request_user_choice' && p.toolMessageContent) {
  resultContent = p.toolMessageContent;  // marker 字符串
} else if (p.notice) {
  resultContent = `\${p.notice}\
\
\${p.rawResult}`;
} else {
  resultContent = p.rawResult;
}
\`\`\`

两种实现等价，团队任选。

#### F. 终止分支 yield done + 持久化 + 降级（约 +30 行）
位置：原 `yield { type: 'done', sql: '', message };` 之前

```js
if (pendingUserChoice) {
  // 1) 持久化 messages（Turn 2 要 load 这份）
  // ★ 含 try/catch + 降级：DB 失败时不强弹窗，避免 Turn 2 拿不到上下文
  let dbSaveOk = true;
  if (sessionId) {
    try {
      saveMessagesToDb(sessionId, messages);
    } catch (e) {
      // 现有 saveMessagesToDb 内部已有 try/catch + error 日志
      // 但仍可能因异常路径未覆盖（如死锁、超时）走到这里
      dbSaveOk = false;
      logger.error('CRITICAL: saveMessagesToDb failed for user_choice flow', {
        sessionId, error: e.message
      });
    }
  }
  
  // 2) 写日志
  queueLog(
    `🔔 TURN 1 终止 - user_choice 请求: id=${pendingUserChoice.id} question="${pendingUserChoice.question}" options=${JSON.stringify(pendingUserChoice.options)} multi_select=${pendingUserChoice.multi_select} dbSaveOk=${dbSaveOk}`,
    true, username
  );
  flushLogs();
  
  // 3) 降级处理：DB 写失败 → 不弹窗，让 LLM 继续（不依赖 Turn 2 加载历史）
  if (!dbSaveOk) {
    // 放弃弹窗机制，依赖 LLM 自然语言处理
    logger.warn('DB save failed, falling back to LLM continuation', { sessionId });
    yield {
      type: 'done',
      sql: '',
      message: responseText + '\n\n（系统提示：用户交互持久化失败，请基于已有信息继续）',
      userChoiceRequest: null  // ★ 关键：null 告诉前端不弹窗
    };
    return;
  }
  
  // 4) 正常路径：yield done 携带 userChoiceRequest
  yield {
    type: 'done',
    sql: '',
    message: responseText,
    userChoiceRequest: pendingUserChoice
  };
  return;
}
```

**与现有 saveMessagesToDb 配合**（[llm.js:573-593](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L573-L593)）：
- 现有实现：REPLACE 语义（UPDATE/INSERT 互斥）→ **幂等**
- 已有 try/catch + error 日志
- 新增外层 try/catch 处理"未覆盖异常"（死锁/超时），并降级

**避免重复 saveMessagesToDb**（针对 reviewer #4 关注点）：
- §3.1 步骤 3（line 968）调一次 — 这是**通用工具循环结束后的保存**，**不是** user_choice 专用
- §3.1 步骤 6（终止分支）再调一次 — 这是**user_choice 专用**，保存完整 messages 含 tool 消息
- 因为 saveMessagesToDb 是 REPLACE 语义，重复调用是**幂等的**（第二次覆盖第一次）
- 实施时可优化：user_choice 场景**跳过**步骤 3 的保存（仅在终止分支保存）—— 但这是**性能优化**而非正确性问题，**可后续 PR 优化**

**风险点**：
- ❌ `recordToolCall` 调用时机：在 `p.tool.func` 执行后（line 1004）—— 这时 args 还没经过 dupCheck 过滤
- ✅ 但 user_choice 不走 dedup，过滤不生效，原 args 完整
- ❌ 如果 LLM 在 TURN 1 流式累积 `responseText` 之前就调工具，`responseText` 为空
- ✅ 此时 `done.message = ''`，DB 存空 assistant.content（合理，工具调用时 LLM 没说任何话）

### 5.3 `backend/src/routes/query.js`

**变更类型**：修改
**影响行数**：+8
**变更点**：

#### A. `done` 处理分支捕获事件字段（约 +3 行）
位置：line 432-435

```js
} else if (chunk.type === 'done') {
  sql = chunk.sql || '';
  message = chunk.message || '';
  // ★ 新增：捕获 userChoiceRequest（不靠 regex）
  if (chunk.userChoiceRequest && !userChoiceRequestPayload) {
    userChoiceRequestPayload = chunk.userChoiceRequest;
  }
}
```

需在 for-await 之前声明：
```js
let userChoiceRequestPayload = null;
```

#### B. 构造 doneData 时写入（约 +3 行）
位置：line 488 之后

```js
if (userChoiceRequestPayload) {
  doneData.user_choice_request = userChoiceRequestPayload;
}
```

#### C. contentForDb 不变（line 464）
`const contentForDb = fullContent || message;` —— 保持。DB 入库的 assistant 内容是 LLM 流式引导文本（不含 marker），干净。

**风险点**：
- ❌ `message` 为空时（LLM 调工具前没流式输出任何文字）→ `fullContent` 也为空 → `contentForDb` 为空 → 跳过 INSERT
- ✅ 这种情况：聊天区 assistant 气泡为空（只有 LLM 思考过程），弹窗显示问题/选项 —— UX 可接受
- ❌ 之前类似 `confirm_tag_add` 提取靠 regex —— 我们的方案完全绕开 regex，无此风险

### 5.4 `frontend/src/App.jsx`

**变更类型**：修改
**影响行数**：+50
**变更点**：

#### A. 新增 state（约 +6 行）
```js
const [userChoiceRequest, setUserChoiceRequest] = useState(null);  // null 或 { visible, requestId, question, options, multiSelect, header }
```

#### B. SSE done 处理分支（约 +8 行）
位置：line 831 之后

```js
} else if (data.type === 'done') {
  // 现有逻辑：更新 assistant 气泡
  setMessages(prev => { ... });
  
  // ★ 新增：弹窗触发
  if (data.user_choice_request) {
    const req = data.user_choice_request;
    setUserChoiceRequest({
      visible: true,
      requestId: req.id,
      question: req.question,
      options: Array.isArray(req.options) ? req.options : [],
      multiSelect: !!req.multi_select,
      header: req.header || ''
    });
  }
  // 关闭按钮：sse stream 已经 done，isStreaming 会被 finally 置 false
}
```

#### C. 提交/取消 handler（约 +30 行）
```js
// 简洁答案：直接拼接 selected + text，不包装成 wrapper
const buildUserChoiceAnswer = (selected, text) => {
  const parts = [];
  if (Array.isArray(selected) && selected.length > 0) {
    parts.push(selected.join(', '));
  }
  if (text && text.trim()) {
    parts.push(text.trim());
  }
  return parts.length > 0 ? parts.join(' + ') : '（无回复）';
};

const handleSubmitUserChoice = (selected, text) => {
  if (!userChoiceRequest) return;
  
  // 简洁格式："近7天" 或 "近7天, 华东区" 或 "含退款" 等
  const answer = buildUserChoiceAnswer(selected, text);
  
  // 1) 先在聊天区插入 user 气泡（UX §2.5.A 连贯性）
  appendUserBubble(answer);
  
  // 2) 关闭弹窗
  setUserChoiceRequest(null);
  
  // 3) 立即显示 loading（UX §2.5.B loading 连续）
  setLoading(true);
  
  // 4) 触发 /generate（question 直接是简洁 answer）
  generateSQL({ question: answer, sessionId: currentSessionId });
};

const handleCancelUserChoice = () => {
  if (!userChoiceRequest) return;
  
  // 取消时也用简洁格式
  const answer = '用户取消了选择';
  
  appendUserBubble(answer);
  setUserChoiceRequest(null);
  setLoading(true);
  generateSQL({ question: answer, sessionId: currentSessionId });
};
```

**关键**：前端**不**再生成 wrapper（`[用户对选择请求的回复] 问题: ...`），直接用简洁 answer。LLM 通过上下文自然关联。

#### D. 渲染弹窗（约 +8 行）
位置：line 1700 附近（`confirmTagAdd.visible` 块旁边）

```
{userChoiceRequest?.visible && (
  <UserChoiceDialog
    visible={true}
    question={userChoiceRequest.question}
    options={userChoiceRequest.options}
    multiSelect={userChoiceRequest.multiSelect}
    header={userChoiceRequest.header}
    onSubmit={handleSubmitUserChoice}
    onCancel={handleCancelUserChoice}
  />
)}
```

**风险点**：
- ❌ `generateSQL` 关闭弹窗前调 → 用户看到弹窗在请求途中消失
- ✅ 先 `setUserChoiceRequest(null)` 再调 `generateSQL`，React 18 批处理合并
- ❌ 弹窗打开时 SSE 重连（如网络抖动）→ 重新收到 done 事件 → 弹窗被覆盖
- ✅ 实际场景：弹窗打开时 SSE 已 done，不会再发；网络重连是新请求，不会重放 done
- ❌ **多轮中用户在弹窗打开时直接输入新问题** → 弹窗与新消息并发
- ✅ **新增 UX 约束**：弹窗打开时禁用聊天输入框（`Input.TextArea disabled={!!userChoiceRequest?.visible}`），并在占位符显示"请先完成弹窗中的选择"

#### E. 多轮聊天输入框锁（新增，约 +5 行）
```jsx
<Input.TextArea
  value={userInput}
  onChange={e => setUserInput(e.target.value)}
  placeholder={userChoiceRequest?.visible ? '请先完成弹窗中的选择...' : '请输入您的问题...'}
  disabled={!!userChoiceRequest?.visible}
  // ... 其余 props
/>
```

适用范围：所有让用户发新消息的输入控件（聊天输入框、"我的查询"输入框等）。`confirmTagAdd` 也可同样处理（不强制，可选）。

### 5.5 `frontend/src/components/UserChoiceDialog.jsx`（新文件）

**变更类型**：新建
**影响行数**：+95

```jsx
import React, { useState, useEffect } from 'react';
import { Modal, Radio, Checkbox, Input, Button, Space } from 'antd';

function UserChoiceDialog({ visible, question, options, multiSelect, header, onSubmit, onCancel }) {
  const [selected, setSelected] = useState([]);
  const [text, setText] = useState('');

  // 弹窗打开/关闭时清空状态（避免上次选择残留）
  useEffect(() => {
    if (visible) {
      setSelected([]);
      setText('');
    }
  }, [visible]);

  if (!visible) return null;

  const handleSubmit = () => {
    onSubmit(selected, text);
  };

  return (
    <div style={{
      margin: '12px 24px',
      padding: '16px',
      background: '#f0f5ff',
      border: '1px solid #adc6ff',
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
    }}>
      <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>
        {header && <span style={{ background: '#2f54eb', color: '#fff', padding: '2px 8px', borderRadius: 4, marginRight: 8 }}>{header}</span>}
        <span>需要您输入</span>
      </div>
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 500 }}>
        {question}
      </div>
      
      <div style={{ marginBottom: 12 }}>
        {multiSelect ? (
          <Checkbox.Group
            value={selected}
            onChange={setSelected}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {options.map((opt, i) => (
              <Checkbox key={i} value={opt}>{opt}</Checkbox>
            ))}
          </Checkbox.Group>
        ) : (
          <Radio.Group
            value={selected[0] || ''}
            onChange={e => setSelected([e.target.value])}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            {options.map((opt, i) => (
              <Radio key={i} value={opt}>{opt}</Radio>
            ))}
          </Radio.Group>
        )}
      </div>
      
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          补充说明（可选）：
        </div>
        <Input.TextArea
          value={text}
          onChange={e => setText(e.target.value)}
          onPressEnter={handleSubmit}  // ★ 文本框内按 Enter 直接提交
          placeholder="如果选项未涵盖您的情况或需要补充说明"
          autoSize={{ minRows: 2, maxRows: 5 }}
          maxLength={500}
        />
      </div>
      
      <Space>
        <Button type="primary" size="small" onClick={handleSubmit}>提交</Button>
        <Button size="small" onClick={onCancel}>取消</Button>
      </Space>
    </div>
  );
}

export default UserChoiceDialog;
```

**风险点**：
- ⚠️ **Enter 键绑定**：`onPressEnter={handleSubmit}` 文本框按 Enter 提交 —— 但**不**阻止 Shift+Enter 换行
  - antd `Input.TextArea` 默认 Shift+Enter 换行，单独 Enter 触发 `onPressEnter` — 需验证
  - 如发现冲突，可移除 `onPressEnter` 绑定，要求用户点提交按钮
- ❌ `Checkbox.Group` 传 `value=[]` 时全空——单选 `Radio.Group` 传 `''` —— 已处理
- ❌ `Input.TextArea` 超过 500 字截断 —— 合理
- ✅ 弹窗内按 Enter 自动提交 —— 已绑定 `onPressEnter={handleSubmit}`（与 R-51 一致）

### 5.6 `skills/sql-creator-skill-v2/SKILL.md`

**变更类型**：修改
**影响行数**：+8
**变更点**：在"## 标签纠正"章节之后新增

```markdown
## 用户交互

当任务缺少必要信息无法继续时（例如时间范围、报表口径、模糊字段消歧）：

1. **在 content 中自然语言描述问题**（让历史回看能看清问题+选项）：
   ```
   好的，请选择时间范围: 1) 近7天 2) 近30天 3) 近90天
   ```

2. **调用 `request_user_choice(question, options, multi_select, header)` 工具**（触发前端对话框）：
   - `question`: 提问内容（≤500字，与 content 中描述一致）
   - `options`: 候选选项（1-8 个字符串，每项 ≤100 字）
   - `multi_select`: `true`=多选（checkbox）/`false`=单选（radio），默认 `false`
   - `header`: 弹窗短标题（≤12字，如"时间范围"）

3. 工具调用后**不要在最终回复中输出更多文字**（已流式累积的 content 即可作为历史展示）

4. 用户提交后，user 消息是**简洁答案**（如"近7天, 华东区"），直接基于此继续生成 SQL
```

**同步位置**：`skills/skill_back/<最近日期>/sql-creator-skill-v2/SKILL.md` 也需同步（保留历史一致性）

**风险点**：
- ❌ LLM 调完工具后仍输出引导文字——程序控制已兜底（`responseText` 是 LLM 已流式累积的文字，不影响终止）
- ✅ 即使 LLM 输出文字也不破坏功能（`done` 事件由程序 yield，LLM 输出追加在 messages 中）

---

## 6. 数据持久化矩阵

| 数据 | 位置 | 写入时机 | TURN 2 是否能读 |
|------|------|----------|-----------------|
| 用户原问题（messages.role='user'） | `messages` 表 | TURN 1 进入时（query.js） | ✅ 加载 |
| 助手引导文本（messages.role='assistant'） | `messages` 表 | TURN 1 done 后（query.js） | ✅ 加载（前端展示） |
| 完整 messages 数组（结构化） | `llm_messages` 表 | TURN 1 工具消息 push 后 + 终止前（llm.js） | ✅ 加载 |
| 工具调用注册表 | 进程内存 `Map<sessionId, reg>` | TURN 1 recordToolCall 时 | ✅ 复用（除非服务重启） |
| 日志 | `logs/YYYY-MM-DD/{username}_llm.log` | TURN 1 终止 flushLogs | ✅ 写盘即可 |
| userChoiceRequest payload | 仅 SSE 事件流 | TURN 1 done | ❌ 不持久化（重新刷新页面不重弹） |

**说明**：userChoiceRequest 不持久化是**有意设计**——与 `confirm_tag_add` 一致（刷新不重弹）。如需重弹，扩展点：在 messages 表加 `pending_user_choice` 列。

---

## 7. 风险登记册（Risk Register）

| # | 风险 | 触发场景 | 严重度 | 缓解措施 | 验证方式 |
|---|------|----------|--------|----------|----------|
| R-01 | LLM 调工具前流式输出大量引导文字 | LLM 习惯性先解释 | 低 | responseText 自然累积，DB 入库包含；UI 气泡显示 | 单元测试：模拟 LLM 流式输出后调工具 |
| R-02 | LLM 在 TURN 1 调工具后仍继续流式输出（罕见） | DeepSeek 不遵守 SKILL.md | 低 | 程序 yield done 后 `return`，LLM 不再被调用 | TURN 1 调工具后 SSE 流立即关闭 |
| R-03 | Marker JSON 解析失败（JSON 被截断） | LLM 修改 marker（虽然程序不靠它） | 中 | `try/catch` 包裹解析，失败 → 降级走 LLM 正常流程（不终止） | 单测：构造异常 marker，验证 fall through |
| R-04 | `options` 含 9+ 项 | LLM 不遵守 1-8 限制 | 中 | 工具 func 截断到 8 项 | 单测：传 10 项 options |
| R-05 | `options` 含空字符串/非字符串 | LLM 生成脏数据 | 中 | 工具 func 过滤非字符串项 | 单测：传 `[1, '', null, 'a']` |
| R-06 | `question` 为空/null | LLM 漏参数 | 中 | 工具 func 返回错误 `'请提供 question'` | 单测 |
| R-07 | 服务重启导致 registry 丢失 | TURN 1 后服务重启 | 中 | `llm_messages` 持久化完整 messages，TURN 2 LLM 看到 tool 消息自动理解；registry 重建为空，新工具调用不再被 dedup 拦截（业务工具可能重复） | 集成测试：TURN 1 后 kill -9 后端，TURN 2 继续 |
| R-08 | 浏览器刷新丢失 userChoiceRequest | 用户在弹窗打开时刷新 | 低 | 不持久化（设计取舍），用户重新提问 | 手工测试 |
| R-09 | 多个 tab 共享同一 session | 用户开多 tab | 中 | TURN 1 done 触发弹窗只一次；TURN 2 状态不同步（后到的 tab 看新内容） | 手工测试：双 tab 同一 session |
| R-10 | TURN 1 SSE 流未关闭就触发弹窗 | 极端时序 | 低 | 程序 yield done 后 `return` 保证流关闭 | 单元测试 |
| R-11 | TURN 2 LLM 又调 `request_user_choice` | LLM 觉得还需确认 | 中 | 允许（设计原则）；但弹窗再次打开需保证不残留旧状态 | `useEffect` 重置 selected/text |
| R-12 | TURN 2 LLM 调 `request_user_choice` 但用相同 (question, options) | LLM 长上下文注意力衰减 | 低 | 不去重（设计原则），LLM 在 checklist 看到自己问过，但仍然允许再问 | 单测：构造 checklist 提醒验证 |
| R-13 | `responseText` 为空（LLM 调工具前未流式） | LLM 立即调工具 | 低 | UI 气泡空 + 弹窗显示；DB 存空 content | 手工测试 |
| R-14 | TURN 1 done 事件后 query.js 写库失败 | DB 异常 | 高 | 现有 catch 已处理，但 TURN 2 加载不到数据；用户在 TURN 2 输入"用户回复"后 LLM 困惑 | 加测：DB 锁竞争场景 |
| R-15 | 用户在 TURN 1 流式输出阶段点"取消"（弹窗未显示） | 时序竞争 | 中 | `abortControllerRef.current.abort()` 触发，生成器 `catch (e) { yield error; return; }` | 单元测试 |
| R-16 | 用户提交后立即点"取消" | UI 重复点击 | 低 | `handleSubmit`/`handleCancel` 入口判 `if (!userChoiceRequest) return` | 单测：连点 |
| R-17 | `header` 含 HTML 特殊字符（如 `<script>`） | LLM 不当输入 | 中 | `String(header).slice(0, 12)` 截断 + 弹窗 React 渲染天然转义 | 单测 |
| R-18 | TURN 2 LLM 不认识 tool 消息格式 | LLM API 兼容 | 中 | 已有大量 tool 消息历史，模型有 training；fallback：TURN 2 user 消息是简洁答案，LLM 通过上下文关联到前一条 assistant 的问题 | TURN 2 实测 |
| R-19 | `recordToolCall` 写 registry 失败 | 内存异常 | 低 | 不影响功能，下次调同工具不拦截（降级到正常流程） | 监控 |
| R-20 | TURN 2 的 `loadMessagesFromDb` 拿到旧 messages（含旧 system） | SKILL.md 更新 | 低 | query.js 现有逻辑替换 system message 为最新 | 手工测试：更新 SKILL.md 后 |
| R-21 | Marker 在 LLM 流式文本中"半截"（只输出一半） | LLM 截断 | 不影响 | marker 来自工具返回值，不在 LLM 文本中 | 无需验证 |
| R-22 | `pendingUserChoice` 被外层 break 误跳过 | 代码顺序错误 | 中 | 两处 `if (pendingUserChoice) break;` 都加注释强调 | 代码 review |
| R-23 | 工具返回空字符串/非 marker 字符串 | LLM 异常输入 | 中 | `if (p.rawResult?.includes('<!--user_choice:'))` 守卫 | 单测：mock 工具返回空串 |
| R-24 | TURN 1 同时调多个工具，其中一个是 user_choice | LLM 一次问 2 件事 | 中 | 第一个工具执行后 `break`，第二个不执行；TURN 2 重新跑 | 单测：mock 2 个 tool_calls |
| R-25 | DeepSeek API `reasoning_content` 400 错误 | TURN 2 LLM 调用 | 中 | 现有剥离逻辑只剥无 tool_calls 的 assistant；tool_calls 的保留 | 现有单测覆盖；新增场景验证 |
| R-26 | TURN 2 LLM 看到 tool 消息后，决定"再问一次"而不是用用户回复 | LLM 推理 | 低 | 允许；LLM 自由决策 | 手工测试 |
| R-27 | `useEffect` 重置弹窗状态时机问题 | React 18 批处理 | 低 | `useEffect(() => { ... }, [visible])` 依赖 visible，关闭时立即清空 | 手工测试 |
| R-28 | UserChoiceDialog 组件未导入 | 缺 import | 中 | 实施时严格 `import UserChoiceDialog from '../components/UserChoiceDialog'` | 编译验证 |
| R-29 | TURN 2 `loadMessagesFromDb` 返回 null（无 llm_messages 记录） | TURN 1 异常终止未保存 | 中 | 现有逻辑：fallback 到 `messages = [system, user]`——TURN 2 失去 TURN 1 上下文 | 加测：TURN 1 异常 |
| R-30 | 多个 SSE done 事件携带 userChoiceRequest | 网络重发 | 中 | `if (chunk.userChoiceRequest && !userChoiceRequestPayload)` —— 保留第一个 | 单测：mock 多个 done 事件 |
| **R-31** | **多轮 messages 数组膨胀** | **超过 5+ 轮后 token 累计超过 32K** | **中** | **userChoiceAsked 全部显示在 checklist；messages 数组不做截断（依赖模型上下文窗口硬限）；question 预览限 50 字符节省 token** | **集成测试：模拟 10 轮 LLM 请求，记录 token 增长** |
| **R-32** | **多轮 LLM 长上下文注意力衰减** | **messages 越长，LLM 越易遗忘早期问答** | **高** | **每轮 checklist 末尾提醒"已调用 request_user_choice" + tool 消息结构化保留 + assistant.content 已含问题（按 SKILL.md 指示）+ user 简洁答案由上下文自然关联** | **手工测试：5 轮后让 LLM 复述 Q1 答案是否一致** |
| **R-33** | **多轮 LLM 重新问已答过的问题** | **LLM 注意力衰减导致重复** | **中** | **registry.userChoiceAsked 记录所有历史 + checklist 全部显示（不截断）+ tool 消息结构化保留 + 不强制拦截（设计上允许重复）** | **集成测试：mock LLM 重复调用 + 验证不拦截** |
| **R-34** | **多轮 SSE 连接反复创建** | **每轮一个新 HTTP 请求** | **低** | **现有 SSE 实现 + abortController 清理机制已成熟** | **手工测试：观察网络面板 SSE 连接数** |
| **R-35** | **多轮中用户关闭页面后回来** | **TURN 3 弹窗打开时用户关掉浏览器** | **中** | **userChoiceRequest 不持久化（设计取舍）；用户重连后需手动发新消息** | **手工测试：弹窗打开 → 关浏览器 → 重开页面 → 发新问题** |
| **R-36** | **多轮中用户中途换问题** | **TURN 3 弹窗打开时用户直接在聊天框输入新问题** | **中** | **前端应锁定聊天输入框直到弹窗关闭（**新增 UX 约束**）** | **手工测试：弹窗打开时尝试在输入框打字** |
| **R-37** | **多轮 messages 数组里有失败的 tool 消息** | **某轮工具执行异常** | **低** | **现有 `execError` 分支处理（line 1030-1036），生成 `Error: ...` 作为 tool 消息** | **回归测试：mock 工具抛错** |
| **R-38** | **TURN N-1 调了业务工具但 TURN N 的 LLM 没意识到** | **messages 数组中业务工具的 tool 消息在长上下文中被淹没** | **中** | **checklist 末尾汇总所有业务工具调用 + 表名/参数；LLM 在每轮请求前看到** | **集成测试：TURN 1 调 get_table_ddl，TURN 3 让 LLM 复用结果** |
| **R-39** | **多轮后 messages 数组的 token 数超过模型限制** | **理论上 15+ 轮后 messages 达 60K+** | **低** | **当前主 LLM `deepseek-v4-flash` (V4-Flash) 1M context；按每轮增长 3000-8000 tokens（保守值，含工具结果）计，实际可支撑 ~125-330 轮；本次不引入截断/压缩机制；未来 plan 单独做** | **监控：messages 长度超阈值告警（可设 800K）** |
| **R-40** | **TURN N LLM 决定不调工具直接生成 SQL，但 SQL 引用了未确认字段** | **LLM 跳过 Q1 答案用默认字段** | **中** | **简洁 user 答案（如"近7天, 华东区"）含完整 Q1 答案，LLM 自由决策；前端显示 SQL 后用户可手动指正** | **手工测试** |
| **R-41** | **多轮 checklist 中早期 userChoiceAsked 数量过多导致 checklist 过长** | **20+ 轮 user_choice 后 checklist 行达 1000+ tokens** | **中** | **question 预览限 50 字符（~50 tokens/项）；id 紧凑（6 字符）；上限依赖模型上下文窗口；如超限未来 plan 截断早期** | **监控：checklist 长度超阈值告警** |
| **R-42** | **多轮 `userChoiceRequest` state 在网络抖动时被旧值覆盖** | **TURN 2 done 到达时 TURN 1 弹窗还没关** | **低** | **前端：提交后立即 `setUserChoiceRequest(null)`，新一轮 done 到达才设新值；不存在中间态** | **手工测试：网速慢时观察 state 变化** |
| **R-43** | **checklist 误 push 到累积 messages 数组** | **实施时手滑 `messages.push(checklistMsg)` 或 `requestMessages.push(...)`** | **高** | **§2.5 实施检查点 + grep 验证 + 集成测试断言 llm_messages 不含 `[已调用]` 开头的 system 消息** | **grep + DB 内容检查** |
| **R-44** | **多轮 TURN N-1 末尾 checklist 在 TURN N 加载时被一起 loadMessagesFromDb 加载** | **历史 messages 误存 checklist** | **高** | **§2.5：saveMessagesToDb 只保存真实对话，不存 checklist；loadMessagesFromDb 不可能拿到 checklist（DB 中本就不存在）** | **DB 内容检查** |
| **R-45** | **多轮 TURN N 的 requestMessages 末尾 checklist 与 TURN N-1 的 messages 混淆** | **代码中 checklist 临时数组复用** | **中** | **const requestMessages = [...messages, checklistMsg]；requestMessages 是局部变量，作用域只到 fetch() 调用；不与 messages 共享引用** | **代码 review 强调局部性** |
| **R-46** | **checklist 在日志中泄露业务敏感信息（user_choice question 含敏感词）** | **question 含客户名/手机号等** | **低** | **日志已有按用户分文件 + 现有 sanitize 规则；如需加固可对 question 做正则脱敏（如手机号 → ****）** | **日志审计脚本** |
| **R-49** | **registry.userChoiceAsked Map 无限增长** | **超长会话（100+ 轮 user_choice）累积大量无用记录** | **中** | **本次不实现清理（依赖 `clearSessionRegistry` 在 session 结束时清理）；长会话监控 reg 大小；如需限制可保留最近 50 个** | **监控：reg.userChoiceAsked.size > 50 告警** |
| **R-50** | **Marker regex 边界：options 含 `}-->` 子串被误截断** | **LLM 问关于代码的问题（如 `function foo() {} --> bar`）** | **低** | **现有 regex `\{[\s\S]*?\}` 非贪婪匹配；如担心可改用 base64 编码 marker（需扩展 `buildUserChoiceMarker`）** | **单测：options 含 `}-->` 解析正确** |
| **R-51** | **弹窗内按 Enter 误触提交（reviewer #12 反馈）** | **用户填完文本按 Enter 想换行，但触发了提交** | **低** | **`onPressEnter={handleSubmit}` 绑定 + 验证 antd TextArea 行为（Shift+Enter 应换行）** | **手工测试：弹窗内 Enter vs Shift+Enter 行为** |
| **R-52** | **tool.func 返回结构化对象但 caller 忘记拆解，messages.push 存入对象而非 marker 字符串** | **实施时漏写 `toolMessageContent = rawResult.marker` 拆解代码** | **中** | **§5.2.C 实施检查点：所有 push tool 消息处用 `toolMessageContent` 而非 `rawResult`；单测验证 messages 中 tool content 是 string** | **单测 + 代码 review 强调** |

---

## 8. 测试计划

### 8.1 单元测试（每条对应一个具体函数）

| ID | 测试用例 | 期望结果 |
|----|----------|----------|
| UT-01 | `buildUserChoiceMarker` 正常参数 | 返回含 `<!--user_choice:{json}-->` 的字符串 |
| UT-02 | `buildUserChoiceMarker` 超长 question | 截断到 500 字 |
| UT-03 | `buildUserChoiceMarker` 超 8 项 options | 截断到 8 项 |
| UT-04 | `buildUserChoiceMarker` 9 字符 header | 截断到 12 字 |
| UT-05 | 工具 func 空 question | 返回错误字符串 |
| UT-06 | 工具 func 空 options | 返回错误字符串 |
| UT-07 | 工具 func 字符串入参 | 正确解析（`typeof params === 'string'`） |
| UT-08 | `checkAndFilterDuplicateCall('request_user_choice', ...)` | 返回 `{ block: false }` |
| UT-09 | `recordToolCall('request_user_choice', {id, question, options, ...}, sessionId)` | registry.userChoiceAsked 含对应记录 |
| UT-10 | `buildToolCallChecklistMessage` 含 userChoiceAsked | checklist 出现 `request_user_choice:[uc_xxx: "..."]` |
| UT-11 | 工具循环 mock 工具返回含 marker → 终止分支触发 | yield done 含 userChoiceRequest |

### 8.2 集成测试

| ID | 场景 | 步骤 | 期望 |
|----|------|------|------|
| IT-01 | 单选提交流程 | 1.用户问"统计近 7 天销量" 2.LLM 调 request_user_choice(options=[7天,30天,90天]) 3.前端弹窗 4.用户选"7天" + 提交 5.TURN 2 LLM 收到回复 6.生成 SQL | 弹窗显示 + LLM 继续 + SQL 正确 |
| IT-02 | 多选+文本补充 | 用户多选 2 项 + 填"含退款" | TURN 2 user 消息 = "A, B + 含退款"（简洁） |
| IT-03 | 仅文本不勾选 | 用户直接输入文本提交 | TURN 2 user 消息 = "含退款"（简洁） |
| IT-04 | 取消 | 用户点取消 | TURN 2 user 消息 = "用户取消了选择"（简洁） |
| IT-05 | 业务工具跨轮持久 | TURN 1 LLM 调 get_table_ddl(order_student, short=1) → TURN 2 | registry 复用，checklist 提醒，重复调被拦截 |
| IT-06 | 服务重启后 TURN 2 | TURN 1 后重启后端，TURN 2 提交 | TURN 2 LLM 看到 messages（含 tool）但 registry 丢失；新工具调不被拦截（降级） |
| IT-07 | 弹窗打开时刷新 | TURN 1 弹窗显示后用户刷新 | 弹窗消失（设计取舍），用户需重新提问 |
| IT-08 | TURN 1 LLM 流式输出后调工具 | LLM 输出"好的，请稍等"后调 request_user_choice | assistant 气泡显示引导文字 + 弹窗 |
| IT-09 | 工具调用链：调 user_choice + 其他工具 | LLM 一次调 get_table_ddl + request_user_choice | 先执行 get_table_ddl，user_choice 触发后终止 |
| IT-10 | TURN 2 LLM 再次调 user_choice | TURN 2 LLM 觉得还需确认 | 弹窗再次打开（userChoiceRequest state 正确重置） |
| **IT-11** | **连续 3 轮 user_choice** | **TURN 1 问 Q1 → 用户答 → TURN 2 问 Q2 → 用户答 → TURN 3 问 Q3 → 用户答 → TURN 4 出 SQL** | **每次弹窗正确显示；TURN 4 messages 数组含 3 个 user/assistant(tool_calls)/tool 三元组 + 1 个 user/assistant SQL 三元组** |
| **IT-12** | **3 轮 user_choice + 业务工具混合** | **TURN 1: user_choice(Q1) → 答 → TURN 2: get_table_ddl → TURN 3: user_choice(Q2) → 答 → TURN 4: 出 SQL** | **业务工具调在 user_choice 中间执行；messages 数组保持完整顺序；registry 持续累积** |
| **IT-13** | **TURN N LLM 主动不再问问题** | **TURN 2 用户答完 Q1 后 LLM 直接生成 SQL** | **TURN 2 done 无 userChoiceRequest；弹窗不再打开** |
| **IT-14** | **TURN N LLM 在同一轮调 user_choice + 业务工具** | **TURN 2: LLM 调 get_table_ddl + request_user_choice(Q2)** | **get_table_ddl 先执行，user_choice 后执行但触发终止；TURN 3 messages 含两个 tool 消息** |
| **IT-15** | **TURN N 用户取消** | **TURN 2 弹窗取消** | **TURN 3 LLM 收到"用户取消了选择"消息，决定下一步** |
| **IT-16** | **TURN N 弹窗打开时用户在聊天框输入新问题** | **弹窗未关闭时尝试输入** | **聊天输入框应被禁用/锁住（前端 UX 约束）** |
| **IT-17** | **多轮后 messages 数组增长** | **模拟 5 轮 LLM 请求** | **每轮 messages 长度线性增长 ~500-2000 tokens；`llm_messages` 整体更新** |
| **IT-18** | **多轮 checklist 显示全部 userChoiceAsked** | **5 轮后调用 `buildToolCallChecklistMessage`** | **显示全部 5 个 `request_user_choice:[...]` 项，question 预览各 50 字符** |
| **IT-19** | **多轮 checklist 不污染 messages 数组** | **TURN 3 完成后查询 `llm_messages.messages` JSON** | **断言：JSON 数组中无 `role=system` 且 `content` 以 `[已调用]` 开头的消息** |
| **IT-20** | **多轮 TURN N requestMessages 末尾含 checklist，TURN N+1 的 messages 不含** | **mock LLM 5 轮请求，每轮 fetch 前快照 requestMessages** | **每轮 requestMessages 末尾 1 条 system 消息（checklistMsg）；TURN N+1 加载的 messages 数组不含这条** |
| **IT-21** | **grep 辅助验证代码中无 `messages.push(checklistMsg)`** | **`grep -rn "messages.push.*checklist" backend/src/services/llm.js`** | **无匹配（除注释外）—— 注意 grep 只能抓字面量 `messages.push`，抓不到 `arr.push(checklistMsg)`，所以 IT-19 的 DB 断言是主验证** |

### 8.3 验证脚本

新增 `tests/test_request_user_choice.mjs`（基于 Node 直接调函数）：
- 测试 marker 生成、参数校验、registry 行为
- 不依赖 LLM 实际调用（mock 工具返回值）

### 8.4 手工验收（QA 阶段）

- [ ] 端到端流程：登录 → 提问 → LLM 弹窗 → 提交 → LLM 继续 → 执行 SQL
- [ ] 多选场景：勾 2 项 + 文本
- [ ] 仅文本场景
- [ ] 取消场景
- [ ] 弹窗打开期间刷新页面
- [ ] 同一 session 多次 user_choice
- [ ] 跨多轮：弹窗 → 提交 → LLM 再调工具 → 不弹窗 → 出 SQL
- [ ] 服务重启后跨轮
- [ ] 检查 `logs/YYYY-MM-DD/{username}_llm.log` 含 `🔔 TURN 1 终止 - user_choice 请求` 记录
- [ ] 检查 `llm_messages.messages` JSON 含 `tool` role 的 marker 消息
- [ ] 检查 `messages` 表 assistant 行 content 是 LLM 引导文本（不含 marker 原始 HTML 注释）

---

## 9. 实施顺序（任务清单）

| # | 任务 | 文件 | 估时 | 依赖 |
|---|------|------|------|------|
| T1 | 新增 `request_user_choice` 工具函数和 DynamicTool | `toolFuncs.js` | 30min | 无 |
| T2 | 新增 registry 字段 `userChoiceAsked` | `llm.js` | 10min | 无 |
| T3 | 新增 `checkAndFilterDuplicateCall` 分支（不拦截） | `llm.js` | 5min | T2 |
| T4 | 新增 `recordToolCall` 分支 | `llm.js` | 10min | T2 |
| T5 | 新增 `buildToolCallChecklistMessage` 一行 | `llm.js` | 10min | T2 |
| T6 | 工具循环内检测 + 终止分支（核心逻辑） | `llm.js` | 40min | T2 |
| T7 | query.js 捕获事件字段 + 写入 doneData | `query.js` | 15min | T6 |
| T8 | 新增 UserChoiceDialog 组件 | `components/UserChoiceDialog.jsx` | 40min | 无 |
| T9 | App.jsx 新增 state + handler + 渲染 | `App.jsx` | 30min | T7, T8 |
| T9a | **多轮聊天输入框锁**（UX 约束） | **App.jsx** | **10min** | **T9** |
| T9b | **多轮 UX 连贯性（§2.5 5 项）** | **App.jsx + UserChoiceDialog.jsx** | **30min** | **T9** |
| T9c | ~~§2.5.F 历史回看元数据展示 + §2.5.G 多轮历史展示~~ | ~~App.jsx + 新增 UserChoiceMetaLine.jsx~~ | ~~15min~~ | **取消（消息格式简化后天然支持）** |
| T10 | 更新 SKILL.md | `SKILL.md` | 10min | T1 |
| T11 | 同步 SKILL.md 到 skill_back 目录 | `skills/skill_back/.../SKILL.md` | 5min | T10 |
| T11a | **多轮集成测试**（IT-11 ~ IT-18） | `tests/test_request_user_choice_multi.mjs` | 40min | T13 |
| T12 | 编写验证脚本 | `tests/test_request_user_choice.mjs` | 30min | T1-T6 |
| T13 | 运行验证 + 集成测试 + 修复 | - | 60min | T1-T12 |
| T14 | 更新 project_memory.md 记录新约束 | `project_memory.md` | 10min | T13 |
| T15 | 更新 CHANGELOG.md | `CHANGELOG.md` | 5min | T13 |

**总估时**：~5.5h（含多轮测试和修 bug）

---

## 10. 不确定 / 待用户决策

| # | 问题 | 候选方案 | 我的建议 |
|---|------|----------|----------|
| Q-01 | TURN 2 user 消息格式 | A: 我设计的 wrapper `[用户对选择请求的回复] 问题: ...`  B: **简洁答案（"近7天" 或 "近7天, 华东区"）**  C: 更详细（含 reasoning） | **B（更自然，聊天记录可读，LLM 通过上下文关联）** |
| Q-02 | 弹窗样式（颜色/位置） | A: 浮层（贴聊天区底部）  B: 模态框（覆盖全屏）  C: 抽屉（侧边） | A（与 confirmTagAdd 一致，UX 延续） |
| Q-03 | `multi_select` 默认值 | A: false（单选）  B: true（多选）  C: LLM 必须显式传 | A + C 组合（LLM 不传则 false） |
| Q-04 | 选项数上限 8 | A: 8  B: 5  C: 不限 | 8（与 Antd Radio/Checkbox.Group 推荐数对齐） |
| Q-05 | 取消时是否通知 LLM | A: 通知（简洁消息"用户取消了选择"）  B: 不通知（用户重新提问） | A（保证 LLM 有完整上下文） |
| Q-06 | 弹窗内输入是否限字符 | A: 500  B: 200  C: 1000 | 500（与 question 上限一致） |
| **Q-07** | **多轮聊天输入框是否锁住** | **A: 弹窗打开时禁用输入框  B: 不禁用（允许发新问题）  C: 禁用且占位符提示** | **C（防误操作 + UX 引导）** |
| **Q-08** | **多轮 checklist 显示多少个 userChoiceAsked** | **A: 最近 3 个  B: 全部  C: 不显示（只看 messages 数组）** | **B（与其他工具一致：termConfirmed/tableSchema 都不截断；截断会导致 LLM 重新问早期问题）** |
| **Q-09** | **LLM 在 TURN N 问过同一问题（重复）时是否拦截** | **A: 不拦截（设计原则）  B: 拦截完全相同 (question, options)  C: 拦截同 question** | **A（不拦截，让 LLM 自由决策；早期问题答案已在 user message 中）** |
| **Q-10** | **多轮中 messages 数组 token 超限时的处理** | **A: 不处理（依赖模型硬限）  B: 截断最早 messages  C: 摘要压缩** | **A（本次不解决；未来单独 plan 引入压缩）** |

---

## 11. 回归影响

### 11.1 已有功能不受影响

- `request_tag_confirmation` 流程不变（不动其代码）
- `get_tables` / `get_sliced_index` / `get_table_schema` / `get_table_ddl` 工具不变
- LLM 工具剪枝逻辑不变（只剪 get_domain_index / get_sliced_index）
- SSE 事件类型不变（新增 `chunk.userChoiceRequest` 字段是 done 事件的可选字段）
- `messages` 表 schema 不变
- `llm_messages` 表 schema 不变

### 11.2 前端可见变化

- 聊天区底部可能出现 "需要您输入" 蓝色提示框（弹窗）
- 弹窗样式与现有"是否将术语添加到表" 黄色框风格区分（蓝色 vs 黄色）
- 弹窗关闭后，聊天继续，UI 自动滚动

### 11.3 后端可见变化

- `logs/YYYY-MM-DD/{username}_llm.log` 多一条 `🔔 TURN 1 终止 - user_choice 请求` 记录
- 开发调试接口 `GET /api/query/messages` 返回的 messages 数组多一个 `tool` role 项

---

## 12. 附录：关键代码索引（实施时查阅）

| 文件 | 关键行号/位置 | 用途 |
|------|--------------|------|
| `toolFuncs.js` | line 285-462 (tools 数组) | 插入新 DynamicTool |
| `llm.js` | line 248-265 (registry) | 新增 userChoiceAsked 字段 |
| `llm.js` | line 305-332 (buildToolCallChecklistMessage) | 新增一行 |
| `llm.js` | line 340-493 (checkAndFilterDuplicateCall) | 新增分支 |
| `llm.js` | line 496-523 (recordToolCall) | 新增分支 |
| `llm.js` | line 1011-1046 (工具执行阶段 3) | 检测 user_choice 触发 break |
| `llm.js` | line 1064-1069 (done yield) | 插入终止分支 |
| `query.js` | line 432-435 (done 处理) | 捕获 userChoiceRequest |
| `query.js` | line 488-509 (doneData 构造) | 写入 user_choice_request |
| `App.jsx` | line 109-114 (state 声明区) | 新增 useState |
| `App.jsx` | line 831-849 (done SSE 处理) | 检测并设置 userChoiceRequest |
| `App.jsx` | line 883-897 (handler 区) | 新增 handleSubmit/CancelUserChoice |
| `App.jsx` | line 1700 附近 (渲染区) | 渲染 UserChoiceDialog |
| `SKILL.md` | line 60 之后 | 新增"## 用户交互"章节 |

---

## 13. 审批与签署

- [ ] 用户审批本方案（含多轮模型 §2.4）
- [ ] 用户审批 §2.5 前端 UX 连贯性硬约束（5 项：A 简洁 user 气泡 / B loading 连续 / C 过渡语 / D 继续角标 / E 聊天框锁定；**F/G 由简洁消息格式天然支持**）
- [ ] 用户审批 §2.6 Checklist 生命周期硬约束（"checklist 不在历史 messages 中"）
- [ ] 用户确认第 10 节"待决策"项（Q-01 ~ Q-10）
- [ ] 用户确认第 9 节实施顺序（含 T9a 输入框锁 + T9b UX 连贯性 + T11a 多轮测试；**T9c 取消**）
- [ ] 用户确认第 7 节风险登记册的缓解措施（含 R-31 ~ R-52 多轮专项风险）

审批通过后按 T1-T15（含 T9a, T9b, T11a）顺序实施。

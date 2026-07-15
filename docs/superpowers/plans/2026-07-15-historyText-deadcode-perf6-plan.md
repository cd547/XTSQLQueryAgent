# Plan: historyText 死代码 + PERF-6 llm_messages 序列化优化

> **创建日期**: 2026-07-15
> **状态**: ⏸️ 待需要时再实施（DESIGN-FROZEN）
> **关联**:
> - [CODE_ANALYSIS_2026-07-15-generate.md](../../superpowers/reviews/CODE_ANALYSIS_2026-07-15-generate.md) 第 Q-7 / P-4 节
> - [project_memory.md](../../../c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/project_memory.md) 待追加 Lessons Learned

---

## 1. 背景

2026-07-15 `/generate` 后端代码审查时，发现两个**非阻塞**的优化点：

1. **historyText 死代码**：`query.js` 装载的 `historyText` 从未到达 LLM context
2. **PERF-6 JSON 全量序列化**：`saveMessagesToDb` 30 轮对话写 30 次

两个问题均**不影响当前功能**（仅性能 / 维护性 / 误导性），且都属于"未来场景下需要"的状态——按用户要求**先记录不实施**。

---

## 2. historyText 死代码

### 2.1 现象

`query.js:325-339` 加载最近 20 条 user/assistant 消息，拼接成 `historyText`：

```js
// query.js:325-337
let historyText = '';
if (sessionId) {
  const db = getDb();
  const messages = db.prepare(`
    SELECT content, sql FROM messages
    WHERE session_id = ? AND role IN ('user', 'assistant')
    ORDER BY id DESC LIMIT 20
  `).all(sessionId);
  historyText = messages.reverse().map(m => `用户: ${m.content}\n助手: ${m.sql || ''}`).join('\n');
}
```

随后传入 [query.js:369](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L369)：

```js
const generator = generateSQLWithLangChainStreamGen_BAK(
  question, historyText,         // ← 第 2 个参数
  abortController.signal, sessionId, req.user.username
);
```

`llm.js:683` 函数签名：

```js
export async function* generateSQLWithLangChainStreamGen_BAK(
  question, history = '', signal, sessionId = null, username = null
) {
  logger.info('...', { ..., historyLength: history?.length, ... });
  //                       ↑ 仅写日志
  // ... 函数体 L686-1237 全文未引用 history
}
```

**`grep historyText llm.js` 命中 0 次**——形参 `history` 在函数体内**从未被消费**。

### 2.2 真实 LLM context 历史来源

| 维度 | `messages` 表（死路径）| `llm_messages` 表（实际生效）|
|------|----------------------|---------------------------|
| 加载位置 | [query.js:331-336](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L331-L336) | [llm.js:716](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L716) |
| 字段 | `content, sql` | `messages` (JSON blob) |
| 数据量 | 最近 20 条 | **完整**历史（每轮全量）|
| 实际作用 | ❌ **未使用** | ✅ LLM 看到的真实历史 |

`llm_messages.messages` 是**每轮 LLM 响应后**通过 [llm.js:1050](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1050) `saveMessagesToDb(sessionId, messages)` 立即序列化的完整 JSON 数组（含 system + user + assistant tool_calls + tool returns）。

### 2.3 已实施动作（2026-07-15）

**临时禁用入口**（保留代码 + 加注释）：

```js
// [DEAD-CODE 2026-07-15] historyText 当前未被 llm.js 消费（llm.js 用 llm_messages.messages JSON blob）
// 保留这段代码以备未来"双上下文"设计（如：用 messages 表做更精细的 token 控制 / 摘要压缩 / 工具调用审计）
// 恢复方法：在 llm.js:683 generateSQLWithLangChainStreamGen_BAK 函数体内使用 history 形参
let schema = '';
let historyText = '';
if (false && sessionId) {  // ← 临时禁用入口，避免无谓 SQL 查询
  const db = getDb();
  // 取最近 20 条消息（长对话保留近期上下文），再翻转成时间正序拼入 prompt
  const messages = db.prepare(`
    SELECT content, sql FROM messages
    WHERE session_id = ? AND role IN ('user', 'assistant')
    ORDER BY id DESC LIMIT 20
  `).all(sessionId);
  historyText = messages.reverse().map(m => `用户: ${m.content}\n助手: ${m.sql || ''}`).join('\n');
}
```

`llm.js:683` 函数体注释同步：

```js
// [DEAD-CODE 2026-07-15] history 形参当前未在函数体内被消费：
//   - query.js:325-339 的 historyText 装载逻辑已被临时禁用（`if (false && sessionId)`）
//   - 真实 LLM context 历史来自 llm_messages.messages（loadMessagesFromDb）
//   - 恢复方法：在本函数体内把 history 注入到 system message 或 user message 之前
//     （注意：会影响 DeepSeek prefix cache，因为 system 变了）
```

**为什么用 `if (false && ...)` 而不是删除**：
- 保留代码 + 注释 = **未来恢复时无需 Git blame / git revert**
- `if (false && ...)` = **运行时不执行，避免无谓 SQL 查询**
- 注释中明确"恢复方法"——新成员能立即理解为什么有这段死代码

### 2.4 触发恢复使用的场景

| 场景 | 描述 | 优先级 |
|------|------|--------|
| **场景 1: 工具调用审计** | 需要展示"LLM 实际使用过哪些历史信息"做 token 成本分析 | 低（可选）|
| **场景 2: 摘要压缩** | V4-Flash 1M context 撑不住时，把 historyText 改成"旧轮 user/assistant 摘要" | 中（500 轮+）|
| **场景 3: 双上下文设计** | `messages` 表做"展示历史"、`llm_messages` 做"LLM context"，通过 `historyText` 桥接 | 低（设计重构）|

### 2.5 风险评估

| 风险 | 评估 |
|------|------|
| 误用 historyText | 极低（`if (false && ...)` 阻止执行；注释明确警告）|
| 未来遗忘 | 低（注释 + cross-reference 到本 plan 文档）|
| 误删 llm.js 形参 | 中（如果有人看到 `history = ''` 以为是没用的，删除 → 未来恢复时缺参数）|
| **预防措施** | 注释明确"形参保留但未消费"——禁止删除直到本 plan 文档标记为 "DELETED" |

---

## 3. PERF-6 llm_messages JSON 序列化优化

### 3.1 现状量化

| 指标 | 数值 |
|------|------|
| **写入次数** | 30 轮对话 → **30 次** `saveMessagesToDb` |
| **每次写入字节** | 第 N 轮写 ≈ N × 5KB（messages 数组持续增长）|
| **30 轮累计 IO** | 5+10+15+...+150 = **~750KB** |
| **典型场景影响** | 桌面单用户 → 实际**几乎无感** |
| **触发优化场景** | 1. web 部署多用户并发 2. 500 轮级长对话 |

### 3.2 写入点分布

| # | 文件位置 | 触发条件 |
|---|---------|---------|
| 1 | [llm.js:1050](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1050) | **每轮** LLM 响应 + `messages.push(assistantMsg)` 之后 |
| 2 | [llm.js:1192](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1192) | `request_user_choice` 终止 TURN 1 时再写一次（保证 Turn 2 能 load）|

### 3.3 方案 A：去重中间轮写入（**推荐**）

**核心思路**：只保留**终态写入**，去掉中间轮"每轮都写"。

**改动点**（5 行）：

| 位置 | 改动 | 行为变化 |
|------|------|---------|
| [llm.js:1048-1051](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1048-L1051) | **删除** `saveMessagesToDb` 调用 | 中间轮不写 |
| [llm.js:1234-1236](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1234-L1236)（`yield done` 之前）| **新增** `saveMessagesToDb` | 终态必写 |
| [llm.js:1209-1237](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1209-L1237) 异常 yield error 路径 | **新增** `saveMessagesToDb` | 错误态也持久化（前端可读历史）|
| [llm.js:1192](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1192) user_choice 终止 | **保留** | TURN 1 终止时必写（Turn 2 要 load）|

**实施代码片段**：

```js
// L1044 messages.push(assistantMsg) 之后
// 移除原 L1050 if (sessionId) saveMessagesToDb(sessionId, messages);

// 终态 L1234 之前
if (sessionId) {
  try {
    saveMessagesToDb(sessionId, messages);
  } catch (e) {
    logger.error('Failed to save final messages', { sessionId, error: e.message });
  }
}
yield { type: 'done', sql, message: responseText };
```

**收益 / 风险**：

| 维度 | 评估 |
|------|------|
| 写入次数 | **30 → 1**，**30 倍**降低 |
| 写入字节 | 30 轮 × 5-150KB → 1 次 150KB = **几乎不变**（最后一次最大）|
| 改动量 | ~5 行 |
| 兼容性 | **完全兼容**（无 schema 变更）|
| 风险 | **进程崩溃会丢最近 1 轮**——下次请求从 N-1 轮开始 |
| 可接受度 | 桌面单用户 + LLM 本身不确定性强，丢 1 轮可接受 |
| 实施难度 | **10 分钟** |

### 3.4 方案 B：增量只写新消息

**核心思路**：每次只写本轮新增的 1-2 条消息（assistantMsg + tool return），读时合并。

**新表 schema 迁移**（[sqlite.js:198](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L198) 附近）：

```sql
CREATE TABLE IF NOT EXISTS llm_message_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER,
  turn_index INTEGER,          -- 第几轮
  new_messages TEXT,            -- 本轮新增 1-2 条消息 JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX idx_llm_diffs_session_turn ON llm_message_diffs(session_id, turn_index);
```

**写入路径**：

```js
// 写入：计算本轮新增的 messages
const persistedTurns = db.prepare(
  'SELECT MAX(turn_index) as maxTurn FROM llm_message_diffs WHERE session_id = ?'
).get(sessionId)?.maxTurn || 0;
const currentTurn = maxToolCallsInitial - maxToolCalls;  // 当前轮数
if (currentTurn > persistedTurns) {
  const newMessages = messages.slice(persistedTurns * 2);  // 每轮 ~2 条
  db.prepare('INSERT INTO llm_message_diffs (session_id, turn_index, new_messages) VALUES (?, ?, ?)')
    .run(sessionId, currentTurn, JSON.stringify(newMessages));
}
```

**读取路径**：

```js
const diffs = db.prepare(
  'SELECT new_messages FROM llm_message_diffs WHERE session_id = ? ORDER BY turn_index ASC'
).all(sessionId);
const messages = [];
for (const diff of diffs) {
  messages.push(...JSON.parse(diff.new_messages));
}
```

**收益 / 风险**：

| 维度 | 评估 |
|------|------|
| 写入次数 | 30 次（不变） |
| 写入字节 | 30 × 1KB = **30KB**（vs 750KB，**25 倍降低**）|
| 改动量 | ~50 行（schema + 读写逻辑）|
| 兼容性 | **破坏兼容**：旧 `llm_messages.messages` 需迁移（一次性脚本）|
| 风险 | turn_index 错位 → 历史乱序；schema 迁移复杂 |
| 实施难度 | **1-2 小时** |

### 3.5 方案 C：混合策略

**核心思路**：主路径走方案 A（去重）；增加**未完成轮次**的短期内存 cache 用于崩溃恢复。

**改动点**：

```js
// L1050 改为：写到内存 cache，不立即落盘
sessionMessageCache.set(sessionId, JSON.parse(JSON.stringify(messages)));

// 新增：定期 flush 钩子（每 5 轮 flush 一次）
// 或在 yield done 前 flush

// 进程启动时：扫描 sessionMessageCache 中未 flush 的 session，fallback 落盘
```

**收益 / 风险**：

| 维度 | 评估 |
|------|------|
| 写入次数 | 1-6 次 |
| 写入字节 | 略低于方案 A |
| 改动量 | ~30 行（cache + 启动恢复）|
| 复杂度 | 中（需要 cache 失效机制）|
| 实施难度 | **30 分钟** |

### 3.6 三方案对比

| 维度 | 方案 A（去重）| 方案 B（增量）| 方案 C（混合）|
|------|-------------|-------------|-------------|
| 写入次数 | **1 次** ✅ | 30 次 | 1-6 次 |
| 写入字节 | 150KB | **30KB** ✅ | 100-150KB |
| 改动量 | **5 行** ✅ | 50 行 | 30 行 |
| 兼容性 | **完全兼容** ✅ | 需迁移 | 完全兼容 |
| 风险 | 进程崩溃丢 1 轮 | 顺序错位 | 复杂度↑ |
| 实施难度 | **10 分钟** | 1-2 小时 | 30 分钟 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

### 3.7 推荐选择：**方案 A**

**理由**：
1. **改动最小**（5 行），风险最低
2. **写次数从 30 降到 1**，CPU/IO 收益已经到位
3. **写入字节几乎不变**（最后一次最大），方案 B 字节优势不明显
4. **桌面单用户**下，进程崩溃极端情况可接受
5. **保留升级路径**：未来真需要 500 轮场景，可以再升级到方案 B
6. **向后兼容**：无 schema 变更，部署时无需停机迁移

---

## 4. 实施触发条件（决策树）

```
当下一次发生以下情况时，启动实施：
├── 用户反馈"长对话慢" 或 "切会话慢"
├── 500 轮级会话触发 context 警告
├── 部署到 web 多用户并发场景
└── 监控数据显示 saveMessagesToDb 调用 > 30 次/会话

优先级：
- 触发现象"长对话慢"     → 实施 方案 A（10 分钟搞定）
- 触发现象"500 轮 context 警告"  → 同步实施 方案 A + 方案 B
- 仅触发现象"web 部署"   → 暂不优化（web 部署前先压测，定位瓶颈）
```

---

## 5. 实施时序（选定方案后）

### 5.1 方案 A 实施步骤

1. **改 [llm.js:1048-1051](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1048-L1051)**：注释 + 删除 `saveMessagesToDb(sessionId, messages)` 调用
2. **改 [llm.js:1232-1236](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1232-L1236)**：在终态 `yield done` 之前新增 `saveMessagesToDb`
3. **改 [llm.js:1207-1237](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1207-L1237)**：异常 yield error 路径也持久化
4. **保留 [llm.js:1192](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1192) user_choice 路径**的 `saveMessagesToDb`（TURN 1 终止边界必须写）
5. `node --check backend/src/services/llm.js` 语法检查
6. 手动跑 30 轮对话验证：
   - 监控 `saveMessagesToDb` 日志频率（应 = 1 次/会话）
   - 中途 kill 进程模拟崩溃 → 重启后下一轮从 N-1 开始（确认 1 轮丢失可接受）
7. 更新 [project_memory.md](../../../c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/project_memory.md) Lessons Learned
8. 写 CHANGELOG

### 5.2 回滚方案

如果方案 A 引发未预期的数据丢失问题（实测发现丢 1 轮体验差），临时回滚：

```js
// L1048-1051 恢复 saveMessagesToDb 调用
if (sessionId) {
  saveMessagesToDb(sessionId, messages);
}
```

---

## 6. 验证清单

**实施后必跑**：

- [ ] `node --check backend/src/services/llm.js` 通过
- [ ] 单元测试 `test-llm-timeout.mjs` 14/14 通过
- [ ] 单元测试 `test-skill-cache.mjs` 10/10 通过
- [ ] 单元测试 `test-sql-validator.mjs` 86/86 通过
- [ ] 单元测试 `test-fs-utils.mjs` 13/13 通过
- [ ] 手动 30 轮对话：监控 `saveMessagesToDb` 日志频率 = 1 次/会话
- [ ] 手动 30 轮对话 + user_choice 场景：TURN 1 终止 → TURN 2 加载正确
- [ ] 手动 kill -9 进程模拟崩溃：下一轮从 N-1 开始（确认可接受）
- [ ] 后端日志路径 `logs/YYYY-MM-DD/{username}_llm.log` 内容正常

---

## 7. 不实施的原因（DESIGN-FROZEN 状态）

按用户 2026-07-15 明确要求"日后需要时再改"，本文档将以下内容**冻结**：

1. ✅ `historyText` 临时禁用入口（`if (false && ...)`）已生效
2. ⏸️ PERF-6 三个方案**待触发**（决策树 §4）
3. ⏸️ 任何对 `historyText` 或 `saveMessagesToDb` 的优化，**除非**满足触发条件

**后续动作**：
- 每次启动新会话前，简要 review 本 plan
- 用户明确要求"现在改"时，按选定方案直接实施
- 监控数据（`saveMessagesToDb` 频率、单次字节）出现明显异常时，触发评估

---

## 8. 关联文档

- [CODE_ANALYSIS_2026-07-15-generate.md §5 Q-7 / P-4](../../superpowers/reviews/CODE_ANALYSIS_2026-07-15-generate.md#五已发现的问题与建议)
- [CODE_REVIEW_2026-06-20.md DEAD-04 / DEAD-05](../reviews/CODE_REVIEW_2026-06-20.md)
- [project_memory.md L34 (V4-Flash 1M context 撑 500 轮)](../../../c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/project_memory.md)
- [deepseek_v3_tokenizer 历史](https://api-docs.deepseek.com/guides/thinking_mode)

---

> 🤖 Generated with [Trae IDE](https://trae.ai) (MiniMax-M3)
> **生成日期**: 2026-07-15
> **状态**: ⏸️ DESIGN-FROZEN

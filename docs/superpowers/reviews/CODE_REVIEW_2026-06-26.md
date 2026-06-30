# 🔍 XTSQLQueryAgent 项目代码审查报告

> **审查日期**: 2026-06-26
> **审查范围**: 全项目（后端 / 前端 / Electron）
> **代码量**: ~4,500 行

---

## 项目概况

| 层级 | 技术栈 |
|------|--------|
| 桌面壳 | Electron 42 |
| 后端 | Express.js + better-sqlite3 + mysql2 |
| 前端 | React 18 + Vite 5 + Ant Design 5 + Monaco Editor |
| 本地存储 | SQLite (WAL 模式) |
| 查询目标 | MySQL |
| LLM | DeepSeek / OpenAI / MiniMax / Ollama |
| 鉴权 | JWT (httpOnly Cookie + token_version 吊销) |

---

## 🔴 严重 Bug

> **修复状态总览（截至 2026-06-30 复核）**:
>
> | 类别 | 已修 | 待修 | 不修/暂缓 | 明细 |
> |------|------|------|-----------|------|
> | 🔴 P0 严重 Bug | 3/3 | 0 | 0 | BUG-1、BUG-2、BUG-4 |
> | 🔴 P1 重要 Bug | 3/3 | 0 | 0 | BUG-3、BUG-5、BUG-6 |
> | 🟡 P2 中等 Bug | 3/4 | 0 | 2 ⏸️ | BUG-7、BUG-9、BUG-11 已修；BUG-8、BUG-10 不修 |
> | 🟢 P3 性能 | 2/6 | 4 | 1 ⏸️ | PERF-4、PERF-7 已修；PERF-1/2/5/6 待修；PERF-3 暂不实施 |
> | 🟢 P3 安全 | 1/3 | 1 | 1 ⏸️ | **SEC-1 ✅ 已修复**；SEC-2 待修；SEC-3 暂缓（计划由 LLM 验证替代） |
> | 🟢 P3 代码质量 | 1/5 | 4 | 0 | CODE-2 已修；CODE-1、CODE-3、CODE-4、CODE-5 待修 |
> | 🟢 P3 Bug 其他 | 1/1 | 0 | 0 | BUG-12 已修（防御性 await） |
> | 🔴 P0 本轮新发现 | 1/1 | 0 | 0 | NEW-1 |
> | 🟡 P2 本轮新发现 | 2/2 | 0 | 0 | NEW-2、NEW-6 |
> | 🟢 P3 本轮新发现 | 3/3 | 0 | 0 | NEW-3、NEW-4、NEW-5 |
> | **合计** | **20/30 (66.7%)** | **9** | **4** | 含 ⏸️ 不修/暂缓 4 项时为 **20/34 (58.8%)** |
>
> *2026-06-26 决定：BUG-8、BUG-10 标记为 ⏸️ 不修（不进入本轮修复范围）。BUG-10 上一轮回复曾误标"已修复"，已更正。*
>
> *2026-06-29 增量修复：PERF-7（fs.readFileSync 异步化）、NEW-5（axios 4xx/5xx 拦截器）、NEW-6（agent loop 工具并行）。*
>
> *2026-06-30 增量修复：SEC-1（stripSqlComments 状态机重写 + 两阶段校验）、BUG-7（三层超时：T2 fetch 120s / T3 整体 5min / T4 reader 30s + withTimeout helper）。SEC-3 暂缓（计划由 LLM 验证替代，当前部署只读 MySQL 用户，威胁面已收窄）。*
>
> *复核日期：2026-06-30（消除汇总表 / 优先级表 / 详细章节之间的不一致）*

### BUG-1: `skill.js` 中 4 个关键 API 路由完全未注册 ✅ 已修复

**文件**: [backend/src/routes/skill.js:208](backend/src/routes/skill.js#L208)
**优先级**: P0 — 功能完全不可用

```javascript
// 第 208 行 — export 放在了路由定义之前！
export default router;

// ⚠️ 以下 4 个路由永远不会被注册（定义在 export 之后）:
router.post('/save', ...)              // 第 210 行 — 保存 Skill 文件
router.post('/check-table', ...)       // 第 334 行 — 检查表是否存在
router.post('/fetch-ddl', ...)         // 第 353 行 — 获取 DDL
router.post('/create-table-files', ...) // 第 400 行 — 创建表文件
```

**影响**: 前端"添加表格"功能（Steps 1-3）和 Skill 文件编辑保存功能完全不可用。所有请求都返回 404。

**修复**: 将 `export default router;` 移到文件末尾（第 502 行之后）。

---

### BUG-2: `skill.js` save 路由 catch 块中的 `ReferenceError` ✅ 已修复

**文件**: [backend/src/routes/skill.js:238-282](backend/src/routes/skill.js#L238)
**优先级**: P0 — 错误处理自身崩溃

```javascript
router.post('/save', (req, res) => {
  // ...
  try {
    let oldContent = '';  // ← let 作用域仅限于此 try 块
    // ...
  } catch (e) {
    // 尝试记录失败日志
    try {
      stmt.run(
        'save', filePath, backupFilePath || null,
        oldContent || '',  // ← ReferenceError! oldContent 在此作用域中不存在
        content, 'failed', e.message
      );
    } catch (logErr) { ... }
  }
});
```

**影响**: 当文件保存过程中抛出异常时，错误日志写入本身会因 `ReferenceError` 崩溃，原始异常信息丢失。

**修复**: 将 `let oldContent = '';` 提升到 try/catch 之前。

---

### BUG-3: `getDb()` 单例存在竞态条件 ✅ 已修复

**文件**: [backend/src/db/sqlite.js:21-35](backend/src/db/sqlite.js#L21)
**优先级**: P1 — 资源泄漏
**修复日期**: 2026-06-26

```javascript
let db;

export function getDb() {
  if (!db) {           // ← 两个并发调用可能同时通过此检查
    db = new Database(dbPath, { ... });  // 第二个覆盖第一个，旧连接泄漏
  }
  return db;
}
```

**影响**: 并发初始化时旧的 Database 实例丢失引用但文件句柄未关闭，长时间运行可能导致文件句柄耗尽。

**修复方案（职责分离）**:
- `getDb()` 改为纯 getter，未初始化直接抛错
- `new Database()` 移到 `initDatabase()` 内部，仅启动期调用一次
- `initDatabase()` 末尾 `initialized = true` 才标记为就绪
- `initDatabase()` 加幂等保护 `if (initialized) return`

**配套修复（auth.js JWT 密钥懒求值）**:
- 原因：`getJwtSecret()` 之前在模块顶层调用 `getDb()`，新设计下会抛错
- 方案：去掉顶层 `const JWT_SECRET = getJwtSecret()`，改为第一次 `signToken()` / `verifyToken()` 时才求值
- 此时 `initDatabase()` 早已完成，`getDb()` 安全
- 验证：JWT 密钥仍从 `configs` 表读取，重启后 token 不会失效

**状态**: 已修复，[sqlite.js:28-33](backend/src/db/sqlite.js#L28) 改为纯 getter，[sqlite.js:60-66](backend/src/db/sqlite.js#L60) 初始化下沉，[auth.js:11-38](backend/src/services/auth.js#L11) JWT 懒求值。

---

### BUG-4: `wait-for-backend.js` 调用管理员接口导致启动等待永远卡住 ✅ 已修复

**文件**: [wait-for-backend.js:6](wait-for-backend.js#L6)
**优先级**: P0 — 开发环境启动阻塞
**修复日期**: 2026-06-26

```javascript
// 当前代码
const req = http.get('http://localhost:5002/api/config/db', (res) => {
  resolve();
});
```

`/api/config/db` 需要 `adminRequired` 中间件。如果数据库中没有用户或用户未登录，此端点返回 401，但 `wait-for-backend.js` 不检查状态码——然而即使 401 也是"连接成功"，所以这里其实能工作。

但语义错误：此处意图是等待后端启动，应使用无需认证的 `/api/health` 端点。

**修复**: 改为 `http.get('http://localhost:5002/api/health', ...)`。
**状态**: 已修复，[wait-for-backend.js:6](wait-for-backend.js#L6) 已改用 `/api/health` 端点。

---

### BUG-5: Express JSON 解析未设置显式大小限制 ✅ 已修复

**文件**: [backend/src/index.js:13](backend/src/index.js#L13)
**优先级**: P1 — DoS 风险
**修复日期**: 2026-06-26

```javascript
app.use(express.json());  // ← 无 limit 参数
```

默认限制为 100KB，对于长时间会话的消息历史可能不够。同时也缺少显式的合理上限作为 DoS 防护。

**修复**: `app.use(express.json({ limit: '10mb' }));`
**状态**: 已修复，[index.js:13](backend/src/index.js#L13) 已设置 10MB 限制。

---

### BUG-6: Monaco 编辑器 hover 隐藏定时器内存泄漏 ✅ 已修复

**文件**: [frontend/src/App.jsx:1229-1234](frontend/src/App.jsx#L1229)
**优先级**: P1 — 内存泄漏

```javascript
const hoverClearInterval = setInterval(hideHoverWidgets, 100);
const disposeDisposable = editor.onDidDispose(() => {
  clearInterval(hoverClearInterval);
  disposeDisposable?.dispose();
});
```

**问题**:
1. React Strict Mode 下双重挂载/卸载可能累积多个定时器
2. 如果组件在 editor 未触发 dispose 时卸载，100ms 定时器永久运行
3. 多次开关 Skill Drawer（每次创建新 Editor 实例）会累积定时器

**修复**: 在 `onMount` 返回值中清理，或使用 `useEffect` cleanup + ref 管理。

---

## 🟡 中等问题

### BUG-7: SSE 流式生成缺少单轮 LLM 调用超时 ✅ 已修复

**文件**:
- [backend/src/services/llm.js:14-69](backend/src/services/llm.js#L14) — `withTimeout` helper + `LLM_TIMEOUTS`
- [backend/src/services/llm.js:467-519](backend/src/services/llm.js#L467) — fetch / reader.read 改造
- [backend/src/routes/query.js:344-351](backend/src/routes/query.js#L344) — 整体 SSE 5min 超时

**优先级**: 🟡 P2 — 中等 Bug
**修复日期**: 2026-06-30

**原始问题**:
工具调用循环最多 30 轮，但每轮 LLM API 的 `fetch` 调用没有独立超时。`AbortController` 仅在上层 `res.on('close')` 时触发。如果 LLM API 连接建立后无限挂起（不返回 headers）、stream 中途不发 chunk、整体 SSE 长时间不结束——用户只能关闭标签页来中断。

**修复方案（三层超时 + helper 抽离）**:

| # | 触发源 | 时长 | 实现位置 |
|---|--------|------|----------|
| T1 客户端断开 | res.on('close') | 立即 | 已有，未改 |
| T2 单轮 LLM fetch | LLM API 整体响应 | 120s | llm.js:467 fetch 处 |
| T3 整体 SSE | 整个 generateSQL | 5min | query.js:344 |
| T4 单次 reader.read | stream 中途断流 | 30s | llm.js:504 reader.read 处 |

**核心 helper**：`withTimeout(externalSignal, timeoutMs, label)` 返回 `{signal, cancel, isExternalAbort}`，支持：
- 外部 abort（客户端断开 / T3 触发）立即级联并清理 timer
- 本地超时（达到 timeoutMs）自动 abort
- 操作完成后 `cancel()` 清理 timer 与 listener，无内存泄漏
- `isExternalAbort()` 区分 abort 原因（前端错误消息会不一样）

**前端错误消息**：
- T2 触发：`LLM 响应超时（>120s），请稍后重试`
- T4 触发：`LLM 流式响应中断（>30s 无新数据），请稍后重试`
- T3 触发：外层 catch 捕获，由前端 axios 拦截器统一显示

**测试覆盖**（[test-llm-timeout.mjs](backend/test-llm-timeout.mjs) 14 条用例）：
- A. 外部 abort 立即生效
- B. 外部 abort 优先于超时
- C. timeoutMs 后超时触发，reason.message 含 label + 毫秒
- D. cancel() 后定时器清理
- E. 错误消息格式
- F. 并发调用互不干扰

**状态**: 已修复。timeout 测试 14/14 通过，sqlValidator 回归 86/86 通过。

---

### BUG-8: 非 stream 模式的 SQL 生成未实现

**文件**: [backend/src/routes/query.js:483](backend/src/routes/query.js#L483)

```javascript
if (schemaMode === 'stream') {
  // ... 完整的 stream 实现（~150 行） ...
  return;
}  // ← if 在此结束，但 else 分支（非 stream）是空的！
```

当 `schemaMode !== 'stream'` 时，代码不做任何处理直接返回，前端收到空响应。前端 `App.jsx` 始终传 `schemaMode: 'stream'`，但后端接口应该要么实现此分支要么报错。

**修复**: 添加 `else { res.status(400).json({ error: '不支持的模式' }); }` 或移除此参数。

---

### BUG-9: 消息历史 `LIMIT 20` 取最早而非最新 ✅ 已修复

**文件**: [backend/src/routes/query.js:325-329](backend/src/routes/query.js#L325)

```javascript
const messages = db.prepare(`
  SELECT content, sql FROM messages
  WHERE session_id = ? AND role IN ('user', 'assistant')
  ORDER BY id ASC LIMIT 20   -- ← 永远取最早的 20 条
`).all(sessionId);
```

**影响**: 长对话中最近的消息不会被包含在 LLM 上下文中，导致 LLM 丢失近期对话记忆。

**修复**: 改为 `ORDER BY id DESC LIMIT 20`，然后在 JS 层翻转数组顺序。

---

### BUG-10: `checkPort` 连接 `0.0.0.0` 可能误判 Windows 端口占用

**文件**: [electron/main.js:231](electron/main.js#L231)

```javascript
const isPortUsed = await checkPort(5002, '0.0.0.0');
```

**问题**: Windows 上连接 `0.0.0.0` 的行为与 `127.0.0.1` 不同。Express 默认监听所有接口，但 socket 连接测试 `0.0.0.0` 在某些 Windows 配置下可能失败。

**修复**: 改为 `checkPort(5002, '127.0.0.1')`。

---

### BUG-11: 错误响应返回 HTTP 200 ✅ 已修复

**文件**: [backend/src/routes/session.js](backend/src/routes/session.js)、[backend/src/routes/query.js](backend/src/routes/query.js)
**优先级**: P2 — 错误处理语义错误
**修复日期**: 2026-06-26

```javascript
// 修复前：所有错误都返回 200，前端无法通过 status code 区分
} catch (error) {
  res.json({ error: error.message, sessions: [], total: 0, hasMore: false });
}
```

session.js、query.js 等路由的错误处理全部使用 `res.json()` 返回 HTTP 200。前端 axios 拦截器无法通过 status code 区分成功/失败，只能检查响应体中的 `error` 字段，但调用方并不总是做此检查。

**修复方案（按错误类型分配状态码）**:
- 系统异常（catch 块） → `500`
- 资源不存在 → `404`
- 参数错误 / 业务校验失败 → `400`
- 权限不足 → `403`（已部分实现）
- 所有 catch 块新增 `logger.error(...)` 记录上下文

**状态**: 已修复。
- session.js：13 处改动（500×7、404×2、400×3、403×1）
- query.js：12 处改动（500×4、400×6、403×1、未触发的 stream 错误响应保留）
- 总计 25 处 `res.json({ error` → `res.status(N).json({ error`

---

### BUG-12: `initSkillLogTable()` 未 await 可能造成表未就绪就被使用 ✅ 已修复

**文件**: [backend/src/index.js:44](backend/src/index.js#L44)

```javascript
await initDatabase();
initSkillLogTable();  // ← 同步调用，但没有 await（虽然函数本身是同步的）
```

`initSkillLogTable` 是同步函数所以这里没问题，但如果将来改成异步，启动顺序会出错。建议加上 `await` 作为防御性编程。

---

## 🟢 性能问题

### PERF-1: BPE Token 计数同步阻塞事件循环 ⭐

**文件**: [backend/src/services/tokenizer.js:68-141](backend/src/services/tokenizer.js#L68)
**严重程度**: 中等

```javascript
export function countMessagesTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    if (msg.content && typeof msg.content === 'string') {
      total += countTokens(msg.content);  // 同步 BPE 编码
    }
  }
  return total;
}
```

`bpeEncode` 对每个字符执行迭代合并，对包含数百条消息的会话可能耗时 200-500ms，期间事件循环完全阻塞。

**建议**: 
- 将 BPE 计算移到 Worker Thread
- 或在 `saveMessagesToDb` 中异步执行 token 计数
- 短期方案：把 token 计数从 `saveMessagesToDb` 的热路径中移出，放到后台队列

---

### PERF-2: 流式响应中每次 chunk 都 `findLastIndex` 扫描整个消息数组 ⭐

**文件**: [frontend/src/App.jsx:536](frontend/src/App.jsx#L536)

```javascript
// 每次 SSE chunk 到达时都执行:
const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
```

每条 SSE chunk 都 O(n) 扫描消息数组。流式响应期间可能有数百个 chunk，累积开销显著。

**建议**: 缓存最后一个 assistant 消息的索引，在流式响应开始前记录，用直接索引替代搜索。

---

### PERF-3: 无分页的消息历史加载

**文件**: [backend/src/routes/session.js:80](backend/src/routes/session.js#L80)

```javascript
const messages = db.prepare(
  'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC'
).all(req.params.id);
```

长会话可能有数千条消息，全部加载到内存然后传给前端。应加入 `LIMIT` 和分页。

**建议**: 默认返回最近 100 条，支持 `?limit=&offset=` 参数。

**2026-06-29 决策 — 暂不实施**:
- 当前无长会话场景的真实性能反馈（用户实测切换会话流畅）
- LLM 上下文通过单独的 `llm_messages` 表（JSON blob 完整存储）保证，**分页 `messages` 表不影响 DeepSeek 上下文**
- 实施需要决策：分页单位（按 turn 还是按行）、turn 边界锚点（user 行 id）、scroll 位置保留 UX
- 触发条件：用户反馈"切 200+ turn 会话卡"或前端 dashboard 出现可观测的 P99 延迟时再启动
- 实施时完整方案已讨论存档（本对话 2026-06-29 末段）：
  - 默认 `limit=100`、上限 200
  - 锚点：`SELECT id FROM messages WHERE session_id=? AND role='user' ORDER BY id DESC LIMIT 1 OFFSET 99`
  - 取该 id 及之后所有行（保证 turn 完整性，不会切到中间）
  - 前端零改动（默认 100 已能覆盖绝大多数场景）
  - 真要"向上加载更多"再走 Phase 2：游标 `before=<oldest_user_msg_id>` + scroll 位置保留

---

### PERF-4: 前端多次串行 API 调用

**文件**: [frontend/src/App.jsx:338-362](frontend/src/App.jsx#L338)

```javascript
// handleSessionClick 中依次调用 3 个独立 API:
const data = await getSessionTokens(session.id);       // 第 1 次
const config = await api.getAgentConfig();             // 第 2 次
const msgData = await getQueryMessages(session.id);    // 第 3 次
```

三个请求互不依赖，但串行执行。每次切换会话多等待 2 个 RTT。

**建议**: 使用 `Promise.all` 并行请求，减少延迟 ~2 倍。

---

### PERF-5: Skill 文件树每次请求都完整重建

**文件**: [backend/src/routes/skill.js:50-88](backend/src/routes/skill.js#L50)

`buildTree()` 递归遍历整个 skills 目录且无缓存。每次打开 Skill 侧边栏都要重新遍历。

**建议**: 添加内存缓存（带 TTL 或文件变更检测）。

---

### PERF-6: LLM 消息上下文作为完整 JSON Blob 存储

**文件**: [backend/src/services/llm.js:280](backend/src/services/llm.js#L280)

```javascript
const messagesJson = JSON.stringify(messages);  // 可能 >500KB
db.prepare('UPDATE llm_messages SET messages = ?, ...').run(messagesJson, ...);
```

每次工具调用后都将整个 messages 数组全量序列化写入。长对话的 messages 可达数百 KB。

**建议**: 增量更新（只追加新消息）或使用更高效的序列化格式。

---

### PERF-7: `fs.readFileSync` 在请求路径中同步阻塞

**文件**: [backend/src/services/toolFuncs.js](backend/src/services/toolFuncs.js#L11-L16) 等多处

```javascript
// 在每个 LLM 工具调用中同步读取文件
return JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
```

对于桌面单用户场景影响不大，但在工具调用密集时（30 轮循环）累积的同步 IO 会增加响应延迟。

**建议**: 使用启动时加载到内存的缓存，配合文件变更检测失效。

**2026-06-29 修复 — 异步化（保留实时读取）**:
用户明确要求"读取文件必须是实时读取最新的，因为这里的文件内容会变化"（schema 重建、tag 修改、DDL 变更等），**不能**用缓存。改为 `fs.promises.readFile` 异步化：

- 新增 `readFileIfExists(path)` 辅助函数：单次系统调用 + ENOENT 兜底（避免 `existsSync + readFileSync` 双重调用 + TOCTOU 竞态）
- **9 个函数改为 async**：`loadTableIndex` / `loadDomainRouterIndex` / `sliceTableIndex` / `sliceTableIndexByDomains` / `loadSkillMd` / `getTableSchema` / `getTableDDL` / `getOutputFormat` / `getMysqlLimits`
- **6 个工具的 `func` 回调改为 async**：`get_tables` / `get_table_schema` / `get_table_ddl` / `get_domain_index` / `get_sliced_index`（`request_tag_confirmation` 纯字符串，无需改）
- **调用方更新**：
  - `llm.js:334` `loadSkillMd()` → `await loadSkillMd()`（generateSQL 路径）
  - `query.js:318` `loadSkillMd()` → `await loadSkillMd()`（/generate 路径）
- **新增内部并行**（配合 NEW-6 工具并行化）：
  - `sliceTableIndexByDomains`：多域文件读取并行
  - `getTableSchema`：多表 field_config 并行
  - `getTableDDL`：多表 DDL 并行

**未改（不在 LLM 工具调用路径）**:
- `routes/skill.js` 自己的 `loadTableIndex`（admin 路径，技能树/文件编辑）
- `routes/query.js:50-55, 83-90` `loadSkillV2` / `loadFieldConfig`（启动 + `/execute` 路径，加载慢但非 agent loop 热点）
- `tokenizer.js:14` BPE 加载（PERF-1 单独跟踪）

**状态**: ✅ 已修复（2026-06-29）

**验证**:
- `node --check` 通过：toolFuncs.js / llm.js / query.js
- Agent loop 兼容：`await Promise.resolve(p.tool.func(...))` 早已支持 async 工具函数
- 行为不变：每次调用都重新读盘；文件不存在时返回原 fallback（`'输出格式模板不存在'` 等）
- 无 TOCTOU 竞态：单次 `readFile` + ENOENT 捕获

**收益**:
- 工具调用期间事件循环不再被阻塞
- 单 `get_table_schema × 3` 内部并行：~3×100ms → ~100ms
- 与 NEW-6 工具并行化叠加：3 个 `get_table_schema` × 3 表 = 9 读 → 3 并发 × 3 内部并行 ≈ 1 次往返

---

## 🔒 安全问题

### SEC-1: `stripSqlComments` 有边界绕过风险 ✅ 已修复

**文件**: [backend/src/services/sqlValidator.js:104-231](backend/src/services/sqlValidator.js#L104)
**优先级**: P3 — 安全
**修复日期**: 2026-06-30

**原始问题**:
1. MySQL 条件注释 `/*! ... *\/`（含版本号形式 `/*!12345 ... *\/`）会被当块注释剥掉，
   但 MySQL 实际会执行其中内容 → UNION 注入可借此绕过白名单/危险函数检查
2. 字符串字面量内的注释符 `SELECT '-- not a comment' FROM t` 被错误剥离，损坏 SQL
3. 未闭合的 `/*` / `'` / `"` / `` ` `` 没有报错，可能导致 DoS

**修复方案（两阶段校验 + 字符级状态机）**:
- `stripSqlComments` 重写为单遍字符级状态机，返回 `{cleaned, errors[]}`
- 字符串/双引号/反引号内字符原样保留
- 单/双/反引号支持 `\` 转义 + 双写转义（`''`/`""`/`` `` ``）
- `--` 行注释必须后跟空白或行尾（避免误伤 `SELECT -1`）
- MySQL 条件注释（`/*!` / `/*!12345`）一发现即短路返回 `MYSQL_CONDITIONAL_COMMENT`
- 未闭合的块注释/字符串/反引号返回 `INVALID_SQL`
- 新增 `validateStructure` 阶段 2 函数：长度/多语句/前缀/危险函数
- `validateReadOnlySql` 改为编排两阶段，接口完全兼容

**新增错误码**:
- `MYSQL_CONDITIONAL_COMMENT`：MySQL 条件注释
- `INVALID_SQL`：未闭合的注释/字符串/反引号

**测试覆盖**（[test-sql-validator.mjs:115-166](backend/test-sql-validator.mjs#L115) 新增 24 条用例）:
- 条件注释 3 种形式拒绝
- 字符串/双引号/反引号内伪注释符保留
- `''` / `""` / `` `` `` / `\` 转义
- 未闭合的 4 种情况
- `--` 边界（避免负数误伤）
- 条件注释短路：阶段 1 失败不进阶段 2
- SEC-3 残留显式记录（UNION 仍走前缀检查，**不在本修复范围**）

**状态**: 已修复。86/86 测试通过。

---

### SEC-2: `killProcessOnPort` 使用 `netstat` 解析不可靠

**文件**: [electron/main.js:166-184](electron/main.js#L166)

```javascript
const parts = line.trim().split(/\s+/);
const pid = parts[parts.length - 1];  // 取最后一列作为 PID
```

**问题**:
1. `netstat -ano` 输出格式因 Windows 版本和语言不同而变化
2. 盲目 `taskkill /F` 所有占用端口的进程可能误杀其他应用

**建议**: 使用 `Get-NetTCPConnection` (PowerShell) 或 `netstat -ano | findstr` 后解析 PID 列位置（而非最后一列）。

---

### SEC-3: LLM 生成的 SQL 仅做前缀检查而非 AST 解析

**文件**: [backend/src/services/sqlValidator.js](backend/src/services/sqlValidator.js#L108-L166)

当前只检查：前缀白名单 + 危险函数黑名单 + 多语句检测（分号）。攻击者可以通过子查询注入绕过前缀检查：`SELECT 1 FROM t WHERE id = (SELECT ... DANGEROUS ...)`。

**建议**: 对于 AI 生成的 SQL，始终保持应用层 LIMIT + 只读数据库用户 + 超时保护三道防线。当前的 `MAX_DISPLAY_ROWS = 1000` 截断是正确的，但建议再加 MySQL `max_execution_time`。

---

## 🧹 代码质量问题

### CODE-1: `toolFuncs.js` 中表信息格式化代码重复

**文件**: [backend/src/services/toolFuncs.js:249-318](backend/src/services/toolFuncs.js#L249)

`formatTableInfo` 函数（249 行）和 `get_tables` 工具的 `func` 回调（292 行）有几乎完全相同的格式化逻辑。应统一复用。

---

### CODE-2: `config.js` 导出的 `config` 对象未被使用 ✅ 已修复

**文件**: [backend/src/config.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/config.js)
**修复日期**: 2026-06-29

定义了 `config` 对象但各处代码直接读 `process.env` 或硬编码，从未 import 此导出。要么删除，要么让所有代码统一通过此模块获取配置。

**修复方案（统一为唯一入口）**:
- 重写 [config.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/config.js)：改用 `path.resolve(__dirname, '..', '..')` 解析项目根（Windows 下 `D:` 不算一段，原 fallback `'.'` 错误），所有路径字段基于项目根解析为绝对路径，port 用 `parseInt` 转 number
- 迁移 **7 个文件 / 10 处** 直接读 `process.env` 改为 `import { config } from './config.js'`：
  - [index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js):7 — `PORT`
  - [logger.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/logger.js):7 — `LOG_PATH`
  - [db/sqlite.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js):9 — `DB_PATH`
  - [services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js):11 — `LOGS_PATH`
  - [services/toolFuncs.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js):8-9 — `PROJECT_ROOT` / `SKILL_PATH`
  - [routes/skill.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js):18-19 — `PROJECT_ROOT` / `SKILL_PATH`
  - [routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js):35-36 — `PROJECT_ROOT` / `SKILL_PATH`

**收益**:
- 静态配置来源统一（dynamic 配置仍在 `services/config.js` 走 SQLite，两层职责清晰）
- 顺手去重 `PROJECT_ROOT` / `SKILL_PATH` 的 3 处复制
- 修复原 fallback `'.'` 错误（如果有人 import `config.projectRoot` 会拿到错的相对路径）

**验证**:
- `node --check` 8 个文件全部通过
- `grep process.env.(PORT|DB_PATH|SKILL_PATH|LOG_PATH|LOGS_PATH|PROJECT_ROOT)` 收敛到 config.js 内部 5 处
- 启动后端：`Skill V2 reloaded` (107 tables) / `SQLite initialized` / `Server running on port 5002`
- `/api/health` 返回 200

---

### CODE-3: 多处 `try { fs.mkdirSync() } catch (e) {}` 静默吞掉非"目录已存在"的错误

**文件**: 
- [backend/src/db/sqlite.js:15-17](backend/src/db/sqlite.js#L15)
- [backend/src/logger.js:10](backend/src/logger.js#L10)

```javascript
try { mkdirSync(dbDir, { recursive: true }); } catch (e) {
  // 目录已存在，忽略  ← 也会忽略权限错误、磁盘满等
}
```

**建议**: 检查 `e.code === 'EEXIST'`，其余错误应向上抛出或至少 log。

---

### CODE-4: 前端状态过多（40+ useState）

**文件**: [frontend/src/App.jsx:49-141](frontend/src/App.jsx#L49)

`AuthenticatedApp` 组件有超过 40 个 `useState` 调用。这使得组件难以测试和维护。建议使用 `useReducer` 或拆分出更多子组件。

---

### CODE-5: 后端路由文件（tables.js / tableSchema.js / export.js）为空壳

**文件**: 
- [backend/src/routes/tables.js](backend/src/routes/tables.js)
- [backend/src/routes/tableSchema.js](backend/src/routes/tableSchema.js)
- [backend/src/routes/export.js](backend/src/routes/export.js)

这三个文件只注册了 `authRequired` 中间件但未定义任何路由。如果功能已废弃，应删除并移除 `index.js` 中的挂载代码，减少维护负担。

---

## 📋 问题优先级汇总

> **更新日期**: 2026-06-26

| 优先级 | 编号 | 问题 | 影响 | 文件 | 状态 |
|--------|------|------|------|------|------|
| 🔴 P0 | BUG-1 | skill.js 4 个路由未注册 | 功能完全不可用 | skill.js:208 | ✅ 已修复 |
| 🔴 P0 | BUG-2 | skill.js catch 块 ReferenceError | 错误处理崩溃 | skill.js:282 | ✅ 已修复 |
| 🔴 P0 | BUG-4 | wait-for-backend 语义错误 | 启动等待可能异常 | wait-for-backend.js:6 | ✅ 已修复 |
| 🔴 P1 | BUG-3 | getDb 竞态条件 | 文件句柄泄漏 | sqlite.js:21 | ✅ 已修复 |
| 🔴 P1 | BUG-5 | JSON 解析无大小限制 | DoS 风险 | index.js:13 | ✅ 已修复 |
| 🔴 P1 | BUG-6 | Monaco 定时器内存泄漏 | 长时间运行 OOM | App.jsx:1229 | ✅ 已修复 |
| 🟡 P2 | BUG-7 | SSE 流式生成缺单轮 LLM 超时 | 长请求挂起 | query.js:344 | ✅ 已修复（2026-06-30，三层超时 + withTimeout） |
| 🟡 P2 | BUG-8 | 非 stream 模式未实现 | 接口空响应 | query.js:483 | ⏸️ 不修 |
| 🟡 P2 | BUG-9 | 消息历史取最早而非最新 | 长对话上下文丢失 | query.js:328 | ✅ 已修复 |
| 🟡 P2 | BUG-10 | checkPort 连接地址不正确 | Windows 端口检测误判 | main.js:231 | ⏸️ 不修 |
| 🟡 P2 | BUG-11 | 错误响应返回 HTTP 200 | 前端无法区分错误 | session.js/query.js 共 25 处 | ✅ 已修复 |
| 🟡 P2 | PERF-2 | findLastIndex 重复扫描 | 流式响应卡顿 | App.jsx:536 | ⏳ 待修复 |
| 🟢 P3 | PERF-1 | BPE 同步阻塞 | 大消息量时短暂冻结 | tokenizer.js:68 | ⏳ 待修复 |
| 🟢 P3 | PERF-3 | 消息无分页 | 长会话加载慢 | session.js:80 | ⏸️ 暂不实施（无长会话场景反馈） |
| 🟢 P3 | PERF-5 | Skill 树无缓存 | 每次打开重新遍历 | skill.js:50 | ⏳ 待修复 |
| 🟢 P3 | SEC-1 | SQL 注释剥离边界绕过 | 安全校验可靠性 | sqlValidator.js:104 | ✅ 已修复（2026-06-30，状态机 + 两阶段） |
| 🟢 P3 | SEC-2 | netstat 解析 PID 列位置不可靠 | 误杀进程 | main.js:166 | ⏳ 待修复 |
| 🟢 P3 | SEC-3 | LLM 生成 SQL 仅前缀检查 | 子查询绕过 | sqlValidator.js:108 | ⏸️ 暂缓（计划由 LLM 验证替代） |
| 🟢 P3 | PERF-4 | 切换会话 3 个 API 串行 | 多余 2 RTT | App.jsx:342 | ✅ 已修复 |
| 🟢 P3 | PERF-6 | LLM 消息 JSON Blob 全量存储 | 大对话 IO 大 | llm.js:280 | ⏳ 待修复 |
| 🟢 P3 | PERF-7 | toolFuncs 同步读文件 | 工具调用密集时卡 | toolFuncs.js:11 | ✅ 已修复（async 化 + 内部并行） |
| 🟢 P3 | CODE-1 | toolFuncs 格式化代码重复 | 维护负担 | toolFuncs.js:249 | ⏳ 待修复 |
| 🟢 P3 | CODE-2 | config.js 导出对象未使用 | 死代码 | config.js:3 | ✅ 已修复（重构为唯一入口） |
| 🟢 P3 | CODE-4 | 前端 40+ useState | 组件难测试 | App.jsx:49 | ⏳ 待修复 |
| 🟢 P3 | CODE-5 | 空壳 routes（tables/tableSchema/export） | 死代码 | routes/* | ⏳ 待修复 |
| 🟢 P3 | BUG-12 | initSkillLogTable 未 await | 防御性 | index.js:44 | ✅ 已修复 |
| 🔴 P0 | **NEW-1** | /explain-analyze headers-sent 后 res.json | **接口崩溃** | query.js:750 | ✅ 已修复 |
| 🟡 P2 | **NEW-2** | /explain-analyze 无断连保护 | 浪费 token | query.js:680 | ✅ 已修复 |
| 🟢 P3 | **NEW-3** | /me、/logout 缺限流 | 理论可耗 | auth.js:85 | ✅ 已修复 |
| 🟢 P3 | **NEW-4** | extractToken 不校验格式 | 无效 CPU | auth.js:90 | ✅ 已修复 |
| 🟡 P2 | **NEW-5** | axios 拦截器未处理 4xx 业务错误 | 用户无错误提示 | api/index.js:44 | ✅ 已修复 |
| 🟡 P2 | **NEW-6** | agent loop 工具调用串行 | agent loop 慢 | llm.js:557 | ✅ 已修复（3 阶段并行） |
| 🟢 P3 | CODE-3 | mkdirSync 静默吞错 | 问题排查困难 | sqlite.js:15 | ⏳ 待修复 |

**修复进度**: **20/30 (66.7%)** — 含 ⏸️ 不修/暂缓 4 项时为 20/34 (58.8%)。已修项：BUG-1/2/3/4/5/6/7/9/11/12、PERF-4/7、SEC-1、CODE-2、NEW-1/2/3/4/5/6。⏸️ 不修/暂缓：BUG-8、BUG-10、PERF-3、SEC-3。⏳ 待修 9 项：PERF-1/2/5/6、SEC-2、CODE-1/3/4/5。SEC-1 通过状态机 + 两阶段校验堵住 MySQL 条件注释注入与字符串/反引号边界绕过；SEC-3 暂缓改由 LLM 验证替代；BUG-7 通过三层超时（fetch 120s / 整体 5min / reader 30s）+ withTimeout helper 防御 LLM API 挂起

---

## 🚨 本轮新发现问题（2026-06-26 复审补充）

> 复审代码时发现，**原审查详细章节提及但汇总表未列入** 10 个问题（BUG-12、PERF-4/6/7、SEC-2/3、CODE-1/2/4/5），且**额外发现 4 个新问题**（NEW-1~NEW-4）。

### NEW-1: `/explain-analyze` SSE 头已发送后 `res.status(400).json()` 🔴 P0

**文件**: [backend/src/routes/query.js:680-802](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L680)

**问题**:  
`res.flushHeaders()` 在 line 721 调用（设置 SSE 头），但 `return res.status(400).json(...)` 在 line 750（未知 provider 分支）— 这会触发 `ERR_HTTP_HEADERS_SENT` 错误，**整个 explain-analyze 接口崩溃**。

**触发条件**:  
- LLM 配置中 `provider` 是非 `deepseek`/`openai` 的旧值（如 `minimax`）
- 用户点击 SQL 的 "explain analyze" 按钮

**修复**:
- 提取 `validateLlmProvider()` 共享函数（同步校验 + 返回标准化错误）
- 在 `flushHeaders()` 之前完成 provider 校验
- 修正 line 716-721 的 6 空格缩进错误
- 修正 line 725 `=config.model` 缺少空格

**状态**: ✅ 已修复（2026-06-26）

**验证**: `node --check src/routes/query.js` 通过；`res.json()` 只在 SSE 头发送前调用。

---

### NEW-2: `/explain-analyze` 无客户端断连保护 🟡 P2 ✅ 已修复

**文件**: [backend/src/routes/query.js:680-802](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L680)

**问题**:  
`/generate` 端点有 `req.on('close', () => abortController.abort())`（line 341-346），但 `/explain-analyze` 没有。如果用户在 LLM 流式响应过程中切换页面/关闭面板，客户端 fetch 中断 → 服务端继续读取 LLM 流、继续 `res.write()` 到死 socket，**浪费 token 配额**。

**修复**: 复用 `/generate` 的 abort 模式。

---

### NEW-3: `/api/auth/me`、`/logout` 缺限流 🟢 P3 ✅ 已修复

**文件**: [backend/src/routes/auth.js:85, 90](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L85)

**问题**:  
`/login`、`/register`、`/change-password` 有 `authRateLimiter`，但 `/me`、`/logout` 没有。  
影响较小（需鉴权后才能触发），但理论上能用于耗 token_version 递增。

---

### NEW-4: `extractToken` 不校验 token 格式 🟢 P3 ✅ 已修复

**文件**: [backend/src/services/auth.js:90-101](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js#L90)

**问题**:  
直接传 `Authorization` 头的 value 到 `jwt.verify`，垃圾 token 也会触发 verify。`jwt.verify` 本身有 try/catch 兜底，但增加了无效 CPU 开销。

**修复**: 简单正则预校验（`/^[A-Za-z0-9_\-\.]{10,}$/`）即可。

---

### NEW-5: 前端 axios 拦截器未处理 4xx 业务错误，导致 `message.error` 永不触发 🟡 P2

**文件**: [frontend/src/api/index.js:44-53](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/api/index.js#L44)、[frontend/src/App.jsx:687-720](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L687)

**问题**:  
用户实测：`/api/query/execute` 当 SQL 不通过 `validateReadOnlySql` 校验时，后端返回 `400 { error: "只允许 SELECT / WITH 查询", code: "FORBIDDEN_PREFIX", rowCount: 0, queryTime: 0 }`。  
但前端 `handleExecute` 在 try 块里 `await queryExecute(...)` 后判断 `if (res.error) message.error(res.error)` —— **axios 默认对 4xx 抛错 reject**，res 永远不会拿到，结果 `message.error` 从未被调用，loading 关闭后页面**没有任何错误提示**。

同样的 bug 潜伏在 `handleExplain`（`/query/explain`）。本质是 BUG-11 修复后端加了 4xx 状态码，但前端所有调用方都按 200 OK + body.error 写，没有补 try/catch。

**修复**:
- 在 [frontend/src/api/index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/api/index.js) 的 axios 响应拦截器里，对 **4xx + body.error** 自动 `message.error(data.error)`
- 401 仍走专用 `xtsql:auth-expired` 事件（不重复 toast）
- 5xx 留给调用方处理（系统异常信息更技术性，由调用方决定展示）
- 4xx 但 body 无 error 字段（如某些 401）也不 toast，留给调用方

**2026-06-29 策略调整**: 5xx 也改为自动 toast（去掉 `status < 500` 上限）。原"5xx 留给调用方"策略实际导致 `handleExecute` / `handleExplain` 等没 try/catch 5xx 的接口在 500 错误时"页面无反应"——用户实测 `?` 占位符 SQL 触发 MySQL 500 完全无提示。重复 toast 风险小于完全无反馈。

**状态**: ✅ 已修复（2026-06-29）

---

### NEW-6: Agent loop 中工具调用串行执行，等待长 🟡 P2

**文件**: [backend/src/services/llm.js:557-614](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L557)

**问题**:
LLM 一轮响应中可能返回多个 tool_call（如同时 `get_table_schema × 3`），原代码用 `for...of` 顺序执行：

```js
for (const toolCall of validToolCalls) {
  // 参数解析 → dupCheck → tool.func(effectiveArgs)  // ← 串行
}
```

每个 `get_table_schema` 涉及文件读 + JSON 解析（~100-300ms），3 个工具就是 ~1s。Agent loop 每多 1 秒用户就多等 1 秒。

用户反馈："现在其实都不卡，只是等待最后的输出慢，主要是因为工具调用，模型思考等原因"——确认瓶颈是 agent loop 而非前端渲染。

**修复（3 阶段重构）**:
- 阶段 1：同步预处理（参数解析 + 重复调用检查）一次性完成所有 validToolCalls——必须在并行执行前，否则同会话内两个相同工具的检查会互相穿透
- 阶段 2：`Promise.all` 并行执行所有工具（`Promise.resolve(tool.func(...))` 同时支持同步/异步工具）
- 阶段 3：按原始 tool_calls 顺序写回 messages（保证 LLM 看到 tool 顺序与调用顺序一致）；`recordToolCall` 仍在阶段 2 内成功后才登记，与原"成功才登记"语义一致

**状态**: ✅ 已修复（2026-06-29）

**验证**:
- `node --check backend/src/services/llm.js` 通过
- 同步工具路径：包装为 `Promise.resolve(...)`，结果与原代码等价
- 错误路径：`execError` 单独分支处理，写入 `Error: <msg>`，与原 try/catch 行为一致
- 重复拦截路径：`dupCheck.block` 时跳过执行、只写消息，与原 `continue` 行为一致
- 消息顺序：阶段 3 按 `execResults` 顺序（与 `validToolCalls` 顺序一致）写回

**收益**：3 个 `get_table_schema` 从 ~900ms 降到 ~300ms（取最慢者）；agent loop 每轮可省 0.5-2 秒。

---

## 📋 原审查"易被忽视"项当前状态追踪

> *这 10 项是 2026-06-26 复审时发现"详细章节已记录但汇总表未列入"的问题。2026-06-30 已重写汇总表（L25-42）将其全部纳入，此表保留作为易被忽视项的当前状态快照：*

| 编号 | 优先级 | 问题 | 文件 | 当前状态 |
|------|--------|------|------|---------|
| BUG-12 | 🟢 P3 | `initSkillLogTable` 未 await（防御性） | index.js:44 | ✅ 已修复 |
| PERF-4 | 🟢 P3 | 切换会话 3 个 API 串行调用 | App.jsx:342-365 | ✅ 已修复（Promise.allSettled） |
| PERF-6 | 🟢 P3 | LLM 消息 JSON Blob 全量存储 | llm.js:280 | ⏳ 待修复 |
| PERF-7 | 🟢 P3 | `fs.readFileSync` 同步阻塞 | toolFuncs.js:11-16 | ✅ 已修复（async 化 + 内部并行） |
| SEC-2 | 🟢 P3 | `killProcessOnPort` netstat 解析不可靠 | main.js:166-184 | ⏳ 待修复 |
| SEC-3 | 🟢 P3 | LLM 生成 SQL 仅前缀检查（非 AST） | sqlValidator.js:108 | ⏸️ 暂缓（计划由 LLM 验证替代 SEC-3；当前部署只读 MySQL 用户，威胁面已收窄） |
| CODE-1 | 🟢 P3 | toolFuncs 格式化代码重复 | toolFuncs.js:249-318 | ⏳ 待修复 |
| CODE-2 | 🟢 P3 | config.js 导出对象未使用 | config.js:3-9 | ✅ 已修复（重构为唯一入口） |
| CODE-4 | 🟢 P3 | 前端 40+ useState 难维护 | App.jsx:49-141 | ⏳ 待修复 |
| CODE-5 | 🟢 P3 | 空壳 routes（tables/tableSchema/export） | routes/* | ⏳ 待修复 |

*小结：10 项中已修 4 项（BUG-12、PERF-4、PERF-7、CODE-2），待修 5 项（PERF-6、SEC-2、CODE-1、CODE-4、CODE-5），⏸️ 暂缓 1 项（SEC-3 计划由 LLM 验证替代）。*

---

## 🎯 建议修复顺序

> **更新日期**: 2026-06-30（与汇总表同步）

1. **第一步（立即修复）**: BUG-1 ✅、BUG-2 ✅ — 已完成（2026-06-26）
2. **第二步（本周）**: BUG-4 ✅、BUG-5 ✅、BUG-6 ✅ — 全部完成（2026-06-26）
3. **第三步（本次迭代）**: BUG-3 ✅、BUG-9 ✅、BUG-11 ✅ — 全部完成 ✅（2026-06-26）
4. **第四步（首轮收官）**: BUG-8 ⏸️、BUG-10 ⏸️ — 经评估不进入本轮修复范围
5. **第五步（2026-06-29 增量）**: PERF-7 ✅、NEW-5 ✅、NEW-6 ✅ — 全部完成 ✅
6. **后续迭代（持续优化）**: P3 剩余 **10 项** — BUG-7、PERF-1/2/5/6、SEC-1/2/3、CODE-1/3/4/5；另有 PERF-3 暂不实施（无长会话场景反馈）

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)

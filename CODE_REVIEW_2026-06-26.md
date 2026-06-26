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

> **修复状态总览（截至 2026-06-26）**:
>
> | 类别 | 数量 | 状态 |
> |------|------|------|
> | 🔴 P0（严重） | BUG-1、BUG-2、BUG-4 | ✅ 3/3 已修复 |
> | 🔴 P1（重要） | BUG-3、BUG-5、BUG-6 | ✅ 3/3 已修复 |
> | 🟡 P2（中等） | BUG-9、BUG-11 | ✅ 2/4 已修复，BUG-8/BUG-10 ⏸️ 不修 |
> | 🟢 P3（轻微） | PERF/SEC/CODE 共 12 项 | ⏳ 0/12 已修复 |
> | **合计** | **8/16 (50.00%)** | |
>
> *2026-06-26 决定：BUG-8、BUG-10 标记为 ⏸️ 不修（不进入本轮修复范围）。BUG-10 上一轮回复曾误标"已修复"，已更正。*
>
> *修复日期：2026-06-26*

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

### BUG-2: `skill.js` save 路由 catch 块中的 `ReferenceError`

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

### BUG-6: Monaco 编辑器 hover 隐藏定时器内存泄漏

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

### BUG-7: SSE 流式生成缺少单轮 LLM 调用超时

**文件**: [backend/src/routes/query.js:339-496](backend/src/routes/query.js#L339)

工具调用循环最多 30 轮，但每轮 LLM API 的 `fetch` 调用没有独立超时。`AbortController` 仅在上层 `res.on('close')` 时触发。如果 LLM API 连接建立后无限挂起（不返回 headers），用户只能关闭标签页来中断。

**修复**: 在 `fetch` 调用时传入 `signal: AbortSignal.timeout(120000)`（Node 16+），或用 `Promise.race`。

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

### BUG-9: 消息历史 `LIMIT 20` 取最早而非最新

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

### BUG-12: `initSkillLogTable()` 未 await 可能造成表未就绪就被使用

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

---

## 🔒 安全问题

### SEC-1: `stripSqlComments` 有边界绕过风险

**文件**: [backend/src/services/sqlValidator.js:80-84](backend/src/services/sqlValidator.js#L80)

```javascript
return sql
  .replace(/\/\*[\s\S]*?\*\//g, '')   // 不处理嵌套 /* /* */ */
  .replace(/--[^\n]*/g, '')
  .replace(/#[^\n]*/g, '');
```

**问题**: 
1. 嵌套块注释 `/* /* inner */ outer */` 可能使部分 SQL 逃逸
2. 字符串字面量中的注释标记 `SELECT '-- not a comment' FROM t` 会被错误剥离

**建议**: 使用 SQL 解析器（如 `node-sql-parser`）而非正则。

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

### CODE-2: `config.js` 中导出的 `config` 对象未被使用

**文件**: [backend/src/config.js:3-9](backend/src/config.js#L3)

定义了 `config` 对象但各处代码直接读 `process.env` 或硬编码，从未 import 此导出。要么删除，要么让所有代码统一通过此模块获取配置。

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
| 🟡 P2 | BUG-8 | 非 stream 模式未实现 | 接口空响应 | query.js:483 | ⏸️ 不修 |
| 🟡 P2 | BUG-9 | 消息历史取最早而非最新 | 长对话上下文丢失 | query.js:328 | ✅ 已修复 |
| 🟡 P2 | BUG-10 | checkPort 连接地址不正确 | Windows 端口检测误判 | main.js:231 | ⏸️ 不修 |
| 🟡 P2 | BUG-11 | 错误响应返回 HTTP 200 | 前端无法区分错误 | session.js/query.js 共 25 处 | ✅ 已修复 |
| 🟡 P2 | PERF-2 | findLastIndex 重复扫描 | 流式响应卡顿 | App.jsx:536 | ⏳ 待修复 |
| 🟢 P3 | PERF-1 | BPE 同步阻塞 | 大消息量时短暂冻结 | tokenizer.js:68 | ⏳ 待修复 |
| 🟢 P3 | PERF-3 | 消息无分页 | 长会话加载慢 | session.js:80 | ⏳ 待修复 |
| 🟢 P3 | PERF-5 | Skill 树无缓存 | 每次打开重新遍历 | skill.js:50 | ⏳ 待修复 |
| 🟢 P3 | SEC-1 | SQL 注释剥离边界绕过 | 安全校验可靠性 | sqlValidator.js:80 | ⏳ 待修复 |
| 🟢 P3 | CODE-3 | mkdirSync 静默吞错 | 问题排查困难 | sqlite.js:15 | ⏳ 待修复 |

**修复进度**: 8/16 (50.00%)

---

## 🎯 建议修复顺序

> **更新日期**: 2026-06-26

1. **第一步（立即修复）**: BUG-1 ✅、BUG-2 ✅ — 已完成
2. **第二步（本周）**: BUG-4 ✅、BUG-5 ✅、BUG-6 ✅ — 全部完成
3. **第三步（本次迭代）**: BUG-3 ✅、BUG-9 ✅、BUG-11 ✅ — 全部完成 ✅
4. **第四步（本轮收官）**: BUG-8 ⏸️、BUG-10 ⏸️ — 经评估不进入本轮修复范围
5. **后续迭代（持续优化）**: P3 全部 6 项 — PERF-1/2/3/5、SEC-1、CODE-3

---

> 🤖 Generated with [Claude Code](https://claude.com/claude-code)

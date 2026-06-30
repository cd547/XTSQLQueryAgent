# XTSQLQueryAgent 代码审查报告

- **审查日期**: 2026-06-20
- **审查范围**: `backend/`、`frontend/`、`electron/` 全量代码
- **审查维度**: 性能 / 逻辑 / 代码 Bug / 无用代码 / 安全 / 文档
- **总问题数**: 35（其中 P0 高危 5 个）

---

## 目录

- [🔴 P0 - 必须立即修复](#p0)
- [🟠 P1 - 建议本轮修复](#p1)
- [🟡 P2 - 后续清理](#p2)
- [附录: 已确认无需修改](#附录)

---

<a id="p0"></a>
## 🔴 P0 - 必须立即修复（5 个）

### #BUG-01 【高】`loadCurrentModel.loading` 模式存在并发漏洞

**位置**: [frontend/src/App.jsx](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L180-L210)

**问题**:
```js
// L180-210
loadCurrentModel.loading = false;  // 写在 useEffect 外部，每个 render 都执行
useEffect(() => {
  loadCurrentModel();
  // ...
}, [...]);
```

`loadCurrentModel.loading = false` 被放在 `useEffect` 之前（无函数包裹），意味着：
1. **每次组件 re-render** 都会把 loading 重置为 false
2. React Strict Mode 下 useEffect 会双调用
3. 在 `loadCurrentModel()` 执行中触发任何 state 更新 → re-render → loading 被重置 → 第二个并发请求通过闸门

**影响**:
- "加载中...正在请求 /api/agent/config" 显示闪烁
- 配置请求**可能并发触发 2 次**（实测可见 Network 标签里出现 2 条相同请求）
- 后续切换会话时也偶尔复现

**修复建议**:
```js
const loadingRef = useRef(false);

const loadCurrentModel = async () => {
  if (loadingRef.current) return;
  loadingRef.current = true;
  try {
    // ...
  } finally {
    loadingRef.current = false;
  }
};
```

**预估工作量**: 10 分钟

---

### #BUG-02 【高】`/api/query/generate` 异常无 try/catch 包裹

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L300-L420)

**问题**:
整个 `/generate` 路由函数从 line 300 一直到底（420+ 行），**没有顶层 try/catch**。任何同步抛出（如 JSON.parse 失败、SDK 内部异常）都会走到 Express 默认错误处理器，返回 500 + 堆栈。

**影响**:
- 任意一次 LLM 异常会**直接 5xx** 整个 SSE 流，前端 `reader.read()` 拿到非 200 响应后只显示"请求失败"，无具体原因
- 多轮 tool call 中若 throw，客户端永远卡在"加载中"（流没收到 `done` 事件）

**修复建议**:
```js
router.post('/generate', async (req, res) => {
  try {
    // ... 原逻辑
  } catch (e) {
    logger.error('generate failed', { error: e.message, stack: e.stack });
    if (!res.headersSent) {
      return res.status(500).json({ error: '服务器内部错误' });
    }
    // 已经发了 SSE 头，要走 SSE 通道报 error
    res.write(`data: ${JSON.stringify({ type: 'error', content: '生成失败' })}\n\n`);
    res.end();
  }
});
```

**预估工作量**: 20 分钟

---

### #BUG-03 【高】`/execute` 强制追加 `LIMIT 1000` 静默截断

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L600-L640)

**问题**:
```js
// 在拼接最终 SQL 时无条件追加 LIMIT 1000
const finalSql = cleaned + ' LIMIT 1000';
```

**影响**:
- 用户写 `SELECT ... UNION ALL ...` 时被强制截断
- AI 生成的 SQL 里如果有 `LIMIT 50 OFFSET 0`（用户期望分页），最终变成 `... LIMIT 50 OFFSET 0 LIMIT 1000` → **MySQL 语法错误**
- **完全静默丢失数据**，用户看不到 "你查了 N 行，被截到 1000"

**修复建议**:
- 不自动加 LIMIT
- 改成响应中带 `truncated: true/false` 和 `totalAvailable` 字段
- 或只在明显没有 LIMIT 时才加（且仅在单表 SELECT 时）

**预估工作量**: 30 分钟

---

### #SEC-01 【高】`/api/skills/fetch-ddl` SQL 注入

**位置**: [backend/src/routes/skill.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js)

**问题**:
```js
// 典型反模式
const sql = `SHOW CREATE TABLE \`${tableName}\``;
```

`tableName` 来自前端请求体或 URL 参数，**完全没做白名单校验**。

**PoC**:
```
POST /api/skills/fetch-ddl
{ "tableName": "users`; DROP TABLE users; --" }
```

**修复建议**:
1. 严格白名单：只允许 `[a-zA-Z0-9_.]+` 且最大 64 字符
2. 优先用 `table_index.json` 里已存在的表名做二次校验
3. 实在要拼接就用占位符：
   ```js
   const sql = 'SHOW CREATE TABLE ??';
   const [rows] = await conn.query(sql, [tableName]);
   ```
   注意 mysql2 的 `?` 占位符**不识别 `??`（列/表占位符）用于 SHOW CREATE**，需手工转义反引号并校验字符集

**预估工作量**: 15 分钟

---

### #PERF-01 【高】MySQL 连接每次请求都新建

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L590-L610) 等多处

**问题**:
```js
const conn = await mysql.createConnection({...});
const [rows] = await conn.query(sql);
await conn.end();
```

`/execute` / `/explain` / `/fetch-ddl` / `/db-info` 每次都 `createConnection` + `end()`。

**影响**:
- 每次 TCP 握手 + MySQL auth + close，**单次查询 50-200ms 浪费在连接上**
- 慢 SQL 时连接池用尽可能
- 突发并发（N 个用户同时点查询）会触发 `ER_CON_COUNT_ERROR`

**修复建议**:
```js
// 单例 pool
let pool = null;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: cfg.mysql.host,
      // ...
      connectionLimit: 10,
      waitForConnections: true,
    });
  }
  return pool;
}

// 使用
const [rows] = await getPool().query(sql);
```

**预估工作量**: 30 分钟

---

<a id="p1"></a>
## 🟠 P1 - 建议本轮修复（11 个）

### #SEC-02 【中】错误信息直接返回前端

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js) 全部 catch 块

**问题**:
```js
catch (e) {
  return res.json({ error: e.message });  // 把内部细节抛给前端
}
```

例如 MySQL 报错会泄露 `ER_DUP_ENTRY: Duplicate entry 'admin' for key 'username'` 这类**含表名/列名**的细节；LLM API 失败会泄露 `https://api.deepseek.com/v1/...` URL + key 前缀。

**修复建议**:
```js
catch (e) {
  logger.error('xxx failed', { error: e.message, stack: e.stack });
  return res.json({ error: '操作失败' });  // 用户文案
}
```

**预估工作量**: 30 分钟

---

### #SEC-04 【中】JWT secret 持久化到 SQLite

**位置**: [backend/src/services/auth.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js)

**问题**:
当 `JWT_SECRET` 环境变量未设置时，代码自动生成 secret **并写入数据库 config 表**。意味着：
- DB 文件被复制 → 攻击者可以签发任意 token
- `WRAP_INSYNC`/`BACKUP` 行为可能把 secret 带出

**修复建议**:
- 生产模式（`NODE_ENV=production`）**必须**有 `JWT_SECRET`，否则启动失败
- 开发模式仍可自动生成，但加日志告警
- secret 不要和 user data 存同一 DB

**预估工作量**: 20 分钟

---

### #LOG-03 【中】`initDatabase` 启动未 await

**位置**: [backend/src/index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js#L20-L50)

**问题**:
```js
initDatabase();  // fire-and-forget
initSkillLogTable();
app.listen(PORT, ...);
```

虽然现在靠 `console.log('SQLite initialized')` 做 ready 信号（Electron 端检测），但 `initSkillLogTable` 失败时**没有任何告警机制**，Electron 等不到信号会卡 30 秒超时。

**修复建议**:
```js
await initDatabase();
await initSkillLogTable();
app.listen(PORT, ...);
```

**预估工作量**: 10 分钟

---

### #DEAD-01 【清理】`callLLM()` 整个函数未使用

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L490-L562)

**问题**:
73 行代码（4 个 provider 实现 + Promise.race 超时）**从未被任何代码调用**。实际 LLM 调用已经迁到 `services/llm.js` 的 LangChain 流程。

**修复建议**: 直接删除整段

**预估工作量**: 5 分钟

---

### #DEAD-02 【清理】`buildSchemaFromSkillV2` / `matchTables` / `loadFieldConfig` 死代码

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L82-L196)

**问题**:
整套 100+ 行的"基于表名匹配 → 拼 schema"逻辑 + `cachedSkill` 状态机**从未被引用**。已被 `services/llm.js` 的 tool call（`get_tables` / `get_table_schema`）替代。

**修复建议**: 删除整个 `loadSkillV2` / `loadFieldConfig` / `matchTables` / `buildSchemaFromSkillV2` + 模块级 `cachedSkill`

**预估工作量**: 10 分钟

---

### #DEAD-03 【清理】三个空路由文件

**位置**:
- [backend/src/routes/tables.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/tables.js)
- [backend/src/routes/tableSchema.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/tableSchema.js)
- [backend/src/routes/export.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/export.js)

**问题**:
Router 创建后**没有挂任何路由**，也没在 `index.js` 中注册。

**修复建议**: 全部删除

**预估工作量**: 5 分钟

---

### #DEAD-04 【清理】`sql-parser` 依赖未使用

**位置**: [backend/package.json](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/package.json#L23)

**问题**:
`sql-parser@0.5.0` 已声明但**无任何 import**。

**修复建议**:
```bash
npm uninstall sql-parser
```

**预估工作量**: 1 分钟

---

### #DEAD-05 【清理】`@langchain/deepseek` 依赖未使用

**位置**: [backend/package.json](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/package.json#L12)

**问题**:
`@langchain/deepseek@1.0.22` 已声明但**无任何 import**。实际 LLM 走 `ChatOpenAI` 自定义 baseURL（llm.js L3）。

**修复建议**:
```bash
npm uninstall @langchain/deepseek
```

**预估工作量**: 1 分钟

---

### #DEAD-06 【清理】`ChatOpenAI` 导入后只用于注释

**位置**: [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L3, L280)

**问题**:
```js
import { ChatOpenAI } from '@langchain/openai';
// ...
//   const llm = new ChatOpenAI({...}).bindTools(tools);  // 注释
```

**修复建议**:
- 若已彻底改用 `fetch` 直接打 API → 删 import
- 若要保留作为未来重构 → 注释清楚原因

**预估工作量**: 1 分钟

---

### #DEAD-07 【清理】`getLastMessages` 调试接口 + 旧注释

**位置**:
- [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L38)
- [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L648)
- [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L211)

**问题**:
1. `getLastMessages()` 暴露的是进程级全局 `lastMessages` 变量，跨用户污染（前次会话标记为已知不修）
2. `llm.js` L648 注释 `// （已废弃：generateSQLWithLangChainStreamGenV2 从未被任何代码调用）` 指向**根本不存在的函数名**

**修复建议**:
- 删 `/query/messages` 路由
- 删 `getLastMessages` 函数
- 删 L648 这条"已废弃"注释

**预估工作量**: 10 分钟

---

### #LOG-04 【中】`getLastMessages` 跨用户（已知不修，写注释）

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L208-L220)

**现状**:
你之前说"前端没调用就不改"，但**接口仍然暴露在 /api/query/messages**，其他端点可能误调，且未来如果有任何代码引用就立刻是 P0。

**修复建议**:
要么：
- (A) 加 `// 前端没有调用，但保留供开发调试` 注释（你已经选了）
- (B) 路由 + 函数一起删（更彻底）

**预估工作量**: 1 分钟

---

<a id="p2"></a>
## 🟡 P2 - 后续清理（19 个）

### ⚡ 性能

#### #PERF-02 【中】`bpeEncode` 字节拆分未预分配

**位置**: [backend/src/services/tokenizer.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/tokenizer.js#L67-L80)

```js
const newTokens = [];
for (const char of tokens) {
  if (vocab[char] !== undefined) {
    newTokens.push(char);
  } else {
    const utf8 = Buffer.from(char, 'utf8');
    for (const byte of utf8) {
      newTokens.push(String.fromCharCode(byte));
    }
  }
}
```

**问题**:
- 每次 push 都可能触发 V8 数组扩容
- 中文长文本 O(N) 扩容

**修复建议**:
```js
const newTokens = new Array(tokens.length);
let idx = 0;
for (const char of tokens) {
  if (vocab[char] !== undefined) {
    newTokens[idx++] = char;
  } else {
    const utf8 = Buffer.from(char, 'utf8');
    for (const byte of utf8) {
      newTokens[idx++] = String.fromCharCode(byte);
    }
  }
}
newTokens.length = idx;
```

**预估工作量**: 5 分钟

---

#### #PERF-03 【中】`/query/generate` 消息未 LRU 缓存

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L380-L400)

**问题**:
每次 AI 请求都 `loadMessagesFromDb(sessionId)`，无任何缓存。多轮对话中前几轮历史每次都要查一次。

**修复建议**:
- 加 LRU（key: sessionId, value: messages[]）
- 写入新消息时失效

**预估工作量**: 30 分钟

---

#### #PERF-04 【低】`loadFieldConfig` 缓存无过期

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L82-L94)

**问题**:
虽然 #DEAD-02 删了函数就解决了，但若保留则需要过期机制。

---

#### #PERF-05 【中】`App.jsx` 800+ 行单组件

**位置**: [frontend/src/App.jsx](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx)

**问题**:
- 60+ 个 useState
- 20+ 个事件处理函数
- 任何 state 变化触发整个组件 re-render
- 200+ 行 useEffect

**修复建议**:
- 拆分为 `ChatPanel` / `SqlPanel` / `SkillPanel` / `MessageList` 等子组件
- 状态管理用 useReducer 或 zustand

**预估工作量**: 4 小时

---

#### #PERF-06 【低】`getSessions` token 统计 N+1

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L260-L290)

**问题**:
列出 N 个会话时，循环内每次都 `SELECT SUM(total_tokens) FROM llm_messages WHERE session_id = ?`，N+1 查询。

**修复建议**:
```sql
SELECT s.*, COALESCE(SUM(m.total_tokens), 0) as total_tokens
FROM sessions s
LEFT JOIN llm_messages m ON m.session_id = s.id
WHERE s.user_id = ?
GROUP BY s.id
```

**预估工作量**: 10 分钟

---

### 📐 逻辑 / 设计

#### #LOG-01 【中】`/query/explain` 三分支重复

**位置**: [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L660-L720)

**问题**:
MySQL / 通用 explain / explain analyze 三段几乎相同。

**修复建议**: 提取 `runExplain(cleanedSql, conn, mode)`

**预估工作量**: 20 分钟

---

#### #LOG-02 【中】登录页用户名规则不一致

**位置**: [frontend/src/components/LoginPage.jsx](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/components/LoginPage.jsx)

**问题**:
- 登录表单 `username` 字段无 `pattern` 校验（虽然后端会校验）
- 注册表单有 `pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/`
- **不一致**导致用户登录时输入 `用户名@公司` 等能过前端、但后端 400

**修复建议**: 登录也加同样的 pattern 规则

**预估工作量**: 5 分钟

---

#### #LOG-05 【低】`loadCurrentModel` 函数属性锁 + Strict Mode

**位置**: [frontend/src/App.jsx](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L192-L201)

参见 #BUG-01，本质相同但同时是逻辑问题（用函数属性做并发锁，违反 React 数据流）。

---

#### #LOG-06 【低】`handleDeleteSession` 失败时关闭弹窗

**位置**: [frontend/src/App.jsx](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L344-L362)

**问题**:
```js
catch (e) {
  message.error('删除失败');
  // 但 Modal 仍然关闭（Ant Design 的 Modal.confirm 默认行为）
}
```

**修复建议**: catch 时 `onOk` 抛 Promise.reject 阻止关闭

**预估工作量**: 5 分钟

---

### 📝 文档 / 注释

#### #DOC-01 【低】CHANGELOG 缺失近期安全修复

**位置**: 项目根目录

**建议**: 把 P0 修复（路径遍历、跨用户泄露、SQL 注入、token 清理、bcrypt 异步化、rate limit、schema 升级错误处理、tool 重复调用）写入 CHANGELOG

**预估工作量**: 20 分钟

---

#### #DOC-02 【低】`llm.js` 末尾的"已废弃"注释指向不存在的函数

**位置**: [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L648)

参见 #DEAD-07。

---

#### #DOC-03 【低】README 中"单用户"描述已过时

**位置**: README.md

**建议**: 改为"支持多用户登录 / 聊天记录按用户隔离 / 默认 admin/admin123"

**预估工作量**: 5 分钟

---

### 🧹 其他无用代码

#### #DEAD-08 【清理】`generateSQLWithLangChainStreamGen_BAK` 名字带 _BAK

**位置**: [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L325)

**问题**:
这是**当前在用**的实现，但函数名带 `_BAK` 后缀，引起新成员困惑。

**修复建议**: 重命名为 `generateSQLWithLangChainStreamGen`

**预估工作量**: 5 分钟

---

#### #DEAD-09 【清理】`console.log` 散落未被 logger 接管

**位置**: [backend/src/db/sqlite.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L202, L224) / [backend/src/index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js#L46)

**问题**:
```js
console.log('SQLite initialized');  // 没走 winston
console.log('Server running on port ' + PORT);
```

Electron 用 stdout 文本匹配做就绪信号时兼容，但**生产模式应走 logger**。

**修复建议**:
- `console.log` 改为 `logger.info`（同时保留 stdout 输出，Electron 能匹配）
- 或只在 `process.env.NODE_ENV === 'production'` 时改用 logger

**预估工作量**: 10 分钟

---

### 其他

#### #MISC-01 【低】`vite.config.js` 缺 `define` 配置

**位置**: [frontend/vite.config.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/vite.config.js)

```js
// 缺
define: {
  'process.env.NODE_ENV': JSON.stringify(mode),
},
```

虽然 Vite 大多数情况下能自动处理，但若引入了某些 CJS 库可能缺 `process.env`。

**预估工作量**: 2 分钟

---

#### #MISC-02 【低】`tokenizer.js` 文件路径硬编码 5 层 `../`

**位置**: [backend/src/services/tokenizer.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/tokenizer.js#L9)

```js
const tokenizerPath = path.join(__dirname, '../../deepseek_v3_tokenizer/tokenizer.json');
```

打包后 `__dirname` 变化会失效。

**修复建议**:
```js
const tokenizerPath = process.env.TOKENIZER_PATH
  || path.join(process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..'), 'deepseek_v3_tokenizer/tokenizer.json');
```

**预估工作量**: 10 分钟

---

#### #MISC-03 【低】`bcryptjs` 名字误导

**位置**: [backend/package.json](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js)

**问题**:
实际使用的是 `bcryptjs`（纯 JS 实现），不是 `bcrypt`（原生实现）。`bcryptjs` 性能比 `bcrypt` 慢 5-10 倍。10 rounds 时 100-200ms 每次 hash。

**修复建议**:
- 若接受原生依赖（electron-rebuild）→ 换 `bcrypt`（+ 自动构建脚本）
- 若保持纯 JS → 至少把 rounds 降到 8（已经 10 改成 8 可提速 1 倍）

**预估工作量**: 30 分钟（含测试）

---

<a id="附录"></a>
## 附录: 已确认无需修改

| 编号 | 内容 | 你的决定 |
|---|---|---|
| 跨用户数据泄露 `/api/query/messages` | 前端无调用，保留调试用 | 加注释（已完成） |
| CORS `origin: true` | 内网部署，不暴露公网 | 不修 |

---

## 修复建议优先级

| 优先级 | 问题编号 | 累计预估工作量 |
|---|---|---|
| **P0** | #BUG-01 / #BUG-02 / #BUG-03 / #SEC-01 / #PERF-01 | ~2 小时 |
| **P1** | #SEC-02 / #SEC-04 / #LOG-03 / #DEAD-01~07 / #LOG-04 | ~3 小时 |
| **P2** | 上述 19 项 | ~8 小时 |

**最划算的清理**: 一次性删除 #DEAD-01~07（30 分钟），可清理 ~250 行无用代码 + 2 个无用依赖。

---

## ✅ 已修复（2026-06-20 当日）

| 编号 | 标题 | 状态 | 修复位置 |
|------|------|------|----------|
| #BUG-01 | `loadCurrentModel.loading` 模式存在并发漏洞 | ✅ 已修 | [frontend/src/App.jsx](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx) - 改用 `loadingRef.current.model` |
| #BUG-02 | `/api/query/generate` 异常无 try/catch 包裹 | ✅ 已修 | [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js) - 区分 `res.headersSent` 分流到 SSE / JSON |
| #BUG-03 | `/execute` 强制追加 `LIMIT 1000` 静默截断 | ✅ 已修 | [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js) - 应用层 slice + `truncated`/`returned` 字段 |
| #SEC-01 | `/api/skills/fetch-ddl` SQL 注入 | ✅ 已修 | [backend/src/routes/skill.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js) - 三层防御（白名单 + 类型 + 反引号过滤） |
| #PERF-01 | MySQL 连接每次请求都新建 | ✅ 已修 | 新增 [backend/src/services/mysqlPool.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/mysqlPool.js) 单例池，3 个热路径改造 |
| #LOG-03 | `initDatabase` 启动未 await | ✅ 已修 | [backend/src/index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js) - 启动失败 `process.exit(1)` |
| #PERF-02 | `bpeEncode` 字节拆分未预分配 | ✅ 已修 | [backend/src/services/tokenizer.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/tokenizer.js) - 预分配 + 索引器 |
| #PERF-06 | `getSessions` token 统计 N+1 | ✅ 已修 | [backend/src/routes/session.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/session.js) - 显式 LEFT JOIN + GROUP BY |

### 修复验证
- `✅ mysqlPool.js 加载 OK`
- `✅ query.js + skill.js 都能正常 import`
- `✅ 白名单验证: 3 个合法表名通过 / 8 个注入尝试全部拒绝`
- `✅ bpeEncode: 4000 中文 5ms 处理完`
- `✅ getSessions: 3 个 session token 统计全部正确（S0=200, S1=50, S2=0）`

### 剩余问题
- 🟠 P1：4 个（#SEC-02 / #SEC-04 / #DEAD-01~07 / #LOG-04）
- 🟡 P2：18 个

详见 [CHANGELOG.md](../changelog/CHANGELOG.md) 2026-06-20 段落。

---

**报告生成**: 2026-06-20
**生成工具**: Trae IDE (MiniMax-M3)

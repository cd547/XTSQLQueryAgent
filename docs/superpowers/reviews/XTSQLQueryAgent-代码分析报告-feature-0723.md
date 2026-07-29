# XTSQLQueryAgent 代码分析报告

| 项目 | 信息 |
|------|------|
| 仓库 | `cd547/XTSQLQueryAgent` |
| 分支 | `feature/0723` |
| 分析日期 | 2026-07-29 |
| 分析范围 | 后端（7,622 行）/ 前端（4,242 行）/ Electron 壳（606 行）/ 工程化配置，全部核心文件逐行阅读 |
| 验证方式 | 关键结论已由主分析线回读源码逐行复核（标记 ✅已复核） |

---

## 目录

1. [执行摘要](#一执行摘要)
2. [P0 确定性 Bug](#二p0-确定性-bug必修)
3. [后端分析报告](#三后端分析报告)
4. [前端分析报告](#四前端分析报告)
5. [Electron 与工程化分析报告](#五electron-与工程化分析报告)
6. [修复优先级路线图](#六修复优先级路线图)

---

## 一、执行摘要

**项目定位**：自然语言转 SQL 的 LLM Agent 桌面/网页应用。Electron 42 + React 18/Vite/AntD 5 + Express + better-sqlite3 + mysql2 + DeepSeek LLM。包含 100+ 张表的 Skill V2 知识库（域路由 → 表索引 → 字段配置 → DDL）。

**总体评价**：**中上质量**。代码有明显迭代痕迹，注释诚实（多处 `[DEAD-CODE]` 标记与历史 Bug 复盘），鉴权链路、SQL 校验状态机、Agent loop 超时清理体系在同类项目中属于少见的严谨。但存在 **3 个确定性 Bug** 和 **7 项高危安全问题**，建议下次发版前修复。

**问题分布**：共 60+ 条（高 14 / 中 20+ / 低 25+）

| 类别 | 数量 | 代表问题 |
|------|------|----------|
| 确定性 Bug（P0） | 3 | catch 块 ReferenceError 致进程崩溃；非流式请求永久挂起；Electron 退出不杀后端 |
| 高危安全 | 7 | WITH 写绕过、凭证明文存储、CORS 任意 origin、调试路由泄露他人上下文等 |
| 正确性/竞态 | ~10 | SSE 解析丢内容、会话切换竞态、EXPLAIN 结果串 tab |
| 性能 | ~8 | 无虚拟化长列表、LLM 历史无限增长、连接池无 acquireTimeout |
| 工程化 | ~10 | 打包产物不可用、无测试体系、依赖松散 |

**核心优点**：

- sqlValidator 字符级状态机质量高，连 MySQL 条件注释 `/*!...*/` 都封死
- Agent loop 三阶段并行 + 工具去重 + T2/T3/T4 分层超时 + SSE 中断清理
- 鉴权设计优秀（httpOnly cookie + token_version 吊销 + 401 事件总线），前端 XSS 防控到位
- Electron 渲染进程配置正确（contextIsolation、无 nodeIntegration），启动可观测性出色

---

## 二、P0 确定性 Bug（必修）

### P0-1 `/explain-analyze` catch 块必抛 ReferenceError → 后端进程崩溃 ✅已复核

**位置**：`backend/src/routes/query.js:802` vs `query.js:891`

```js
// 802 行（try 块内，const 块级作用域）
const overallTimer = setTimeout(() => { ... }, OVERALL_TIMEOUT_MS);
...
// 890-891 行（catch 块——try 块的 const 在此不可见）
} catch (error) {
  clearTimeout(overallTimer);   // ← ReferenceError: overallTimer is not defined
```

**问题**：`overallTimer` 是 try 块内的 `const`，catch 块属于另一作用域，**每次**进入 catch 都会抛 ReferenceError。896 行注释只对 `abortController` 做了 typeof 守卫，遗漏了 overallTimer。该路由是 async 函数，而 `package.json` 锁定 `express: ^4.21.0`——Express 4 不接管 async 抛错，异常成为 unhandledRejection，Node 15+ 默认**进程退出**（整个后端崩溃）。同文件 `/generate` 路由（526 行 catch）timer 与 catch 在同一块级作用域所以无此问题，正好反证这里是笔误。

**修复**：把 `let overallTimer = null` 提升到 try 之前声明；同时增加全局错误兜底中间件 + `process.on('unhandledRejection')` 护栏；长期可升级 Express 5。

### P0-2 `/generate` 非 stream 模式请求永久挂起 ✅已复核

**位置**：`backend/src/routes/query.js:341-539`

```js
if (schemaMode === 'stream') {
  ...
  return;              // 537
}                      // 538
// ← 此处没有任何 else 分支，也没有后续响应逻辑
```

**问题**：`schemaMode !== 'stream'` 时函数走完 try 块什么都不返回，客户端挂起直到超时。属旧非流式实现删除后留下的空洞（前端目前硬编码 `schemaMode: 'stream'`，所以未暴露）。

**修复**：else 分支 `return res.status(400).json({ error: '仅支持 schemaMode=stream' })`，或补回非流式实现。

### P0-3 Electron 变量遮蔽：退出时后端进程永远不会被杀死 ✅已复核

**位置**：`electron/main.js:9`、`main.js:328`、`main.js:589-597`

```js
let backendProcess;                    // L9 全局声明
...
function startBackend() {
  ...
  let backendProcess;                  // L328 局部变量遮蔽全局！
  backendProcess = spawn(nodePath, ...); // 只赋给局部
}
...
app.on('window-all-closed', () => {
  if (backendProcess) {                // 全局恒为 undefined，永不进入
    backendProcess.kill();
```

**问题**：每次关闭应用都遗留孤儿 node.exe（占用 5002 端口、持有 SQLite WAL 句柄）。日常未暴露是因为下次启动时 `killProcessOnPort(5002)` 兜底强杀。与设计文档"窗口关闭时自动清理后端子进程"的承诺相悖。

**修复**：删除 L328 的 `let`；同时在 `before-quit` 也加 kill 兜底。

---

## 三、后端分析报告

### 3.1 架构概述

Express 4 单体应用（ESM 模块），分层为 `routes → services → db/mysqlPool`。本地元数据（用户/会话/消息/配置/LLM 历史）存 better-sqlite3（WAL 模式），业务库为 MySQL（mysql2 单例连接池）。核心是 `llm.js` 中基于 async generator 的 agent loop：加载 SKILL.md + 会话历史，驱动 DeepSeek 流式 tool-calling，最多 30 轮，通过 SSE 向客户端实时推送 chunk/usage/思考/工具日志。鉴权为 JWT（httpOnly cookie + Bearer 双通道）+ token_version 吊销 + bcryptjs。SQL 安全依赖自研 `sqlValidator.js`（注释剥离状态机 + 前缀白名单 + 危险函数黑名单）+ 连接池禁多语句双保险。skill 知识库为本地 JSON/MD 文件，带缓存、备份与审计日志。

### 3.2 核心流程：一次 `/api/query/generate` (stream) 请求链路

1. **路由层**（query.js:292-552）：`authRequired` 查库验 JWT+token_version → sessionId 归属校验（无则 `ensureSession` 自动建会话）→ user 消息落 `messages` 表 → `loadSkillMd()` → 设 SSE 头 + `setNoDelay` + T3 整体 5min 定时器 + `res.on('close')` 触发 abort。
2. **agent loop**（llm.js:1000-1947）：
   - 入口：`resetPerQuestionRegistryFlags` 重置问题级标志 → 读 LLM 配置 → 从 `llm_messages` 加载历史（JSON blob），替换 system 消息、追加 user 消息。
   - 每轮（≤30 轮，llm.js:1108）：构建 checklist 提示消息（不持久化）→ `compactConsumedToolResults` 折叠已消费的 sliced_index 结果 → 剥离无 tool_calls 的 assistant 的 reasoning_content（DeepSeek 协议要求）→ 工具剪枝 → `fetch` DeepSeek 流式接口（T2 120s 超时）→ 逐行解析 SSE（T4 30s/read 超时），yield chunk/usage/reasoning_chunk → 汇总流式 tool_calls → **三阶段工具执行**：①同步参数解析（含裸引号自动修复）+ 幻觉调用拦截 + `checkAndFilterDuplicateCall` 注册表去重；②`Promise.all` 并行执行；③按原序写回 messages 并 `saveMessagesToDb` → 命中 `request_user_choice` 则 break 并 yield done 携带弹窗载荷。
3. **路由消费侧**：for-await 消费 generator，实时落库并 SSE 透传；done 时写 assistant 消息（含 token 与耗时）、累计 `sessions.total_tokens`、解析 `user_choice_request`/`confirm_tag_add` 标记透传前端。
4. **SQL 执行**（独立链路 query.js:629-695 `/execute`）：`validateReadOnlySql`（剥离注释→前缀白名单 SELECT/WITH→危险函数黑名单→多语句检测）→ 连接池 `query` → 应用层截断 1000 行返回。

### 3.3 问题清单

#### 🔴 高严重度

**B1. CORS 任意 Origin + credentials，localhost 服务面临 DNS Rebinding 绕过**
【`src/index.js:10-13`】
```js
app.use(cors({
  origin: (origin, cb) => cb(null, true), // 任意 origin；通过 cookie+SameSite 保护
  credentials: true
}));
```
反射任意 Origin 且 `credentials: true`。注释称依赖 SameSite=Lax 防护，但：①Electron/localhost 部署下，攻击者可通过 DNS Rebinding 让恶意域名解析到 127.0.0.1，此时请求变为"同站"，SameSite 完全失效，浏览器携带 httpOnly cookie 发起请求且 CORS 放行响应读取——等于任意网站可操作用户本地实例全部 API（含执行 SQL）；②未校验 Host 头。
**修复**：①显式 origin 白名单（`['http://localhost:5173', 'app://-']` 或按环境变量配置）；②Host 头校验中间件（仅允许 `127.0.0.1:5002`/`localhost:5002`）；③非 Electron 部署改 Bearer-only 并关 credentials。

**B2. DB 密码、LLM API Key、JWT 密钥全部明文存储于同一 SQLite 表**
【`src/routes/config.js:39、67`；`src/services/auth.js:22-25`】
```js
// routes/config.js:39
const configData = JSON.stringify({ host, port, user, password, database });
// services/auth.js:24-25
const secret = crypto.randomBytes(48).toString('hex');
db.prepare('INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)').run('jwt_secret', secret);
```
三类最高机密全部以明文 JSON 存于 `data/app.db` 的 configs 表。任何能读到该文件的人/进程（备份、同步盘、其他本地软件）即获得全部凭证；拿到 jwt_secret 可伪造任意 admin token。
**修复**：①对称加密（key 派生自机器特征/Electron safeStorage）或环境变量注入；②JWT secret 与业务凭证分离存储；③`POST /db`、`POST /llm` 增加字段级校验与审计日志。

**B3. sqlValidator 的 `WITH` 前缀白名单可被 MySQL 8 的 `WITH ... DELETE/UPDATE` 绕过执行写操作**
【`src/services/sqlValidator.js:255、272-280`；`src/routes/query.js:16`】
```js
const { allowedPrefixes = ['SELECT', 'WITH'], maxLength = 20000 } = options;  // 255
const prefixRe = buildPrefixRe(allowedPrefixes);                              // 272
if (!prefixRe.test(cleaned)) { ... }   // ^\s*(SELECT|WITH)\b
```
MySQL 8.0 官方语法允许 `WITH cte AS (...) DELETE FROM t` / `WITH ... UPDATE ...`。此类语句：以 WITH 开头 ✓ 通过前缀白名单；无分号 ✓ 通过多语句检测；不含黑名单函数 ✓。`multipleStatements:false` 也挡不住（单语句）。项目 schema 面向 MySQL 5.7，但连接的实例版本由管理员配置决定，一旦指向 8.0 实例，`/api/query/execute` 即可删改任意表。另外 `SELECT ... FROM information_schema.*`/`mysql.user` 跨 schema 读取不受限（只读但越权）。
**修复**：①对 WITH 语句用 node-sql-parser（已是依赖）解析 AST，确认顶层语句类型为 SELECT；②或用只读账号/会话级 `SET SESSION TRANSACTION READ ONLY`；③限制可访问 schema。

**B4. `/explain-analyze` catch 块 ReferenceError → 进程崩溃**
→ 见 [P0-1](#p0-1-explain-analyze-catch-块必抛-referenceerror--后端进程崩溃-已复核)

**B5. `/generate` 非 stream 模式请求永久挂起**
→ 见 [P0-2](#p0-2-generate-非-stream-模式请求永久挂起-已复核)

**B6. `/execute` 全量结果集读入内存并全量 JSON 落 SQLite，大结果直接 OOM/DB 爆炸**
【`src/routes/query.js:657、662、676`】
```js
const [allRows] = await (await getPool()).query(execSql);   // 657：无 LIMIT，全表进内存
const truncated = allRows.length > MAX_DISPLAY_ROWS;
...
.run(sessionId, sql, JSON.stringify(allRows));              // 676：全量行序列化存 SQLite
```
应用层截断（1000 行）只影响**返回前端**的部分；`allRows` 已把整张表读进 Node 内存（无行数/字节上限），且 676 行把**全量**结果 JSON.stringify 写进 messages.results——一张百万行的表会让 Node 进程 OOM，即使不 OOM 也会让 SQLite 单条消息膨胀到数百 MB，后续会话历史加载被拖垮。
**修复**：①SQL 层强制 `LIMIT`（包装子查询或解析后注入）；②results 落库前截断到 MAX_DISPLAY_ROWS，大结果只存摘要；③messages.results 增加大小上限保护。

**B7. 流中断时 partial assistant 消息不落库，用户已消耗的内容与 token 丢失** ✅已复核
【`src/routes/query.js:473-496、526-531`】
assistant 消息与 token 统计只在 stream 正常完成路径（473-496 行）写入；用户点停止/网络断开时，`res.on('close')` 触发 abort，generator 抛错进入 526 行 catch，直接写 error 事件——**已生成的大部分内容、已消耗的 LLM token 全部不落库**，前端刷新后该轮对话完全消失，token 统计也失真。
**修复**：catch/abort 路径补一次 partial 保存（标记 `interrupted: true`）；token 按已收到的 usage 累计。

**B8. llm_messages 调试路由向任意登录用户泄露其他提问者的完整 LLM 上下文**
【`src/routes/query.js:211-213` 附近】
该调试接口仅需普通登录即可查看任意会话的完整 LLM 消息历史（含他人问题、表结构、SQL）。代码注释已自承风险但仍默认挂载。
**修复**：生产构建中移除该路由，或加 `adminRequired + NODE_ENV!=='production'` 双闸门。

**B9. skill 写接口（/save、/add-tag、/create-table-files）仅需普通登录，任意用户可篡改全局 prompt 知识库**
【`src/routes/skill.js:17`（`router.use(authRequired)`，无 adminRequired）】
skill 文件直接决定所有用户的 system prompt 与工具返回内容。普通用户可注入恶意业务规则/SQL 示例（间接 prompt injection 全体用户）。另 `/api/skills/debug`（97-105 行）向任意用户泄露服务器绝对路径。
**修复**：写操作与 /debug 加 `adminRequired`；保留只读接口给普通用户。

#### 🟡 中严重度

**B10. 限流仅覆盖 auth 路由，高成本接口裸奔**
【`src/middleware/rateLimit.js`；`src/routes/query.js:23`】
`/generate`（每请求可烧 30 轮 LLM token）、`/execute`（全表扫描）、`/summarize` 均无频率限制。多用户共享部署时单用户可耗尽 API 配额/打满 MySQL 连接池。
**修复**：为 /generate、/execute、/summarize 加按用户维度的 limiter（keyGenerator 用 `req.user.id`）。

**B11. LLM 历史无截断/压缩机制，长会话 token 与存储无限增长；且每轮全量重写**
【`src/services/llm.js:1058-1086`（全量 load）、`939-958`（每轮全量 JSON.stringify 重写 llm_messages）】
无任何 token 上限裁剪（仅前端警告阈值）。长对话最终必然超出模型上下文窗口 → API 400 使整个会话不可用。且 `saveMessagesToDb` 每轮 O(history) 重写，30 轮即 O(n²) 序列化开销。
**修复**：滑动窗口 + 摘要压缩（sessions.summary 字段已在但未被 llm.js 消费）；saveMessagesToDb 改增量追加。

**B12. MySQL 连接池无 acquireTimeout，队列无限长**
【`src/services/mysqlPool.js:19-27`】
```js
const POOL_CONFIG = { connectionLimit: 10, waitForConnections: true, queueLimit: 0, ... }
```
`queueLimit: 0` = 无限排队且无 `acquireTimeout`：慢查询占满 10 连接后，后续请求**永久挂起**（无超时、无错误），表现为前端转圈。
**修复**：加 `acquireTimeout: 15000` 与单查询 `timeout`，超时报错而非挂死。

**B13. Express 4 async 路由缺 try/catch，异常即 unhandledRejection**
【`src/routes/config.js:30-43、45-56、58-71、73-85、95`（`JSON.parse` 在 try 外）】
配置 JSON 损坏或 DB 异常时直接炸进程（同 B4 机制）。
**修复**：统一包 asyncHandler 或补 try/catch。

**B14. 错误信息直接向客户端回传 `e.message`**
【`src/routes/auth.js:48/80/127`；`query.js:549/693` 等】
MySQL 错误含表名/语法上下文，SQLite 错误含路径——信息泄露面。
**修复**：客户端返回通用文案 + code，细节只进 logger。

**B15. authRateLimiter 按 IP 10 次/小时，localhost 多用户互相锁死**
【`src/middleware/rateLimit.js:15-26`】
Electron 场景所有请求来自 127.0.0.1：同机一个用户连续输错 10 次密码，其他所有用户 1 小时内无法登录/注册/改密。
**修复**：登录失败计数按 `username+IP` 复合 key；成功请求不计数（`skipSuccessfulRequests: true`）。

**B16. skill 文件写非原子，崩溃可损坏 table_index.json 等关键文件**
【`src/routes/skill.js:216、266、329、505、520` 均为 `fs.writeFileSync` 直写】
进程在写中途被杀 → JSON 截断 → `loadTableIndex` 解析失败 → agent 核心知识库不可用。
**修复**：写临时文件 + `fs.renameSync` 原子替换。

**B17. `POST /api/config/test` 构成 admin 级 SSRF/内网探测**
【`src/routes/config.js:14-28`】
admin 可让后端向任意 host:port 发起 MySQL 握手并通过 `error.message` 回显差异。admin-only 故为中危。
**修复**：host 限制为内网段或白名单。

#### 🟢 低严重度

| # | 文件:行号 | 问题 | 建议 |
|---|---|---|---|
| B18 | logger.js:26 | DailyFileTransport 构造时创建名为 `temp` 的 dummy 写流，永不关闭（fd 泄漏 + 垃圾文件） | 传入 `stream: process.stdout` 占位或重写构造 |
| B19 | query.js:25-32；session.js:60-69 | `MAX(sort_order)+1` 非原子，并发建会话得到相同 sort_order/重名 | `INSERT ... SELECT COALESCE(MAX)+1` 单语句或事务 |
| B20 | query.js:488-491 vs session.js:25-34 | token 统计两套真源互不同步 | 去掉一处（建议删 sessions.total_tokens 维护逻辑） |
| B21 | query.js:554-627 等 | `callLLM` 死代码且 Promise.race 超时不 abort fetch；39-197 行 cachedSkill 等无消费方；330 行 `if (false && sessionId)` 死分支 | 集中清理死代码 |
| B22 | mysqlPool.js:73-76 | getPool 配置变更 closePool 期间，并发请求可拿到正在关闭的旧池 | getPool 加 promise 单例锁 |
| B23 | sqlite.js:67-71 | 未 `PRAGMA foreign_keys = ON`，声明的 FK 不生效；session.js:132-136 三次 DELETE 无事务 | 开启外键 pragma；删除操作包 `db.transaction()` |
| B24 | tokenizer.js:101-138 | BPE 合并每轮全量 getPairs，长文本 O(n²) 且同步阻塞事件循环 | 限制计数字符上限或迁移 worker |
| B25 | auth.js:64 | bcrypt cost=10 偏低；bcryptjs 纯 JS 实现仍阻塞事件循环 | cost 提到 12；高并发换原生 `bcrypt` |
| B26 | query.js:718-723 | 三元表达式两个分支完全相同，isSelectOrWith 是死判断 | 简化为直接拼接 |
| B27 | llm.js:1041 | `t.lc_kwargs.params` 依赖 @langchain/core 内部字段，升级即碎 | toolFuncs.js 显式导出 params 元数据 |
| B28 | llm.js:1307 | `!line.includes("[DONE]")` 会误丢 content 中含 "[DONE]" 子串的合法数据行 | 精确匹配 `line === 'data: [DONE]'` |
| B29 | query.js:292-298 | `/generate` 未校验 `question` 非空 | 入口加 `if (!question?.trim()) return 400` |
| B30 | query.js:514 | `confirm_tag_add` 正则 `(\{[^}]+\})` 遇嵌套 `}` 即截断 | 改用事件字段透传（同 user_choice） |
| B31 | auth.js:9-10 | 注释"3-32 位"与正则 `{2,32}` 不符；register 响应回传 token_version 等内部字段 | 修正注释；响应只回必要字段 |
| B32 | llm.js:289-310 | splitThinkingFromContent 启发式可能误剥正常长回答开头 | 要求 reasoning_content 为空时才剥离 |
| B33 | llm.js:317-330 | flushTimer 缓冲日志在进程退出时丢失（最多 1s） | 注册 `process.on('exit')` 同步 flush |
| B34 | sqlite.js:91-108 | 非生产自动建 admin/admin123（已有警告与开关，属可接受残留风险） | 生产镜像强制 NODE_ENV=production |

### 3.4 后端做得好的地方

1. **sqlValidator 两阶段设计质量较高**：字符级状态机正确处理 `--`/`#`/块注释/字符串/反引号/转义，且识别并直接拒绝 MySQL 条件注释 `/*!...*/`（120-124 行），多语句检测 + `multipleStatements:false` 双保险——常见注释绕过手段基本被封死。
2. **agent loop 三阶段工具执行**（llm.js:1487-1703）：同步预处理 → 并行执行 → 按序写回，机制上避免同批 tool_calls 互相穿透；注册表 + checklist 注入 + 工具剪枝三层防重复调用。
3. **超时与资源清理体系完整**：T2/T4/T3 分层超时、`withPromiseTimeout` 的 onAbort 钩子 `reader.cancel()`（llm.js:1282）、SSE close→abort——流式中断处理是同类项目中少见的严谨。
4. **路径安全 `isPathSafe`**（skill.js:47-55）：`path.relative` 同时防 `../` 跳出、前缀撞名和绝对路径，实现正确。
5. **鉴权链路扎实**：JWT 格式预检省 CPU、token_version 吊销在 logout/改密均递增、register 强制 role='user' 防提权、sessionBelongsToUser 失败 fail-closed。
6. **性能意识**：会话列表 LEFT JOIN 消除 N+1、SQLite WAL + busy timeout、连接池配置指纹自动重建、skill 树缓存 + 写后失效、LLM 日志 1s 批量落盘。
7. **运维细节**：`addColumnIfMissing` 幂等迁移、DB 初始化失败拒绝监听、skill 文件写前备份 + skill_logs 审计表。

---

## 四、前端分析报告

### 4.1 架构概述

单页应用：`main.jsx` 挂载 `ThemeProvider > AuthProvider > App`。App 按登录态分流到 `LoginPage` 或巨型组件 `AuthenticatedApp`（App.jsx，2218 行，承载几乎全部业务）。Context 仅 Auth/Theme 两个，划分恰当；其余状态全部用 `useState` 堆在 AuthenticatedApp（60+ 个 state、15+ 个 ref）。API 层统一 axios 实例 + httpOnly cookie 鉴权 + 401 事件总线；SSE 用原生 `fetch + ReadableStream` 手写解析。子组件已做部分拆分且有 memo，但消息流、SQL 执行、Skill 管理、Excel 导出等核心逻辑仍全部内联在 App.jsx，呈"薄组件、厚页面"结构。

### 4.2 App.jsx 职责拆解与组件树

**AuthenticatedApp 承担的 12 块职责**（佐证超载）：

| # | 职责 | 主要行号 |
|---|------|---------|
| 1 | 会话列表分页加载/新建/删除/重命名/总结 | 224–595 |
| 2 | 消息加载、DB 消息归一化、耗时回填 | 368–428 |
| 3 | **SSE 流式引擎**（8 种事件分发） | 738–1017 |
| 4 | user_choice 链式弹窗状态机 | 1041–1102 |
| 5 | request_tag_confirmation 确认弹窗 | 805–822, 1025–1039 |
| 6 | SQL 标签页管理 + 执行 + EXPLAIN + AI 分析流 | 597–640, 1119–1228 |
| 7 | 结果表格列宽/列定义/分页 | 1356–1391 |
| 8 | Excel 导出（含样式逐格写入） | 1230–1309 |
| 9 | Skill 文件树浏览/编辑/保存/拖拽 | 1311–1354, 2008–2197 |
| 10 | 收藏状态机 + 收藏回显 + 新会话建议 | 642–736 |
| 11 | 滚动位置记忆/恢复 + rAF 节流滚动 | 430–454, 794–801 |
| 12 | Monaco 挂载/hover 屏蔽 hack + 6 处拖拽 resize | 1661–1708 等 |

**组件树**：
```
App ── bootstrapping→Spin / 未登录→LoginPage / 已登录→AuthenticatedApp
AuthenticatedApp (ConfigProvider)
 ├─ Sider：会话列表(Dropdown) + 用户卡片 + 配置/Skill 入口
 ├─ Content：Tabs[chat | sql-*]
 │    ├─ chat: groupedMessages → RoundGroup → ChatMessage(memo)
 │    │                       └ single → ChatMessage(ReactMarkdown+SyntaxHighlighter)
 │    ├─ ConfirmDialog / UserChoiceDialog / SessionMessagesModal(Monaco)
 │    └─ 输入区 TextArea + token 进度条
 │    └─ sql tab: Collapse[Monaco Editor | 结果 Table(ResizableTitle) | EXPLAIN Table]
 ├─ Drawer×2：ConfigPanel / Skill(Tree+Monaco)
 └─ AddTableModal / ChangePasswordModal / ExplainAnalyzeModal
```

### 4.3 问题清单

#### 🔴 高严重度

**F1. SSE 解析有缺陷：跨 chunk 截断导致内容静默丢失 + 多字节乱码**
【App.jsx:773–997（handleSend）及 1198–1223（handleExplainAnalyze）两处同样问题】
```js
const { done, value } = await reader.read();
if (done) break;
const text = decoder.decode(value);        // ① 无 { stream: true }
const lines = text.split('\n');            // ② 无半截行缓冲
for (const line of lines) {
  if (line.startsWith('data: ')) {
    try {
      const data = JSON.parse(line.slice(6));  // ③ 半截行 parse 必抛
    } catch (e) {
      console.warn('Parse SSE error:', e);     // ④ 静默吞掉
```
① `TextDecoder.decode()` 不带 `{stream:true}`，UTF-8 多字节字符（中文）恰好跨两个 TCP chunk 时被切成 U+FFFD 乱码；② SSE 的一行 `data: {...}` 可能跨 chunk 到达，没有 remainder 缓冲，对半截行 `JSON.parse` 必抛异常；③ 异常被 `console.warn` 吞掉——**该 chunk 的流式内容永久丢失**，表现为长回答中偶发缺字/缺句，且无监控。这是流式聊天产品的核心正确性 bug。
**修复**：
```js
let buf = '';
// 循环内：
buf += decoder.decode(value, { stream: true });
const lines = buf.split('\n');
buf = lines.pop();          // 最后一截留给下一 chunk
```
循环结束后再 `decoder.decode()` flush 并处理 buf 残余。

**F2. 会话切换竞态：loadMessages 无过期响应校验 + 流式期间切会话污染新会话**
【(a) App.jsx:368–428；(b) App.jsx:786–895】
```js
// (a) 加载竞态
const data = await getSessionMessages(sessionId);
...
setMessages(loaded);            // 418: 未校验 currentSessionId 是否已变更
```
用户快速点击会话 A→B：A、B 请求并发（ref 去重只挡同 id），若 A 后返回，`setMessages(A的消息)` 覆盖 B 的界面——**当前会话是 B 却显示 A 的消息**，收藏状态也被污染。
```js
// (b) 流式写入竞态：SSE 循环内所有 setMessages 基于 findLastIndex 定位后 splice
newMsgs.splice(lastAssistantIdx, 0, logMsg);   // 844
```
流式进行中用户切换会话，loadMessages 重置 messages 后，**旧会话的 chunk/log 继续被写进新会话的消息数组**；且 `handleSessionClick`（483–518）不 abort 进行中的流。done 事件里 `data.sessionId !== currentSessionId`（955）比较的是闭包旧值。
**修复**：为每次加载/流式生成递增 requestId（ref），写 state 前比对"我是否仍是最新请求"；切换会话时 `abortControllerRef.current?.abort()`。

**F3. LLM API Key 明文回传前端并存入 React state**
【ConfigPanel.jsx:23–33】
```js
api.getLlMConfig().then(data => {
  setLlmConfig({ provider: data.provider, apiKey: data.apiKey || '', ... });
```
虽然用 `Input.Password` 遮蔽显示，但明文 key 已存在于 JS 内存/DOM value 中：任何 XSS、浏览器扩展、React DevTools 均可读取。鉴权已精心升级为 httpOnly cookie 防 XSS 偷 token，却把更敏感的 LLM 密钥直接下发，前功尽弃。
**修复**：后端只返回 `hasApiKey: true` + 掩码（如 `sk-****abcd`）；保存时若用户未改动则不提交 apiKey 字段。

#### 🟡 中严重度

**F4. handleExplainAnalyze 流无法中断，Modal 关闭后仍在 setState**
【App.jsx:1178–1228】`api.explainAnalyze()` 不接受 signal，函数内无 AbortController；`onClose` 仅关弹窗。关闭弹窗/退出登录后 reader 继续读流并 setState——浪费 token、对已卸载组件 setState。对比 handleSend 有完整 AbortController，此处明显遗漏。
**修复**：增加第二个 AbortController ref，onClose 时 abort；或抽公共 `useSSEStream` hook。

**F5. EXPLAIN 结果不随标签页隔离，切换 tab 数据串台；两个死 state**
【App.jsx】`results/rowCount/queryTime` 已按 tab 存入 `tabs[key]`，但 `explainResults` 是全局 state，只在新建/复制 tab 时重置，**普通 tab 切换不清空**：tab A 点 EXPLAIN 后切到 tab B，仍显示 A 的执行计划，且"AI分析"按钮用 `sqlInput`（B 的 SQL）+ `explainResults`（A 的结果）做分析，数据张冠李戴。另有死状态：`isExplainResult`（渲染层无读取）、`schemaMode`（从未使用）。
**修复**：explain 结果并入 `tabs[key]` 或切换时清空；删除死 state。

**F6. memo 被穿透：流式期间整棵消息子树仍然重渲染**
【App.jsx:1635–1636】
```jsx
favoriteState={favoriteStates[msg.id]}
onFavorite={userQuestion ? ({...}) => handleFavorite({...}) : undefined}
```
每个 ChatMessage 的 `onFavorite` 是每次 render 新建的内联箭头函数，`favoriteStates` 整个对象作为 prop 传递——`React.memo` 浅比较必然失败。叠加 `handleFavorite` 的 useCallback 依赖 `[favoriteStates]`。后果：流式期间每个 chunk `setMessages` → AuthenticatedApp 整体重渲染 → 全部消息（含历史长消息，ReactMarkdown 重新解析）+ Sider + Tabs + Table 全部重渲染。
**修复**：`onFavorite` 改为传稳定回调让子组件自己组装参数；favoriteState 只传布尔值。

**F7. createMarkdownRenderers 每次 render 新建组件类型，导致 markdown 子树反复 remount**
【ChatMessage.jsx:73】
```js
const { pre: PreRender, code: CodeRender } = createMarkdownRenderers(themeMode === 'dark');
```
工厂每次 render 返回**全新的组件函数引用**——React 对组件类型变化会 unmount/remount 对应子树：流式期间每来一个 chunk，所有 SyntaxHighlighter 代码块 DOM 重建（闪烁 + 滚动跳动 + 高亮重算）。ExplainAnalyzeModal.jsx:50 同样问题。
**修复**：`useMemo(() => createMarkdownRenderers(isDark), [isDark])`；或工厂移到组件外按主题预建。

**F8. Monaco worker 路径疑似 404 + Monaco 双份加载**
【monacoEnv.js:13–27】`getWorkerUrl` 返回 `monacoPath + '/editor/editor.worker.js'`，但 `public/monaco/vs/` 下实际只有 hash 命名文件（`assets/editor.worker-Be8ye1pW.js`），不存在 `public/monaco/vs/editor/editor.worker.js`。后果：worker 创建失败 → 回退主线程执行，大文件编辑卡顿。同时 npm 包 `monaco-editor@0.55.1` 被 manualChunks 打进 bundle，运行时又从 public 加载 AMD 版——两套共存，浪费约 3MB+。
**修复**：改用 npm 包 + `?worker` import（或 vite-plugin-monaco-editor），删除 public/monaco；至少修正 getWorkerUrl 指向真实 hash 文件。

**F9. 中断/异常路径丢失后端 auto-create 的 sessionId**
【App.jsx:949–969】代码已意识到该问题并只在 `done` 事件修复：但当用户点停止或网络异常时，`done` 永远不到达——若本轮是 `currentSessionId=null` 的首问，后端已 auto-create 的 sessionId 前端拿不到，**下一条消息又以 null 发送 → 后端再建一个新会话 → 上下文断裂**，数据库留下孤儿会话。
**修复**：后端改为在首个 SSE 事件（如 `meta`）即下发 sessionId；前端收到即回写，不依赖 done。

**F10. 大列表无虚拟化 + 流式 markdown 全量重解析**
- 消息列表（1599–1641）全量渲染所有历史消息，单会话上百条后 DOM 庞大；
- 结果 Table（1822–1838）`dataSource={currentResults}` 一次性全量，仅 DOM 层分页，无 `virtual`；
- 流式消息每个 chunk 对**累计全文**重新跑 ReactMarkdown 解析，总复杂度 O(n²)。

**修复**：react-window 或 antd List virtual；Table 开 `virtual` + 固定 `scroll.y`；流式期间只渲染纯文本，done 后再 markdown 渲染。

#### 🟢 低严重度

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| F11 | LoginPage.jsx:105 | 登录页展示默认口令 `admin / admin123` | 仅首次初始化时后端控制台提示，或环境变量控制 |
| F12 | api/index.js:59-61 + 各调用方 | 拦截器与调用方 catch 双重错误 toast | 调用方静默或拦截器加标记跳过 |
| F13 | ConfigPanel.jsx | saveDb 复用 testing 作为 loading；`parseInt` 清空得 NaN；useEffect 依赖缺失 | 分 loading state；`Number(value) \|\| 0` |
| F14 | App.jsx:292、205-209、905 | useCallback/useEffect 依赖问题；`setMessages(prev => prev)` 无意义调用 | 修依赖；删无效调用 |
| F15 | App.jsx 1744/1795/1924/2040/2089/2141 | 6 处手写拖拽 resize 几乎逐行相同；3 个建 tab 函数仅差两步；SSE 解析两段复制粘贴 | 抽 `useDragResize` hook；合并函数；抽公共 SSE generator |
| F16 | App.jsx 等 | Table rowKey 用 `record.id` 遇重复 id 冲突；exportToExcel 全量双重循环写样式 10 万行卡死；xlsx 与 xlsx-js-style 死依赖+死 chunk；Monaco vs-dark 三处写死；handleConfirmTagAdd 无防重；sessionScrollTopsRef 只增不减；UserChoiceDialog getContainer 耦合 DOM class | 逐项小修 |

### 4.4 前端做得好的地方

1. **鉴权设计优秀**：httpOnly cookie + 启动时主动清理遗留 localStorage token + 401 全局事件总线 + bootstrap 区分 401/429 避免被限流踢出。
2. **XSS 防控到位**：react-markdown v10 未引入 rehype-raw，全库 grep 无 `dangerouslySetInnerHTML`/`eval`。
3. **性能意识清晰**：ChatMessage memo + 流式计时器下沉为组件内 interval；groupedMessages/columns 用 useMemo；滚动位置用 ref 记忆避免 onScroll 重渲染；chunk 滚动 rAF 节流。
4. **内存清理有意识**：Monaco hover interval 双保险清理；AuthContext bootstrap 有 cancelled 标志。
5. **工程细节**：主题 pre-apply 防闪烁；markdownRenderers 对 LLM 嵌套代码围栏的兼容处理有详尽历史 bug 注释；消息 id 分 `db-`/`c-` 双命名空间防 key 冲突。
6. **组件拆分方向正确**：Modal 类组件状态已自洽下放——下一步应把 SSE 引擎、SQL 执行、Skill 抽屉同样抽为 hook/子组件。

---

## 五、Electron 与工程化分析报告

### 5.1 Electron 架构概述

**启动链路（electron/main.js，599 行）**：

1. `app.ready`（L535）→ 初始化启动日志（console 双写 + `appendFileSync` 同步落盘）→ 创建 360×360 无边框 Splash 窗。
2. splash `did-finish-load` 后（L545-551，防竞态）调用 `startBackend()`（L229-430）：
   - `checkPort(5002)` 检测端口占用，占用则 `killProcessOnPort()` 强杀（L230-240）；
   - 计算 `projectRoot`：打包模式 = `dirname×3(exe)`，开发模式 = 仓库根；数据目录 `<projectRoot>/data/app.db`；
   - 生产模式优先用便携目录下的 `backend/src/index.js`，备用 `app.asar.unpacked/backend`（L273-292）；Node 解释器经 `getSystemNodePath()` 查找（优先 nvm-windows 中最高的 24.x）；
   - `spawn(node, [backend/src/index.js], {cwd, env: {DB_PATH, PROJECT_ROOT, SKILL_PATH, LOG_PATH}})`；
   - 监听 stdout 匹配 `Server running on port` 视为就绪；60 秒超时 + 5/20/40/50s 分阶段提示。
3. 后端就绪 → `createWindow()`：开发模式加载 `http://localhost:5173`，打包模式加载 `file://<asar>/frontend/dist/index.html`；主窗加载完成后 200ms 关 splash。
4. 失败 → splash 放大为错误面板（显示 reason/stderr 尾部 2KB/日志路径，支持复制日志），20 秒后 `app.quit()`。

**前后端连接**：后端 Express 监听 5002，配置统一走 `backend/src/config.js`。前端 `api/index.js:4-5` 按协议切换：`file:`（打包）→ `http://localhost:5002/api` 直连；否则走 `/api`（dev 由 vite 代理）。鉴权为 HttpOnly Cookie + JWT，Electron 下由 `installAuthCookieCompat()` 改写 Set-Cookie 解决 file:// 跨站 Cookie 问题。

**Skill 体系**：`skills/sql-creator-skill-v2/` 三层组织——`SKILL.md`（LLM 行为规则）、`domain_router_index.json` + `domains/*.json`（12 个业务域）、`ddl/*.sql` 与 `field_config/*.json`（各 100+ 个文件，约 98-120 张表）。后端经 `SKILL_PATH` 环境变量定位，实时读盘不缓存。

**docs/ 目录**：`agent-flow-mermaid.md`（流程图）；`docs/superpowers/` 下 19 份实施计划、11 份设计文档、4 份审查记录。核心架构文档为 `specs/2026-04-03-data-query-assistant-design.md` 与 `specs/2026-05-06-electron-integration-design.md`。

### 5.2 两份 Debug 文档摘要与修复落地验证

**debug-splash-30s-timeout.md（状态：RESOLVED）**：打包后启动卡 splash 30s 超时退出。实测后端冷启动需 37s（杀软扫描拖慢），超过 30s 窗口。修复：超时升至 60s、阶段提示 5/20/40/50s、删除 3 个死依赖。
→ **验证：✅ 已修复**。60s 超时（main.js:420-428）、阶段提示（407-418）、死依赖移除（backend/package.json 仅剩 @langchain/core）均与文档一致。

**debug-electron-cold-startup.md（状态：仍 OPEN）**：同一后端 `npm run dev` <5s 启动，Electron spawn 需 30s+。定位根因为 Windows Defender 对未签名 electron.exe 派生的 node.exe 做实时深度扫描。修复方案为用户手动加 Defender 排除项。
→ **验证：⚠️ 代码层未修复（文档本身承认无法纯代码修复）**。代码侧只落地了容错措施（60s 超时、splash 文案提及杀软、启动日志落盘）。属已缓解、未根治的遗留 OPEN 问题，分发时应附带"添加 Defender 排除项"的用户指引。

### 5.3 问题清单

#### 🔴 高严重度

**E1. `backendProcess` 变量遮蔽——退出时后端永远不会被杀死**
→ 见 [P0-3](#p0-3-electron-变量遮蔽退出时后端进程永远不会被杀死-已复核)

**E2. 启动时无差别强杀 5002 端口上的任意进程**
【`electron/main.js:161-227、230-239`】
```js
const killCommand = `taskkill /F /PID ${pid}`;                 // L188-191
exec(`lsof -ti:${port} | xargs -r kill -9`, ...)               // L216 Linux/macOS
// L231-234 调用前未校验占用者身份
```
代码不校验占用 5002 的进程是不是本应用后端，只要是 LISTENING 就强杀。用户机器上若有其他服务监听 5002，启动本应用会**强制杀死他人进程**。且 L230 向 `0.0.0.0` 发起连接做占用检测，语义错误（应为 `127.0.0.1`）。
**修复**：①杀进程前 `GET http://127.0.0.1:5002/api/health`（后端已有该端点），能通且返回特征字段说明是"自己人"——此时应直接复用现有后端；②校验进程镜像路径；③更根本：改用动态端口（listen 0，端口写入临时文件）。

**E3. electron-builder 配置产不出可独立运行的安装包**
【`package.json:26-35`；`electron/main.js:274-292`】
```json
"files": ["package.json", "electron/**/*", "frontend/dist/**/*"]
```
`files` 中**没有 `backend/**/*`、`skills/**/*`**，也没有 `asarUnpack`/`extraResources`。而主进程引用的 `app.asar.unpacked/backend`（L275-276）在任何构建产物中都不存在，L284-288 的"备用路径"是死代码。实际能跑只有一种情况：便携目录下人工放置的源码 backend 存在——即依赖人工把 `backend/`（含 node_modules 与 better-sqlite3 原生模块）、`skills/` 手工复制到便携目录。`npm run electron:build` 产物给新用户必然启动失败（splash 报 "Backend file not found"）。
**修复**：二选一——①用 `extraResources` 把 backend（含生产依赖 node_modules）与 skills 打进 `resources/`，better-sqlite3 原生模块随 extraResources 天然避开 asar，并用 `beforeBuild`/`afterPack` 钩子执行 `npm ci --omit=dev`；②明确"便携目录需人工部署 backend"为正式发布形态，写进 README 并在打包脚本中自动完成复制。

**E4. 生产模式用字符串拼接 `file://` URL 而非 `loadFile`** ✅已复核
【`electron/main.js:525-530`】
```js
const startUrl = app.isPackaged
  ? `file://${path.join(__dirname, '../frontend/dist/index.html')}`
  : 'http://localhost:5173';
mainWindow.loadURL(startUrl);
```
`file://` 拼接不做 URL 编码：安装路径含空格/中文/`#`/`%` 等特殊字符时页面加载失败或资源路径解析错误。
**修复**：改用 `mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'))`。

#### 🟡 中严重度

**E5. 缺少窗口打开拦截与导航白名单**
【main.js 全文】无 `setWindowOpenHandler`/`will-navigate` 处理。主窗渲染 LLM 输出的 Markdown（可含任意链接），`window.open`/`target=_blank` 将按默认行为打开新原生窗口（继承 webPreferences），页面内导航不受限。
**修复**：`setWindowOpenHandler`：http/https 一律 `shell.openExternal` 并 deny；`will-navigate` 白名单仅放行 `file://`（生产）与 `http://localhost:5173`（开发）。

**E6. Cookie 兼容层改写范围过大且弱化安全模型**
【main.js:472-511】`onHeadersReceived` 没有按 URL 过滤，对所有响应的 Set-Cookie 一律改写为 `SameSite=None; Secure`；`onBeforeSendHeaders` 往请求头塞 `credentials: include`——这不是合法 HTTP 请求头，属无效代码。SameSite=None 意味着一旦主窗未来加载/嵌入第三方页面，会话 Cookie 可被跨站携带，CSRF 防护被架空。
**修复**：`onHeadersReceived` 加 URL 过滤（仅 `localhost:5002`）；删除无效 credentials 头逻辑；更干净的方案是注册 `http://app.local` 自定义协议 serve 前端。

**E7. 后端绑定 0.0.0.0 + CORS 任意 origin 携带凭证**
【`backend/src/index.js:10-13、49`】`app.listen(PORT)` 未指定 host → 绑定 0.0.0.0 对局域网开放。同一局域网任何机器都能直接调用本机 5002 的 API；Web 部署时任意网站可发起携带凭证的跨站请求。
**修复**：`app.listen(PORT, '127.0.0.1')`；CORS origin 改白名单。（与后端 B1 同源）

**E8. `npm run build` 必然失败：backend 没有 build 脚本**
【根 package.json:15-17 vs backend/package.json:6-9】`build:backend` 引用不存在的 `build` script，执行 `npm run build` 报 `Missing script: "build"`。
**修复**：删除根 `build:backend`，或改占位 `"build": "echo skip"`。

**E9. 便携模式 projectRoot 依赖 `dirname×3(exe)` 的隐式目录约定，无校验无文档**
【main.js:17-18、242-247】该计算只有在 exe 位于 `<root>/<两级目录>/app.exe` 时才恰好等于项目根。若用户用默认 NSIS 安装器，projectRoot 会解析成 `%LOCALAPPDATA%`，`data/`、`logs/` 被写到错误位置且多应用互相污染。
**修复**：显式判断 + 环境变量覆盖；打包配置固定 `win.target: portable` 使目录层级可预期；找不到 backend 时 splash 明确提示目录结构要求。

**E10. 后端运行期崩溃无守护、无重启、无用户提示**
【main.js:356-364、556-566】`backendProcess.on('close')` 只在启动阶段报错；启动成功后后端再崩溃，主进程既不重启也不通知用户——前端所有请求静默失败。
**修复**：启动成功后追加"运行期崩溃"分支：弹 `dialog.showErrorBox` 或向前端发事件提示，可选指数退避自动重启（最多 N 次）。

#### 🟢 低严重度

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| E11 | package.json:25 | 图标路径 `icons/app` 指向不存在的目录 | 补 `icons/app.ico`（≥256×256）或删除该字段 |
| E12 | splash.html:140/151 | 版本号永远显示 "vundefined"（读取在赋值之前） | 赋值语句移到读取之前 |
| E13 | wait-for-backend.js:6-11 | 不看状态码直接 resolve（500 也算就绪）；无限重试无总超时 | 校验 200；加 60s 上限超时 |
| E14 | .gitignore:6 | 只忽略根目录 `data/*.db`，但仓库中存在 `backend/data/xtsql.db`、`backend/test-output.txt` | 增加 `**/data/*.db`、`*-shm`/`*-wal` 并 `git rm --cached` |
| E15 | package.json:41-44 等 | 根 deps 重复声明 react-markdown/remark-gfm；无 engines/.nvmrc 但硬编码依赖 Node 24.x；非 Windows 写死 `/usr/bin/node` | 删冗余 deps；加 engines + .nvmrc；fallback 到 PATH |
| E16 | 三个 package.json | 无 test 脚本；backend/ 下 18 个手写 test-* 脚本无运行器无 CI | 引入 `node --test`（Node 24 内置），至少把 sqlValidator/auth/rateLimit 纳入回归 |

### 5.4 Electron 做得好的地方

1. **渲染进程安全配置正确**：`nodeIntegration: false, contextIsolation: true`；splash preload 仅经 contextBridge 暴露两个最小 API；全项目未用 remote、未关 webSecurity。
2. **splash 有 CSP**，主进程向 splash 传参用 `JSON.stringify` + `executeJavaScript`，避免字符串拼接注入。
3. **启动可观测性出色**：console 双写落盘、同步 append 防 kill -9 丢日志；spawn 错误按 ENOENT/EACCES 分类给出可操作指引；stderr 截尾 2KB 防卡死。
4. **多处坑都有注释沉淀**：splash 加载完成再 startBackend 的竞态、Windows pipe 多行合并必须用两个独立 if、stdout 标志匹配。
5. **后端工程细节**：统一静态配置入口不依赖 CWD；JWT 密钥首用时 `crypto.randomBytes(48)` 生成持久化、无硬编码；initDB 失败即 `process.exit(1)` 让 Electron 立即感知。
6. **前端构建合理**：`base: './'` 适配 file://、manualChunks 拆分四大 chunk、monaco 本地 vendored 无 CDN；`isElectron` 自动切换 API baseURL。

---

## 六、修复优先级路线图

### 第一梯队：确定性 Bug（1-3 行/个，当天可完成）

| 项 | 修复 |
|---|---|
| P0-1 | `let overallTimer = null` 提升到 try 之前 |
| P0-2 | `/generate` 补 else 分支返回 400 |
| P0-3 | 删除 main.js:328 的 `let` |
| B7 | 流中断路径补 partial 消息落库 |
| F1 | SSE 解析加 `{stream:true}` + 行缓冲（两处） |

### 第二梯队：高危安全（本周）

| 项 | 修复 |
|---|---|
| B3 | WITH 语句用 node-sql-parser 验 AST 顶层类型（依赖已有） |
| B1/E7 | `listen(PORT, '127.0.0.1')` + CORS 白名单 |
| B2/F3 | 凭证加密存储（Electron safeStorage）；API key 不下发前端 |
| B8/B9 | 调试路由加 admin+NODE_ENV 双闸门；skill 写接口加 adminRequired |
| E2 | 杀端口前先探 `/api/health` |
| E5 | setWindowOpenHandler + will-navigate 白名单 |

### 第三梯队：发布阻断（下个发版前）

| 项 | 修复 |
|---|---|
| E3 | extraResources 打包 backend/skills，或明确便携部署形态并自动化 |
| E4 | 改用 `loadFile` |
| E8 | 修 `npm run build` |
| B6 | `/execute` 强制 LIMIT + results 落库截断 |
| F2 | 会话切换 requestId 防竞态 + 切会话 abort 流 |

### 第四梯队：质量与可维护性（迭代排期）

- B10-B17 限流/历史压缩/连接池超时/错误信息收敛
- F4-F10 前端 hook 抽取（useSSEStream/useDragResize）、虚拟化、Monaco 单份化
- E9/E10 路径约定显式化、后端崩溃守护
- E16 测试体系（node --test 归拢现有 18 个手写脚本）

---

## 附录：分析验证记录

| 验证项 | 方法 | 结果 |
|---|---|---|
| P0-1 ReferenceError | 回读 query.js:795-807（const 在 try 内）与 883-900（catch 引用） | ✅ 属实，896 行注释只守卫 abortController 遗漏 overallTimer |
| P0-3 变量遮蔽 | 回读 main.js:325-336（L328 局部 let 遮蔽 L9 全局） | ✅ 属实 |
| E4 loadURL | 回读 main.js:513-533（字符串拼接 file:// URL） | ✅ 属实 |
| B7 中断丢消息 | 回读 query.js:440-552（落库仅在正常完成路径 473-496） | ✅ 属实 |
| debug 文档修复落地 | 对照 main.js:407-428 与 backend/package.json | ✅ splash-timeout 已修复；cold-startup 为环境级 OPEN |

*报告完。共 3 个 P0、14 个高严重度、20+ 中严重度、25+ 低严重度问题，均附文件行号与修复建议。*

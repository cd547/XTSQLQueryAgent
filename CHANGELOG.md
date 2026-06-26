# 更新日志

## 2026-06-26

### 代码审查与 P0 修复

#### 审查报告
- 新增 [CODE_REVIEW_2026-06-26.md](CODE_REVIEW_2026-06-26.md)，全量审查 `backend/`、`frontend/`、`electron/`，发现 6 个严重 Bug + 7 个中等问题 + 7 个性能问题 + 3 个安全问题 + 5 个代码质量问题

#### P0/P1 已修复
- **#BUG-1 skill.js 路由未注册**：原 [`backend/src/routes/skill.js`](backend/src/routes/skill.js) 第 208 行 `export default router` 位置错误，导致后续 4 个关键路由永远不会被 Express 注册
  - `/api/skills/save`（保存 Skill 文件）
  - `/api/skills/check-table`（检查表是否存在）
  - `/api/skills/fetch-ddl`（获取 DDL）
  - `/api/skills/create-table-files`（创建表文件）
  - 影响：前端"添加表格"向导 Steps 1-3 全部 404
  - 修复：将 `export default router` 移至文件末尾（[skill.js:502](backend/src/routes/skill.js#L502)）
- **#BUG-2 skill.js save 路由 ReferenceError**：catch 块引用了 try 块内 `let` 声明的 `oldContent`，导致错误日志写入自身崩溃
  - 修复：将 `let oldContent = ''` 提升至 try/catch 之外（[skill.js:229](backend/src/routes/skill.js#L229)）
- **#BUG-3 getDb 竞态条件**：[sqlite.js:21-35](backend/src/db/sqlite.js#L21) `if (!db)` 检查 + `new Database()` 赋值存在理论竞态
  - 修复方案（职责分离）：`getDb()` 改为纯 getter（未初始化抛错），`new Database()` 下沉至 `initDatabase()` 内部，加 `initialized` 标志 + 幂等保护
  - 配套修复（[auth.js:11-38](backend/src/services/auth.js#L11)）：JWT 密钥由顶层 `const` 改为懒求值，第一次 `signToken()` / `verifyToken()` 时才读 `configs` 表
  - 验证：JWT 密钥仍从数据库读取，重启后 token 不会失效；模块加载期 `getDb()` 不会被触发
- **#BUG-4 wait-for-backend 调用管理员接口**：[wait-for-backend.js:6](wait-for-backend.js#L6) 调用 `/api/config/db`（需要 admin 权限），未登录时返回 401，虽不阻塞但语义错误
  - 修复：改为无鉴权的 `/api/health` 端点
- **#BUG-5 JSON 解析无大小限制**：[backend/src/index.js:13](backend/src/index.js#L13) `express.json()` 默认 100KB，长会话消息历史会触发 `PayloadTooLargeError`
  - 修复：改为 `express.json({ limit: '10mb' })`，兼顾 DoS 防护与正常使用
- **#BUG-6 Monaco hover 定时器内存泄漏**：[App.jsx:1229](frontend/src/App.jsx#L1229) `setInterval(hideHoverWidgets, 100)` 仅在 `editor.onDidDispose` 中清理，React 卸载先于 Monaco 异步销毁时定时器残留
  - 修复方案（useRef + useEffect cleanup）：新增 `hoverIntervalRef` 跨 render 持久化 timer id；`onMount` 中先清旧再创新；`onDidDispose` 中清理；新增 `useEffect(() => () => clearInterval(...), [])` 组件卸载兜底
- **#BUG-9 消息历史取最早而非最新**：[query.js:328](backend/src/routes/query.js#L328) `ORDER BY id ASC LIMIT 20` 永远取会话最早的 20 条
  - 修复：改为 `ORDER BY id DESC LIMIT 20` + `messages.reverse()` 翻转，LLM 上下文保留最近对话
- **#BUG-11 错误响应统一返回 HTTP 200**：[session.js](backend/src/routes/session.js)、[query.js](backend/src/routes/query.js) 共 25 处 `res.json({ error` 全部用 HTTP 200 返回
  - 修复方案（按错误类型分配状态码）：系统异常 → 500、资源不存在 → 404、参数/业务校验失败 → 400、权限不足 → 403
  - 所有 catch 块新增 `logger.error(...)` 记录上下文（userId / sessionId / sql 等）

#### 待修复
- 🟡 P2：BUG-8（非 stream 模式）、BUG-10（checkPort 地址） — **不修**（经评估不进入本轮范围）
- 🟢 P3：PERF-1/2/3/5、SEC-1、CODE-3 — 后续迭代处理

#### 验证
- 4 个之前 404 的 skill 路由全部可达
- 后端启动日志无 `oldContent is not defined` 类错误
- 10MB 内 payload 请求正常处理
- `wait-for-backend` 调用无鉴权端点，符合最小权限原则
- 数据库单例由 `initDatabase()` 统一创建，重复调用幂等
- 单元测试：未初始化时调用 `getDb()` 抛 `Database not initialized` 错误
- 长对话（>20 条消息）测试：最近消息正确进入 LLM 上下文
- 错误响应测试：`curl -i /api/sessions/999` 返回 404；`curl -i -X POST /api/query/execute -d '{}'` 返回 400

---

## 2026-06-26（本轮修复收官）

### 修复完成（8/16 = 50%）
- 全部 P0/P1 严重 Bug（BUG-1~BUG-6）已修复
- P2 中等 Bug：BUG-9 消息历史排序、BUG-11 错误响应状态码已修复
- BUG-8、BUG-10 标记为不修（评估后不进入本轮范围）
- P3 全部 6 项性能/安全/代码质量项留待后续迭代

---

## 2026-06-24

### Bug 修复：Electron 启动间歇性卡在 splash 页

#### 现象
打包后 `dist\win-unpacked\XTSQLQueryAgent.exe` 启动时 ~16% 概率卡在 splash 页面 60 秒后自动退出。

#### 根因
[electron/main.js](electron/main.js) 后端 stdout 处理用 `if/else if` 链匹配 `SQLite initialized` 和 `Server running on port 5002`：
- 后端连续 `console.log` 写出的三行在 Windows pipe 上有时被合并到**同一个 chunk**（间歇性）
- 合并场景下 `SQLite initialized` 分支命中，`else if` 被跳过
- `finish({ ok: true })` 永远不调用 → 60s 定时器触发 `finish({ ok: false })` → 错误页 → 20s 后 `app.quit()`

#### 修复
- 把 `Server running on port` 分支提到第一个独立 `if`（ready 信号优先级最高）
- `SQLite initialized` 改成第二个独立 `if`（进度提示）
- 两者互不依赖，stdout 合并块 / 分块都能正确触发 `finish({ ok: true })`
- 详见 [electron/main.js:402-419](electron/main.js#L402-L419)

#### 验证
连续启动 12 次全部成功，每次日志 ≥ 42 行、均出现 `Backend started successfully!` 和 `Loading URL:`，启动耗时 < 5s。

---

## 2026-06-20

### 代码审查与 P0/P1 修复

#### 审查报告
- 新增 [CODE_REVIEW_2026-06-20.md](CODE_REVIEW_2026-06-20.md)，全量审查 `backend/`、`frontend/`、`electron/`，发现 35 个问题
- 分类：🔴 P0 高危 5 / 🟠 P1 11 / 🟡 P2 19

#### P0 安全 / 性能
- **#SEC-01 SQL 注入**：`/api/skills/fetch-ddl` 拼接 `tableName`，增加三层防御（白名单正则 + 类型检查 + 反引号兜底）
  - 改前：`SHOW CREATE TABLE \`${tableName}\`` 完全不校验
  - 改后：`/^[a-zA-Z0-9_.]{1,64}$/` 白名单 + 透传安全值 + 不再透传 `e.message` 给前端
  - 验证：8 个注入用例全部拒绝
- **#PERF-01 MySQL 连接池**：新增 [`backend/src/services/mysqlPool.js`](backend/src/services/mysqlPool.js)
  - 单例 pool（connectionLimit: 10、idleTimeout 10min、TCP keepalive）
  - 配置变更自动重建 pool；进程退出优雅关闭
  - 改造 `/execute` / `/explain` / `/fetch-ddl` 三个热路径
  - 效果：单次查询省 50-200ms TCP 握手，并发 10 路不排队
- **#BUG-01 并发漏洞**：`App.jsx` `loadCurrentModel` 用函数属性做锁，组件 render 时被重置；改用 `loadingRef.current.model` 统一模式
- **#BUG-02 try/catch 缺失**：`/api/query/generate` 异常在 SSE 头已发时调用 `res.json` 抛错；改为根据 `res.headersSent` 分流到 SSE error 事件或 JSON
- **#BUG-03 静默截断**：`/execute` 自动追加 `LIMIT 1000` 破坏含 LIMIT / UNION 复杂查询；改为应用层 `slice(0, 1000)` + 响应增加 `truncated` / `returned` / `rowCount` 字段

#### P1 / P2 改进
- **#LOG-03 启动未 await**：`index.js` 重构启动序列，DB 初始化失败时 `process.exit(1)` 避免带病 listen
- **#PERF-02 bpeEncode 预分配**：UTF-8 字节拆分改用 `new Array(Buffer.byteLength(text, 'utf8'))` 预分配 + 索引器，避免 V8 多次扩容
- **#PERF-06 N+1 查询**：`GET /api/sessions` 把相关子查询改为 `LEFT JOIN messages + GROUP BY`，EXPLAIN QUERY PLAN 验证走 `idx_sessions_user_id` + `idx_messages_session_id` 索引

---

## 2026-06-15

### 多用户认证系统 (新增)

#### 功能
- 完整的多用户登录/注册/改密/退出流程
- 聊天记录按用户隔离，会话归属校验
- 默认账号 `admin` / `admin123`，首次登录后必须修改密码

#### 安全机制
- **HttpOnly + SameSite Cookie** 存储 JWT，防止 XSS 窃取
- **Token Version 机制**：`users.token_version` 字段，密码变更/退出时自增，旧 token 全部失效
- **Rate Limiting**：`/login` `/register` `/change-password` 限流 10 次/小时/IP
- **bcrypt 异步化**：从 `bcrypt.hashSync` 改为 `bcrypt.hash` 异步实现，不阻塞事件循环
- **路径遍历防御**：`/api/skills/read` `/save` 等校验 `path.resolve` 是否在白名单 skills 目录内
- **跨用户数据泄露防御**：所有会话接口走 `sessionBelongsToUser` 校验

#### 前端
- 新增 [frontend/src/components/LoginPage.jsx](frontend/src/components/LoginPage.jsx)
- 401 自动跳登录页；fetch `credentials: 'include'` 携带 cookie
- `AuthContext` 状态管理 + axios/fetch 拦截器

#### 后端
- 新增 [`backend/src/middleware/rateLimit.js`](backend/src/middleware/rateLimit.js)
- 新增 [`backend/src/db/sqlite.js`](backend/src/db/sqlite.js) 中 `users` / `users.token_version` / `sessions.user_id` 字段
- 新增 [`backend/src/services/auth.js`](backend/src/services/auth.js) JWT 签发/校验、密码哈希、cookie 设置
- 新增 [`backend/src/routes/auth.js`](backend/src/routes/auth.js) 5 个接口

#### Schema 升级
- 引入 `addColumnIfMissing` 工具函数（[`backend/src/db/sqlite.js`](backend/src/db/sqlite.js)），结构化迁移 + 详细日志
- 不再吞掉 `catch` 异常，错误显式上报
- 测试覆盖：[`backend/test-schema-migration.mjs`](backend/test-schema-migration.mjs)

#### LLM 工具调用去重
- 新增 session 级 `sessionToolRegistries`（[`backend/src/services/llm.js`](backend/src/services/llm.js)）
- 防止 `get_tables` / `get_domain_index` 等在多轮对话中重复调用，节省 token

---

## 2026-05-09

### 消息历史查看按钮优化

#### 功能
- 将"查看消息"按钮改为进度条形式展示 token 使用状态
- 进度条长度 60px，高度 8px
- 正常状态显示绿色，超过警告阈值显示红色
- 点击进度条仍可打开消息查看弹窗

#### 修改文件
- `frontend/src/App.jsx`: 替换按钮为进度条组件

### SKILL.md 实时生效修复

#### 问题
- 在 Skill 查看器中修改 SKILL.md 文件后，下次对话没有立即使用新内容
- 日志中显示的仍是旧内容

#### 解决方案
- 移除了 `loadSkillMd()` 函数中的缓存机制
- 每次调用时重新从磁盘读取文件内容

#### 修改文件
- `backend/src/services/toolFuncs.js`: 移除 `cachedSkillMd` 缓存变量

#### 效果
- 修改 SKILL.md 后无需重启程序
- 下次对话自动使用最新内容

## 2026-05-08

### 消息历史查看功能 (新增)

#### 功能
- 在聊天对话框右侧添加「查看消息」按钮
- 点击弹出模态框，使用 Monaco Editor 展示完整消息历史（JSON格式）
- 模态框顶部显示消息上下文长度（token数）
- 支持会话中断后恢复

#### 后端改动
- `backend/src/db/sqlite.js`: 新增 `llm_messages` 表存储消息历史
  - 字段：`session_id`, `messages`, `message_tokens`, `updated_at`
- `backend/src/routes/query.js`: 新增接口
  - `GET /api/query/messages/:sessionId` - 获取消息历史
  - `DELETE /api/query/messages/:sessionId` - 删除消息历史
- `backend/src/services/llm.js`: 新增函数
  - `saveMessagesToDb()` - 保存消息到数据库
  - `loadMessagesFromDb()` - 从数据库加载消息

#### 前端改动
- `frontend/src/App.jsx`:
  - 新增「查看消息」按钮和模态框组件
  - 集成 Monaco Editor 展示消息内容
  - 显示 token 上下文长度

### DeepSeek Tokenizer 集成 (优化)

#### 功能
- 使用 DeepSeek 官方 BPE (Byte Pair Encoding) 算法计算 token
- 加载 `backend/deepseek_v3_tokenizer/tokenizer.json` 词汇表和合并规则
- 支持中文和多字节字符的正确 token 化

#### 文件变更
- `backend/src/services/tokenizer.js`: 重构实现
  - 加载官方 tokenizer 数据
  - 实现 BPE 编码算法
  - 添加最大迭代次数限制防止无限循环
  - 添加异常捕获和回退机制

### 消息持久化 (优化)

#### 功能
- 会话消息自动保存到 SQLite 数据库
- token 数异步计算并存储
- 读取时自动加载历史消息和 token 数
- 支持会话中断后继续

#### 数据库改动
- `llm_messages` 表新增 `message_tokens` 字段

### getTableSchema 方法优化

#### 功能
- 自动过滤空属性（空字符串、null、空对象、空数组）
- 输出更简洁的表结构信息

#### 文件变更
- `backend/src/services/toolFuncs.js`: 新增 `removeEmptyProperties()` 函数

### 便携版本优化

#### 功能
- 统一开发/生产环境数据库路径：`d:\Ai_Program_Files\XTSQLQueryAgent\data\app.db`
- 统一 `skills` 和 `logs` 目录路径
- Electron 客户端支持便携模式

#### 文件变更
- `electron/main.js`: 优化路径解析逻辑
- `backend/src/db/sqlite.js`: 使用统一的项目根目录路径

## 2026-04-30

### 发送按钮中断功能优化

#### 问题
- 原中断按钮显示红色X图标，样式不够美观

#### 解决方案
- 导入 `LoadingOutlined` 图标
- 中断按钮改为显示转圈效果 (Spin + LoadingOutlined)
- 发送按钮加载时显示 loading 状态
- 保持中断按钮可点击，用户可以随时中断请求

#### 修改文件
- `frontend/src/App.jsx`:
  - 导入 `LoadingOutlined` 图标
  - 中断按钮使用 `<Spin size="small" indicator={<LoadingOutlined ...>} />` 显示转圈效果
  - 发送按钮添加 `loading` 属性

## 2026-04-28

### 工具函数重构

#### 统一参数处理逻辑
- **参数解析统一**：使用 `lc_kwargs.params` 或默认空对象作为参数源
- **明确参数定义**：为所有工具添加 `params` 定义（type/properties/required）
- **兼容性增强**：支持对象和字符串两种参数格式输入

#### 批量获取支持
- **表结构批量获取**：`get_table_schema` 支持传入表名数组
- **DDL批量获取**：`get_table_ddl` 支持传入表名数组
- **返回格式优化**：单个表返回对象，多个表返回 `{table1: {...}, table2: {...}}`

#### Skill 配置优化
- **移除未使用函数**：删除 `get_output_format` 和 `get_mysql_limits`
- **DDL输出格式**：简化为 `-- @@TABLE {表名}` 标记
- **SKILL.md规则调整**：增加工具调用约束，禁止主动扩展不相关表

#### 工具函数描述优化
- **get_tables**：明确列出 business_constraints/business_rules
- **get_table_schema**：说明支持多表批量获取
- **get_table_ddl**：说明支持多表批量获取
- **request_tag_confirmation**：说明触发前端确认框的行为

### LLM 服务更新

#### thinking 配置支持
- **reasoning_content 处理**：解析 `reasoning_content` 字段作为思考过程
- **thinking 配置**：支持 thinking 参数配置

#### 模型支持
- **deepseek-v4-flash**：新增模型支持

## 2026-04-24

### 代码拆分

#### 拆分 ConfigPanel 组件
- 拆分为独立组件：`components/ConfigPanel.jsx` (~108行)
- App.jsx 从 1729 行减少到 1621 行

#### Monaco 配置本地化

##### 问题
- 原配置使用 `./node_modules/monaco-editor/min/vs` 路径
- 打包后静态文件会尝试访问 node_modules 目录，导致资源加载失败

##### 解决方案
- 将 monaco-editor 的 vs 目录复制到 `public/monaco/vs/`
- 修改 `utils/monacoEnv.js` 使用绝对路径 `/monaco/vs`
- 移除 vite.config.js 中的 `optimizeDeps`

##### 文件变更
- 新增 `public/monaco/vs/` 目录（121个文件）
- 新增 `utils/monacoEnv.js` - Monaco 配置
- 修改 `vite.config.js` - 移除 optimizeDeps

#### 删除未使用的组件
- 删除 `components/ConfigPanel.jsx` - 未被引用
- 删除 `components/QueryPanel.jsx` - 未被引用
- App.jsx 使用内部定义的 ConfigPanel

### 滚动条优化

#### 功能
- 左侧会话列表滚动条、聊天消息滚动条、右侧配置面板滚动条统一调细
- 从默认粗细调整为 6px 宽度

#### 修改文件
- `frontend/src/App.css` 添加全局滚动条样式：
  ```css
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #f1f1f1; }
  ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
  * { scrollbar-width: thin; scrollbar-color: #c1c1c1 #f1f1f1; }  /* Firefox */
  ```

### 聊天消息表格支持

#### 功能
- 聊天消息中的 Markdown 响应支持 GFM 表格语法渲染
- 添加自定义表格样式：边框、padding、背景色等

#### 修改文件
- `frontend/src/App.jsx` - ChatMessage 组件：
  - 添加 `markdownComponents` 配置表格渲染样式
  - ReactMarkdown 添加 `remarkPlugins={[remarkGfm]}`

### Monaco Editor 搜索框问题修复

#### 问题
- 代码编辑器搜索框 (Ctrl+F) 的关闭按钮无法点击
- 鼠标悬停时提示框不停闪烁

#### 解决方案
- 在 `onMount` 中动态注入 CSS 样式
- 使用定时器每 100ms 检测并隐藏 tooltip 元素
- 禁用 Monaco Editor 的多个提示功能：
  - `hover: { enabled: false }`
  - `quickSuggestions: false`
  - `parameterHints: { enabled: false }`
  - `suggestOnTriggerCharacters: false`
  - `acceptSuggestionOnEnter: 'off'`
  - `tabCompletion: 'off'`
  - `wordBasedSuggestions: 'off'`

#### 修改文件
- `frontend/src/App.jsx` - SQL Editor 配置和 onMount 逻辑
- `frontend/src/App.css` - CSS 样式覆盖

## 2026-04-18

### 总结聊天记录功能 (新增)

#### 功能
- 点击会话列表中每个会话的「更多」按钮，选择「总结聊天」
- 将该会话的 user 和 assistant 对话按顺序发送给大模型
- 大模型生成两个内容：
  - 100字左右的总结 (summary)
  - 20字以内的标签 (name)
- 自动更新 sessions 表的 name 字段为标签内容
- sessions 表新增 summary 字段存储详细总结

#### 后端 API
- `POST /api/sessions/:id/summarize` - 总结指定会话
- 数据库 sessions 表新增 `summary` TEXT 字段

#### 前端
- `summarizeSession()` API 函数
- `handleSummarizeSession()` 处理函数
- 会话下拉菜单新增「总结聊天」选项 (FileTextOutlined 图标)

### 查询结果显示耗时 (新增)

#### 功能
- 查询结果标题显示：查询结果 (100 条 耗时: 300ms)
- 后端返回 queryTime 字段，前端解析并显示

#### 后端 API
- `POST /api/query/execute` 返回新增 `queryTime` 字段（毫秒）

#### 前端
- App.jsx 新增 `queryTime` state
- QueryPanel.jsx 新增 `queryTime` state
- 标题格式：`查询结果 ({rowCount} 条 耗时: {queryTime}ms)`

### LLM Provider 配置 (前端预留)

#### 功能
- 配置面板支持选择不同的 Provider（OpenAI、DeepSeek、MiniMax、Ollama）
- 当前仅实现 DeepSeek API 支持
- 其他 Provider 支持预留，待后续扩展

### SQL EXPLAIN 功能 (新增)

#### 功能
- 在 SQL 预览区域添加 "EXPLAIN" 按钮
- 点击后执行 SQL 执行计划分析
- 结果显示在查询结果区域
- 优先执行选中的 SQL，无选中则执行全部

#### 后端 API
- `POST /api/query/explain` - 执行 EXPLAIN 语句
- 安全验证：仅允许 SELECT/EXPLAIN 开头
- 禁止：INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE

#### 前端
- `explainQuery()` API 函数
- `handleExplain()` 处理函数
- 按钮使用 `SelectOutlined` 图标

### Skill查看器 - 表格添加功能 (新增)

#### 功能流程
- 点击"添加"按钮 → 弹出 Modal 引导框
- 步骤1：输入表名 → 检查 table_index.json 是否存在
  - 已存在：提示"表已存在，是否继续？"
  - 不存在：进入步骤2
- 步骤2：获取 DDL
  - 后端使用已保存的数据库配置连接真实库
  - 执行 `SHOW CREATE TABLE {table_name}` 获取 DDL
  - 自动提取表注释和关联表（FOREIGN KEY）
- 步骤3：生成文件
  - 更新 table_index.json（添加表节点）
  - 生成 ddl/{表名}.sql
  - 生成 field_config/{表名}.json
  - 操作记录写入 skill_logs 表

#### 后端 API
- `POST /api/skills/check-table`: 检查表是否存在
- `POST /api/skills/fetch-ddl`: 从数据库获取 DDL
- `POST /api/skills/create-table-files`: 创建表格相关文件

#### 前端 API (frontend/src/api/index.js)
- `checkTableExists(tableName)` - 检查表是否存在
- `fetchTableDDL(tableName)` - 获取 DDL
- `createTableFiles(tableName, ddl, description)` - 创建文件

#### 自动提取
- `related_tables`: 从 DDL 的 FOREIGN KEY 自动分析
- `description`: 从 DDL 的 COMMENT 自动提取

#### UI优化
- skill-drawer-content 添加 `paddingTop: 5px`，解决目录结构与顶部线距离过近的问题

### Skill查看器 (新增功能)

#### 锁定机制
- 标题栏右侧添加锁定按钮 (`LockOutlined`/`UnlockOutlined`)
- 初始状态锁定 (`skillLocked: true`)
- 锁定状态：Monaco Editor 为只读模式
- 解锁状态：Editor 可编辑，显示保存按钮

#### 保存功能
- 保存按钮：仅在解锁且文件有改动时显示，小型图标按钮 (`EditOutlined`)
- 备份机制：
  - 备份目录：`skills/skill_back/{YYYYMMDDHHmmss}/{原目录结构}/`
  - 保留完整目录结构
- 数据库日志：`skill_logs` 表记录操作
  - 字段：operation, file_path, backup_path, old_content, new_content, status, error_message

#### 目录树优化
- 后端自动过滤 `skill_back` 目录，不显示在列表中
- 高度拖拽调整：80-400px，拖动条位于底部

#### 文件编辑器优化
- 高度拖拽调整：100-500px，拖动条位于顶部

#### 操作面板
- 位置：目录结构标题下方（仅解锁时显示）
- 包含"添加"按钮：`TableOutlined` 图标，蓝色 #1890ff，悬停提示"添加表格"

### UI调整 - 聊天输入区域

#### 输入框重构
- 分离为两部分：输入区域 + 操作行
- 输入框：去除边框，使用 autoSize 自适应高度
- 操作行：位于底部，包含模型名称 + token消耗 + 发送按钮

#### 发送按钮
- 缩小尺寸 (`size="small"`)
- 图标化：`SendOutlined`，无文字
- 字体 11px，内边距缩小

#### 信息显示
- 模型名称：12px，蓝色 #1890ff，加粗
- Token消耗：11px，灰色 #999
- 位置：发送按钮左侧，作为操作空间区域

### 后端改动

#### 数据库
- `sqlite.js`: 新增 `initSkillLogTable()` 初始化 `skill_logs` 表

#### 路由
- `skill.js`:
  - 新增 `POST /api/skills/save` 接口
  - `buildTree()` 过滤 skill_back 目录
  - 备份逻辑：创建备份目录，写入原文件，保存新内容，记录日志

### Agent配置功能 (backend + frontend)
- **数据库存储**: configs 表新增 agent 配置项
  - `agent_max_tool_calls`: 最大工具调用次数 (默认30)
  - `agent_timeout_ms`: 超时时间 (默认60000)
- **后端接口**: 
  - `GET /config/agent` 获取所有 agent 配置
  - `PUT /config/agent/:key` 更新单个配置
- **读取配置**: llm.js 从数据库读取 `maxToolCalls` 参数
- **配置面板**: Agent 配置区域可修改参数并保存

### Token统计优化
- **每轮记录**: 每次 DeepSeek API 调用保存 `role='usage'` 记录
- **过滤显示**: loadMessages 过滤掉 usage 类型，不在聊天历史显示
- **精确计算**: SQL 查询只统计 role='usage' 的记录，避免重复

### UI调整
- **日志样式**: 思考过程/工具调用/工具返回标签统一
- **图标优化**: 折叠箭头使用 Ant Design 图标 (CaretRightOutlined/DownOutlined)
- **Skill查看器折叠**: 目录结构和文件内容可独立折叠/展开
- **文件编辑器间距**: 底部保留 10px 间距

## 2026-04-11

### Token消耗统计功能 (新增)
- **DeepSeek API token 用量**: 请求时添加 `stream_options: { include_usage: true }`
  - 流式响应的最后一个 chunk 包含 usage 数据
- **解析 usage**: 在 llm.js 中提取并 yield usage 数据
  - `prompt_tokens`: 输入 token 数
  - `completion_tokens`: 输出 token 数
  - `total_tokens`: 总 token 数
- **数据库存储**: 
  - messages 表添加 `prompt_tokens`, `completion_tokens`, `total_tokens` 字段
  - sessions 表添加 `total_tokens` 字段累积
- **动态计算**: 从 messages 表 SUM 计算会话累积 token
  - `/sessions` 接口动态计算 `total_tokens`
  - `/sessions/:id/tokens` 从 messages 表查询
- **前端显示**: 发送按钮下方显示累积 token 消耗
  - `[currentTokens] tokens` 格式
  - 发送完成后累加
  - 切换会话时加载历史 token

### 功能新增 (frontend/src/App.jsx)
- **选中SQL执行**: SQL预览支持选中部分内容执行
  - 新增 `sqlEditorInst` state 和 `onMount` 获取 Monaco Editor 实例
  - 新增 `getSelectedSql()` 函数：优先返回选中文本，无选中则返回全文
  - 查询按钮改为执行 `getSelectedSql()` 而非直接使用 `sqlInput`

### UI调整
- **暗色主题**: SQL预览 Editor 添加 `theme="vs-dark"`
- **字体缩小**: SQL预览 Editor 字体从 12px 改为 11px

### 日志优化 (backend/src/services/llm.js)
- **立即刷新**: `queueLog()` 新增 `immediate` 参数
  - Round请求、工具调用、函数结束使用 `immediate=true` 立即写入日志
- **完成日志**: 每个函数结束添加完成标记日志
  - `queueLog(..., true)` + `flushLogs()` 确保日志不丢失

## 2024-04-11

### 性能优化 (backend src/services/llm.js)
- **抽取 Provider 映射函数**: 新增 `getProviderConfig()` 消除重复 switch 代码
  - 三个版本函数共用：generateSQLWithLangChain、StreamGen_BAK、StreamGen
- **日志缓冲写入**: 新增 `queueLog()` + `flushLogs()` 批量写入（1秒缓冲）
- **流式解析 Buffer 修复**: done=true 时用 `stream: false` 解码全部数据，避免丢失
- **tools 缓存**: 在函数开头创建 `toolsDefinition` 数组，避免每次请求重新创建
- **参数解析优化**: 传递完整 `parsedArgs` 对象给工具函数，支持多参数扩展
- **工具查找优化**: 创建 `toolsMap` (Map) 在 while 外部，查找从 O(n) 变为 O(1)
- **空 Catch 日志**: 添加 `logger.debug()` 记录解析失败，避免静默吞掉错误

### 2024-04-10

### 修复
- **Monaco Editor 本地化**: 解决首次加载一直显示 Loading 的问题
  - 问题原因：默认从 cdn.jsdelivr.net 加载，被浏览器 Tracking Prevention 阻止
  - 解决方案：使用本地 monaco-editor 包
    - 使用 cnpm 安装 monaco-editor 到 node_modules
    - 配置 `@monaco-editor/react` loader 使用本地路径
    - 配置 Vite optimizeDeps 预构建 monaco-editor
    - 更新 worker URL 指向本地路径

### UI 调整
- **隐藏下拉选择框**: 聊天界面底部隐藏了 schemaMode 下拉选择框（固定为 stream 模式）
- **代码字体缩小**: Skill 查看器代码区域字体从 12px 改为 11px
- **左侧栏布局重构**:
  - 顶部固定："新对话"按钮（带 PlusOutlined 图标，size="small"）
  - 中间滚动：会话列表（padding 紧凑）
  - 底部固定："配置"和"Skill"按钮（同一行显示，size="small"）
- **全局暗色主题**: 统一使用 vs-dark 主题，提升加载速度

### 文档更新
- 更新设计文档 `docs/superpowers/specs/2026-04-03-data-query-assistant-design.md`
  - 添加第 14 节：Monaco Editor 本地化
  - 添加第 15 节：UI微调

### 文件变更
- `frontend/src/App.jsx`
- `frontend/vite.config.js`
- `docs/superpowers/specs/2026-04-03-data-query-assistant-design.md`
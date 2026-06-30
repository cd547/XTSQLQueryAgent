# SQL 查询助手

通过自然语言与 AI Agent 对话，实现对公司 MySQL 数据库的数据查询。

## 功能概览

### 核心功能

| 功能 | 说明 |
|------|------|
| 多用户登录 | 支持多账号登录/注册/改密/退出，会话按用户隔离；admin 角色可访问所有配置项 |
| 自然语言查询 | 输入自然语言描述，自动生成 SQL 并执行（SSE 流式） |
| SQL 执行 | 支持直接输入 SQL 查询，仅限 `SELECT` / `WITH` |
| SQL 预览 | LLM 生成 SQL 后先预览，用户确认后再执行 |
| 结果导出 | 主路导出为 Excel (.xlsx，SheetJS 动态 import)，失败时自动回退为 CSV（带 UTF-8 BOM） |
| 多会话管理 | 支持创建、切换、重命名、删除会话；分页加载（默认 20/页，上限 100） |
| Token 统计 | 统计每次 LLM 调用的 token 消耗（DeepSeek 官方 BPE Tokenizer） |
| 智能标签关联 | 用户纠正表名时，自动建议将术语添加到表标签（支持批量添加） |
| 请求中断 | 发送中可点击按钮中断请求（AbortController） |
| 会话总结 | AI 自动总结聊天内容，生成会话标签与 100 字总结 |
| 消息历史查看 | 点击查看当前会话的完整消息历史，显示 token 上下文长度 |
| 消息持久化 | 会话消息自动保存到 SQLite，支持会话中断后恢复 |

### AI 能力

| 功能 | 说明 |
|------|------|
| LLM 后端 | **生产可用：DeepSeek**（前端配置面板硬编码为 DeepSeek，模型下拉来自 DeepSeek `GET /v1/models`）。后端代码已实现 OpenAI / MiniMax / Ollama 协议（`getProviderConfig` 列出 4 个、`callLLM` 实现 4 个端点），但**前端无切换 UI**（`ConfigPanel.jsx:137` 是静态 `<span>DeepSeek</span>`；保存时 `:79` 强制覆盖 `provider: 'deepseek'`）；主路流式走 OpenAI 兼容 `/chat/completions`，MiniMax 实际端点是 `/v1/text/chatcompletion_v2`、Ollama 是 `/api/generate`，因此**实际只有 deepseek / openai 协议兼容**。`/explain-analyze` 硬编码 `validateLlmProvider` 只接受 deepseek / openai。 |
| 流式输出 | SSE 实时显示 LLM 思考过程与工具调用日志 |
| Tool 调用 | 9 个工具（表索引 / 域路由 / 表 schema / DDL / 输出格式 / 标签确认等），支持批量获取 + 内部并行 |
| Agent Loop 三阶段并行 | 同步预处理 → `Promise.all` 并行执行工具 → 按原序写回 messages，3 个 schema 工具从 ~900ms 降到 ~300ms |
| 工具调用去重 | 同一会话内同工具 + 同参数组合 1 分钟内仅生效一次，避免 LLM 重复拉取 |
| Skill V2 | 结构化表结构 + 字段配置 + DDL；修改后实时生效（每次读盘不缓存） |
| Markdown 表格 | 支持 GFM 表格语法 + 语法高亮（react-syntax-highlighter，本地依赖） |
| EXPLAIN 分析 | 一键查看 MySQL 执行计划；点击 "AI 分析" 调用 LLM 解释性能瓶颈 |

### 辅助功能

| 功能 | 说明 |
|------|------|
| SQL EXPLAIN | 执行计划分析（`/query/explain`） |
| SQL 智能分析 | 基于 EXPLAIN 结果调用 LLM 给出优化建议（`/query/explain-analyze`） |
| Skill 查看器 | 浏览和编辑本地 skill 配置（锁定/解锁、自动备份、实时生效） |
| 表结构同步 | 从 MySQL 同步表结构到本地存储（`/skills/fetch-ddl`、`/skills/create-table-files`） |
| Agent 配置 | 可配置最大工具调用次数（1-100）、超时时间（1-300s）、Token 警告上限（1-300k） |
| 选中 SQL 执行 | SQL 预览支持选中部分内容执行 |
| Skill 版本检查 | `GET /api/query/version` 返回 md5 + 加载时间 + 表数量，便于调试 |
| 健康检查 | `GET /api/health` 无需鉴权，dev 启动等待使用 |

### UI 特性

| 特性 | 说明 |
|------|------|
| 流式输出 | SSE 实时显示 LLM 思考过程和工具调用日志 |
| Markdown 渲染 | 支持 GFM 表格 + 代码块语法高亮（本地依赖，无 CDN） |
| 主题切换 | 暗色 / 默认主题切换（ThemeContext） |
| 暗色 Monaco | SQL 编辑器使用 vs-dark 主题 |
| 滚动条优化 | 统一调细为 6px 宽度 |
| 请求中断 | 发送中可点击按钮中断请求（显示转圈效果） |
| Token 进度条 | 顶部进度条按 token 警告阈值显示（绿色正常 / 红色警告） |
| 登录页 | 独立登录页（`LoginPage.jsx`），未登录自动跳转 |

### 部署方式

| 方式 | 说明 |
|------|------|
| 网页版 | `npm run dev` 一键启动（自动等后端就绪再启前端） |
| Electron 客户端 | `npm run electron:dev` 开发 / `npm run electron:build` 打包 |
| 便携版本 | Electron 打包后支持便携模式，数据存应用目录下，开发/生产路径一致 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Vite 5 + Ant Design 5 + Monaco Editor + react-markdown + react-resizable + react-syntax-highlighter |
| 后端 | Express (端口 5002) + LangChain Core（DynamicTool）|
| 鉴权 | jsonwebtoken（HttpOnly Cookie + token_version 吊销）+ bcryptjs |
| 安全 | express-rate-limit（10/h/IP 鉴权端点）+ cors + cookie-parser |
| 数据库驱动 | mysql2/promise（连接池：`services/mysqlPool.js`）|
| 本地存储 | better-sqlite3（WAL 模式，含 users / sessions / messages / configs / llm_messages / skill_logs 表）|
| Tokenizer | DeepSeek 官方 BPE（`backend/deepseek_v3_tokenizer/`）|
| 桌面壳 | Electron 42 + electron-builder |
| 构建工具 | Vite + esbuild |

## 项目结构

```
XTSQLQueryAgent/
├── backend/                          # Express 后端
│   ├── src/
│   │   ├── index.js                  # 入口（启动顺序：initDB → initSkillLog → listen）
│   │   ├── config.js                 # ⭐ 静态配置统一入口（PORT/DB_PATH/SKILL_PATH/LOG_PATH）
│   │   ├── logger.js                 # 日志（logPath 走 config）
│   │   ├── routes/                   # API 路由
│   │   │   ├── auth.js               # /api/auth/* （注册/登录/me/logout/改密）
│   │   │   ├── config.js             # /api/config/* （DB/LLM/Agent 配置）
│   │   │   ├── query.js              # /api/query/* （生成/执行/EXPLAIN/版本）
│   │   │   ├── session.js            # /api/sessions/* （CRUD + 分页 + token 统计）
│   │   │   └── skill.js              # /api/skills/* （列表/读/写/标签/DDL）
│   │   ├── services/                 # 业务逻辑
│   │   │   ├── auth.js               # JWT 懒求值 + HttpOnly cookie + token_version 吊销
│   │   │   ├── config.js             # 动态配置（SQLite 读写 getConfig/getLlmConfig/getAgentConfig）
│   │   │   ├── llm.js                # LLM 调用 + 3 阶段 agent loop + 工具调用去重
│   │   │   ├── toolFuncs.js          # 9 个工具（async 化 + 内部并行 + 实时读盘）
│   │   │   ├── sqlValidator.js       # SQL 校验（注释剥离 + 白名单 + 黑名单 + 多语句）
│   │   │   ├── tokenizer.js          # DeepSeek BPE token 计数
│   │   │   └── mysqlPool.js          # MySQL 连接池（替代每次新建连接）
│   │   ├── middleware/
│   │   │   └── rateLimit.js          # 鉴权端点限流（10/h/IP）
│   │   └── db/
│   │       └── sqlite.js             # SQLite 初始化（幂等保护 + addColumnIfMissing 迁移）
│   └── deepseek_v3_tokenizer/        # DeepSeek 官方 BPE Tokenizer 数据
│       ├── tokenizer.json
│       ├── tokenizer_config.json
│       └── deepseek_tokenizer.py
├── frontend/                         # React 前端
│   └── src/
│       ├── App.jsx                   # 主应用（含 ConfigPanel，~2000 行）
│       ├── App.css
│       ├── main.jsx
│       ├── api/                      # API 封装（axios + 4xx/5xx 拦截器）
│       │   └── index.js
│       ├── context/                  # 全局 Context
│       │   ├── AuthContext.jsx       # 鉴权状态 + 401 自动派发
│       │   └── ThemeContext.jsx      # 主题切换
│       ├── components/               # 组件
│       │   ├── ConfigPanel.jsx       # 配置面板（DB/LLM/Agent 三 Tab）
│       │   ├── ChatMessage.jsx       # 聊天消息渲染（Markdown + 代码高亮）
│       │   ├── LoginPage.jsx         # 独立登录页
│       │   ├── AppIcon.jsx           # 应用图标
│       │   ├── markdownRenderers.jsx # GFM 自定义渲染器
│       │   ├── ResizableTitle.jsx    # 可调整列宽的表格标题
│       │   └── ConfirmDialog.jsx     # 确认对话框
│       ├── utils/
│       │   └── monacoEnv.js          # Monaco Editor 配置
│       └── public/
│           └── monaco/vs/            # Monaco Editor 语言文件（121 个）
├── electron/                         # Electron 桌面壳
│   ├── main.js                       # 主进程（窗口管理 + 后端启动 + 端口检测）
│   └── preload.js
├── skills/
│   └── sql-creator-skill-v2/         # Skill V2 配置
│       ├── SKILL.md
│       ├── table_index.json          # 表索引（业务域 / 表 / 标签）
│       └── field_config/             # 字段配置
├── data/
│   └── app.db                        # SQLite（会话 / 消息 / 配置 / skill_logs）
├── logs/                             # 运行日志（含 llm_YYYY-MM-DD.log）
├── docs/                             # 开发文档
│   └── superpowers/
│       ├── changelog/                # CHANGELOG.md
│       ├── reviews/                  # CODE_REVIEW_*.md
│       ├── plans/                    # 实施计划
│       └── specs/                    # 设计规范
├── icons/                            # 应用图标
├── dist/                             # Electron 打包输出
├── wait-for-backend.js               # dev 启动时等后端 /api/health 就绪
└── package.json
```

## API 接口

### 公共

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查（无认证） |

### 认证

| 方法 | 路径 | 说明 | 限流 |
|------|------|------|------|
| POST | /api/auth/register | 注册新用户 | 10/h |
| POST | /api/auth/login | 登录，设置 HttpOnly cookie | 10/h |
| GET | /api/auth/me | 获取当前登录用户信息 | 10/h |
| POST | /api/auth/logout | 退出登录，token_version 递增使 token 失效 | 10/h |
| POST | /api/auth/change-password | 修改密码，旧 token 全部失效 | 10/h |

> 所有认证端点均启用 express-rate-limit（10 次/小时/IP）。`/me`、`/logout` 也加限流以防 `token_version` 递增被滥用。

### 配置

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | /api/config/test | admin | 测试数据库连接 |
| POST | /api/config/db | admin | 保存数据库配置（含密码）|
| GET | /api/config/db | admin | 获取数据库配置（密码字段不返回）|
| POST | /api/config/llm | admin | 保存 LLM 配置（provider/apiKey/model）|
| GET | /api/config/llm | admin | 获取 LLM 配置（apiKey 仅返回 hasApiKey 布尔）|
| GET | /api/config/llm/models | admin | 从 DeepSeek 拉取可用模型列表 |
| GET | /api/config/agent | 任意登录用户 | 读 Agent 配置（含 token 警告阈值，用于前端进度条）|
| PUT | /api/config/agent/:key | admin | 更新单个 Agent 配置项 |

### 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/sessions | 获取所有会话（分页 `?limit=20&offset=0`，上限 100，返回 `hasMore`）|
| GET | /api/sessions/:id/tokens | 获取会话累计 token |
| POST | /api/sessions | 创建新会话 |
| GET | /api/sessions/:id/messages | 获取会话消息 |
| POST | /api/sessions/:id/messages | 保存单条消息 |
| PUT | /api/sessions/:id | 更新会话名称 |
| DELETE | /api/sessions/:id | 删除会话 |
| POST | /api/sessions/:id/summarize | LLM 总结会话（生成 100 字总结 + 20 字标签 + 更新名称）|

### 查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/query/version | Skill V2 版本（md5 + lastLoad + tableCount）|
| GET | /api/query/messages | 调试接口：返回最后一次 LLM 调用的完整 messages（**仅供开发**，未鉴权隔离）|
| GET | /api/query/messages/:sessionId | 获取指定会话的消息历史（含 messageTokens）|
| DELETE | /api/query/messages/:sessionId | 删除指定会话的消息历史 |
| POST | /api/query/generate | 生成 SQL（SSE 流式，30 轮工具循环，AbortController 客户端断连保护）|
| POST | /api/query/execute | 执行 SQL（仅 SELECT/WITH，返回 rowCount / queryTime / truncated）|
| POST | /api/query/explain | 执行 EXPLAIN 分析（标准 MySQL 表格格式）|
| POST | /api/query/explain-analyze | LLM 分析 EXPLAIN 结果（仅 deepseek/openai，SSE 流式）|

### Skill

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/skills/debug | Skill 树调试输出（缓存命中状态）|
| GET | /api/skills/list | 获取 Skill 文件树 |
| GET | /api/skills/read | 读取文件内容（`?path=` 走白名单）|
| POST | /api/skills/save | 保存文件（带备份到 `logs/skill_backups/`，写入 `skill_logs` 表）|
| POST | /api/skills/add-tag | 给表添加标签（`?tableName=&tag=`）|
| POST | /api/skills/check-table | 检查表是否存在（`?tableName=` 走白名单正则）|
| POST | /api/skills/fetch-ddl | 从 MySQL 拉取 DDL（`?tableName=` 走白名单）|
| POST | /api/skills/create-table-files | 一键创建表 DDL/description/field_config 三件套 |

## 配置说明

### 默认账号

首次启动自动创建 admin 账号（仅当用户表为空时）：

- 用户名：`admin`
- 密码：`admin123`

> ⚠️ **生产环境必须立即修改密码**，并设置 `ALLOW_DEFAULT_ADMIN=false` 禁用自动创建。代码会在启动日志中以醒目的 `==========` 块警告。

### 数据库配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| Host | MySQL 主机 | localhost |
| Port | 端口 | 3306 |
| Username | 用户名 | - |
| Password | 密码 | - |
| Database | 数据库名 | - |

数据库连接通过 `services/mysqlPool.js` 的连接池管理（替代每次请求新建连接）。

### LLM 配置

**调 LLM 的端点共 2 个**（`/query/execute`、`/query/explain` 都不调 LLM，只跑 MySQL），可用矩阵如下：

| Provider | baseURL | 默认模型 | `/query/generate` 流式（主路） | `/query/generate` 非流式 | `/query/explain-analyze` |
|----------|---------|----------|:---:|:---:|:---:|
| **DeepSeek** ✅ | `https://api.deepseek.com` | `deepseek-v4-flash` | ✅ | ✅ | ✅ |
| OpenAI（代码支持，前端不提供切换） | `https://api.openai.com/v1` | `gpt-4o` | ✅ | ✅ | ✅ |
| MiniMax（代码列出口，实际不兼容） | `https://api.minimax.chat/v1` | `abab6.5s-chat` | ❌ 端点错 | ✅ | ❌ 白名单拒 |
| Ollama（代码列出口，实际不兼容） | `http://localhost:11434` | `llama3.2` | ❌ 端点错 | ✅ | ❌ 白名单拒 |

**主路流式走 OpenAI 兼容 `/chat/completions`**（[services/llm.js:411](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L411)），这是限制 4 个 provider 中只有 deepseek/openai 真正能跑通的原因。

**用户实际可选**：仅 DeepSeek（UI 硬编码 + 协议实际兼容）。要让 OpenAI / MiniMax / Ollama 真正可用，需要三步：① 前端 `ConfigPanel.jsx:137` 改 `<Select>` + 移除 `:79` 的 `provider: 'deepseek'` 强制覆盖；② `services/llm.js:411` 主路流式分支按 provider 走不同 endpoint；③ `query.js:718` `validateLlmProvider` 放开白名单。

> **模型列表**：`GET /api/config/llm/models` 仅从 DeepSeek API 拉取，要求当前 provider = deepseek 且 apiKey 已配置。

### Agent 配置

| 字段 | 说明 | 默认 | 范围 |
|------|------|------|------|
| `agent_max_tool_calls` | 工具调用最大轮数 | 30 | 1-100 |
| `agent_timeout_ms` | 单轮 LLM `fetch` 超时（毫秒）| 60000 | 1000-300000 |
| `agent_token_warning_level` | Token 警告阈值（顶部进度条红色阈值）| 30000 | 1000-300000 |

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 后端 HTTP 端口 | `5002` |
| `JWT_SECRET` | JWT 签名密钥（生产环境**必须**显式设置） | 自动生成并存 SQLite，重启后沿用 |
| `JWT_EXPIRES_IN` | JWT 过期时间 | `7d` |
| `ALLOW_DEFAULT_ADMIN` | 是否允许自动创建 admin 账号 | dev=true / prod=false |
| `NODE_ENV` | `production` 时禁用默认 admin + secure cookie | - |
| `DB_PATH` | SQLite 数据库路径 | `<projectRoot>/data/app.db` |
| `SKILL_PATH` | Skill 配置根目录 | `<projectRoot>/skills` |
| `LOG_PATH` | 日志目录 | `<projectRoot>/logs` |
| `PROJECT_ROOT` | 项目根目录（用于解析以上路径的 fallback）| `path.resolve(__dirname, '..', '..')` |

> 所有路径字段的 fallback 基于 `backend/src/config.js` 位置解析为**绝对路径**，不依赖 CWD。详见 [backend/src/config.js](backend/src/config.js)。

## 使用说明

### 启动

从项目根目录一键启动（自动等后端就绪再启前端）：

```bash
npm run dev
```

或分别启动：

```bash
# 后端 (端口 5002)
npm run dev:backend

# 前端 (端口 5173)
npm run dev:frontend
```

访问 http://localhost:5173。

### 使用流程

1. **配置数据库**：打开配置面板 → "数据库" Tab → 填写 MySQL 连接信息 → 点击"测试连接"验证
2. **配置 LLM**：切换到 "LLM" Tab → 选择 Provider → 填写 API Key + 模型 → 保存
3. **配置 Agent**（可选）：切换到 "Agent" Tab → 调整最大工具调用次数 / 超时 / Token 警告阈值
4. **创建会话**：点击"新对话"开始聊天
5. **输入问题**：用自然语言描述查询需求
6. **预览 SQL**：确认 LLM 生成的 SQL 是否正确
7. **执行查询**：点击执行查看结果，可点击"EXPLAIN"查看执行计划
8. **AI 解释**：在 EXPLAIN 结果页点击"AI 分析"，LLM 给出性能瓶颈与优化建议
9. **导出结果**：可导出为 Excel（失败时回退为 CSV）

### Skill 查看器

点击左侧边栏 "Skill" 按钮，可浏览和编辑本地 skill 配置：

- **SKILL.md** - SQL 生成规范说明
- **table_index.json** - 表索引（按业务域组织 + 标签 + 关联表）
- **field_config/** - 字段配置
- **ddl/** - 建表语句

**功能特性：**
- 锁定/解锁编辑
- 保存时自动备份到 `logs/skill_backups/<时间戳>/`
- **实时生效**：修改后下次对话自动使用最新内容（每次读盘不缓存）

### 智能标签关联

当用户纠正表名时，Agent 自动检测并询问用户是否将术语添加到对应表的标签中：
- 使用 `request_tag_confirmation` 工具触发确认框
- 支持单个或多个术语同时添加

**单个术语场景：**

1. 用户说"aa表就是edu_student"
2. Agent 调用 `request_tag_confirmation(term=["aa"], table="edu_student", description="学生")`
3. 前端显示确认框："是否将'aa'添加到 edu_student 的标签？"
4. 用户确认后，调用 `/api/skills/add-tag` 更新 table_index.json

**多个术语场景：**

1. 用户说"学生和学员都指edu_student表"
2. Agent 调用 `request_tag_confirmation(term=["学生", "学员"], table="edu_student", description="学生")`
3. 前端显示确认框："是否将["学生", "学员"]添加到 edu_student 的标签？"
4. 用户确认后，两个标签都会添加到表中

### 会话总结

点击会话列表中的「更多」按钮，选择「总结聊天」：
- AI 自动分析对话内容
- 生成 100 字左右的总结
- 生成 20 字以内的会话标签
- 自动更新会话名称

### 消息历史查看

在聊天对话框右侧，点击进度条按钮：
- 弹出模态框显示当前会话的完整消息历史
- 使用 Monaco Editor 以 JSON 格式展示
- 顶部显示消息上下文长度（token 数）
- Token 计算采用 DeepSeek 官方 BPE Tokenizer
- 消息自动保存到 SQLite 数据库，支持会话中断后恢复
- **进度条指示**：显示已使用 token 与警告上限的比例（绿色正常，红色警告）

### Token 计算

项目使用 DeepSeek 官方的 BPE（Byte Pair Encoding）算法计算 token：
- 加载 `backend/deepseek_v3_tokenizer/tokenizer.json` 中的词汇表和合并规则
- 支持中文和多字节字符的正确 token 化
- 计算结果存储在数据库的 `llm_messages.message_tokens` 字段
- 前端读取时自动展示在进度条上

## 安全设计

### 鉴权

- **JWT 签名密钥**：优先 `JWT_SECRET` 环境变量，否则首次启动随机生成 48 字节 hex 并存 SQLite，重启后沿用
- **懒求值**：`getJwtSecret()` 在第一次 `signToken()` / `verifyToken()` 时才求值，避开 `initDatabase()` 之前调用 `getDb()` 的竞态
- **HttpOnly Cookie**：token 存 `xtsql_auth` cookie（httpOnly + SameSite=Lax + 生产环境 secure），前端 JS 不可读 → 防 XSS 窃取
- **JWT 格式预校验**：进入 `jwt.verify` 前先 `/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/`，减少垃圾 token 触发 CPU 消耗
- **token_version 吊销**：改密时递增用户的 `token_version`，旧 token 即使未过期也立刻失效

### 限流

- `authRateLimiter` 应用于所有 `/api/auth/*` 端点（10/h/IP），含 `/me`、`/logout`
- 桌面端 Electron 应用所有请求来自 127.0.0.1，限制是"同机所有用户共享 10 次/小时"
- 反向代理部署需在 `index.js` 设置 `app.set('trust proxy', 1)`

### SQL 校验

- **注释剥离**：`/* */`、`--`、`#` 三种注释（`services/sqlValidator.js`）
- **前缀白名单**：`/execute` 仅允许 `SELECT`/`WITH`；`/explain` 允许 `SELECT`/`WITH`/`EXPLAIN`
- **危险函数黑名单**：拦截 `INSERT`/`UPDATE`/`DELETE`/`DROP`/`TRUNCATE`/`GRANT` 等 DML/DDL
- **多语句检测**：拒绝包含 `;` 的多语句输入
- **应用层截断**：超过 `MAX_DISPLAY_ROWS = 1000` 时截断并返回 `truncated: true`（不静默追加 LIMIT，保留用户原 SQL 语义）

### 错误处理

- 后端 catch 块按错误类型返回标准化状态码：500（系统异常）/ 404（资源不存在）/ 400（参数错误）/ 403（权限不足）
- 前端 axios 拦截器对 4xx + 5xx + body.error 自动 `message.error` 提示
- 401 触发 `xtsql:auth-expired` 自定义事件，自动跳转登录页
- 5xx 也自动 toast（重复 toast 风险小于"页面无反应"）

### 请求体大小限制

`app.use(express.json({ limit: '10mb' }))` — 防止 DoS，同时允许长会话消息历史。

## 更新日志

详见 [CHANGELOG.md](./docs/superpowers/changelog/CHANGELOG.md)

最近一次全面代码审查：2026-06-26（详见 [CODE_REVIEW_2026-06-26.md](./docs/superpowers/reviews/CODE_REVIEW_2026-06-26.md)，18/30 = 60% 修复）

# SQL 查询助手

通过自然语言与 AI Agent 对话，实现对公司 MySQL 数据库的数据查询。

## 功能概览

### 核心功能

| 功能 | 说明 |
|------|------|
| 自然语言查询 | 输入自然语言描述，自动生成 SQL 并执行 |
| SQL 执行 | 支持直接输入 SQL 查询，仅限 SELECT 操作 |
| SQL 预览 | LLM 生成 SQL 后先预览，用户确认后再执行 |
| 结果导出 | 支持导出为 Excel (.xlsx)、CSV、HTML 格式 |
| 多会话管理 | 支持创建、切换、重命名、删除会话 |
| Token 统计 | 统计每次 LLM 调用的 token 消耗 |
| 智能标签关联 | 用户纠正表名时，自动建议将术语添加到表标签 |

### AI 能力

| 功能 | 说明 |
|------|------|
| 多 Provider 支持 | OpenAI、DeepSeek、MiniMax、Ollama (本地) |
| 流式输出 | SSE 实时显示 LLM 思考过程 |
| Tool 调用 | 自动获取表结构、DDL、输出格式等 |
| Skill V2 | 结构化表结构说明和字段配置 |
| Markdown 表格 | 支持 GFM 表格语法渲染 |

### 辅助功能

| 功能 | 说明 |
|------|------|
| SQL EXPLAIN | 执行计划分析，优化查询性能 |
| Skill 查看器 | 浏览和编辑本地 skill 配置 |
| 表结构同步 | 从数据库同步表结构到本地存储 |
| 会话总结 | AI 自动总结聊天内容，生成会话标签 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + Ant Design + Monaco Editor + react-markdown |
| 后端 | Express (端口 5002) |
| LLM 框架 | LangChain.js |
| 数据库驱动 | mysql2/promise (MySQL) |
| 本地存储 | better-sqlite3 (SQLite) |
| 构建工具 | Vite |

## 项目结构

```
XTSQLQueryAgent/
├── backend/                 # Express 后端
│   └── src/
│       ├── routes/         # API 路由
│       │   ├── query.js    # SQL 查询接口
│       │   ├── session.js  # 会话管理
│       │   ├── config.js  # 配置管理
│       │   └── skill.js   # Skill 管理
│       ├── services/       # 业务逻辑
│       │   ├── llm.js     # LLM 调用
│       │   └── config.js  # 配置读取
│       └── db/            # 数据库
│           └── sqlite.js  # SQLite 初始化
├── frontend/               # React 前端
│   └── src/
│       ├── App.jsx        # 主应用
│       ├── api/           # API 调用
│       └── components/    # 组件
│           ├── QueryPanel.jsx   # SQL 查询面板
│           └── ConfigPanel.jsx  # 配置面板
├── skills/                # Skill 配置
│   └── sql-creator-skill-v2/
│       ├── SKILL.md       # 技能说明
│       ├── table_index.json
│       └── field_config/  # 字段配置
├── docs/                  # 开发文档
│   └── superpowers/
├── CHANGELOG.md           # 更新日志
└── package.json
```

## API 接口

### 配置

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/config/test | 测试数据库连接 |
| POST | /api/config/db | 保存数据库配置 |
| GET | /api/config/db | 获取数据库配置 |
| POST | /api/config/llm | 保存 LLM 配置 |
| GET | /api/config/llm | 获取 LLM 配置 |

### 会话

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/sessions | 获取所有会话 |
| POST | /api/sessions | 创建新会话 |
| PUT | /api/sessions/:id | 更新会话名称 |
| DELETE | /api/sessions/:id | 删除会话 |
| GET | /api/sessions/:id/messages | 获取会话消息 |
| POST | /api/sessions/:id/summarize | 总结会话聊天记录 |

### 查询

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/query/generate | 生成 SQL (流式输出) |
| POST | /api/query/execute | 执行 SQL |
| POST | /api/query/explain | 执行 EXPLAIN 分析 |

### Skill

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/skills/list | 获取 Skill 列表 |
| GET | /api/skills/read | 读取文件内容 |
| POST | /api/skills/save | 保存文件 (带备份) |
| POST | /api/skills/add-tag | 添加表标签 |

## 配置说明

### 数据库配置

| 字段 | 说明 | 默认值 |
|------|------|--------|
| Host | MySQL 主机 | localhost |
| Port | 端口 | 3306 |
| Username | 用户名 | - |
| Password | 密码 | - |
| Database | 数据库名 | - |

### LLM 配置

| Provider | Base URL | 默认模型 |
|----------|----------|----------|
| OpenAI | https://api.openai.com/v1 | gpt-4o |
| DeepSeek | https://api.deepseek.com | deepseek-chat |
| MiniMax | https://api.minimax.chat/v1 | abab6.5s-chat |
| Ollama | http://localhost:11434 | llama3.2 |

## 使用说明

### 启动

从项目根目录一键启动（自动先启动后端，等待就绪后再启动前端）：

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

访问 http://localhost:5173

### 使用流程

1. **配置数据库**：打开配置面板，填写 MySQL 连接信息
2. **配置 LLM**：选择 Provider，填写 API Key 和模型
3. **创建会话**：点击"新对话"开始聊天
4. **输入问题**：用自然语言描述查询需求
5. **预览 SQL**：确认生成的 SQL 是否正确
6. **执行查询**：点击执行查看结果
7. **导出结果**：可导出为 Excel 或 CSV

### Skill 查看器

点击左侧边栏 "Skill" 按钮，可浏览和编辑本地 skill 配置：

- **SKILL.md** - SQL 生成规范说明
- **table_index.json** - 表索引
- **field_config/** - 字段配置
- **ddl/** - 建表语句

支持锁定/解锁编辑，保存时自动备份。

### 智能标签关联

当用户纠正表名时，Agent 会自动检测并询问用户是否将术语添加到对应表的标签中：

1. 用户说"aa表就是edu_student"
2. Agent 调用 `request_tag_confirmation` 工具
3. 前端显示确认框："是否将'aa'添加到 edu_student 的标签？"
4. 用户确认后，调用 `/api/skills/add-tag` 更新 table_index.json

这样下次查询时，Agent 可以通过新术语直接匹配到对应表。

### 会话总结

点击会话列表中的「更多」按钮，选择「总结聊天」：
- AI 自动分析对话内容
- 生成 100 字左右的总结
- 生成 20 字以内的会话标签
- 自动更新会话名称

## 更新日志

详见 [CHANGELOG.md](./CHANGELOG.md)
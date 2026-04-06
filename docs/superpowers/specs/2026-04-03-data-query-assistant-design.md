# 数据查询助手 - 设计规范

## 1. 项目概述

**项目名称**：公司内部数据查询助手  
**项目类型**：Web应用  
**核心功能**：通过自然语言与AI Agent对话，实现对公司MySQL数据库的数据查询，支持多种格式输出  
**目标用户**：公司内部员工

---

## 2. 技术栈

| 层级 | 技术选型 |
|------|----------|
| 前端 | React 18 + JavaScript + Ant Design |
| 后端 | Express + JavaScript (端口5002) |
| LLM框架 | LangChain.js ^0.3 |
| SQL解析 | sql-parser |
| 数据库驱动 | mysql2（仅MySQL） |
| SQLite | better-sqlite3（单用户本地存储） |
| Excel导出 | xlsx |
| 日志 | winston |
| 构建工具 | Vite |

---

## 3. 系统架构

```
┌─────────────────────────────────────────┐
│            Browser                       │
│  ┌─────────────────────────────────┐   │
│  │      React Frontend              │   │
│  │  • 配置面板（数据库+LLM）       │   │
│  │  • 对话界面（查询输入/结果）     │   │
│  │  • 导出功能                     │   │
│  │  • 会话管理                    │   │
│  └───────────┬─────────────────────┘   │
│              │ HTTP API                 │
│  ┌──────────▼─────────────────────┐   │
│  │      Express Backend            │   │
│  │  • /api/config - 配置管理    │   │
│  │  /api/query - 查询接口       │   │
│  │  /api/schema - 表结构获取    │   │
│  │  /api/tables - 表列表查询    │   │
│  │  /api/sessions - 会话管理   │   │
│  │  /api/table-schema - 表结构│   │
│  └────┬────────────────────────────┘   │
│       │                                 │
│  ┌────▼────────┐     ┌─────────────┐    │
│  │  mysql2    │     │  LLM API   │    │
│  │  数据库   │     │ (多provider)│    │
│  └────┬──────┘     └─────────────┘    │
│       │                                 │
│  ┌────▼───────────────────────────┐    │
│  │       SQLite本地存储            │    │
│  │  • 会话/消息历史            │    │
│  │  • 表结构说明              │    │
│  └────────────────────────────┘     │
│                                       │
│  ┌────────────────────────────┐     │
│  │       Skill (Agent调用)      │     │
│  │  • 表结构说明              │     │
│  │  • 业务逻辑               │     │
│  └────────────────────────────┘     │
└─────────────────────────────────────────┘
```

---

## 4. 功能模块

### 4.1 数据库配置

- 用户在界面填写MySQL连接参数：
  - Host
  - Port (默认3306)
  - Username
  - Password
  - Database Name
- 连接测试功能
- 配置加密存储在SQLite后端（表configs），后端不解密只透传

### 4.2 表结构发现（两种模式）

**模式A：自动获取**
- 调用 `SHOW TABLES` 获取所有表
- 调用 `DESCRIBE <table>` 获取表结构
- 生成 Schema描述供LLM使用

**模式B：本地存储**
- 表结构存储在SQLite `table_schemas` 表（优先级高于自动获取）
- 支持版本控制和同步状态
- SQL结构：
  ```sql
  CREATE TABLE table_schemas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT,
    description TEXT,
    columns TEXT,
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'synced',
    auto_schema TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- 字段说明：
  - `status`: synced（已同步）/ pending（待同步）/ manual（手动）
  - `auto_schema`: 自动获取的表结构快照
- 刷新功能：
  - 自动对比数据库当前schema与存储版本
  - 检测新增/删除/修改的表和字段
  - 标记 `pending` 状态，提示用户确认同步

### 4.2.1 Agent Skill支持

- Skill定义格式（JSON）：
  ```json
  {
    "name": "表结构说明",
    "tables": [
      {
        "name": "users",
        "description": "用户表",
        "fields": {
          "id": "用户ID",
          "name": "用户名",
          "role": "角色：admin/user"
        },
        "business_logic": "业务逻辑说明"
      }
    ]
  }
  ```
- 存储位置：文件 `skills/db_schema_skill.json`（单用户本地优先）
- 版本控制：
  - 文件增加 `version` 字段
  - 每次调用记录当前skill版本
  - 版本变化时提示用户确认
- 检测更新：
  - 启动时计算 skill文件MD5
  - 版本号递增或MD5变化提示重新加载
- 调用方式：
  - 后端读取skill文件，解析JSON
  - 按模板位置插入Prompt（见6.核心Prompt设计）
- 作用：提供表业务含义，助LLM理解字段用途

### 4.3 对话历史存储

- 使用SQLite本地存储对话历史
- 表结构：
  ```sql
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    role TEXT,
    content TEXT,
    sql TEXT,
    results TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- 支持多会话，每个会话包含多条消息
- 每次查询记录question + answer + SQL + results
- 多轮对话时可获取历史上下文
- 安全存储数据库密码和LLM API Key（加密存储）

### 4.4 SQL预览与安全确认

- LLM生成SQL后，**先返回给用户预览**
- 用户可选择：
  - 确认执行
  - 修改SQL后执行
  - 取消
- 自动过滤危险SQL（INSERT/UPDATE/DELETE/ DROP等）

### 4.5 手动SQL编辑

- 用户可直接输入SQL查询
- 支持SQL语法高亮
- 执行后可查看结果

### 4.6 自然语言查询

- 用户输入自然语言查询请求
- 后端使用LangChain.js：
  1. 构建Prompt（包含Schema + 用户问题）
  2. 调用LLM生成SQL
  3. **不直接执行，返回SQL预览**
  4. 用户确认后执行
- 结果展示在对话界面

### 4.7 查询结果处理

- 分页展示（默认每页100条）
- 支持跳转页码
- 显示总行数
- 后端使用 `SQL_CALC_FOUND_ROWS` 或 `COUNT(*)` 获取总数
- 使用 `LIMIT 100 OFFSET 0` 实现分页

### 4.8 SQL执行错误修正

- 执行失败时显示错误信息
- 用户可修改SQL后重试
- 保留历史SQL版本

### 4.9 多会话管理

- 支持创建多个对话会话
- 每个会话独立存储历史记录（SQLite单用户模式）
- 可切换、重命名、删除会话
- 仅支持单用户本地使用

### 4.10 LLM多provider支持

支持的providers：

| Provider | SDK | API格式 |
|---------|-----|--------|
| OpenAI | openai | `https://api.openai.com/v1/chat/completions` |
| DeepSeek | deepseek | `https://api.deepseek.com/v1/chat/completions` |
| MiniMax | @minimax/server | `https://api.minimax.chat/v1/text/chatcompletion_v2` |
| Ollama (本地) | ollama | `http://localhost:11434/api/generate` |
| | | 配置：设置Ollama主机和模型名称 |

错误处理：
- API限流：返回429时，提示用户稍后重试
- 超时：10秒超时，自动切换provider
- API错误：返回具体错误信息

调用方式：
- 使用统一的LLM wrapper封装
- 根据provider动态选择SDK和endpoint
- 支持流式响应（可选）

### 4.11 结果导出

支持的输出格式（按优先级）：
1. **Excel (.xlsx)** - 优先级最高
2. HTML表格
3. Markdown表格
4. 图片（可选）

大数据集优化：
- 单次导出上限：10万行
- 超过上限时提示分批导出
- 使用流式写入，避免内存溢出
- Excel支持压缩（.xlsx已内置zip）

### 4.12 表结构存储接口（支持模式B）

- 获取表结构列表：`GET /api/table-schema`
- 添加表结构：`POST /api/table-schema`
- 更新表结构：`PUT /api/table-schema/:id`
- 删除表结构：`DELETE /api/table-schema/:id`

### 4.13 LLM配置接口

- 配置provider：`POST /api/config/llm`
- LLM配置加密存储在SQLite后端

---

## 5. 接口设计

### 5.1 配置接口

```
POST /api/config/test
Body: { host, port, user, password, database }
Response: { success: boolean, message: string }
```

### 5.2 会话管理接口

```
GET /api/sessions
Response: { sessions: [{ id, name, created_at }] }

POST /api/sessions
Body: { name: string }
Response: { id: number }

PUT /api/sessions/:id
Body: { name: string }
Response: { success: boolean }

DELETE /api/sessions/:id
Response: { success: boolean }
```

### 5.3 消息历史接口

```
GET /api/sessions/:id/messages
Response: { messages: [{ id, role, content, sql, results, created_at }] }

DELETE /api/sessions/:id/messages
Response: { success: boolean }
```

### 5.4 表结构接口（获取后前端缓存）

```
GET /api/tables
Header: X-Config (base64编码的配置JSON)
Response: { tables: string[] }

GET /api/schema
Header: X-Config
Response: { schema: TableInfo[] }
```

### 5.5 表结构存储接口（模式B）

```
GET /api/table-schema
Response: { schemas: [{ id, table_name, description, columns, version, status, created_at }] }

POST /api/table-schema
Body: { table_name, description, columns }
Response: { id: number }

PUT /api/table-schema/:id
Body: { table_name?, description?, columns? }
Response: { success: boolean }

DELETE /api/table-schema/:id
Response: { success: boolean }
```

### 5.6 表结构刷新同步接口

```
POST /api/table-schema/refresh
Header: X-Config
Response: { 
  changed: [{ table_name, status, old_columns, new_columns }],
  added: [table_names],
  removed: [table_names]
}

POST /api/table-schema/sync
Body: { table_name, action: 'confirm' | 'discard' }
Response: { success: boolean }
```

### 5.7 Skill加载接口

```
GET /api/skills
Response: { skills: [{ name, content }] }

POST /api/skills
Body: { name, content }
Response: { success: boolean }
```

### 5.8 SQL生成接口（只生成，不执行）

```
POST /api/query/generate
Body: { 
  question: string,
  sessionId: number,
  schemaMode: 'auto' | 'manual' | 'skill'
}
Header: X-LLM-Provider, X-LLM-ApiKey
Response: { 
  sql: string,
  message: string
}
```

### 5.9 LLM配置接口

```
POST /api/config/llm
Body: { provider: string, apiKey: string }
Response: { success: boolean }
```

### 5.10 SQL执行接口（带安全过滤）

```
POST /api/query/execute
Body: { 
  sql: string,
  sessionId: number
}
Header: X-Config
Response: { 
  results: object[],
  rowCount: number,
  error?: string
}
```

安全过滤规则：
- 使用sql-parser验证SQL语法
- 白名单允许操作：仅SELECT语句
- 拒绝包含 INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE 的SQL
- 执行前再次校验解析后的statement type

### 5.11 导出接口

```
POST /api/export
Body: { 
  data: object[],
  format: 'xlsx' | 'html' | 'markdown'
}
Response: 文件流
```

---

## 6. 核心Prompt设计

```prompt
你是一个SQL查询专家。根据以下数据库表结构，回答用户的问题并生成对应的SQL查询。

## 表结构
{schema}

## Skill
{skill}

## 历史上下文（参考之前对话）
{history}
（截取最近10条消息，避免Prompt过长）

## 规则
1. 只生成SELECT查询，不要生成INSERT/UPDATE/DELETE
2. 使用标准的MySQL语法
3. 如需限制结果条数，使用LIMIT默认1000
4. 返回JSON格式：{{"sql": "SQL语句", "message": "简要说明"}

## 用户问题
{question}
```

---

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 数据库连接失败 | 返回错误信息，提示检查配置 |
| SQL执行失败 | 返回错误信息，显示SQL供用户修正；记录error日志到文件 |
| SQL重试上限 | 同一会话单次查询最多重试3次 |
| LLM调用失败 | 返回错误信息，支持切换provider |
| 无结果 | 提示"查询结果为空"，显示相关Schema建议，引导用户调整查询 |

---

## 8. 安全考虑

- 数据库密码和LLM API Key加密存储在SQLite（表configs）
- 后端不解明文，只透传
- SQL执行前使用sql-parser验证语法
- 白名单允许操作：仅SELECT
- 建议：生产环境加企业内部认证（可选）

---

## 9. 里程碑

1. **M1**: 项目初始化 + 基础框架搭建
2. **M2**: 数据库连接 + 表结构获取
3. **M3**: LLM集成 + 自然语言转SQL
4. **M4**: 结果展示 + Excel导出
5. **M5**: 优化体验 + bug修复

---

## 10. 更新日志 (2026-04-03)

### 10.1 Skill模式重构

**变更内容**：
- Skill数据源从单一 `db_schema_skill.json` 迁移到 `sql-creator-skill-v2/` 目录
- 新增动态Skill调用模式（LangChain LCEL + Function Calling）

**文件结构**：
```
skills/sql-creator-skill-v2/
├── SKILL.md                    # 技能说明
├── table_index.json            # 表索引
├── field_config/               # 字段配置
│   ├── edu_course.json
│   └── ...
├── ddl/                        # 建表语句
│   ├── edu_course.sql
│   └── ...
├── docs/
│   └── mysql57_limits.md
└── templates/
    └── output_format.md
```

### 10.2 Schema模式说明

| 模式 | 说明 | 实现状态 |
|------|------|----------|
| langchain | LangChain动态Skill调用（推荐） | ✅ 已实现 |
| skill | 静态注入匹配表结构 | ✅ 已实现 |
| manual | SQLite存储的表结构 | ✅ 已实现 |
| auto | 实时连接数据库获取 | ✅ 已实现 |

**默认模式**：langchain

### 10.3 LangChain集成

**实现文件**：`backend/src/services/llm.js`

**定义的Tools**：
- `get_tables`: 获取所有可用表列表
- `get_table_schema(table_name)`: 获取指定表详细信息
- `get_table_ddl(table_name)`: 获取指定表DDL建表语句
- `get_output_format`: 获取SQL输出格式模板
- `get_mysql_limits`: 获取MySQL 5.7限制信息

**LLM Provider 支持**：
- OpenAI (`ChatOpenAI`)
- DeepSeek (`ChatDeepSeek`)
- MiniMax (`ChatOpenAI` with custom baseURL)

### 10.4 编码问题修复

修复了以下文件的中文乱码问题：
- `backend/src/services/config.js`
- `frontend/src/App.jsx`
- `frontend/src/components/ConfigPanel.jsx`

### 10.6 流式输出与Agent日志 (2026-04-06)

**实现文件**：`backend/src/routes/query.js` (stream mode)

**SSE 事件类型**：
- `type: 'chunk'` - LLM 输出的文本片段
- `type: 'log'` - Agent 工具调用日志
  - `🔧 调用工具: xxx...` - 工具开始调用
  - `📋 工具 xxx 返回: ...` - 工具返回结果
- `type: 'done'` - 完成，返回 sql 和 message
- `type: 'error'` - 错误信息

**前端处理**：接收 SSE 事件，实时显示 Agent 思考过程和工具调用日志

### 10.7 前端更新

**文件**：`frontend/src/App.jsx`

- 新增左侧边栏：会话列表、新建会话、配置按钮
- 聊天区域：显示用户消息、Agent 思考日志、最终 SQL 结果
- 支持流式输出和工具调用日志展示

### 10.8 界面优化与 Tab 功能 (2026-04-06)

**前端更新**：

1. **左侧边栏滚动条修复**
   - 移除固定高度和 overflow: hidden
   - 会话列表使用固定高度计算：`calc(100vh - 104px)`

2. **Tab 功能**
   - 固定"聊天"标签，不可删除
   - 添加按钮可创建新的"SQL查询"标签
   - 新标签可独立删除
   - Tab 使用 antd Tabs 组件的 items 属性

3. **删除按钮样式**
   - 使用 CloseOutlined 图标替代 DeleteOutlined
   - 默认灰色 (#999)，鼠标悬停变红 (#ff4d4f)
   - 自定义 DeleteIcon 组件实现 hover 效果

4. **聊天与 SQL 查询分离**
   - 聊天 tab：自然语言输入框 + 流式输出
   - SQL 查询 tab：独立暗色输入框（monospace 字体，12px）
   - 使用独立的 sqlInput 状态管理

5. **复制到 SQL 查询功能**
   - Agent 回复中如有 sql 字段，显示"复制到SQL查询"按钮
   - 点击后创建新 SQL 查询 tab 并填入 SQL
   - 按钮放置在回复框内最后一行右下角

6. **Markdown 渲染**
   - 使用 react-markdown 渲染 Agent 返回的 markdown 内容
   - 用户消息和助手消息区分显示

**后端更新**：

1. **消息保存逻辑**
   - 用户消息：在 `/api/query/generate` 入口处保存
   - 助手消息：在流式输出完成时保存
   - 不再依赖前端 saveSessionMessage

2. **返回格式变更**
   - 不再返回 JSON 格式，改为直接返回 markdown
   - done 事件返回 `{ sql, message }`，其中 message 为完整 markdown
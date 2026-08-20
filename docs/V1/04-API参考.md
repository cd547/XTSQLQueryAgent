# 04 API 参考

> 版本：V1 · 核对日期：2026-08-12 · 基础 URL：`http://localhost:5002/api`（开发代理 `/api` → 5002；Electron 直连 `http://localhost:5002/api`）
> 鉴权：httpOnly Cookie `xtsql_auth`（浏览器自动携带，axios `withCredentials:true`）或 `Authorization: Bearer <JWT>`。

## 1. 通用约定

- 请求体 JSON，大小上限 10MB；
- 业务错误统一 `{ error: string, code?: string, ... }`；
- 未登录 `401 {error, code:'AUTH_REQUIRED'|'AUTH_INVALID'}`；权限不足 `403 {error, code:'ADMIN_REQUIRED'}`；限流 `429 {error, code:'RATE_LIMIT_EXCEEDED'}`；
- 前端 axios 拦截器对 4xx/5xx 自动 toast；401 触发 `xtsql:auth-expired` 事件跳登录。

## 2. 公共接口

### GET /health（无鉴权）

```json
{ "status": "ok" }
```

用途：Electron / `wait-for-backend.js` 启动探活。

## 3. 认证 /api/auth

限流：`register/login/change-password` 10 次/h/（IP+用户名），成功不计数；`me/logout` 100 次/h/IP。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/register` | `{username, password, displayName?}`；用户名 2-32 位字母/数字/下划线/中文；注册即登录 |
| POST | `/login` | `{username, password}`；成功 Set-Cookie |
| GET | `/me` | 返回当前用户 `{user}` |
| POST | `/logout` | 递增 token_version + 清 Cookie |
| POST | `/change-password` | `{oldPassword, newPassword}`（≥6 位），成功后旧 token 全部失效 |

示例：

```json
POST /api/auth/login
{ "username": "admin", "password": "admin123" }
→ 200 { "success": true, "user": { "id": 1, "username": "admin", "display_name": "管理员", "role": "admin", "token_version": 0 } }
```

## 4. 配置 /api/config（除 /agent 外均需 admin）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/test` | admin | `{host, port, user, password, database}`；新建临时连接测试，返回 `{success, message}` |
| POST | `/db` | admin | 保存 MySQL 配置（JSON 存 configs） |
| GET | `/db` | admin | 读取配置，**删除 password 字段** |
| POST | `/llm` | admin | `{provider, apiKey?, model, apiMode?}`；apiKey 传空保留旧值（F3 修复）；apiMode ∈ chat_completions / responses_api |
| GET | `/llm` | admin | 返回 `{provider, model, apiMode, hasApiKey, maskedKey}`（key 掩码 `sk-****abcd`） |
| GET | `/llm/models` | admin | 从 DeepSeek `GET /models` 拉取模型列表；未配 key 返回 `{success:false}` |
| GET | `/agent` | 登录 | 返回全部 `agent_*` 配置 + `agent_token_warning_level` |
| PUT | `/agent/:key` | admin | `{value}` 更新单项，如 `PUT /agent/max_tool_calls {value:"30"}` |

## 5. 会话 /api/sessions（需登录，全部按用户隔离）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 分页 `?limit=20&offset=0`（limit 上限 100），返回 `{sessions, total, hasMore}`；每项含 `total_tokens`（SUM usage 行，LEFT JOIN+GROUP BY） |
| POST | `/` | `{name?}` 创建，名称默认“新对话 N”，`sort_order` 自增 |
| GET | `/:id/tokens` | `{total_tokens}`（messages 表 role=usage 的 SUM） |
| GET | `/:id/messages` | 会话全部消息 `{messages}`（无分页，全量） |
| POST | `/:id/messages` | 手动保存单条 `{role, content, sql, results}` |
| PUT | `/:id` | `{name}` 重命名 |
| DELETE | `/:id` | 删除会话（连带 llm_messages/messages 记录 + 释放注册表） |
| POST | `/:id/summarize` | LLM 总结：返回 `{success, summary(100字), name(20字标签)}` 并自动更新会话 |

## 6. 查询 /api/query（需登录）

### GET /version

Skill V2 版本信息：

```json
{ "version": 8, "md5": "…", "lastLoad": "2026-08-12T…", "tableCount": 123 }
```

### GET /messages（调试，生产 404，非生产需 admin）

返回进程级 `lastMessages` 全局缓存（最后一次 LLM 调用的完整 messages，**未按用户隔离**，仅限调试）。

### GET /messages/:sessionId

返回该会话 LLM 上下文：

```json
{ "success": true, "messages": [...], "count": 32, "messageTokens": 1234, "apiMode": "chat_completions", "sessionId": 1 }
```

### DELETE /messages/:sessionId

清空该会话 llm_messages + 释放工具注册表。

### POST /generate（SSE 流式）

请求：

```json
{ "question": "查询2024年销售额最高的10个客户", "sessionId": 5, "schemaMode": "stream" }
```

`sessionId` 缺省自动创建（归属当前用户）；`schemaMode` 非 `"stream"` 时当前实现**不返回任何响应**（历史遗留，见问题清单 H1）。

响应事件（`Content-Type: text/event-stream`）：

```
data: {"type":"meta","sessionId":5}

data: {"type":"reasoning_chunk","content":"…","round":0}

data: {"type":"chunk","content":"…","round":0}

data: {"type":"usage","usage":{"prompt_tokens":1200,"completion_tokens":300,"total_tokens":1500,"cached_tokens":800},"round":0}

data: {"type":"tool","log":"🔧 调用工具: get_domain_index","round":0}

data: {"type":"tool_return","log":"📋 工具 get_domain_index 返回:\n…","round":0}

data: {"type":"done","sql":"SELECT …","message":"…","sessionId":5,"totalTokens":3210,"elapsedMs":18432}
```

`done` 可选字段：`user_choice_request`（数组，最多 3 个 `{id, question, options, multi_select, header}`）、`confirm_tag_add`（`{term, table, description}`）。

### POST /execute

```json
{ "sql": "SELECT * FROM edu_student LIMIT 10", "sessionId": 5 }
```

校验：仅 SELECT/WITH；返回：

```json
{ "results": [...], "rowCount": 123, "returned": 1000, "truncated": true, "queryTime": 12 }
```

`rowCount` 为实际行数，`returned` 为返回行数（上限 1000），`truncated` 标记是否截断。带 `sessionId` 时会写两条历史消息（user: sql；assistant: `{rowCount, truncated}` 元数据）。

### POST /explain

```json
{ "sql": "SELECT * FROM edu_student WHERE id = 1" }
```

校验：SELECT/WITH/EXPLAIN；自动前缀 `EXPLAIN `；返回 `{results: [...], rowCount}`。

### POST /explain-analyze（SSE 流式）

```json
{ "sql": "SELECT …", "explainResults": [ { "id": 1, "select_type": "SIMPLE", ... } ] }
```

仅 deepseek/openai；SSE 事件：`chunk` → `done{analysis}` / `error`。结果不落库。

## 7. Skill /api/skills（需登录；写操作需 admin）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/list` | 登录 | 文件树 `{success, tree}`（跳过 skill_back） |
| GET | `/read?path=…` | 登录 | 读文件 `{success, content, language}`；isPathSafe 防穿越 |
| GET | `/domains` | 登录 | `{success, domains}` 业务域列表 |
| GET | `/debug` | admin | 路径/存在性诊断 |
| POST | `/save` | admin | `{path, content}`；备份 `skills/skill_back/<ts>/` + 写 skill_logs |
| POST | `/add-tag` | admin | `{tableName, tag}`（tag 可为数组）；备份 + 写 table_index |
| POST | `/check-table` | 登录 | `{tableName}` → `{exists}` |
| POST | `/fetch-ddl` | 登录 | `{tableName}`（白名单正则）；执行 `SHOW CREATE TABLE` → `{ddl, tableComment, relatedTables}` |
| POST | `/create-table-files` | admin | `{tableName, ddl, description?, domains[]}`；注册域 + 写 table_index/ddl/field_config；已存在则仅覆盖 DDL |

## 8. 收藏 /api/queries（需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/favorite` | `{userQuestion, sqlOutput}`；LLM 提炼标题+提取表名 → 域反查 → upsert；返回 `{id, optimizedQuestion, businessDomains}` |
| POST | `/favorites/check` | `{items:[{sqlOutput}]}` → `{items:[{sqlOutput, matched, id?, optimizedQuestion?, businessDomains?, addTime?}]}` |
| DELETE | `/favorite` | `{sqlOutput}` 取消收藏，返回 `{deleted: boolean}` |
| GET | `/suggestions?count=4` | 随机建议问题（admin 跨用户，count 上限 20） |

## 9. 空壳路由（历史遗留，仅挂 authRequired）

- `/api/tables/*`（routes/tables.js）
- `/api/table-schema/*`（routes/tableSchema.js）
- `/api/export/*`（routes/export.js）

无实际业务实现，前端未调用。

## 10. 错误码速查

| code | 含义 | 典型场景 |
|---|---|---|
| `AUTH_REQUIRED` / `AUTH_INVALID` | 未登录 / 登录失效 | 无 Cookie、token 过期、token_version 不匹配 |
| `ADMIN_REQUIRED` | 非管理员访问受限接口 | 普通用户调 /config/* |
| `RATE_LIMIT_EXCEEDED` | 限流 | 认证写接口 10/h、读接口 100/h |
| `EMPTY_SQL` / `EMPTY_AFTER_CLEAN` | SQL 为空 | /execute、/explain |
| `TOO_LONG` | SQL 超 20000 字符 | 同上 |
| `MULTI_STATEMENT` | 含 `;` 多语句 | 同上 |
| `FORBIDDEN_PREFIX` | 非 SELECT/WITH(/EXPLAIN) | 同上 |
| `FORBIDDEN_FUNCTION` | 命中危险函数黑名单 | SLEEP()/INTO OUTFILE 等 |
| `MYSQL_CONDITIONAL_COMMENT` | 使用 `/*!...*/` | 同上 |
| `INVALID_SQL` | 未闭合注释/引号等 | 同上 |
| `MISSING_PARAMS` / `INVALID_PARAMS` 等 | 参数缺失/非法 | 收藏等业务接口 |
| `DOMAINS_REQUIRED` / `DOMAIN_*` | 业务域问题 | create-table-files / addTableToDomains |
| `INVALID_TABLE` | 表名不合法 | fetch-ddl |


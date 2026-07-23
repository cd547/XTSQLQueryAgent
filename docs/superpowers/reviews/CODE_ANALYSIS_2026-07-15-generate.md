# 🔍 XTSQLQueryAgent 后端 `/generate` 代码分析报告

> **分析日期**: 2026-07-15
> **分析范围**: 后端（`backend/src/`）+ SKILL 文件（`skills/sql-creator-skill-v2/`）
> **聚焦重点**: `/api/query/generate` 接口全链路、LLM 工具调用循环、Skill 系统
> **代码量**: 后端 ~3,800 行 + Skill 系统 9 个核心文件
> **分析方法**: 静态阅读 + 历史变更追溯（基于 [project_memory.md](file:///c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/project_memory.md) 与最近 5 次会话 memory）

---

## 项目概况

| 层级 | 技术栈 | 关键文件 |
|------|--------|----------|
| 后端框架 | Express.js 4.21 + ESM | [index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js) |
| 本地存储 | SQLite (WAL) + better-sqlite3 12 | [db/sqlite.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js) |
| 查询目标 | MySQL + mysql2/promise 连接池 | [services/mysqlPool.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/mysqlPool.js) |
| LLM | DeepSeek / OpenAI / MiniMax / Ollama（`fetch` 直连） | [services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js) |
| 鉴权 | JWT (httpOnly Cookie + `token_version` 吊销) | [services/auth.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js) |
| Skill 系统 | JSON 索引 + 文件 DDL + Domain Router | [services/toolFuncs.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js) + [SKILL.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md) |
| 日志 | Winston + 按日期/用户分文件 | [logger.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/logger.js) |

**核心架构**：桌面端 Electron 应用 → 单进程 Express → SQLite 存元数据 + MySQL 查业务数据 → LLM 工具调用链生成 SQL → 用户在 Electron 客户端执行/复制/导出。

---

## 一、`/api/query/generate` 完整流程

入口：[routes/query.js:292](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L292-L550)（共 258 行，0 个空函数/0 个 TODO）

### 1.1 阶段时序图

```
[Client]                  [query.js /generate]              [llm.js]                    [LLM API]
   |                              |                            |                            |
   |-- POST /generate ---------> |                            |                            |
   |   {question, sessionId,     |-- loadSkillMd() --------> |                            |
   |    schemaMode:'stream'}     |   (= SKILL.md 文本)        |                            |
   |                             |-- historyText (last 20)   |                            |
   |                             |-- reqStartTime = Date.now()|                            |
   |                             |                            |                            |
   |                             |--- SSE headers set ------->|                            |
   |                             |   setNoDelay(true)         |                            |
   |                             |                            |                            |
   |                             |-- generateSQLWithStream -> |-- build requestMessages    |
   |                             |                            |   (含 checklist 临时消息)  |
   |                             |                            |-- pruned tools 数组         |
   |                             |                            |                            |
   |<-- data: {type:'chunk'} ---|<-- yield chunk -------------|-- fetch stream ----------->|
   |<-- data: {type:'reasoning'}-|<-- yield reasoning_chunk --|   (T2: 120s 超时)          |
   |<-- data: {type:'usage'} ---|<-- yield usage -------------|                            |
   |<-- data: {type:'tool'} ----|<-- yield tool log ----------|                            |
   |<-- data: {type:'tool_ret'}-|<-- yield tool_return -------|                            |
   |                             |                            |   ┌─ 重复拦截 ──────────┐  |
   |                             |                            |   │  checkAndFilterDup  │  |
   |                             |                            |   │  recordToolCall     │  |
   |                             |                            |   └─────────────────────┘  |
   |                             |                            |                            |
   |<-- data: {type:'done'} ----|<-- yield done --------------|<-- LLM 自然完成/工具拦截 --|
   |   {sql, message,            |   (含 elapsedMs,           |                            |
   |    elapsedMs,               |    userChoiceRequest?)     |                            |
   |    userChoiceRequest?}      |                            |                            |
```

### 1.2 关键阶段详解

| 阶段 | 代码位置 | 行为 | 防御/优化 |
|------|---------|------|---------|
| 鉴权 | [query.js:23](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L23) | `router.use(authRequired)` | JWT + `token_version` 校验 |
| 会话 | [query.js:25-32](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L25-L32) | `ensureSession` / `sessionBelongsToUser` | 防越权访问 |
| 历史加载 | [query.js:331-336](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L331-L336) | 最近 20 条 user/assistant，`ORDER BY id DESC LIMIT 20` + 翻转 | 长对话保留近期上下文 |
| SSE 头 | [query.js:340-345](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L340-L345) | `setNoDelay(true)` 关闭 Nagle | 避免小包攒批顿挫 |
| 整体超时 | [query.js:351-357](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L351-L357) | `OVERALL_TIMEOUT_MS = 5min` | T3 防御 30 轮全超时 |
| 断连保护 | [query.js:359-364](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L359-L364) | `res.on('close') → abort()` | T1 防浪费 token |
| 工具循环 | [llm.js:754-1179](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L754-L1179) | `maxToolCalls ≤ 30` | 防无限循环 |
| 单轮超时 | [llm.js:843-865](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L843-L865) | `withTimeout(signal, 120_000, 'LLM fetch')` | T2 |
| 流中断超时 | [llm.js:882-897](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L882-L897) | `withPromiseTimeout(..., 30_000, 'LLM stream read')` | T4 |
| 工具并行 | [llm.js:1078-1103](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1078-L1103) | `Promise.all` 三阶段 | NEW-6 优化 |
| 工具剪枝 | [llm.js:805-821](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L805-L821) | 已调用过的 `get_domain_index` / `get_sliced_index` 从 tools 数组移除 | prefix cache 友好 |
| 重复拦截 | [llm.js:352-524](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L352-L524) | `checkAndFilterDuplicateCall` 6 种工具全覆盖 | 防 LLM 注意力衰减 |
| 思考剥离 | [llm.js:793-799](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L793-L799) | 只剥"无 tool_calls"的 assistant.reasoning_content | DeepSeek 规则 |
| 用户选项终止 | [llm.js:1144-1229](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1144-L1229) | `pendingUserChoice` 置位 → 跳出循环 → yield done.userChoiceRequest | TURN 1 硬控 |
| DB 持久化 | [query.js:472-494](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L472-L494) | token 统计 + elapsed_ms 写入 messages 表 | 历史回显 |
| 错误兜底 | [query.js:537-549](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L537-L549) | SSE 头已发 → 走 SSE 通道；未发 → 500 JSON | ERR_HTTP_HEADERS_SENT 防御 |

### 1.3 事件协议（SSE chunk 类型）

`generateSQLWithLangChainStreamGen_BAK` 通过 `async function*` 协议 yield 11 种事件，[query.js:381-443](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L381-L443) 翻译为 SSE `data: {json}` 帧：

| 事件 | 出处 | DB 写入 | 前端用途 |
|------|------|---------|---------|
| `chunk` | LLM delta content | 否（合并到 `assistant`） | 助手消息气泡实时增量 |
| `usage` | LLM usage 字段 | ✅ `INSERT messages role='usage'` | token 统计 |
| `reasoning_chunk` | LLM reasoning_content delta | 否 | 思考流式卡片 |
| `message_final` | 启发式剥离 thinking 后修正 | 否 | 修正前端消息气泡 |
| `reasoning_done` | 思考完成 | ✅ `INSERT messages role='LLM'` | 历史回显 |
| `LLM` / `tool` / `tool_return` | 工具调用日志 | ✅ 同 role 写入 messages | 日志卡片 |
| `error` | 异常 | 否 | 错误提示 |
| `done` | 终止事件 | ✅ `INSERT messages role='assistant' + elapsed_ms` | 触发前端 UserChoiceDialog / 收尾 |

**关键设计**：`userChoiceRequest` 通过 `done` 事件字段透传（[query.js:506-510](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L506-L510)），区别于 `confirm_tag_add` 的 regex 解析（[query.js:512-520](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L512-L520)）—— 两种"程序控制"使用不同机制。

---

## 二、LLM 工具调用循环（[llm.js:677-1237](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L677-L1237)）

### 2.1 7 个 LLM 工具

[toolFuncs.js:312-533](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L312-L533) 定义：

| # | 工具 | 关键参数 | 作用 | 调用次数 |
|---|------|---------|------|---------|
| 1 | `get_tables` | 无 | **兜底**返回全部表 | 会话 ≤1 次 |
| 2 | `get_table_schema` | `table_names[]` | 字段别名/枚举/约束/业务规则 | 按需 |
| 3 | `get_table_ddl` | `table_names[], short=0\|1` | DDL（short=0 含索引/外键；short=1 仅列） | 按需 |
| 4 | `request_tag_confirmation` | `term[], table, description` | 术语→表名确认（HTML marker） | 按需 |
| 5 | `request_user_choice` | `question, options, multi_select, header` | **结构化对象** `{id, marker, payload}` | 按需（终止 TURN 1） |
| 6 | `get_domain_index` | 无 | 列出业务域 | 会话 ≤1 次（剪枝） |
| 7 | `get_sliced_index` | `domain_ids[]` | 按域裁剪表池 | 会话 ≤5 次（剪枝） |

**工具顺序硬约束**（[toolFuncs.js:440-484](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L440-L484)）：前 5 个稳定工具位置**严禁变化**——会破坏 DeepSeek prefix cache 命中率（project_memory L98-99）。新增工具必须追加在 `request_user_choice` 之后、`get_domain_index` 之前。

### 2.2 工具调用注册表（[llm.js:248-298](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L248-L298)）

会话级状态机 `sessionToolRegistries: Map<sessionId, ...>`：

```js
{
  getTablesCalled: boolean,
  getDomainIndexCalled: boolean,
  slicedDomains: Set<domainId>,
  tableSchema: Set<tableName>,
  tableDdl: Map<tableName, Set<'short=0'|'short=1'>>,  // (table, short) 组合
  termConfirmed: Set<`${term}::${table}`>,
  userChoiceAsked: Map<id, {question, options, multiSelect, header, signature}>
}
```

**多用户并发安全**：按 `sessionId` 隔离，[llm.js:250-268](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L250-L268) `getOrCreateRegistry` 保证独立 Map。已实测并发测试。

**释放时机**：[llm.js:589-593](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L589-L593) `clearSessionRegistry` 由 [query.js:270](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L270) 在 `DELETE /messages/:sessionId` 时调用。

### 2.3 重复调用拦截策略（[llm.js:352-524](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L352-L524)）

| 工具 | 重复检测粒度 | 重复处理 |
|------|------------|---------|
| `get_tables` | 全局 | **block** + 提示已有 checklist |
| `get_domain_index` | 全局 | **block** |
| `get_sliced_index` | 按 `domain_ids` 集合 | 全重 → block；部分重 → 过滤 + notice |
| `get_table_schema` | 按 `table_names` 集合 | 全重 → block；部分重 → 过滤 |
| `get_table_ddl` | 按 `(table, short)` 组合 | 全重 → block；部分重 → 过滤 |
| `request_tag_confirmation` | 按 `(term, table)` 组合 | 全重 → block；部分重 → 过滤 |
| `request_user_choice` | 按 `(question, options, multi_select)` signature | **block**（不同问题都允许） |

**双重防御**（project_memory L86）：
1. **事前**：[llm.js:308-344](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L308-L344) `buildToolCallChecklistMessage` 临时追加到 `requestMessages` 末尾（不持久化）
2. **事后**：[llm.js:352-524](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L352-L524) `checkAndFilterDuplicateCall` 硬拦截

**checklist 消息不持久化原则**（project_memory L33, L96, L105）：仅在当轮 LLM 请求使用，**绝不 push 到累积 messages 数组**，否则会污染 history / DB / 调试接口 `lastMessages`。
- ✅ 仅追加到 `[...messages, checklistMsg]`（拷贝，不修改原数组）
- ❌ 绝不能 `messages.push(checklistMsg)` 或 `saveMessagesToDb`

### 2.4 Reasoning Content 条件剥离（[llm.js:793-799](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L793-L799)）

**起源**：commit `0b52eca` 2026-07-11 一刀切全剥导致工具调用场景第二轮报 400。

**修复规则**（project_memory L24）：
```js
if (m.role === 'assistant' && m.reasoning_content && !m.tool_calls) {
  const { reasoning_content, ...rest } = m;  // 剥
  return rest;
}
return m;  // 有 tool_calls 必须保留
```

**正确理解**（DeepSeek 官方 thinking_mode 文档）：
- 两个 user 之间**无工具调用** → assistant.reasoning_content 传入 API 也会被忽略
- 两个 user 之间**有工具调用** → assistant.reasoning_content **必须**回传 API，否则 400

### 2.5 工具并行执行（[llm.js:1053-1161](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1053-L1161)）

3 阶段重构（NEW-6 优化）：

| 阶段 | 行为 | 关键设计点 |
|------|------|-----------|
| 阶段 1 | 同步预处理：参数解析 + 重复检查 | 必须在并行前一次性完成，避免"两个相同工具的检查互相穿透" |
| 阶段 2 | `Promise.all` 并行执行 | `await Promise.resolve(p.tool.func(...))` 同时支持同步/异步工具 |
| 阶段 3 | 按原始 tool_calls 顺序写回 messages | 阶段 3 顺序写回保证 LLM 看到 tool 顺序与调用顺序一致 |

**`request_user_choice` 特殊处理**（[llm.js:1087-1102](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1087-L1102)）：返回结构化对象 `{id, marker, payload}`：
- `toolMessageContent = rawResult.marker`（阶段 3 写到 LLM context）
- `userChoiceId = rawResult.id`（写到 registry，保证与 marker 内 id 一致）

**关键 bug 防御**（project_memory L100-101）：必须显式把字段挂到 `execResults` 对象（`{...p, rawResult, toolMessageContent, userChoiceId}`），不能依赖"阶段 3 会想到拆解"。

---

## 三、SKILL.md 规则体系

### 3.1 SKILL.md 演进历史

| 版本 | 时间 | 关键变更 |
|------|------|---------|
| V2.0 | 2026-06-04 之前 | 基础 9 条规则 |
| V2.1 | 2026-06-30 13:45 | 9 条 + "信息已全"判定 4 项 + 工具循环冻结 |
| 当前 | 2026-07-14 | 加入 `request_user_choice` 工具使用规范（[SKILL.md:65-82](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L65-L82)） |

**V2.1 关键改进**（[SKILL.md:30-35](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L30-L35)）："信息已全"判定必须同时满足 4 项：
1. 目标表 DDL
2. 表关联 `virtual_associations`
3. 字段别名/枚举
4. 业务规则

满足 4 项后**禁止重复查表** + **禁止补充工具调用**。

### 3.2 当前 SKILL.md 9 条核心规则

| # | 规则 | 实现位置 |
|---|------|---------|
| 1 | 仅回答 SQL 生成 | system prompt |
| 2 | SELECT/INSERT/UPDATE/DELETE | sqlValidator 白名单（[`/execute` 只允许 SELECT/WITH](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L16)） |
| 3 | **域路由工作流**（get_domain_index → get_sliced_index → get_table_schema/ddl） | tools 工具定义 |
| 4 | 关联表：用 `virtual_associations` 不猜测 | field_config 数据源 |
| 4.1 | `conditional_many_to_one` 关联模式 | field_config 数据源 |
| 5 | 字段名严格来自 DDL；枚举用 CASE WHEN 转换 | 文档规则 |
| 6 | 字段别名含特殊字符必须用反引号 | 文档规则 |
| 7 | MySQL 5.7 限制（禁窗口函数、CTE、JSON_TABLE） | 文档规则 |
| 8 | 歧义处理：调 `request_user_choice` | tools 工具定义 |
| 9 | **【铁律】最终输出前冻结** | tools 工具描述 + SKILL.md 文档 |
| 9.1 | 信息已全判定 4 项 | SKILL.md 文档 |
| 10 | 工具调用前检查（[2026-07-11](file:///c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/20260710/topics.md)） | tools 工具描述 + checklist |

### 3.3 Skill 数据资产（[skills/sql-creator-skill-v2/](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/)）

```
sql-creator-skill-v2/
├── SKILL.md (9 规则体系)
├── table_index.json         (107+ 表的索引)
├── domain_router_index.json (10 业务域)
├── domains/                  (10 个 {id}.json 列各自包含的表名)
├── field_config/             (107 个 {table}.json 含别名/枚举/虚拟关联/业务规则)
├── ddl/                      (107 个 {table}.sql DDL 完整定义)
├── docs/
│   ├── mysql57_limits.md
│   └── table_index文档说明.md
└── templates/                (输出格式模板)
```

**域路由设计**（[domain_router_index.json](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/domain_router_index.json)）：10 个业务域（people/department/permission/campus/course/product/finance/activity/crm/study_abroad）。

**Skill 文件缓存**（[skillCache.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/skillCache.js)）：fs.watch 300ms 防抖 + mtime 兜底 + 显式失效（PERF-5 修复）。

**字段实时读取**（[toolFuncs.js:15-22](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L15-L22)）：每次工具调用都重新读盘，**不缓存**——用户要求"读取文件必须是实时读取最新的"（project_memory L15）。已用 `fs.promises.readFile` 异步化（PERF-7 修复）。

---

## 四、关键配套服务

### 4.1 SQL 校验器 [sqlValidator.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js)

**两阶段校验**（SEC-1 修复后）：
- **阶段 1**（[stripSqlComments](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js#L104-L231)）：单遍字符级状态机
  - 拒绝 MySQL 条件注释 `/*! ... */` 和 `/*!12345 ... */`（一发现短路）
  - 字符串/双引号/反引号内字符原样保留
  - `--` 行注释必须后跟空白或行尾（避免误伤 `SELECT -1`）
  - 未闭合块注释/字符串/反引号返回 `INVALID_SQL`
- **阶段 2**（[validateStructure](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js#L254-L296)）：长度/多语句/前缀/危险函数
  - 危险函数黑名单：[`INTO OUTFILE` / `SLEEP` / `BENCHMARK` / `LOAD_FILE` / `GET_LOCK` / `USER()` 等 8 类](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js#L75-L84)
  - 多语句检测：剩余分号 → 拒绝

**两个调用方**：
- `/execute`（[query.js:641](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L641)）：`allowedPrefixes: ['SELECT', 'WITH']`
- `/explain`（[query.js:703](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L703)）：`allowedPrefixes: ['SELECT', 'WITH', 'EXPLAIN']`

**测试覆盖**（`test-sql-validator.mjs`）：86/86 通过。

### 4.2 数据库层 [db/sqlite.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js)

**7 张表**：
- `users`（id, username, password_hash, display_name, role, token_version）
- `sessions`（id, name, sort_order, user_id, total_tokens, summary）
- `messages`（id, session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, **elapsed_ms**）
- `configs`（key-value 配置：db_config / llm_config / agent_* / jwt_secret）
- `table_schemas`（自动同步的表元数据）
- `llm_messages`（session_id → JSON 完整 messages blob，含 message_tokens）
- `skill_logs`（operation 审计）
- `my_queries`（我的查询收藏，UNIQUE(user_id, sql_output)）

**Schema 迁移**（[addColumnIfMissing](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L42-L55)）：先用 `PRAGMA table_info` 检查列是否存在；存在静默，不存在才 ALTER；ALTER 失败抛错。**替代旧 try/catch 模式**（CODE-3 修复）——避免静默吞掉磁盘满/权限错等真错误。

**会话级索引**（[sqlite.js:191-208](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L191-L208)）：`idx_messages_session_role` / `idx_sessions_user_id` / `idx_llm_messages_session_id` 等 6 个索引。

**JWT 密钥懒求值**（[auth.js:11-38](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js#L11-L38)）：不在模块加载时 `getJwtSecret()`，第一次 signToken/verifyToken 时才求值——避免 `getDb()` 抛错。

### 4.3 鉴权 [auth.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js)

**JWT 提取**（[auth.js:94-106](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js#L94-L106)）：`Authorization: Bearer xxx` 或 httpOnly Cookie `xtsql_auth`。
**格式预校验**（[auth.js:92](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js#L92)）：`/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/` 三段 base64url 预校验 → 减少垃圾 token 触发 jwt.verify 消耗 CPU。

**token_version 吊销**（[auth.js:124-127](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js#L124-L127)）：登出/改密时 `token_version++`，下次请求 token 内 `tv` 字段对不上 → 401。

**限流分层**（[rateLimit.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/middleware/rateLimit.js)）：
- 写操作（`/login` `/register` `/change-password`）：`authRateLimiter` 10/小时
- 读操作（`/me` `/logout`）：`authMeRateLimiter` 100/小时（避免页面刷新被误踢）

### 4.4 日志系统 [logger.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/logger.js)

**DailyFileTransport**（[logger.js:22-69](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/logger.js#L22-L69)）：每天子目录 `logs/YYYY-MM-DD/{filename}.log`，跨天自动切流。

**用户分文件**（project_memory L25，2026-07-13 重构）：
- `logs/YYYY-MM-DD/{username}_llm.log`（LLM 流量）
- `logs/YYYY-MM-DD/_system_app.log` / `_system_error.log`（系统级）
- `logs/YYYY-MM-DD/_system_llm.log`（username 缺失的 LLM 兜底）

**username 注入链**：`query.js` → `llm.js:678` → `queueLog(content, immediate, username)` → `LOG_BUFFER` 按用户分组聚合 → `writeLlmLog` → 落盘。

---

## 五、已发现的问题与建议

> 基于最近 5 次会话（2026-07-10 ~ 2026-07-14）+ 当前代码静态分析。

### 🟢 P3 代码质量（不阻塞，但建议跟踪）

#### Q-1: `routes/query.js` 中 `loadSkillV2` / `loadFieldConfig` / `matchTables` / `buildSchemaFromSkillV2` 死代码

**文件**：[query.js:39-197](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L39-L197)（约 160 行）
**状态**：未引用，但保留运行（`loadSkillV2()` 启动调用一次；`loadFieldConfig` 完全未被调用）。

**问题**：
- `loadSkillV2` 在 [query.js:199](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L199) 启动时调用，更新 `cachedSkill.version` 用于 [query.js:201-208](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L201-L208) `GET /version` 端点
- `cachedSkill.tableIndex` 通过 `loadSkillV2` 加载，但实际 `/generate` 走 `toolFuncs.loadTableIndex()`（每次都重新读盘）
- `loadFieldConfig` / `matchTables` / `buildSchemaFromSkillV2` **完全未被任何代码引用**

**建议**：
- 保留 `loadSkillV2`（用于 `/version` 端点 + 启动期加载验证）
- 删除 `loadFieldConfig` / `matchTables` / `buildSchemaFromSkillV2`（约 100 行死代码）
- 清理后 `cachedSkill` 简化为只存 `{version, md5, lastLoad}`

**预计收益**：~100 行代码，可读性 ↑

#### Q-2: `routes/skill.js` 中 `loadTableIndex` 同步缓存模式

**文件**：[skill.js:316-331](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L316-L331)

```js
let tableIndexCache = null;
function loadTableIndex() {
  if (tableIndexCache) return tableIndexCache;
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  if (fs.existsSync(tableIndexPath)) {
    tableIndexCache = JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  }
  return tableIndexCache;
}
```

**问题**：
- `fs.readFileSync` 同步阻塞（虽然只在 cache miss 时执行）
- 写操作（[skill.js:327-330](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L327-L330) `saveTableIndex`）有 `tableIndexCache = data`，但 `add-tag` / `save` 路由调 `invalidateAfterWrite()`（[skill.js:219](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L219)）只清 Skill 树缓存，**不清 tableIndexCache**

**建议**：
- 复用 [skillCache.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/skillCache.js) 模式（fs.watch + 显式失效）
- 或在 `add-tag` / `save` 路由显式 `tableIndexCache = null`

#### Q-3: `services/llm.js` 中 `lastMessages` 全局变量仍是安全隐患

**文件**：[llm.js:236-240](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L236-L240)

**现状**：
```js
let lastMessages = null;
export function getLastMessages() {
  return lastMessages;
}
```

注释明确说明"任何调用方都会拿到最后一个提问者的内容"。已被标记"前端未调用保留供开发调试"。

**建议**：
- 加环境变量 gate：`process.env.NODE_ENV === 'production'` 时 `getLastMessages()` 返回 null
- 或在 dev 模式下也禁用该路由（[query.js:213-228](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L213-L228) `GET /messages`）

#### Q-4: `query.js` 中 `callLLM` 死函数

**文件**：[query.js:552-625](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L552-L625)（约 74 行）

**问题**：4 个 provider 实现 + Promise.race 超时封装，**从未被任何代码调用**（已记入 [CODE_REVIEW_2026-06-20 DEAD-01](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/reviews/CODE_REVIEW_2026-06-20.md#L267-L274) 但未执行删除）。

**建议**：直接删除整段。

#### Q-5: `service/llm.js` `_BAK` 后缀函数名仍在用

**文件**：[llm.js:677](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L677)

```js
export async function* generateSQLWithLangChainStreamGen_BAK(...) { ... }
```

**现状**：这是当前在用的实现，但 `_BAK` 后缀引起新成员困惑（[CODE_REVIEW_2026-06-20 DEAD-08](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/reviews/CODE_REVIEW_2026-06-20.md#L590-L601)）。

**建议**：重命名为 `generateSQLWithLangChainStreamGen`（同时清理 [llm.js:1241](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1241) "已废弃"注释指向不存在的函数名的问题）。

#### Q-6: `db/sqlite.js` 启动 `console.log` 散落

**文件**：[sqlite.js:232](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L232)、[sqlite.js:254](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L254)

**现状**：
```js
console.log('SQLite initialized');  // 没走 winston
console.log('Skill logs table initialized');
```

**说明**（DEAD-09）：Electron 用 stdout 文本匹配做就绪信号时兼容，但**生产模式应走 logger**。

**建议**：
- `console.log` 改为 `logger.info`（同时保留 stdout 输出，Electron 能匹配）
- 或在 production 模式改用 logger

#### Q-7: `historyText` 死代码（user-confirmed）⏸️ 已临时禁用

**文件**：[query.js:325-339](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L325-L339) + [llm.js:683](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L683)

**问题**：
`query.js` 装载最近 20 条 user/assistant 消息 → `historyText` → 传给 `llm.js:683 generateSQLWithLangChainStreamGen_BAK(question, historyText, ...)`。但 `grep historyText llm.js` **命中 0 次**——形参 `history` 在函数体内**仅 L684 写日志**，从未被消费。

**真实 LLM context 来源**：`llm_messages.messages` JSON blob（[llm.js:716](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L716) `loadMessagesFromDb`），由 [llm.js:1050](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1050) `saveMessagesToDb` 每轮响应后序列化。

**误导性**：
- 维护者误以为"历史的 SQL 也参与 LLM context"
- 实际只有 `llm_messages.messages` 中的 `assistant` 完整 content（含推理/工具调用链）才会

**已实施动作**（2026-07-15，DESIGN-FROZEN）：
```js
// [DEAD-CODE 2026-07-15] 保留代码 + 临时禁用入口
if (false && sessionId) {  // ← if (false && ...) 阻止执行
  // ... 原始 historyText 装载逻辑
}
```

**为什么用 `if (false && ...)` 而非删除**：
- 保留代码 + 注释 = 未来恢复时无需 Git blame / git revert
- `if (false && ...)` = 运行时不执行，避免无谓 SQL 查询
- 注释中明确"恢复方法"——新成员能立即理解

**完整方案与决策树**：见 [2026-07-15-historyText-deadcode-perf6-plan.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-07-15-historyText-deadcode-perf6-plan.md)

**触发恢复使用的场景**：
- 工具调用审计（token 成本分析）
- 摘要压缩（V4-Flash 1M context 撑不住时）
- 双上下文设计（messages 表展示 + llm_messages LLM context）

**当前状态**：⏸️ 临时禁用，按用户要求"日后需要时再改"。

### 🟢 P3 性能（建议持续观察）

#### P-1: `tokenizer.js` 加载逻辑在模块顶层

**文件**：[tokenizer.js:8-29](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/tokenizer.js#L8-L29)

**问题**：
- `fs.readFileSync(tokenizerPath, 'utf-8')` 在模块加载时同步执行
- 加载失败时仅 `console.warn`，fallback 到 `simpleTokenCount`（粗略计数）
- 无延迟加载机制（首次 `countTokens()` 才需要 vocab/merges）

**建议**：改为按需加载（首次调用 `countTokens` 时检查 `vocab === null` 再加载）。

#### P-2: `routes/config.js` `/test` 端点每次新建连接

**文件**：[config.js:14-28](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/config.js#L14-L28)

```js
router.post('/test', adminRequired, async (req, res) => {
  const connection = await mysql.default.createConnection({...});
  await connection.end();
});
```

**问题**：每次点击"测试连接"都新建连接（不像 [mysqlPool.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/mysqlPool.js) 复用池）。

**建议**：改为 `const pool = mysql.createPool({...}); const conn = await pool.getConnection(); conn.release(); pool.end();` 或直接复用 `getPool()`（如果配置已存在）。

#### P-3: `routes/skill.js` `loadTableIndex` 同步缓存 + `fs.readFileSync`（见 Q-2）

#### P-4: PERF-6 `saveMessagesToDb` 全量 JSON 序列化 ⏸️ DESIGN-FROZEN

**文件**：[llm.js:634-654](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L634-L654) `saveMessagesToDb`、调用点 [llm.js:1050](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1050) + [llm.js:1192](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1192)

**现状**：
| 指标 | 数值 |
|------|------|
| 写入次数 | 30 轮对话 → **30 次** `saveMessagesToDb` |
| 每次写入字节 | 第 N 轮写 ≈ N × 5KB（messages 数组持续增长）|
| 30 轮累计 IO | **~750KB** |
| 典型场景影响 | 桌面单用户 → 实际**几乎无感** |
| 触发优化场景 | web 多用户并发 / 500 轮级长对话 |

**三个方案对比**（完整方案见 [2026-07-15-historyText-deadcode-perf6-plan.md §3](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-07-15-historyText-deadcode-perf6-plan.md#3-perf-6-llm_messages-json-序列化优化)）：

| 维度 | 方案 A（去重）| 方案 B（增量）| 方案 C（混合）|
|------|-------------|-------------|-------------|
| 写入次数 | **1 次** ✅ | 30 次 | 1-6 次 |
| 写入字节 | 150KB | **30KB** ✅ | 100-150KB |
| 改动量 | **5 行** ✅ | 50 行 | 30 行 |
| 兼容性 | **完全兼容** ✅ | 需迁移 | 完全兼容 |
| 风险 | 进程崩溃丢 1 轮 | 顺序错位 | 复杂度↑ |
| 实施难度 | **10 分钟** | 1-2 小时 | 30 分钟 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

**推荐方案 A（去重中间轮写入）**：
1. 删除 [llm.js:1048-1051](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1048-L1051) 中间轮 `saveMessagesToDb` 调用
2. 在 [llm.js:1232-1236](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1232-L1236) 终态 `yield done` 之前新增 `saveMessagesToDb`
3. 异常 yield error 路径也持久化
4. 保留 [llm.js:1192](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1192) `user_choice` 终止路径的 `saveMessagesToDb`（TURN 1 终止边界必写）

**触发条件**（决策树）：
- 用户反馈"长对话慢" 或 "切会话慢" → 实施 方案 A
- 500 轮级会话触发 context 警告 → 同步实施 方案 A + 方案 B
- 仅触发现象"web 部署" → 暂不优化（先压测定位瓶颈）

**当前状态**：⏸️ DESIGN-FROZEN，按用户要求"日后需要时再改"。

### 🟢 P3 安全

#### S-1: 错误响应仍可能泄露内部细节

**文件**：[auth.js:48](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L48)、[auth.js:80](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L80) 等

**现状**：
```js
res.status(500).json({ error: '注册失败: ' + e.message });
```

**问题**：例如 bcrypt 失败会泄露 `"bcrypt.hash failed: ... internal error"`；MySQL 失败会泄露表名/列名。

**建议**：
- 通用 catch 返回 `'操作失败'`
- 详细错误仅 `logger.error` 记录
- 已在 BUG-11 修复过 HTTP 状态码，但消息内容仍需统一

#### S-2: `/api/query/messages` 调试接口 + `/api/auth/login` 等仍可枚举用户名

**文件**：[query.js:213-228](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L213-L228)、[auth.js:65](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L65)

**问题**：
- `GET /api/query/messages` 返回进程级全局消息（见 Q-3）
- `POST /api/auth/login` 返回 `'用户名或密码错误'` 而非 `'用户名不存在'`（**OK**），但 `register` 端点（[auth.js:27-29](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L27-L29)）返回 `'用户名已被占用'` 泄露用户存在性

**建议**：
- `register` 端点：返回 `'注册失败'` + `logger.warn('username exists')`
- `GET /api/query/messages` 加 admin gate 或环境变量 gate

---

## 六、整体健康度评分

| 维度 | 评分 | 评价 |
|------|------|------|
| 架构设计 | ⭐⭐⭐⭐⭐ | 域路由 + 工具调用 + 9 规则体系设计精巧 |
| 代码质量 | ⭐⭐⭐⭐ | 高度模块化，但残留 ~250 行死代码未清理（Q-1/4/5） |
| 测试覆盖 | ⭐⭐⭐⭐ | sqlValidator 86/86、skillCache 10/10、timeout 14/14；但 E2E 覆盖较少 |
| 文档规范 | ⭐⭐⭐⭐⭐ | project_memory.md + 12 份 spec/plan 文档 + 2 份 review 文档 |
| 安全防御 | ⭐⭐⭐⭐ | JWT+token_version+rate limit+sql 校验齐全；仍有小漏（S-1/2） |
| 性能优化 | ⭐⭐⭐⭐ | 三层超时+工具并行+剪枝+实时读取；BPE 仍同步阻塞（P-1） |
| 错误处理 | ⭐⭐⭐ | HTTP 状态码已统一（BUG-11），错误消息仍可能泄露（S-1） |
| 可维护性 | ⭐⭐⭐⭐ | 模块边界清晰；`_BAK` 后缀/死函数拖累新成员认知 |

**总评**：⭐⭐⭐⭐（4.0/5）—— 经过 2026-06-20 / 06-26 / 06-30 / 07-13 多轮迭代，核心架构已稳定。建议在最近的 request_user_choice 功能上线后清理残留技术债（Q-1/2/3/4/5）。

---

## 七、问题优先级汇总

| 优先级 | 编号 | 问题 | 影响 | 建议工作量 | 文件 |
|--------|------|------|------|-----------|------|
| 🟢 P3 | Q-1 | `query.js` 中死代码（loadFieldConfig/matchTables/buildSchemaFromSkillV2） | 可读性 | 10 分钟 | [query.js:83-197](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L83-L197) |
| 🟢 P3 | Q-2 | `skill.js` loadTableIndex 同步缓存+失效不全 | 写后旧缓存 | 15 分钟 | [skill.js:316-331](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L316-L331) |
| 🟢 P3 | Q-3 | `lastMessages` 全局变量安全隐患 | 跨用户信息泄露（仅 dev） | 5 分钟 | [llm.js:236-240](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L236-L240) |
| 🟢 P3 | Q-4 | `query.js` 中 `callLLM` 死函数（74 行） | 死代码 | 2 分钟 | [query.js:552-625](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L552-L625) |
| 🟢 P3 | Q-5 | `generateSQLWithLangChainStreamGen_BAK` 重命名 | 命名误导 | 5 分钟 | [llm.js:677](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L677) |
| 🟢 P3 | Q-6 | `sqlite.js` 启动 `console.log` 未走 logger | 日志统一性 | 5 分钟 | [sqlite.js:232](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L232) |
| 🟢 P3 | Q-7 | `historyText` 死代码（user-confirmed）| 误导性 + 无谓 SQL | 注释+禁用 已完成 | [query.js:325-339](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L325-L339) / [llm.js:683](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L683) |
| 🟢 P3 | P-1 | `tokenizer.js` 顶层同步加载 | 启动慢 | 10 分钟 | [tokenizer.js:8-29](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/tokenizer.js#L8-L29) |
| 🟢 P3 | P-2 | `config.js /test` 不复用连接池 | 慢 | 5 分钟 | [config.js:14-28](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/config.js#L14-L28) |
| 🟢 P3 | P-4 | PERF-6 `saveMessagesToDb` 全量序列化 | 30 轮 → 1 次写 | DESIGN-FROZEN 10 分钟（方案 A）| [llm.js:634-654](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L634-L654) |
| 🟢 P3 | S-1 | catch 块错误信息泄露 | 信息泄露 | 20 分钟 | [auth.js:48,80,127](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L48) 等 |
| 🟢 P3 | S-2 | `/api/auth/register` 用户名枚举 | 用户名枚举 | 5 分钟 | [auth.js:27-29](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/auth.js#L27-L29) |

**总预估**：~80 分钟（一次清理可解决 80%）。其中 Q-7 / P-4 已**临时禁用/DESIGN-FROZEN**，按用户要求"日后需要时再改"。

**关联设计文档**：[2026-07-15-historyText-deadcode-perf6-plan.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-07-15-historyText-deadcode-perf6-plan.md)

---

## 八、值得肯定的设计（Best Practices）

| 实践 | 文件 | 价值 |
|------|------|------|
| 三层超时（T1/T2/T3/T4）| [llm.js:66-157](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L66-L157) + [query.js:351-364](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L351-L364) | 防御 LLM API 挂起的 4 种边界场景 |
| 工具调用注册表（按 session 隔离）| [llm.js:248-524](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L248-L524) | 解决 LLM 长上下文注意力衰减 |
| 工具并行 3 阶段重构 | [llm.js:1053-1161](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1053-L1161) | 3 个 get_table_schema 从 900ms 降到 300ms |
| 工具剪枝（保护 prefix cache）| [llm.js:805-821](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L805-L821) | 每轮节省 ~120 tokens |
| Reasoning content 条件剥离 | [llm.js:793-799](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L793-L799) | 修复多轮 tool_call 链断裂 |
| checklist 不持久化原则 | [llm.js:793](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L793) | 防 history 污染 |
| 域路由工作流 | [SKILL.md:9-15](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L9-L15) | 107 表场景下精准定位 |
| request_user_choice 终止边界 | [llm.js:1144-1229](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1144-L1229) | 程序硬控 + 事件字段透传 |
| MySQL 条件注释拒绝 | [sqlValidator.js:118-125](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js#L118-L125) | 堵住 SQL 注入边界绕过 |
| 路径安全检查（双重防御）| [skill.js:47-55](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L47-L55) + [skill.js:379-388](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L379-L388) | 防御 `../` 跳出 + SQL 注入 |
| Skill 文件实时读取 | [toolFuncs.js:15-22](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L15-L22) | schema 重建/标签修改立即生效 |
| elapsedMs 后端权威时间 | [query.js:309,469-503](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L309) | 历史回显与实时态一致 |
| 用户/系统日志分离 | [logger.js:85-87](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/logger.js#L85-L87) + [llm.js:42-49](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L42-L49) | 多用户 web 部署时日志可追溯 |
| getDb 纯 getter + init 职责分离 | [sqlite.js:25-30](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L25-L30) | 消除竞态条件 |
| ensureDir 区分 EEXIST vs 真错误 | [utils/fs.js:18-29](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/utils/fs.js#L18-L29) | 启动期 fail-fast |
| JWT 懒求值 | [auth.js:11-38](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/auth.js#L11-L38) | 与 getDb 初始化顺序解耦 |

---

## 九、与历史 review 的关系

| 历史 review | 状态 | 本报告位置 |
|------------|------|-----------|
| [CODE_REVIEW_2026-06-20](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/reviews/CODE_REVIEW_2026-06-20.md) | 35 个问题中已修 8 个（P0 全部） | Q-4（DEAD-01）/ Q-5（DEAD-08）仍未修 |
| [CODE_REVIEW_2026-06-26](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/reviews/CODE_REVIEW_2026-06-26.md) | 22/29 已修（含 ⏸️ 不修 4 项） | Q-1 部分残留（DEAD-02 loadFieldConfig/matchTables/buildSchemaFromSkillV2） |
| [2026-07-13 request_user_choice 实施](file:///d:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/20260713/topics.md) | 已完成 TURN 1 终止 + checklist + 工具并行 | 第二节 2.5 / 第三节 3.1 涵盖 |

---

## 十、验证建议

- **运行 `node --check` 全部后端文件**：保证 ESM 语法
- **运行 `test-llm-timeout.mjs` (14)** + **`test-skill-cache.mjs` (10)** + **`test-sql-validator.mjs` (86)** + **`test-fs-utils.mjs` (13)** = 123 条测试
- **运行 `test-e2e-domain-api.mjs` / `test-skill-domains.mjs` / `test-rate-limit.mjs` / `test-favorite-query.mjs`**：E2E + 集成测试
- **实际场景**：
  - 单会话多轮（30 轮）— 验证 maxToolCalls 边界
  - 跨用户并发（5 用户同时 generate）— 验证 sessionToolRegistries 隔离
  - 客户端断连（生成中途关闭）— 验证 T1 abort 生效
  - 慢 LLM（人工 mock 60s 响应）— 验证 T2/T3 不会无限等

---

## 📌 总结

**`/generate` 接口当前实现**：
- ✅ 核心设计完善：SSE 协议、工具循环、3 层超时、注册表、checklist、剪枝、并行、reasoning 剥离、user_choice 终止边界
- ✅ 安全防御：JWT、token_version、rate limit、SQL 校验（两阶段）、路径安全、白名单
- ✅ 性能优化：异步 IO、连接池、并行执行、mtime 兜底、prefix cache 友好
- ⚠️ 技术债：~250 行死代码（Q-1/4/5）、1 处缓存失效不全（Q-2）、1 处用户枚举（S-2）
- 📈 建议：趁 request_user_choice 功能刚上线、单元测试完备，下一轮迭代集中清理 Q-1 ~ Q-6（80 分钟工作量），使代码干净度达到 4.5/5。

**本轮新增发现（2026-07-15 复审）**：
- Q-7 historyText 死代码（user-confirmed）—— 已临时禁用（query.js:325-339 if (false && ...)），完整方案见 plan §2
- P-4 PERF-6 saveMessagesToDb 全量序列化 —— DESIGN-FROZEN（待触发），三方案对比见 plan §3

**最终问题统计**：
- 总问题数：12（原 10 + Q-7 + P-4）
- 临时禁用/DESIGN-FROZEN：2（Q-7 / P-4）
- 待清理：10（Q-1/2/3/4/5/6 + P-1/2/3 + S-1/2），预估 80 分钟

---

> 🤖 Generated with [Trae IDE](https://trae.ai) (MiniMax-M3)
> **生成日期**: 2026-07-15
> **最后更新**: 2026-07-15（追加 Q-7 / P-4 + plan 文档）
> **配套文档**：
> - [project_memory.md](file:///c:/Users/wusiq/.trae-cn/memory/projects/-d-Ai-Program-Files-XTSQLQueryAgent/project_memory.md)
> - [CODE_REVIEW_2026-06-26.md](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/reviews/CODE_REVIEW_2026-06-26.md)
> - [2026-07-13 request_user_choice spec](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/specs/2026-07-13-request-user-choice-tool.md)
> - [2026-07-15 historyText + PERF-6 plan](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-07-15-historyText-deadcode-perf6-plan.md)

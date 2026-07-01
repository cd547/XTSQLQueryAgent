# 我的查询 - 收藏常用 SQL 功能设计

> **设计日期**: 2026-07-01
> **关联 plan**: [2026-07-01-favorite-query.md](../plans/2026-07-01-favorite-query.md)
> **关联功能**: 新会话建议 [2026-07-01-new-session-suggestions.md](2026-07-01-new-session-suggestions.md)

## 概述

为完成"对话 → SQL"的最后一公里增加**收藏能力**：用户在一轮对话结束后，可将本次 SQL 收藏到"我的查询"。系统会调用 LLM 对原始提问做一次文字优化（生成 ≤30 字的精炼标题），并通过表名反查识别出该 SQL 涉及的业务域，落地到 `my_queries` 表。已收藏的 SQL 在新会话页面上以**随机建议**的形式被复用（详见 [new-session-suggestions](2026-07-01-new-session-suggestions.md)）。

## 背景

### 现状痛点
- 用户经常重复提类似问题（如"统计订单"、"分析近 30 天趋势"），但每次都要重新写提问
- 当前新会话的 4 个推荐是写死的（"查询 2024 年的销售额"等），与用户实际工作场景无关
- 已生成的优质 SQL 没有沉淀机制

### 设计目标
- 沉淀用户认可的高质量 SQL
- 沉淀时不只是简单存储，而是通过 LLM 优化标题，便于后续检索
- 与业务域体系打通，收藏时识别涉及的域，便于后续域级 prompt 优化
- 已收藏的 SQL 反哺新会话页面，形成"使用 → 收藏 → 推荐"闭环

## 关键决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 触发时机 | 一轮完整对话结束、有最终 SQL 时 | 用户已经验证过 SQL 可用 |
| 2 | 按钮位置 | 放在"复制到 SQL 查询"**左边**，不遮挡计时 | UI 排列顺序与现有风格一致 |
| 3 | 优化范围 | **只优化 userQuestion**，不动 SQL | SQL 是用户验证过的成品，不应被改写 |
| 4 | LLM 强制指定 | `FAVORITE_LLM_MODEL` 或 `deepseek-chat` | 与"调用快速模型"分流，避免占用业务主链路模型 |
| 5 | 业务域识别方式 | LLM 提取 `table_names` → `getDomainsForTables` 反查 | 复用现有反查索引（5s 缓存） |
| 6 | 表名匹配回退 | LLM 提取失败 / 表不在任何域 | 业务域字段允许空数组 |
| 7 | 去重策略 | `UNIQUE(user_id, sql_output)`，ON CONFLICT DO UPDATE | 同 SQL 重复收藏不报错，更新优化标题与业务域 |
| 8 | 失败行为 | LLM 失败抛 500，前端 toast 报错 | 不允许"静默失败"——用户已点击按钮应拿到反馈 |
| 9 | 取消收藏 | 按 `user_id + sql_output` 删除 | 简单明确 |
| 10 | 收藏状态回显 | 加载历史消息时批量查 `/favorites/check` | 1 次请求完成所有消息的收藏状态回显 |

## 数据模型

### my_queries 表

```sql
CREATE TABLE IF NOT EXISTS my_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_question TEXT NOT NULL,           -- 用户原始提问
  optimized_question TEXT,               -- LLM 优化后的标题（≤30字）
  sql_output TEXT NOT NULL,              -- 收藏的 SQL
  business_domains TEXT NOT NULL DEFAULT '[]',  -- JSON 数组，如 ["finance", "course"]
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, sql_output),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_my_queries_user ON my_queries(user_id);
```

### 关键约束
- `UNIQUE(user_id, sql_output)`：同一用户的同一 SQL 只存一条
- `ON CONFLICT(user_id, sql_output) DO UPDATE`：重复收藏时更新 `optimized_question` / `business_domains` / `updated_at`
- 不删除原有记录，只更新字段

## 接口设计

### 1. POST /api/queries/favorite

**鉴权**：必须登录

**Request**:
```json
{
  "userQuestion": "全部课程今日课表",
  "sqlOutput": "SELECT ... FROM edu_study WHERE ..."
}
```

**Response 200**:
```json
{
  "success": true,
  "id": 42,
  "optimizedQuestion": "今日课表",
  "businessDomains": ["course"]
}
```

**Response 500**: LLM 失败 / 业务域反查异常
```json
{
  "success": false,
  "code": "FAVORITE_FAILED",
  "message": "..."
}
```

**处理流程**：
1. 入参校验：`userQuestion` / `sqlOutput` 非空
2. 调用 `callLlmForFavorite`（强制使用 `FAVORITE_LLM_MODEL` 或 `deepseek-chat`）
3. 解析 LLM 输出，提取 `optimized_question`（≤30字）和 `table_names`（数组）
4. `getDomainsForTables(tableNames)` 反查业务域
5. 写入 / 更新 `my_queries` 表

### 2. POST /api/queries/favorites/check

**鉴权**：必须登录

**Request**:
```json
{
  "sqlOutputs": [
    "SELECT ...",
    "SELECT ...",
    ""
  ]
}
```

**Response 200**:
```json
{
  "success": true,
  "favorites": {
    "SELECT ...": { "id": 1, "optimizedQuestion": "...", "businessDomains": [...] },
    "SELECT ...": { "id": 5, "optimizedQuestion": "...", "businessDomains": [...] }
  }
}
```

**用途**：前端加载历史消息时，批量查询每条消息是否已收藏、收藏的优化标题。

**实现细节**：空字符串自动过滤、SQL 字符串 trim、返回 Map 而非数组便于 O(1) 查询。

### 3. DELETE /api/queries/favorite

**鉴权**：必须登录

**Request**:
```json
{
  "sqlOutput": "SELECT ..."
}
```

**Response 200**:
```json
{ "success": true, "deleted": true }
```

`deleted: false` 表示记录不存在（idempotent）。

### 4. GET /api/queries/suggestions

**鉴权**：必须登录

**Query**: `count=4`（默认 4，范围 1-20）

**Response 200**:
```json
{
  "success": true,
  "suggestions": ["今日课表", "Top10 销售", "退款订单", "..."]
}
```

**数据源**：admin 跨所有用户随机；普通用户仅自己。优先 `optimized_question`，缺失回退 `user_question`。详见 [new-session-suggestions spec](2026-07-01-new-session-suggestions.md)。

## LLM 交互设计

### Prompt 设计

```
你是一名 SQL 收藏助手。基于用户的提问和最终执行的 SQL，完成两件事：

1. 把用户提问改写成一个简洁、检索友好、不超过 30 字的标题（避免出现 SQL 关键字、列名细节）。
2. 提取 SQL 中涉及的表名（用于业务域识别）。

只输出 JSON，格式：
{ "optimized_question": "≤30字标题", "table_names": ["table1", "table2"] }
```

### 模型选择
- 强制使用 `process.env.FAVORITE_LLM_MODEL || 'deepseek-chat'`
- **不**走 `process.env.LLM_MODEL` 业务主链路模型
- 原因：收藏功能可容忍更高延迟（2-3s），无需占用业务模型配额

### 输出解析
- 容忍 ```json ... ``` 围栏
- 容忍多余文本，找到首个 `{` 和最后一个 `}` 截取
- 解析失败抛 500

### 超时
- 复用现有 `withTimeout` / `withPromiseTimeout` 工具
- 默认 120s 单次超时（收藏 LLM 不是主链路，可以容忍）

## 业务域反查

### 复用 `getDomainsForTables`
- 现有 `services/skillDomains.js` 提供此函数
- 5s 内存缓存（invalidateReverseIndex 用于强制刷新）
- 输入：`table_names: string[]`
- 输出：去重后的 `domainId[]`

### 异常处理
- 表名非法 / 路径越界 → 业务域返空数组（**不抛错**）
- `domain_router_index.json` 缺失 → 业务域返空数组（**不抛错**）
- 写表不阻塞主流程

## 前端设计

### 按钮位置

```
⏱ 耗时 3.2s   [ ⭐ 收藏为常用SQL ]   [ 📋 复制到SQL查询 ]   [ ⚡ 复制并执行 ]
              └─ loading 时 spinner  └─ 点击后变"已收藏"disabled
```

### 状态机
- `idle` → 初始态
- `loading` → 调接口中，按钮显示 spinner + 不可点击
- `done` → 已收藏，图标变金色 + 文字变"已收藏"，可点击触发取消
- `done` 状态点击 → 调 `unfavoriteQuery` → 回到 `idle`

### 状态回显
- `loadMessages` 完成后调 `hydrateFavoriteStates(messages)`
- 内部批量查 `/favorites/check`，按 `sqlOutput` 匹配每条消息的 `favoriteState`
- 去重 + Map 避免重复 setState

### 失败 UX
- LLM 失败 → `message.error('收藏失败')`（不弹具体错误，避免打扰）
- 取消失败 → 保持 `done` 状态（不重置，避免误显示未收藏）

## 涉及文件

| 文件 | 变更 |
|------|------|
| `backend/src/db/sqlite.js` | 修改：新增 `my_queries` 表 + 索引 |
| `backend/src/services/llm.js` | 修改：新增 `callLlmForFavorite` + LLM 日志 |
| `backend/src/services/favoriteQuery.js` | 新建：核心服务 |
| `backend/src/routes/favoriteQuery.js` | 新建：4 个 API 路由 |
| `backend/src/index.js` | 修改：注册路由 |
| `frontend/src/api/index.js` | 修改：4 个 API 封装 |
| `frontend/src/components/ChatMessage.jsx` | 修改：新增"收藏"按钮 + 状态机 |
| `frontend/src/App.jsx` | 修改：state + handler + 回显 |
| `backend/test-favorite-query.mjs` | 新建：74 条单元测试 |

## 测试覆盖

| 类别 | 条数 | 覆盖点 |
|------|------|--------|
| A. extractJsonObject | 8 | 边界、围栏、空输入、嵌套 |
| B. 业务域反查 | 8 | 单表、多表、表名带反引号、缓存命中 |
| C. saveFavoriteQuery | 23 | 正常 / LLM 失败 / 重复 ON CONFLICT / 业务域空 |
| D. checkFavorites | 7 | 空数组、空字符串过滤、去重、跨用户 |
| E. deleteFavoriteQuery | 9 | 存在 / 不存在 / 跨用户 / 入参缺失 |
| F. getFavoriteSuggestions | 12 | admin 跨用户 / 普通用户隔离 / 去重 / 回退 / 不足 / 默认 count |

合计 74 条全过。

## 安全考虑

- **用户隔离**：所有 SQL 严格 `WHERE user_id = ?` 强约束
- **路径安全**：`getDomainsForTables` 内部有 `isPathSafe` 校验
- **SQL 注入**：收藏的 SQL 不会被执行，只作为字符串存储
- **限流**：收藏 API 走通用限流（不在 auth 限流组中）

## 未来扩展

- 收藏列表页（`/api/queries/list` + 分页 + 搜索）
- 收藏导出（CSV / JSON）
- 收藏统计（按业务域聚合）
- 跨用户共享收藏（admin 可推送"精选 SQL"给普通用户）

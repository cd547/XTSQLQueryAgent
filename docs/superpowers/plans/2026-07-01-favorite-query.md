# 我的查询 - 收藏常用 SQL 功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **设计文档**: [2026-07-01-favorite-query.md](../specs/2026-07-01-favorite-query.md)

**Goal:** 用户在一轮完整对话结束（最终有 SQL）时，可点击"收藏为常用 SQL"按钮，系统调用 LLM 优化标题 + 业务域识别，落库到 `my_queries` 表；已收藏 SQL 在新会话页面以随机建议形式复用。

**Architecture:**
- 后端：1 个核心服务 `favoriteQuery.js` + 1 个路由文件 `routes/favoriteQuery.js` + 4 个 API
- 前端：1 个状态机 + 1 个 `handleFavorite` toggle handler + 批量回显
- LLM 复用现有 `withTimeout` / `withPromiseTimeout`，强制 `deepseek-chat`
- 业务域复用现有 `getDomainsForTables`

**Tech Stack:** Express, React 18, Ant Design 5, better-sqlite3, Node 24.11

---

## 文件结构

```
backend/src/db/sqlite.js                       # 修改：+ my_queries 表 + idx
backend/src/services/llm.js                    # 修改：+ callLlmForFavorite + 日志
backend/src/services/favoriteQuery.js          # 新建：核心服务（save/check/delete/suggestions）
backend/src/routes/favoriteQuery.js            # 新建：4 个 API 路由
backend/src/index.js                           # 修改：注册 /api/queries
backend/test-favorite-query.mjs                # 新建：74 条测试
frontend/src/api/index.js                      # 修改：+ 4 个 API 封装
frontend/src/components/ChatMessage.jsx        # 修改：+ 收藏按钮 + 状态机
frontend/src/App.jsx                           # 修改：+ state + handler + 回显
docs/superpowers/changelog/CHANGELOG.md        # 更新：+ 2026-07-01 段
```

---

## Task 1: 数据库表 + 索引

**Files:**
- Modify: `backend/src/db/sqlite.js`（找到 `CREATE TABLE` 集中区域）

- [ ] **Step 1: 新增 my_queries 表**

```sql
CREATE TABLE IF NOT EXISTS my_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_question TEXT NOT NULL,
  optimized_question TEXT,
  sql_output TEXT NOT NULL,
  business_domains TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, sql_output),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_my_queries_user ON my_queries(user_id);
```

- [ ] **Step 2: 验证**

启动后端，DB 浏览器查表存在；或用 `sqlite3 data/app.db ".schema my_queries"` 验证。

---

## Task 2: LLM 调用 + 日志

**Files:**
- Modify: `backend/src/services/llm.js`

- [ ] **Step 1: 新增 `callLlmForFavorite(systemPrompt, userPrompt, signal)`**

强制使用 `process.env.FAVORITE_LLM_MODEL || 'deepseek-chat'`，不读 `LLM_MODEL`。复用 `withTimeout` / `withPromiseTimeout`，120s 超时。

- [ ] **Step 2: 复用现有 LLM 日志基础设施**

- [ ] **Step 3: 验证**

单独 import 测试：
```js
import { callLlmForFavorite } from './src/services/llm.js';
console.log(typeof callLlmForFavorite);  // function
```

---

## Task 3: 核心服务

**Files:**
- Create: `backend/src/services/favoriteQuery.js`

- [ ] **Step 1: 实现 `extractJsonObject(text)`**

容忍 ```json ... ``` 围栏、嵌套对象、首尾多余文本。

- [ ] **Step 2: 实现 `saveFavoriteQuery(params)`**

```js
async function saveFavoriteQuery({ userId, userQuestion, sqlOutput, getDbFn, llmCaller }) {
  // 1. 调 llmCaller(systemPrompt, userPrompt, signal) 取 JSON
  // 2. 解析 optimized_question + table_names
  // 3. getDomainsForTables(table_names) → domains
  // 4. INSERT ... ON CONFLICT(user_id, sql_output) DO UPDATE
  // 5. 返回 { id, optimizedQuestion, businessDomains }
}
```

- [ ] **Step 3: 实现 `checkFavorites(userId, sqlOutputs, getDbFn)`**

返回 Map：`sqlOutput.trim()` → `{ id, optimizedQuestion, businessDomains }`；空串自动过滤。

- [ ] **Step 4: 实现 `deleteFavoriteQuery(userId, sqlOutput, getDbFn)`**

按 `user_id + sql_output` 删除，返回 boolean。

- [ ] **Step 5: 实现 `getFavoriteSuggestions({ userId, role, count, getDbFn })`**

admin 跨用户；普通用户仅自己；`COALESCE(NULLIF(TRIM(optimized_question), ''), TRIM(user_question))` 优先回退；`GROUP BY` 去重；`ORDER BY RANDOM() LIMIT ?`。

- [ ] **Step 6: 验证**

写最小测试调用所有函数，验证基本行为。

---

## Task 4: API 路由

**Files:**
- Create: `backend/src/routes/favoriteQuery.js`

- [ ] **Step 1: 4 个路由**

```js
router.post('/favorite', authRequired, ...);         // POST /api/queries/favorite
router.post('/favorites/check', authRequired, ...);  // POST /api/queries/favorites/check
router.delete('/favorite', authRequired, ...);       // DELETE /api/queries/favorite
router.get('/suggestions', authRequired, ...);       // GET /api/queries/suggestions?count=4
```

- [ ] **Step 2: 注册到 index.js**

```js
import favoriteQueryRouter from './routes/favoriteQuery.js';
app.use('/api/queries', favoriteQueryRouter);
```

---

## Task 5: 前端 API 封装

**Files:**
- Modify: `frontend/src/api/index.js`

- [ ] **Step 1: 4 个 API 函数**

```js
export function saveFavoriteQuery(payload) { return api.post('/queries/favorite', payload).then(r => r.data); }
export function checkFavorites(payload) { return api.post('/queries/favorites/check', payload).then(r => r.data); }
export function unfavoriteQuery(sqlOutput) { return api.delete('/queries/favorite', { data: { sqlOutput } }).then(r => r.data); }
export function getFavoriteSuggestions(count = 4) { return api.get('/queries/suggestions', { params: { count } }).then(r => r.data); }
```

---

## Task 6: 前端 UI

**Files:**
- Modify: `frontend/src/components/ChatMessage.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: ChatMessage 加按钮**

在"复制到 SQL 查询"按钮左边加"收藏为常用 SQL"按钮；状态机：`idle | loading | done`；图标用 `StarOutlined` / `StarFilled`。

- [ ] **Step 2: App.jsx 加 state**

```js
const [favoriteStates, setFavoriteStates] = useState({});  // msgId → 'loading' | 'done'
```

- [ ] **Step 3: handleFavorite toggle**

```js
const handleFavorite = useCallback(async ({ userQuestion, sqlOutput, msgId }) => {
  const cur = favoriteStates[msgId];
  if (cur === 'loading') return;
  if (cur === 'done') {
    // 取消收藏
    setFavoriteStates(prev => ({ ...prev, [msgId]: 'loading' }));
    try { await unfavoriteQuery(sqlOutput); setFavoriteStates(prev => ({ ...prev, [msgId]: undefined })); }
    catch (e) { setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' })); message.error('取消收藏失败'); }
  } else {
    // 收藏
    setFavoriteStates(prev => ({ ...prev, [msgId]: 'loading' }));
    try { await saveFavoriteQuery({ userQuestion, sqlOutput }); setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' })); }
    catch (e) { setFavoriteStates(prev => ({ ...prev, [msgId]: undefined })); message.error('收藏失败'); }
  }
}, [favoriteStates]);
```

- [ ] **Step 4: hydrateFavoriteStates 回显**

```js
const hydrateFavoriteStates = useCallback(async (msgs) => {
  const sqlToMsgIds = new Map();
  for (const m of msgs) {
    const sql = m?.sql; if (!sql) continue;
    const list = sqlToMsgIds.get(sql) || [];
    list.push(m.id);
    sqlToMsgIds.set(sql, list);
  }
  if (sqlToMsgIds.size === 0) return;
  try {
    const res = await checkFavorites({ sqlOutputs: [...sqlToMsgIds.keys()] });
    setFavoriteStates(prev => {
      const next = { ...prev };
      for (const [sql, info] of Object.entries(res.favorites || {})) {
        for (const msgId of sqlToMsgIds.get(sql) || []) next[msgId] = 'done';
      }
      return next;
    });
  } catch (e) { console.error('收藏状态回显失败:', e); }
}, []);
```

- [ ] **Step 5: loadMessages 中调用**

`loadMessages` 完成后 `hydrateFavoriteStates(loaded)`。

---

## Task 7: 测试

**Files:**
- Create: `backend/test-favorite-query.mjs`

- [ ] **Step 1: A. extractJsonObject（8 条）**

边界：围栏、嵌套、首尾多余、空输入、纯文本。

- [ ] **Step 2: B. getDomainsForTables（8 条）**

单表 / 多表 / 表名带反引号 / 缓存命中 / 表不在任何域 / 路径越界。

- [ ] **Step 3: C. saveFavoriteQuery（23 条）**

正常 / LLM 失败 / 重复 ON CONFLICT / 业务域空 / 用户隔离 / 缺入参 / 异常 caller。

- [ ] **Step 4: D. checkFavorites（7 条）**

空数组 / 空字符串过滤 / 去重 / 跨用户隔离 / trim 行为。

- [ ] **Step 5: E. deleteFavoriteQuery（9 条）**

存在 / 不存在 / 跨用户隔离 / 入参缺失 / idempotent。

- [ ] **Step 6: F. getFavoriteSuggestions（12 条）**

admin 跨用户 / 普通用户隔离 / 去重 / 优化标题回退 / 不足返回 / 空收藏 / userId 缺失 / 默认 count。

- [ ] **Step 7: 跑通**

```bash
cd backend && node test-favorite-query.mjs
# 期望：通过: 74 失败: 0 总计: 74
```

---

## Task 8: 端到端验证

- [ ] **Step 1: 启动后端**

`npm start`，无 500 错误。

- [ ] **Step 2: 启动前端**

`cd frontend && npm run dev`，无构建错误。

- [ ] **Step 3: 手动跑 12 个端到端用例**

| # | 操作 | 期望 |
|---|------|------|
| 1 | 登录 → 新建会话 → 输入"统计今日课表" → 等 LLM 返回 SQL | 显示"收藏为常用 SQL"按钮 |
| 2 | 点击收藏 | 按钮变 loading → 变"已收藏"（金色星） |
| 3 | 点"新建对话" | 新会话页面显示该收藏的标题（之一） |
| 4 | 切回原会话 | 收藏按钮显示"已收藏"（回显成功） |
| 5 | 点击"已收藏"按钮 | loading → 变回"收藏为常用 SQL"（取消成功） |
| 6 | 用 admin 账号登录 | 新会话页面能看到 userA 的收藏（跨用户） |
| 7 | 用普通 user 账号登录 | 新会话页面**只能**看到自己收藏（隔离） |
| 8 | 同 SQL 收藏 2 次 | 第 2 次不报错，更新标题 |
| 9 | LLM 失败时收藏 | 弹 toast "收藏失败"，按钮回到 idle |
| 10 | 用户问题很短 | 优化后标题能取 |
| 11 | 数据库 `my_queries` 查 | 含 user_id / optimized_question / business_domains JSON |
| 12 | 反复刷新页面 | /me 不会被 429 踢回登录页（依赖限流拆分功能） |

- [ ] **Step 4: 回归**

```bash
node test-sql-validator.mjs       # 全过
node test-skill-domains.mjs       # 全过
node test-skill-cache.mjs         # 全过
node test-fs-utils.mjs            # 全过
node test-llm-timeout.mjs         # 全过
node test-favorite-query.mjs      # 74/74
```

- [ ] **Step 5: 前端 build**

```bash
cd frontend && npm run build
```

---

## 验证标准

- ✅ 后端 74/74 测试通过
- ✅ 5 个其他后端测试无回归
- ✅ 前端 build 成功
- ✅ 12 个端到端用例全部通过
- ✅ 收藏按钮在 3 种状态下表现正确
- ✅ 新会话建议正确显示收藏内容
- ✅ admin 跨用户 / 普通用户隔离正确
- ✅ 反复刷新不被踢出登录页

## 实施工作量

约 6 小时（后端 3h + 前端 2h + 测试 1h + 文档 30min）

## 后续事项

- CHANGELOG 写入 2026-07-01 段
- 同步新会话建议 spec/plan（[2026-07-01-new-session-suggestions](../specs/2026-07-01-new-session-suggestions.md)）
- 同步限流拆分 spec/plan（[2026-07-01-rate-limit-split](../specs/2026-07-01-rate-limit-split.md)）

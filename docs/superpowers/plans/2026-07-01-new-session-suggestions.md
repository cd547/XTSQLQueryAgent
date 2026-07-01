# 新会话建议 - 从收藏中随机抽取 实施计划

> **设计文档**: [2026-07-01-new-session-suggestions.md](../specs/2026-07-01-new-session-suggestions.md)
> **前置功能**: [2026-07-01-favorite-query plan](2026-07-01-favorite-query.md)（"我的查询"）

**Goal:** 新会话页面 4 个推荐从写死字符串改为从用户收藏中随机抽取；admin 跨用户，普通用户仅自己；不足 4 条返几条就显几个；完全空时 fallback 到写死。

**Architecture:**
- 后端：复用 favoriteQuery 服务的 `getFavoriteSuggestions`
- 前端：1 个 state + 1 个 fetch + 1 个 useEffect + 渲染层 fallback
- 触发：mount + handleNewSession

**Tech Stack:** React 18, Ant Design 5, Express, better-sqlite3

---

## 文件结构

```
backend/src/services/favoriteQuery.js          # 修改：+ getFavoriteSuggestions
backend/src/routes/favoriteQuery.js            # 修改：+ GET /suggestions 路由
backend/test-favorite-query.mjs                # 修改：+ F 区块 12 条
frontend/src/api/index.js                      # 修改：+ getFavoriteSuggestions
frontend/src/App.jsx                           # 修改：+ state + fetch + useEffect + 渲染
```

---

## Task 1: 后端服务

**Files:**
- Modify: `backend/src/services/favoriteQuery.js`

- [ ] **Step 1: 实现 getFavoriteSuggestions**

```js
export function getFavoriteSuggestions({ userId, role, count = 4, getDbFn } = {}) {
  if (!userId) return [];
  const db = typeof getDbFn === 'function' ? getDbFn() : getDb();
  const isAdmin = role === 'admin';
  const whereUser = isAdmin ? '' : 'WHERE user_id = ?';
  const sql = `
    SELECT q FROM (
      SELECT COALESCE(NULLIF(TRIM(optimized_question), ''), TRIM(user_question)) AS q
      FROM my_queries ${whereUser}
    )
    WHERE q != '' AND q IS NOT NULL
    GROUP BY q
    ORDER BY RANDOM()
    LIMIT ?
  `;
  const rows = isAdmin ? db.prepare(sql).all(count) : db.prepare(sql).all(userId, count);
  return rows.map(r => r.q).filter(Boolean);
}
```

- [ ] **Step 2: 验证**

写最小测试调用，传不同 userId/role/count 验证返回。

---

## Task 2: API 路由

**Files:**
- Modify: `backend/src/routes/favoriteQuery.js`

- [ ] **Step 1: GET /suggestions 路由**

```js
router.get('/suggestions', authRequired, (req, res) => {
  const count = Math.max(1, Math.min(20, parseInt(req.query.count, 10) || 4));
  try {
    const suggestions = getFavoriteSuggestions({
      userId: req.user.id, role: req.user.role, count
    });
    res.json({ success: true, suggestions });
  } catch (e) {
    logger.error('getFavoriteSuggestions failed', { userId: req.user?.id, error: e.message });
    res.status(500).json({ success: false, code: 'SUGGESTIONS_FAILED', message: e.message });
  }
});
```

---

## Task 3: 前端 API 封装

**Files:**
- Modify: `frontend/src/api/index.js`

- [ ] **Step 1: API 函数**

```js
export function getFavoriteSuggestions(count = 4) {
  return api.get('/queries/suggestions', { params: { count } }).then(r => r.data);
}
```

---

## Task 4: 前端 state + fetch

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 引入 API**

```js
import { ..., getFavoriteSuggestions } from './api';
```

- [ ] **Step 2: 加 state + fetch**

```js
const [chatSuggestions, setChatSuggestions] = useState([]);
const fetchChatSuggestions = useCallback(async () => {
  try {
    const res = await getFavoriteSuggestions(4);
    setChatSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
  } catch (e) {
    console.error('获取建议失败:', e);
    setChatSuggestions([]);
  }
}, []);
```

- [ ] **Step 3: useEffect mount 拉一次**

```js
useEffect(() => { fetchChatSuggestions(); }, [fetchChatSuggestions]);
```

- [ ] **Step 4: handleNewSession 末尾也调一次**

```js
const handleNewSession = async () => {
  // ... 创建会话 ...
  fetchChatSuggestions();
};
```

---

## Task 5: 渲染层

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 替换写死数组**

找到空状态下的建议列表：

```jsx
<div className="xtsql-suggestion-list">
  {(chatSuggestions.length > 0
    ? chatSuggestions
    : ['查询2024年的销售额', '统计每个分类的商品数量', '查找销售额最高的10个客户', '分析最近30天的订单趋势']
  ).map(s => (
    <div key={s} className="xtsql-suggestion" onClick={() => setInput(s)}>
      {s}
    </div>
  ))}
</div>
```

---

## Task 6: 测试

**Files:**
- Modify: `backend/test-favorite-query.mjs`

- [ ] **Step 1: F 区块 12 条用例**

| # | 用例 | 期望 |
|---|------|------|
| F1a | 普通用户只取自己 | 不含 userA/B |
| F1b | GROUP BY 去重 | 重复 0 |
| F1c | 优化标题空 → 回退 user_question | 包含 "只收藏未优化的问题" |
| F1d | 含优化标题 | 包含 "统计月度活跃用户" |
| F1e | 不超过 count | ≤ 20 |
| F2a | admin 跨用户：含 userA | true |
| F2b | admin 跨用户：含 userB | true |
| F3 | admin 30 次采样大部分都能跨用户 | ≥ 15/30 |
| F4 | userB 1 条收藏 | 返 1 条 |
| F5 | 空收藏 | 返 [] |
| F6 | userId 缺失 | 返 [] |
| F7 | 默认 count=4 | ≤ 4 |

- [ ] **Step 2: 跑通**

```bash
node test-favorite-query.mjs
# 期望：74/74 全过
```

---

## Task 7: 端到端验证

- [ ] **Step 1: 启动**

后端 `npm start`，前端 `npm run dev`。

- [ ] **Step 2: 5 个端到端用例**

| # | 操作 | 期望 |
|---|------|------|
| 1 | 登录 → 新建会话 | 显示 4 条收藏的优化标题（如果有） |
| 2 | 没有任何收藏 | fallback 到 4 条写死 |
| 3 | 收藏 1 条 SQL → 新建会话 | 显示该条收藏的标题 |
| 4 | 用 admin 登录 → 新建会话 | 看到其他用户的收藏 |
| 5 | 用普通 user 登录 → 新建会话 | 只看到自己的收藏 |

- [ ] **Step 3: 反复刷新**

每次 mount 拉一次，随机顺序会变。

- [ ] **Step 4: 回归**

```bash
node test-favorite-query.mjs  # 74/74
npm run build                 # 成功
```

---

## 验证标准

- ✅ 12 条 F 区块测试通过
- ✅ 5 个端到端用例通过
- ✅ admin 跨用户 / 普通用户隔离正确
- ✅ 空收藏 / 不足时 fallback 正确
- ✅ mount + handleNewSession 两个触发点都生效

## 实施工作量

约 1.5 小时（后端 30min + 前端 30min + 测试 30min）

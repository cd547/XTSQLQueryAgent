# 新会话建议 - 从收藏中随机抽取

> **设计日期**: 2026-07-01
> **关联 plan**: [2026-07-01-new-session-suggestions.md](../plans/2026-07-01-new-session-suggestions.md)
> **前置功能**: [2026-07-01-favorite-query.md](2026-07-01-favorite-query.md)（"我的查询"）

## 概述

新会话页面原 4 个推荐是**写死的字符串**（"查询 2024 年的销售额"等），与用户实际工作场景无关。改为从**用户自己的收藏**（admin 跨用户）中随机抽取，让推荐内容**与个人使用历史**挂钩。

## 背景

- 用户经常提类似问题，但每次都要重新写
- 写死的 4 个推荐是"通用 SQL 助手"语境的，对具体业务没有意义
- "我的查询"功能（2026-07-01）让用户能收藏 SQL，正好可以作为推荐的数据源

## 关键决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 数据源 | 我的查询表（`my_queries`） | 已有数据，无需新建 |
| 2 | 抽取字段 | 优先 `optimized_question`（LLM 优化后），缺失回退 `user_question` | 优化标题是 ≤30 字精炼表达，更适合展示 |
| 3 | 数量 | 默认 4 个 | 与原写死推荐数量一致 |
| 4 | admin 权限 | admin 跨所有用户随机 | admin 是"全公司 SQL 库"使用者 |
| 5 | 普通用户权限 | 仅自己 | 隐私隔离 |
| 6 | 不足 4 条时 | 返几条就显几个 | 用户决策（"不补写死"） |
| 7 | 完全没收藏时 | 前端 fallback 到写死 4 条 | 保证 UI 始终有内容 |
| 8 | 触发时机 | mount 时 + 点"新建对话"时各拉一次 | 兼顾首次进入和新建会话两种入口 |
| 9 | 顺序 | 随机（`ORDER BY RANDOM()`） | 同一推荐不重复出现 |
| 10 | 去重 | `GROUP BY q` | 同问题多次收藏只返一次 |
| 11 | 字段类型 | 字符串数组 | 与原 `xtsql-suggestion-list` 渲染层兼容 |
| 12 | 接口超时 | 复用现有 axios 配置（无显式超时） | 该接口读多写少、SQL 走索引，不应超时 |

## 接口设计

### GET /api/queries/suggestions

**鉴权**：必须登录

**Query**:
- `count` (可选, 默认 4, 范围 1-20)

**Response 200**:
```json
{
  "success": true,
  "suggestions": ["今日课表", "Top10 销售", "退款订单", "..."]
}
```

**SQL 核心**:
```sql
SELECT q FROM (
  SELECT COALESCE(NULLIF(TRIM(optimized_question), ''), TRIM(user_question)) AS q
  FROM my_queries
  [WHERE user_id = ?]            -- 普通用户才加
)
WHERE q != '' AND q IS NOT NULL
GROUP BY q                        -- 去重
ORDER BY RANDOM()                  -- 随机
LIMIT ?
```

**性能考虑**：
- `idx_my_queries_user` 索引已存在（`my_queries` 表创建时加的）
- 100 条收藏以内，10ms 内返回
- 后续如数据量 > 1000，可考虑：先 `SELECT id ... ORDER BY RANDOM() LIMIT N` 再 `WHERE id IN`

## 前端设计

### State
```js
const [chatSuggestions, setChatSuggestions] = useState([]);  // string[]
```

### 触发点

```js
const fetchChatSuggestions = useCallback(async () => {
  try {
    const res = await getFavoriteSuggestions(4);
    setChatSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
  } catch (e) {
    console.error('获取建议失败:', e);
    setChatSuggestions([]);  // 失败时也清空，让渲染层 fallback
  }
}, []);

// 1) 首次 mount
useEffect(() => { fetchChatSuggestions(); }, [fetchChatSuggestions]);

// 2) 点新建对话时
const handleNewSession = async () => {
  // ... 创建会话逻辑 ...
  fetchChatSuggestions();
};
```

### 渲染

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

**Fallback 触发条件**：
- `chatSuggestions.length === 0`（空数组、加载失败、未登录）
- 用户**没有任何**收藏时也走 fallback（数据源就是空）
- 注意：admin 用户**至少有一个用户**有收藏时就会显示该用户的收藏，不会 fallback

## 用户体验

| 用户状态 | 行为 |
|----------|------|
| 首次使用，没收藏 | fallback 到写死 4 条 |
| 有 1-3 条收藏 | 显示 1-3 条 + 不补足 |
| 有 4+ 条收藏 | 显示 4 条 |
| admin 且有他人收藏 | 显示来自任意用户的收藏 |
| 普通用户 | 只能看自己 |
| 收藏后立即新建会话 | 拉到的是包含刚收藏的随机 4 条（之一） |
| 反复刷新 | 重新随机抽取（顺序可能不同） |

## 涉及文件

| 文件 | 变更 |
|------|------|
| `backend/src/services/favoriteQuery.js` | 修改：+ `getFavoriteSuggestions` 函数 |
| `backend/src/routes/favoriteQuery.js` | 修改：+ `GET /suggestions` 路由 |
| `frontend/src/api/index.js` | 修改：+ `getFavoriteSuggestions` |
| `frontend/src/App.jsx` | 修改：+ state + fetch + 渲染 fallback |
| `backend/test-favorite-query.mjs` | 修改：+ F 区块 12 条测试 |

## 测试覆盖

| 用例 | 覆盖点 |
|------|--------|
| F1a | 普通用户只取自己（无其他用户内容） |
| F1b | `GROUP BY` 去重生效（同问题多次收藏只返一次） |
| F1c | 优化标题缺失时回退到 `user_question` |
| F1d | 优化标题正常取 |
| F1e | 不超过 count |
| F2a-b | admin 跨用户（同时含 userA 和 userB） |
| F3 | admin 30 次采样大部分都能跨用户 |
| F4 | 只有 1 条收藏：返 1 条（不补足） |
| F5 | 空收藏：返 `[]` |
| F6 | userId 缺失：返 `[]` |
| F7 | 默认 count=4 |

合计 12 条，全过。

## 安全考虑

- 严格 `WHERE user_id = ?`（普通用户分支）
- admin 跨用户是**有意的设计**（admin 是平台管理员）
- 收藏内容是用户自己的提问，admin 看见不构成隐私泄露
- 接口需要登录，外部不可访问

## 未来扩展

- 收藏统计聚合：按业务域分组，给 admin 看"哪个域最活跃"
- 跨用户共享：admin 标记"精选 SQL"，普通用户也能看到
- 智能排序：按"使用频次"而非纯随机
- 时效过滤：N 天内收藏优先

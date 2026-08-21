# App.jsx 拆分重构计划

> **目的**：把 2579 行的 `frontend/src/App.jsx` 拆成职责清晰的多个文件，提升可读性、可测性、HMR 响应速度。
> **创建时间**：2026-08-21
> **状态**：阶段 1 ✅ 已完成（commit 7ba8112）

---

## 1. 背景

`App.jsx` 体积过大、单一组件承担过多职责：

| 问题 | 后果 |
|---|---|
| 单文件 2579 行 | 阅读/修改/Review 成本极高 |
| `handleSend` 单函数 444 行 | 改 SSE 协议需要通读整段 |
| 50+ useState 平铺 | 状态归属全凭记忆 |
| 5 类职责（会话/聊天/SQL/技能/UI）混杂 | 测试和复用都困难 |

> 2026-08-21 之前 `App.jsx` 为 2602 行；阶段 1 完成后降至 2579 行（已 commit）。

---

## 2. 拆分策略

采用 **5 阶段渐进式拆分** —— 每阶段独立可发布、可回滚、零行为变化。

| 阶段 | 范围 | 风险 | 预期收益 | 状态 |
|---|---|---|---|---|
| **1** | 抽取纯函数工具 | 极低 | 100+ 行 | ✅ 完成 |
| **2** | 抽 `useChatStream` hook | 中 | 500+ 行 | ⏳ 待做 |
| **3** | 抽 `useSessionList` + `<Sider />` | 中 | 300+ 行 | ✅ 完成 |
| **4** | 抽 `<ChatPanel />` / `<SqlPanel />` / `<ChatInput />` | 低 | 450+ 行 | ✅ 完成 |
| **5** | 抽 `<SkillDrawer />` | 低 | 140+ 行 | ✅ 完成 |

**总预期**：App.jsx **2579 → ~1100 行**（−58%），新增 1 hook + 5 组件。

---

## 3. ✅ 阶段 1：工具抽取（已完成，commit 7ba8112）

### 新增文件

- [`frontend/src/utils/formatTime.js`](../../frontend/src/utils/formatTime.js) — `sqliteUtcToIso` + `formatSqliteUtcLocal`
- [`frontend/src/utils/excel.js`](../../frontend/src/utils/excel.js) — `getCharWidth` + `exportToExcel(data, cols, messageApi)`
- [`frontend/src/utils/toolName.js`](../../frontend/src/utils/toolName.js) — `extractToolName(content, { role, preferToolName })`

### 改动

- `App.jsx`：删除内联 `getCharWidth` / `exportToExcel` / toolName IIFE / `m.created_at.replace(' ', 'T') + 'Z'` 模式
- 4 处调用点替换为工具函数

### 收益

- 消除 4 处重复代码
- 行为零变化（已通过 `npm run build` 验证）
- 附加：消除 antd 静态 `message` 警告（51 处调用迁移到 `AntdApp.useApp()`）

---

## 4. ⏳ 阶段 2：抽 `useChatStream` hook

### 目标

把 `App.jsx` 中 [`handleSend` 函数（约 444 行）](../../frontend/src/App.jsx) 抽到 [`frontend/src/hooks/useChatStream.js`](../../frontend/src/hooks/useChatStream.js)。

### 计划接口

```js
const {
  send,            // (text, opts) => Promise<void>  发送消息
  stop,            // () => void  停止生成
  isStreaming,     // boolean    是否正在流式生成
  messagesEndRef,  // ref        消息列表底部锚点
  chatContentRef,  // ref        聊天区容器
  roundUsages,     // Array      累积的轮次用量
} = useChatStream({
  sessionId,
  reasoningEnabled,
  reasoningEffort,
  messages,
  setMessages,
  onSessionBootstrap,  // 首次流式开始时回调（创建/挂接会话）
});
```

### 风险点（必须保留）

- [ ] F2 / F9 / v5.18 等历史 bug 修复的版本号管理逻辑
- [ ] 6 个 SSE event 分支的 `setMessages` 闭包共享（meta / chunk / LLM/tool/tool_return / reasoning_chunk / usage / reasoning_done / message_final / error / done）
- [ ] `roundUsagesRef` 跨分支状态一致性
- [ ] `abortControllerRef` 流式中止
- [ ] `streamRequestIdRef` 过期请求丢弃

### 验证清单

- [ ] 普通聊天流式响应正常
- [ ] 工具调用（tool/tool_return）正常
- [ ] 工具返回（4 种格式）显示正常
- [ ] 思考模式（reasoning_chunk / reasoning_done）正常
- [ ] 中止按钮可用
- [ ] `roundUsages` 累积正确（缓存命中率折线图数据源）
- [ ] F2 / F9 / v5.18 历史 bug 不回归
- [ ] 切换会话时旧流正确丢弃

### 预计

App.jsx **2579 → ~2100 行**（−479）

---

## 5. ✅ 阶段 3：抽 `useSessionList` + `<Sider />`（已完成）

### 目标

- `frontend/src/hooks/useSessionList.js`（约 95 行）
- `frontend/src/components/Sider.jsx`（约 195 行）
- `frontend/src/utils/constants.js`（新增 6 行，承载 `SESSIONS_PAGE_SIZE`）

### 实施结果

#### `useSessionList` Hook

- 状态：sessions / sessionsTotal / hasMoreSessions / loadingMoreSessions
- 加载：loadMoreSessions（分页）/ handleSiderScroll（触底 80px）
- 变更原语：addSession / removeSession / updateSessionName
- 内部 loadingRef 暴露为 `sessionsLoadingRef`（让 App.jsx 的 `loadSessions` 复用同一锁）
- App.jsx 的 `loadMoreSessions` 与 `handleSiderScroll` 已删除（走 hook）
- `App.jsx` 的 `loadingRef` 去掉 `sessions` / `sessionsMore` 两个键（已迁出）

#### `<Sider />` 组件

- 19 个 props：9 数据 + 1 setter + 7 业务回调 + 4 跨切回调
- 业务回调（onNewSession / onSessionClick / onDeleteSession / onStartRename / onRenameSession / onSummarizeSession）由 App.jsx 透传
- 跨切回调（onConfigClick / onSkillClick / onChangePasswordClick / onLogout）由 App.jsx 包装 setState 与 Modal.confirm
- 9 个图标 + 5 个组件 + 1 个工具函数（formatSqliteUtcLocal）直接 import，不通过 props 传
- `siderListRef` 本地持有（DOM 引用无需外漏）

#### App.jsx 改动

- `handleNewSession` / `handleDeleteSession` / `handleRenameSession` / `handleSummarizeSession` 改用 hook 的变更原语
- `loadSessions` 改用 `sessionsLoadingRef.current.sessions`
- `Sider` 与 `Content` 不再解构（避免与新组件同名冲突）
- 6 个 dead icon import + 1 个 dead ref 删除
- App.jsx 2026 → 1901 行（−125）

### 验证

- [ ] `npm run build` 通过（4255 modules）

### 计划接口

```js
const {
  sessions,
  sessionsTotal,
  hasMoreSessions,
  loadingMoreSessions,
  loadMoreSessions,
  handleSiderScroll,
  handleNewSession,
  handleSessionClick,
  handleDeleteSession,
  handleRenameSession,
  handleStartRename,
  handleSummarizeSession,
} = useSessionList({ user, onSessionChange });
```

### 风险点

- 跨 hook 共享状态（`activeSessionId` / `currentSessionId`）
- 滚动位置保存（`sessionScrollTopsRef`）
- 触发会话切换后 `handleChatScroll` 时序

### 预计

App.jsx **~2100 → ~1700 行**（−400）

---

## 6. ⏳ 阶段 4：抽 `<ChatPanel />` / `<SqlPanel />` / `<ChatInput />`

### 目标

- `frontend/src/components/ChatPanel.jsx`（空态 + 消息列表 + 滚动锚点）
- `frontend/src/components/SqlPanel.jsx`（Monaco 编辑器 + 拖拽条 + 结果表 + EXPLAIN 标签页）
- `frontend/src/components/ChatInput.jsx`（输入区 + 思考模式 + tokens 显示 + 发送按钮）

### 风险点

- 顶层 state 下沉到子组件（activeTabKey / messages / sqlInput / sqlResults / columns / currentResults 等需要 props 钻或 Context）
- 跨子组件回调路径复杂化（建议引入轻量 Context 避免 prop drilling）
- Monaco 性能（HMR 后需要重新实例化）

### 何时考虑 Context

- 如果 props 超过 3 层穿透
- 如果 4+ 个子组件共享同一份状态（如 messages）
- 暂不引入，先尝试 prop drilling，必要时再升 Context

### 预计

App.jsx **~1700 → ~1300 行**（−400）

---

## 7. ✅ 阶段 5：抽 `<SkillDrawer />`（已完成）

### 目标

`frontend/src/components/SkillDrawer.jsx`（约 190 行）—— 完整的技能管理抽屉：文件树 + 文件内容编辑 + 锁 + 拖拽 + 保存。

### 实施结果

- 190 行内联 Drawer → 16 行 `<SkillDrawer />` 调用
- App.jsx：2204 → 2026 行（−178，含 5 个 dead UI state 下沉 + 6 个 dead icon import 清理 + 1 个 dead state 移除）
- 业务数据 8 项 + 业务回调 7 项通过 props 透传
- 5 个内部 UI state（skillTreeCollapsed / skillContentCollapsed / skillTreeHeight / skillEditorHeight / skillDrawerWidth）下沉到组件内部

### 验证

- [ ] `npm run build` 通过（4252 modules）

---

## 8. 全程不变量（必须保留）

### 后端

- [ ] SQL 查询必须经 `sqlValidator` 验证
- [ ] 鉴权端点必须用 `authRateLimiter`（用户名+IP 复合键，10 req/h）
- [ ] `/me` 和 `/logout` 用 `authMeRateLimiter`（100 req/h/IP）
- [ ] MySQL 必须用连接池
- [ ] JWT 存 HttpOnly cookie，禁 localStorage
- [ ] bcrypt 必须 async/await
- [ ] 启动初始化函数必须 await
- [ ] 工具函数读文件必须 `fs.promises.readFile`、实时读、不缓存
- [ ] `/execute` 写入 messages 表时 `results = NULL`

### 前端

- [ ] SQLite UTC 时间串转 ISO 后再 `new Date()`（避免时区错位）
- [ ] UI 时间显示 24 小时制（`hour12: false`）
- [ ] 缓存命中率折线图：x 轴 `R1 R2 R3…`、y 轴 `0/25/50/75/100`、数据点上方显示百分比、配色 antd 蓝 `#69b1ff`
- [ ] 思考模式选中色：`--xtsql-accent`（蓝）+ `--xtsql-accent-soft`（浅蓝）
- [ ] 滚动位置用 `useLayoutEffect` + 临时禁用 `scroll-behavior: smooth`（瞬时还原，不带动画）
- [ ] antd `message` 统一走 `AntdApp.useApp()`（禁静态 `message.xxx`）
- [ ] 外部依赖不引入运行时 CDN（高亮等必须本地化）

### 工具脚本

- [ ] **绝对禁止用 PowerShell `[regex]::Replace` 改源码**（曾把 100KB 文件膨胀到 1.6MB）
- [ ] **所有源码修改必须走 Edit 工具**，且 parallel Edit 可能丢更新（建议 sequential）

---

## 9. 每阶段通用验证清单

- [ ] `npm run build` 通过
- [ ] 浏览器手动测试：登录 / 发送消息 / SQL 执行 / 收藏 / 主题切换 / 思考模式
- [ ] 硬刷（Ctrl+Shift+R）排除 Vite HMR 缓存
- [ ] 历史 bug 回归：F2 / F9 / v5.18（具体内容见后端 `query.js` 的版本号分支）
- [ ] 24h 时间显示正常
- [ ] 缓存命中率折线图正常
- [ ] Excel 导出正常（必须传 `messageApi` 参数）
- [ ] 控制台无 antd 静态 `message` 警告
- [ ] 滚动位置保存/还原无动画
- [ ] 加载大量会话时滚动不卡顿

---

## 10. 目标最终状态

| 阶段 | App.jsx 行数 | 新增文件数 | 累计 |
|---|---|---|---|
| 阶段 0（初始） | 2602 | 0 | 0 |
| 阶段 1 ✅ | 2579 | 3 utils | +3 |
| 阶段 2 后 | ~2100 | +1 hook | +4 |
| 阶段 3 ✅ 后 | 1901 | +1 hook + 1 组件 | +6 |
| 阶段 4 ✅ 后 | 2204 | +3 组件 | +9 |
| 阶段 5 ✅ 后 | 1901 | +1 组件 | **+10** |

> 2602 → 1901，已完成阶段总降幅 **−701 行**（−27%）
>
> 未做阶段 2（useChatStream），如果未来要做，App.jsx 还有约 350 行可清理潜力（handleSend + handleStop + 4 refs）。

---

## 11. 进度跟踪

| 日期 | 阶段 | 关键事件 |
|---|---|---|
| 2026-08-21 | 1 ✅ | commit 7ba8112 `refactor: 统一替换静态 message 为动态上下文 API，新增工具函数` |
| 2026-08-21 | 1 ✅ | 修 3 处 parallel Edit 漏改的 bug（AddTableModal / ChangePasswordModal / excel.js 死 import） |
| 2026-08-21 | 4.1 ✅ | 抽 ChatInput（−85 行）+ 手动测试通过 |
| 2026-08-21 | 4.2 ✅ | 抽 SqlPanel（−229 行）+ dead state/icon 清理 13 行 |
| 2026-08-21 | 4.3 ✅ | 抽 ChatPanel（−60 行）+ dead import 清理 3 个 |
| 2026-08-21 | 5 ✅ | 抽 SkillDrawer（−178 行，含 5 UI state 下沉 + 6 icon import 清理） |
| 2026-08-21 | 3 ✅ | 抽 useSessionList + Sider（−125 行，含 6 dead icon + 1 dead ref 清理） |
| 待开始 | 2 | 抽 `useChatStream` hook（高风险，按需） |

---

## 12. 附录：本计划衍生的设计决定

1. **不引入 Redux/Zustand**：当前 50+ useState 集中管理已能工作，引入额外抽象得不偿失。后续若 props 钻过深再考虑 Context。
2. **不重命名为 `useChatStream.js` 之外的命名**：业界惯例（`use*` 前缀 hook）。
3. **工具函数放 `utils/` 而非 `lib/`**：与 `api/` / `context/` / `components/` 风格一致。
4. **`App.jsx` 始终保留默认导出**（`function App()`）：main.jsx 不动。
5. **`useApp()` 必须在 `AuthenticatedApp` 顶部调用**（hook 规则），不能放在任何条件 return 之后。

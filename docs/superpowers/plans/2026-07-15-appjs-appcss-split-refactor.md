# App.jsx / App.css 拆分重构方案

- **编制日期**: 2026-07-15
- **作者**: Trae
- **目标文件**: `frontend/src/App.jsx` (2338 行) / `frontend/src/App.css` (1250 行)
- **背景**: App.jsx 承担了鉴权/聊天/侧边栏/技能/SQL 工作台/4 个 Modal 等过多职责，单文件 2338 行难以维护。
- **范围**: 纯前端结构重构，**不改业务行为、不改接口、不改后端**。每一步均可独立回滚。

---

## 一、现状扫描

### 1.1 App.jsx 结构（2338 行）

| 行号区间 | 内容 | 行数 | 备注 |
|---|---|---:|---|
| 29-46 | `App()` 顶层（鉴权/bootstrapping 分流） | 18 | 不可拆 |
| 49-2245 | `AuthenticatedApp` 主体 | 2196 | **主战场** |
| 49-164 | 状态声明（**52 个 useState + 9 个 useRef**） | 116 | 拆不动可分组 |
| 166-264 | Tab 切换 + 初始加载（loadSessions / loadCurrentModel / loadAgentConfig） | 99 | |
| 291-376 | 侧边栏滚动 + loadMessages + chat scroll | 86 | |
| 377-516 | 会话 CRUD（new/click/view/delete/rename/summarize） | 140 | |
| 518-561 | Tab CRUD | 44 | |
| 564-636 | 收藏（favoriteStates + hydrateFavoriteStates） | 73 | |
| 644-657 | 聊天建议（fetchChatSuggestions） | 14 | |
| **659-905** | **`handleSend` SSE 流式主逻辑** | **247** | **最大单点** |
| 907-949 | stop / tag / user_choice | 43 | |
| 966-1075 | handleExecute / handleExplain / handleExplainAnalyze | 110 | |
| 1100-1143 | Skill 文件 CRUD | 44 | |
| 1145-1215 | AddTable 三步流程 | 71 | |
| 1217-1252 | `columns` / `explainColumns` 计算 | 36 | |
| 1285-2243 | **JSX 渲染** | 959 | 拆出大块组件 |
| 2248-2336 | `ChangePasswordModal` 独立函数 | 89 | 移出文件 |
| 2337-2338 | `export default App` | 2 | |

**handler 一览**（共 30+）：

```
loadCurrentModel    loadAgentConfig     handleSqlChange     loadSessions
loadMoreSessions    handleSiderScroll   loadMessages        handleChatScroll
handleNewSession    handleSessionClick  handleViewMessages  handleDeleteSession
handleRenameSession handleStartRename   handleSummarizeSession
handleAddTab        handleDeleteTab     handleOpenSqlTab    handleCopyAndExecute
handleFavorite      handleToggleCollapse fetchChatSuggestions
handleSend (247行)  handleStop          handleConfirmTagAdd handleCancelTagAdd
handleSubmitUserChoice handleCancelUserChoice
getSelectedSql      handleExecute       handleExplain       handleExplainAnalyze
loadSkillsList      handleSkillFileSelect handleSkillSave
handleAddTableStep1/2/3  resetAddTableForm  handleAddTableModalClose
exportToExcel
```

### 1.2 App.css 结构（1250 行）

| 行号区间 | 区块 | 行数 |
|---|---|---:|
| 1-91 | 设计 Token（CSS 变量 + 暗色） | 91 |
| 92-112 | 全局滚动条 | 21 |
| 113-268 | 暗色 antd 主题覆盖 | 156 |
| 269-504 | 侧边栏（`.xtsql-sider*`, `.xtsql-session*`, `.xtsql-user*`） | 236 |
| 505-607 | 主内容区 + 空状态 | 103 |
| 608-897 | 消息气泡 / markdown / log 块 | 290 |
| 898-1021 | 输入区 | 124 |
| 1022-1039 | Tabs 美化 | 18 |
| 1040-1052 | 抽屉美化 | 13 |
| 1053-1167 | 登录页 | 115 |
| 1168-1204 | SQL 面板 | 37 |
| 1205-1241 | Skill 树 + 动画 | 37 |
| 1242-1250 | **遗漏区块**：`.xtsql-pulse` 工具类 + `@media (max-width:768px)` 跨 4 组件响应式 | 9 |

**1242-1250 内容核验**（[App.css:1242-1250](file:///D:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.css#L1242-L1250)）：

```css
/* line 1242: 通用动画工具类 */
.xtsql-pulse { animation: xtsql-pulse 1.4s ease-in-out infinite; }

/* line 1244-1250: 跨 4 个组件的响应式 */
@media (max-width: 768px) {
  .xtsql-msg-body { max-width: calc(100% - 60px); }    /* MessageBubble */
  .xtsql-chat-area { padding: 16px 12px; }              /* ChatArea */
  .xtsql-input-wrap { padding: 0 12px 12px; }           /* ChatInput */
  .xtsql-sider { width: 240px !important; }             /* Sidebar */
}
```

**归属方案**：
- `.xtsql-pulse` 放 `global.css`（工具类，全局可用）
- 4 行响应式规则**就近拆分**到各自组件 CSS（每处 1 行），与组件逻辑内聚

### 1.3 关键组件

| 类型 | 位置 | 复杂度 |
|---|---|---|
| `<Modal>` (会话消息详情) | 1770 | 低 |
| `<Drawer>` (配置) | 1883 | 低（已委托 ConfigPanel） |
| `<Drawer>` (Skill 查看器) | 1896-2085 | **高**（含 Monaco + 树 + 添加表按钮） |
| `<Modal>` (AddTable) | 2087-2206 | **中**（3 步流程 + **11 个 state** 移入） |
| `<Modal>` (AI 分析 EXPLAIN) | 2210-2242 | **中**（流式 markdown） |
| `<Modal>` (ChangePassword) | 2287-2336 | 低 |
| `<Tabs>` + `<Collapse>` + `<Table>`×2 (SQL 工作台) | 1421-1740 | **极高**（30+ state、260+ JSX 行） |
| 侧边栏（含会话列表 + 用户卡） | 1290-1406 | 中 |
| 聊天空状态 + ChatMessage 列表 | 1456-1508 | 中 |
| 输入区 | 1804-1877 | 中 |

---

## 二、目标架构

```
frontend/src/
├── App.jsx                          # 顶层壳：鉴权/路由/App context
├── App.css                          # 入口样式（@import 全部 styles）
├── styles/
│   ├── index.css                    # 聚合所有 styles（@import 12 个）
│   ├── tokens.css                   # CSS 变量（亮/暗）
│   ├── global.css                   # 滚动条、reset、.xtsql-pulse 工具类
│   ├── antd-dark-overrides.css
│   ├── Sidebar.css                  # 269-504 + line 1249 响应式
│   ├── ChatArea.css                 # 505-607 + line 1247 响应式
│   ├── MessageBubble.css            # 608-897 + line 1246 响应式
│   ├── ChatInput.css                # 898-1021 + line 1248 响应式
│   ├── Tabs.css                     # 1022-1039
│   ├── Drawer.css                   # 1040-1052
│   ├── LoginPage.css                # 1053-1167
│   ├── SqlPanel.css                 # 1168-1204
│   └── SkillDrawer.css              # 1205-1241
├── components/
│   ├── AppIcon.jsx                  # 已有
│   ├── ChatMessage.jsx              # 已有
│   ├── ConfigPanel.jsx              # 已有
│   ├── ConfirmDialog.jsx            # 已有
│   ├── LoginPage.jsx                # 已有
│   ├── ResizableTitle.jsx           # 已有
│   ├── UserChoiceDialog.jsx         # 已有
│   ├── markdownRenderers.jsx        # 已有
│   │
│   ├── modals/                      # 新建目录
│   │   ├── AddTableModal.jsx        # 4 步流程（state 下放）
│   │   ├── ChangePasswordModal.jsx  # Form.useForm 弹窗
│   │   ├── ExplainAnalyzeModal.jsx  # 流式 markdown 展示
│   │   └── SessionMessagesModal.jsx # 只读 Monaco
│   │
│   ├── Sidebar/                     # 新建目录
│   │   ├── Sidebar.jsx              # 侧边栏主组件
│   │   ├── SessionList.jsx          # 会话列表项
│   │   └── UserCard.jsx             # 用户信息卡
│   │
│   ├── SqlWorkbench/                # 新建目录
│   │   ├── SqlWorkbench.jsx         # Tabs + Collapse + Table
│   │   ├── SqlEditorPane.jsx        # Monaco + resizer
│   │   ├── ResultTable.jsx          # 结果表 + 导出
│   │   ├── ExplainPanel.jsx         # EXPLAIN 子页
│   │   └── useSqlWorkbench.js       # 状态机 hook
│   │
│   ├── SkillDrawer/                 # 新建目录
│   │   ├── SkillDrawer.jsx          # 抽屉 + 树 + 编辑器
│   │   └── useSkillDrawer.js        # 状态机 hook
│   │
│   ├── ChatInput/                   # 新建目录
│   │   ├── ChatInput.jsx            # 输入区 + 发送按钮 + token bar
│   │   └── useChatInput.js          # 状态机 hook
│   │
│   └── EmptyState.jsx               # 聊天空状态 + 建议列表
│
├── hooks/                           # 新建目录
│   ├── useSSEStream.js              # 通用 SSE 流式 hook（最大价值）
│   ├── useChatSession.js            # 聊天相关 state（reducer 化）
│   ├── useResizable.js              # 通用 resizer（height/width）
│   └── useApiResource.js            # 通用列表加载/分页
│
└── utils/                           # 已有
    └── monacoEnv.js
```

---

## 三、分阶段实施

### 第 1 阶段：CSS 拆分 + Modal 抽离（无风险）⭐ 推荐先做

**目标**：App.jsx → 约 1900 行，App.css → 11 个文件。
**改动量**：约 +500/-100 行（净减 ~400 行）。
**风险**：🟢 低。纯剪切 + 重新组织，行为完全等价。

#### 1.1 CSS 拆分（无任何 JS 改动）

剪切 App.css 12 段到独立文件，建 `styles/index.css` 统一 import，**App.css 仅保留 12 行 `@import`**：

```
src/
├── App.css                          # 13 行：12 个 @import（**不是 JS import**）
└── styles/
    ├── index.css                    # 12 个 @import 入口
    ├── tokens.css                   # 1-91
    ├── global.css                   # 92-112 + line 1242 (.xtsql-pulse 工具类)
    ├── antd-dark-overrides.css      # 113-268
    ├── Sidebar.css                  # 269-504 + line 1249 响应式
    ├── ChatArea.css                 # 505-607 + line 1247 响应式
    ├── MessageBubble.css            # 608-897 + line 1246 响应式
    ├── ChatInput.css                # 898-1021 + line 1248 响应式
    ├── Tabs.css                     # 1022-1039
    ├── Drawer.css                   # 1040-1052
    ├── LoginPage.css                # 1053-1167
    ├── SqlPanel.css                 # 1168-1204
    └── SkillDrawer.css              # 1205-1241
```

**App.css 终态**（**关键修正**：CSS 文件里用 `@import` 而非 JS `import`）：

```css
/* App.css - 仅聚合 */
@import './styles/tokens.css';
@import './styles/global.css';
@import './styles/antd-dark-overrides.css';
@import './styles/Sidebar.css';
@import './styles/ChatArea.css';
@import './styles/MessageBubble.css';
@import './styles/ChatInput.css';
@import './styles/Tabs.css';
@import './styles/Drawer.css';
@import './styles/LoginPage.css';
@import './styles/SqlPanel.css';
@import './styles/SkillDrawer.css';
```

> **⚠️ 易错点**：CSS 文件**不支持** JS 模块的 `import` 语句，必须用 `@import './path/file.css';`。原方案误写为 `import './styles/index.css';` 是 JS 语法，Vite 会编译失败。

> **替代方案**：也可以让 `index.css` 用 `@import` 聚合 12 个，再让 `App.css` 唯一 `@import` `index.css`。但这样 Vite 编译会多一层间接，**推荐直接 12 个 `@import` 平铺**。

**最终文件数**：1 个 `App.css`（聚合）+ 12 个 `styles/*.css` = **13 个 CSS 文件**。

**验证**：`vite build` 编译通过；所有 className 仍生效（@import 不会改变 CSS 作用域）。

#### 1.2 4 个 Modal 抽离（state 下放 + 纯展示分层）

按状态机自洽程度分两种模式：

**模式 A：state 完全下放**（Modal 自管 state，父组件只控制 open/close）

- `AddTableModal` (12 个 state，3 步流程机自洽)
- `SessionMessagesModal`（纯展示 + 关闭 reset）

**模式 B：state 留在父组件**（Modal 是纯展示层，SSE 处理在父组件）

- `ExplainAnalyzeModal`（流式 SSE 解析在 App.jsx，Modal 收 content/loading）
- `ChangePasswordModal`（改密回调在父组件）

##### 1.2.1 SessionMessagesModal（最简单，模式 A）

```jsx
// components/modals/SessionMessagesModal.jsx
export default function SessionMessagesModal({ open, onClose, content, tokens }) {
  return (
    <Modal title="会话消息详情" open={open} onCancel={onClose} footer={null} width={800}>
      <div style={{ padding: '12px 16px', ... }}>
        消息上下文长度：<b>{tokens}</b> tokens
      </div>
      <div style={{ height: 480 }}>
        <Editor height={480} defaultLanguage="json" value={content} theme="vs-dark" readOnly />
      </div>
    </Modal>
  );
}
```

App.jsx 替换：32 行 → 5 行（-27 行）。

##### 1.2.2 ChangePasswordModal（模式 B，移出文件）

- 已存在为 `function ChangePasswordModal`，直接 move 到 `components/modals/ChangePasswordModal.jsx`，加 `export default`。
- App.jsx 删除 line 2248-2336，替换为 `<ChangePasswordModal ... />`：-83 行。

##### 1.2.3 AddTableModal（模式 A，state 下放）

**11 个 state**（原方案误写 12） + 3 个 handler + 1 个 useEffect 全部移入 Modal：
- `addTableStep / addTableName / addTableChecking / addTableExists / addTableDDL / addTableDescription / addTableDomains / addTableSelectedDomains / addTableDomainsLoading / addTableRelatedTables / addTableCreating`
- `handleAddTableStep1/2/3` + `resetAddTableForm` + `handleAddTableModalClose`
- `useEffect` (addTableStep === 3 → load domains)

> **修正**：原方案说"12 个 state"是错误的，`addTableModalOpen` 留父组件，**实际下放 11 个**。

App.jsx 仅保留 `addTableModalOpen`：
```jsx
<AddTableModal
  open={addTableModalOpen}
  onClose={() => setAddTableModalOpen(false)}
  onCreated={loadSkillsList}  // 创建成功时回调
/>
```

App.jsx 减约 130 行 + **11 个 useState** + 5 个 handler。

##### 1.2.4 ExplainAnalyzeModal（模式 B，纯展示）

SSE 解析留在 App.jsx（涉及 50+ 行流处理），Modal 只接 `open / onClose / content / loading / isDarkTheme`：

```jsx
<ExplainAnalyzeModal
  open={explainAnalyzeModalOpen}
  onClose={() => setExplainAnalyzeModalOpen(false)}
  content={explainAnalysisContent}
  loading={explainAnalysisLoading}
  isDarkTheme={theme === 'dark'}
/>
```

App.jsx 减约 35 行。

**第 1 阶段总收益**：
- App.jsx 2338 → 约 1900 行（-438 行，**-18.7%**）
- App.css 1250 → 11 文件（每个 13-290 行）
- 风险：🟢 几乎为 0（已在前次执行中验证可工作）

---

### 第 2 阶段：通用 hook 抽取（中等风险）

**目标**：App.jsx → 约 1600 行。
**改动量**：抽 4 个 hook。
**风险**：🟡 中。需注意闭包陷阱、effect 依赖。

#### 2.1 `useSSEStream`（最大价值点）

**问题**：`handleSend`（247 行）+ `handleExplainAnalyze`（50 行）有大量重复的 SSE 读取逻辑：
- `response.body.getReader()` + `TextDecoder` + 行解析
- `data: ` 前缀剥离 + `JSON.parse` + try/catch
- 6+ 种事件类型分发（chunk / LLM / tool / tool_return / reasoning_chunk / reasoning_done / message_final / error / done）

**两路 SSE 现状对比**（[App.jsx:681](file:///D:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L681)、[App.jsx:1025](file:///D:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1025)）：

| 维度 | handleSend | handleExplainAnalyze | 是否对称 |
|---|---|---|---|
| abortControllerRef | ✅ 有（[line 147/681/903/908](file:///D:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L147)） | ❌ **缺失** | 不对称 |
| 流式进度更新 | ✅ messages 累加 | ✅ explainAnalysisContent 累加 | 对称 |
| 事件类型 | chunk/tool/tool_return/reasoning_*/message_final/done | chunk/done | 不同 |
| 状态机复杂度 | 高（5 阶段） | 低（3 阶段） | 不同 |
| 后端超时保护 | ✅（后端 `query.js` 修了 overallTimer） | ✅ | 对称 |

**关键修正**：原方案低估了 `handleExplainAnalyze` 的能力差距——它**完全没有取消机制**。如果用户在 AI 分析流式返回中关闭 Modal、点击其他地方或刷新页面，前端无法主动 abort，后端 LLM 仍在流式 + SSE 连接保持，浪费 token 与带宽。

**修正后的 useSSEStream 设计**（自带 abort 能力）：

```jsx
// hooks/useSSEStream.js
export function useSSEStream({ url, body, parser, onEvent }) {
  const [state, setState] = useState({ status: 'idle', content: '', error: null });
  const abortRef = useRef(null);          // ← 每路 SSE 独立 abort

  const start = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;         // ← 暴露给外部 abort
    setState({ status: 'streaming', content: '', error: null });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';

      while (true) {
        if (controller.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            acc = parser ? parser(acc, evt) : acc + (evt.content || '');
            onEvent?.(evt, acc);
          } catch {}
        }
      }
      setState(s => ({ ...s, status: 'done' }));
    } catch (e) {
      if (e.name === 'AbortError') {
        setState(s => ({ ...s, status: 'aborted' }));
      } else {
        setState(s => ({ ...s, status: 'error', error: e }));
      }
    } finally {
      abortRef.current = null;
    }
  }, [url, body, parser, onEvent]);

  // 暴露 abort 能力，handleExplainAnalyze 可在 Modal 关闭时调用
  const abort = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  // 组件卸载时自动 abort（防止内存泄漏 + 防止 setState on unmounted）
  useEffect(() => () => abort(), [abort]);

  return { state, start, abort };
}
```

**handleSend 改造**（用 ref 持久化 onEvent 避免闭包陷阱）：

```jsx
const onEventRef = useRef(null);
onEventRef.current = (evt, content) => {
  // 原 handleSend 中的 switch 块（247 行 → 60 行）
  switch (evt.type) {
    case 'chunk': setMessages(m => [...m, { role: 'assistant', content: evt.content, ... }]); break;
    case 'tool': /* ... */ break;
    case 'tool_return': /* ... */ break;
    // ...
  }
};

const { state: sendState, start: handleSend, abort: abortSend } = useSSEStream({
  url: '/api/query/generate',
  body: { messages, sessionId, ... },
  onEvent: (e, c) => onEventRef.current?.(e, c),
});
```

**handleExplainAnalyze 改造**（同时获得 abort 能力）：

```jsx
const onAnalyzeRef = useRef(null);
onAnalyzeRef.current = (evt, content) => {
  setExplainAnalysisContent(content);
  setExplainAnalysisLoading(evt.type !== 'done' && evt.type !== 'error');
};

const { state: analyzeState, start: runExplainAnalyze, abort: abortAnalyze } = useSSEStream({
  url: '/api/query/explain-analyze',
  body: { sql, explainResults },
  onEvent: (e, c) => onAnalyzeRef.current?.(e, c),
});

// Modal onCancel 时主动 abort
<ExplainAnalyzeModal
  open={explainAnalyzeModalOpen}
  onClose={() => {
    abortAnalyze();  // ← 新增：主动取消流
    setExplainAnalyzeModalOpen(false);
  }}
  content={explainAnalysisContent}
  loading={analyzeState.status === 'streaming'}
/>
```

**风险点**：
- 业务层事件分发回调的闭包陷阱（用 `onEventRef` 持久化 latest 回调，**关键**）
- `signal` 在 cleanup 中 abort 的时机（useEffect cleanup 函数）
- streaming 滚动用 rAF 节流的迁移
- `handleSend` 中原本用 `messagesRef` / `clientMsgIdRef` 跨流式保持 ID 的逻辑要保留
- 后端 `AbortError` 命名必须匹配（已在 `query.js` 中修复）

**收益**：
- `handleSend` 247 行 → 约 60 行（-187 行）
- `handleExplainAnalyze` 50 行 → 约 20 行（-30 行）
- 顺带修复 `handleExplainAnalyze` 缺 abort 的隐藏 bug（**新增价值**）

#### 2.2 `useResizable`（去重 4 段 onMouseDown 拖拽代码）

侧边栏拖宽、SQL 编辑器拖高、结果表拖高、输入框拖高 — 4 段几乎相同的 mousedown/mousemove/mouseup 代码。

**⚠️ Y 轴方向不一致**（提前标注，实施时需注意）：

| 拖拽位置 | 方向语义 | App.jsx 实际公式 |
|---|---|---|
| 侧边栏拖宽 | X 轴，右拖 = 增宽 | `start - m.clientX` |
| SQL 编辑器拖高 | Y 轴，**上拖 = 增高** | `startY - m.clientY` |
| **结果表拖高** | Y 轴，**上拖 = 增高** | `startY - m.clientY`（[App.jsx:1668](file:///D:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1668)）|
| 输入框拖高 | Y 轴，**下拖 = 增高** | `m.clientY - startY` |

**3 处 Y 拖拽，方向不一致**：结果表、SQL 编辑器向上 = 增高，输入框向下 = 增高。

**修正后的 hook 设计**：

```jsx
// hooks/useResizable.js
// direction: 'up' | 'down' | 'left' | 'right'
//   'down' = 鼠标向下 = 增大（输入框）
//   'up'   = 鼠标向上 = 增大（结果表、SQL 编辑器）
export function useResizable({ initial, min, max, direction = 'down' }) {
  const [size, setSize] = useState(initial);

  const handlers = useMemo(() => ({
    onMouseDown: (e) => {
      e.preventDefault();
      const isVertical = direction === 'up' || direction === 'down';
      const start = isVertical ? e.clientY : e.clientX;
      const startSize = size;
      let raf = 0;
      const move = (m) => {
        const pos = isVertical ? m.clientY : m.clientX;
        // 基础 delta（鼠标向下/右 = 增大）
        let delta = pos - start;
        // 方向反转（向上/左 = 增大）
        if (direction === 'up' || direction === 'left') delta = -delta;
        const next = Math.max(min, Math.min(max, startSize + delta));
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setSize(next));
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (raf) cancelAnimationFrame(raf);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    }
  }), [size, direction, min, max]);

  return [size, handlers];
}
```

**4 处调用**（每处从 20 行 → 1-2 行）：

```jsx
// 侧边栏
const [siderWidth, siderHandlers] = useResizable({ initial: 280, min: 200, max: 480, direction: 'left' });
// SQL 编辑器（上拖增）
const [sqlHeight, sqlHandlers] = useResizable({ initial: 200, min: 100, max: 500, direction: 'up' });
// 结果表（上拖增）
const [resultHeight, resultHandlers] = useResizable({ initial: 240, min: 100, max: 600, direction: 'up' });
// 输入框（下拖增）
const [inputHeight, inputHandlers] = useResizable({ initial: 120, min: 60, max: 300, direction: 'down' });
```

**预计减 -64 行**。

> **修正**：原方案中 `useResizable` 的 Y 轴方向与结果表/编辑器相反，会导致拖拽反向。已用 `direction` 参数修正。

#### 2.3 `useChatSession`（reducer 化聊天 state）

12+ 个 useState 涉及聊天（messages、isStreaming、loading、currentTokens、sessionScrollTopsRef、streamingScrollRafRef、clientMsgIdRef、messageCountRef、favoriteStates、chatSuggestions、sessionMessagesTokens、tokenWarningLevel、chatScrollTop）合并为 `useReducer(chatReducer, initialState)`。

**预计减 -50 行** 状态声明 + -30 行 setter 调用。

#### 2.4 `useApiResource`（去重列表加载模式）

`loadSessions` / `loadMessages` / `loadSkillsList` 三处相同模式：
- loadingRef 守卫
- try/catch + console.error
- finally 释放

抽成 `useApiResource(fetcher, deps)`。**预计减 -30 行**。

**第 2 阶段总收益**：
- App.jsx 1900 → 约 1600 行（-300 行）
- 风险：🟡 中（每个 hook 实施时需仔细测试）

---

### 第 3 阶段：大型复合组件抽离（中等风险）

**目标**：App.jsx → 约 800-1000 行。
**改动量**：4 个大块组件 + 子组件。
**风险**：🟡 中。状态提升/props drilling 需要设计。

#### 3.1 `<Sidebar>` + `<SessionList>` + `<UserCard>`

- 当前 117 行 JSX（line 1290-1406）
- props 透传：sessions / currentSessionId / editingSessionId / editingSessionName / user / sessionsTotal / 8 个回调
- 用 Context（`SidebarContext`）避免 8 层 props drilling

**预计 -90 行** App.jsx JSX。

#### 3.2 `<SqlWorkbench>`（最大块）

- 当前 260+ 行 JSX（line 1482-1742）
- 30+ state 中至少 15 个属于 SQL 工作台：`sqlInput / sqlEditorInst / sqlKey / resultKey / tabs / activeTabKey / currentResults / currentRowCount / currentQueryTime / pageSize / columnWidths / sqlPreviewHeight / resultTableHeight / explainResults / isExplainResult / explainPanelOpen`
- 抽成 `<SqlWorkbench />` + 内部 `useSqlWorkbench()` hook（reducer 化）
- 子组件拆分：
  - `SqlEditorPane` (Monaco + resizer + Execute/Explain 按钮)
  - `ResultTable` (Table + 导出)
  - `ExplainPanel` (Explain Table + AI 分析按钮)

**预计 -200 行** App.jsx JSX + -15 个 useState。

#### 3.3 `<SkillDrawer>`

- 当前 190 行 JSX（line 1896-2085）
- 14 个 state 中 10 个属于 Skill：`skillTree / skillFileContent / skillFileLanguage / skillSelectedFile / skillDrawerWidth / skillTreeCollapsed / skillContentCollapsed / skillLocked / skillSaving / skillOriginalContent / skillTreeHeight / skillEditorHeight / skillTreeActionsVisible`
- 抽成 `<SkillDrawer />` + `useSkillDrawer()` hook
- Monaco hover 隐藏定时器逻辑一起下放

**预计 -150 行** App.jsx JSX + -10 个 useState。

#### 3.4 `<ChatInput>`

- 70 行 JSX + 4 个 state（input / inputHeight / inputResizerRef + 来自父的回调）
- 抽成独立组件，input 相关 state 下放

**预计 -55 行** App.jsx JSX + -3 个 useState。

#### 3.5 `<EmptyState>`

- 17 行（line 1456-1472）
- 抽成 `<EmptyState suggestions={...} onSelect={setInput} />`

**预计 -10 行**。

**第 3 阶段总收益**：
- App.jsx 1600 → 约 900 行（**-700 行，累计 -62%**）
- 风险：🟡 中（每个大块独立测试）

---

### 第 4 阶段：清理与优化（可选）

- 删除未使用 imports（Select / Steps / Form / Space / Avatar / Popconfirm / Empty / List / InputNumber 已被我前次部分清理，可补完）
- 删除 `const { Panel } = Collapse;`（line 5，已确认未用）
- `useState` 中的 `schemaMode` 实际只在 handleSend 用，可与 `useChatSession` 合并
- 整理 handler 顺序：相关业务聚类，跨域用空行分隔

---

## 四、风险评估矩阵

| 阶段 | 改动点 | 风险 | 影响范围 | 回滚难度 | 建议 |
|---|---|---|---|---|---|
| 1.1 CSS 拆分 | 11 个文件 + 1 个 index | 🟢 0 | 样式 | 极低 | **必做** |
| 1.2.1 SessionMessagesModal | props 化 | 🟢 0 | 1 个 Modal | 极低 | **必做** |
| 1.2.2 ChangePasswordModal | 移出文件 | 🟢 0 | 1 个 Modal | 极低 | **必做** |
| 1.2.3 AddTableModal | 12 state 下放 | 🟢 低 | Modal 内部 | 低 | **必做** |
| 1.2.4 ExplainAnalyzeModal | props 化（state 留父） | 🟢 低 | 1 个 Modal | 极低 | **必做** |
| 2.1 useSSEStream | 通用化 SSE | 🟡 中 | handleSend + handleExplainAnalyze | 中 | 推后做 |
| 2.2 useResizable | 去重拖拽 | 🟢 低 | 4 处 JSX | 极低 | 可做 |
| 2.3 useChatSession | reducer 化 | 🟡 中 | 12+ state | 中 | 推后做 |
| 2.4 useApiResource | 去重列表加载 | 🟢 低 | 3 个 handler | 极低 | 可做 |
| 3.1 Sidebar | 大块抽离 | 🟡 中 | 117 行 JSX | 中 | 推后做 |
| 3.2 SqlWorkbench | 最大块 | 🟡 中 | 260+ 行 + 15 state | 高 | 推后做 |
| 3.3 SkillDrawer | 大块抽离 | 🟡 中 | 190 行 + 10 state | 中 | 推后做 |
| 3.4 ChatInput | 中块 | 🟢 低 | 70 行 | 低 | 可做 |
| 3.5 EmptyState | 小块 | 🟢 0 | 17 行 | 极低 | **必做** |

---

## 五、推荐执行顺序

```
Step 1 (30 分钟, 几乎 0 风险):
  ├─ 1.1 CSS 拆分 → 11 个文件
  └─ 1.2 4 个 Modal 抽离 (SessionMessages + ChangePassword + AddTable + ExplainAnalyze)

Step 2 (15 分钟, 0 风险):
  └─ 1.2.5 清理未用 imports + 删除 Panel 解构

Step 3 (45 分钟, 中等风险):
  ├─ 2.2 useResizable (4 处去重)
  └─ 2.4 useApiResource (3 处去重)

Step 4 (60 分钟, 中等风险):
  └─ 2.1 useSSEStream（handleSend 重构）

Step 5 (90 分钟, 中等风险):
  └─ 3.1-3.5 大块组件抽离（按依赖顺序：EmptyState → ChatInput → SqlWorkbench → SkillDrawer → Sidebar）
```

每一步结束都跑 `npm run dev` + `npm run build` 验证。

---

## 六、预期最终效果

| 指标 | 当前 | 第 1 阶段后 | 第 2 阶段后 | 第 3 阶段后 |
|---|---:|---:|---:|---:|
| App.jsx 行数 | 2338 | ~1900 | ~1600 | ~900 |
| App.css 行数 | 1250 | 1（入口） | 1 | 1 |
| App.jsx useState 数量 | 52 | 39 | 25 | 10 |
| App.jsx useEffect 数量 | 7 | 6 | 4 | 2 |
| App.jsx handler 数量 | 30+ | 25 | 20 | 12 |
| 单文件最大行数 | 2338 | 1900 | 1600 | 400 (SqlWorkbench) |
| 改一个 Modal 的影响半径 | 全文件 | 该 Modal 文件 | 该 Modal 文件 | 同左 |
| 新人理解成本 | 高 | 中 | 中 | 低 |

---

## 七、关键设计原则

1. **行为完全等价**：拆分不引入新 bug，不改变 UX，不改变接口
2. **state 下放优先**：自治的 state 全部下放到子组件（如 AddTableModal）
3. **依赖稳定层先拆**：CSS（0 风险）→ Modal（低风险）→ Hook（中风险）→ 大组件（中风险）
4. **每步可回滚**：每个 PR 只动一个阶段，git revert 即恢复
5. **不引入新依赖**：用 React 18 内置 `useReducer` / 自定义 hook，避免 zustand / jotai
6. **不动后端**：纯前端工程化，后端代码完全隔离
7. **不修改公共 API**：与 ChatMessage / LoginPage / ConfigPanel 等已有组件的接口不变

---

## 八、回滚预案

| 阶段 | 回滚方式 |
|---|---|
| 第 1 阶段 | `git revert <commit>` 即可，App.jsx 内容完整保留 |
| 第 2 阶段 | 同上，hook 文件删除即可 |
| 第 3 阶段 | 同上，组件文件删除即可 |

无数据库 schema 变更、无接口变更，零回滚成本。

---

## 九、修正日志

> 本节记录方案经评估复核后的**所有修正点**，便于追踪版本差异。

### 9.1 v2 修正（2026-07-15 评估复核后）

| # | 原方案问题 | 修正内容 | 影响 |
|---|---|---|---|
| 1 | CSS 拆 11 文件，遗漏 line 1242-1250 | 拆 **12 个**语义文件 + 1 入口 = 13 个；`.xtsql-pulse` 放 `global.css`，4 行响应式就近拆到组件 CSS | `App.css` 行数略增 |
| 2 | 写"11 个文件"实际是 12 | 全文统一为 **13 个**（1 聚合 + 12 语义） | 措辞 |
| 3 | `import './styles/index.css';` 误用 JS 语法 | 改用 **`@import './styles/file.css';`**（CSS 规范） | 关键：避免 Vite 编译失败 |
| 4 | AddTableModal 写"12 个 state" | 修正为 **11 个**（`addTableModalOpen` 留父） | 收益预估更准 |
| 5 | `useResizable` Y 轴方向与结果表/编辑器相反 | 加 **`direction: 'up' \| 'down' \| 'left' \| 'right'`** 参数 | 关键：避免拖拽反向 |
| 6 | `useSSEStream` 未考虑 `handleExplainAnalyze` 缺 abort | hook 内置 `abortRef` + cleanup + 暴露 `abort()`，Modal onCancel 调用 | 关键：避免流式泄漏 |

### 9.2 评估中讨论但未纳入方案的非阻塞项

- `Collapse.Panel` 已确认未用，**第 4 阶段**清理
- `useApiResource` 3 处去重在第 2 阶段
- `useChatSession` reducer 化在第 2 阶段
- 大块组件（SqlWorkbench / SkillDrawer / Sidebar / ChatInput / EmptyState）在第 3 阶段

---

## 十、相关历史

- **2026-07-15 historyText 死代码 + PERF-6 JSON 序列化方案**: [2026-07-15-historyText-deadcode-perf6-plan.md](file:///D:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-07-15-historyText-deadcode-perf6-plan.md)
- **2026-07-15 generate 路由代码分析报告**: [CODE_ANALYSIS_2026-07-15-generate.md](file:///D:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/reviews/CODE_ANALYSIS_2026-07-15-generate.md)
- **本次后端 bug 修复**（`/query/explain-analyze` 路由 overallTimer 缺失）：见 [query.js:800-807](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L800-L807)

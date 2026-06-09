# 阶段性优化分析报告

## 概述

对整个 XTSQLQueryAgent 项目（Electron 桌面应用 + Express 后端 + Vite/React 前端）做一次阶段性的代码审查，识别潜在的 Bug、性能瓶颈、操作不便、界面美观问题，作为后续优化的依据。

**审查范围**：

- `electron/main.js`（主进程 + 启动器）
- `backend/src/index.js`（后端入口）
- `backend/src/routes/*.js`（query / session / skill / config / tables / export）
- `backend/src/services/*.js`（llm / config / toolFuncs / tokenizer / logger）
- `backend/src/db/sqlite.js`（本地数据库）
- `frontend/src/App.jsx`、`App.css`、`api/index.js`、`utils/monacoEnv.js`
- `frontend/src/components/*.jsx`（ChatMessage / ConfigPanel / ResizableTitle / ConfirmDialog）

**审查原则**：不动现有业务逻辑，只标注问题、给出建议、明确严重度，由用户决定修复范围。

---

## 严重度图例

- 🔴 **H（高）**：影响程序稳定性、存在内存泄漏、可能误杀进程
- 🟠 **M（中）**：影响用户体验、可观察到的性能问题、潜在崩溃路径
- 🟡 **L（低）**：代码冗余、风格不一致、长期运行隐患

---

## 一、Bug 类（12 项）

> **更新**：本节会随实际修复进度更新，保留原始问题描述不动，仅追加 ✅ 状态与解决说明。

### B1. `generateSQLWithLangChain` 中 `toolsMap` 未定义

- **严重度**：🔴 H
- **状态**：✅ **已解决**（2026-06-09）
- **文件**：[`backend/src/services/llm.js:202`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L202)（原行号，函数已删除）
- **问题**：

  ```js
  // llm.js line 202 在 generateSQLWithLangChain 函数体内
  const tool = toolsMap.get(toolName);  // ReferenceError
  ```

  `toolsMap` 是在 `generateSQLWithLangChainStreamGen` 函数中才 `const toolsMap = new Map(...)` 定义的（line 652），而 line 202 处位于另一个函数 `generateSQLWithLangChain` 中，并没有这个常量。当 `schemaMode: 'langchain'` 模式被使用、且 LLM 触发任意工具调用时会直接抛 `ReferenceError: toolsMap is not defined`。

- **建议**：在该函数顶部补 `const toolsMap = new Map(tools.map(t => [t.name, t]));`，与 `generateSQLWithLangChainStreamGen` 对齐。

- **解决方式**：不补变量，而是直接把整个 `generateSQLWithLangChain` 函数废弃删除。理由是经核对，前端从未发送 `schemaMode: 'langchain'`（[`App.jsx:28`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L28) 默认值与 [`App.jsx:503`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L503) 实际传值都是 `'stream'`），[`query.js:306`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L306) 的 langchain 分支是死代码。顺手清理了同一文件中的另外两个同样无人调用的姊妹函数 `generateSQLWithLangChainStreamGen` 和 `generateSQLWithLangChainStreamGenV2`，并删除 `query.js` 中对应的 import 和 langchain 分支。涉及改动：

  1. `backend/src/services/llm.js` — 删除 `generateSQLWithLangChain` 函数体（约 215 行）
  2. `backend/src/services/llm.js` — `export { generateSQLWithLangChain, loadSkillMd }` → `export { loadSkillMd }`
  3. `backend/src/routes/query.js` — 移除 `generateSQLWithLangChain` 的 import
  4. `backend/src/routes/query.js` — 移除 `if (schemaMode === 'langchain')` 死代码分支

### B2. Monaco Editor `setInterval` 永远不清除

- **严重度**：🔴 H
- **状态**：✅ **已解决**（2026-06-09）
- **文件**：[`frontend/src/App.jsx:1140-1150`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1140-L1150)（原行号）
- **问题**：

  ```js
  setInterval(() => {
    const widgets = document.querySelectorAll('.monaco-hover, ...');
    widgets.forEach(w => {
      if (w.style.display !== 'none') {
        w.style.display = 'none';
      }
    });
  }, 100);
  ```

  该定时器在 `<Editor onMount>` 内创建，**从未被 `clearInterval`**。每次 SQL Tab 创建编辑器都会新增一个定时器，切换/卸载时它们仍在运行，**内存泄漏 + 持续 CPU 占用**。

- **建议**：保存 interval id，在 `onMount` 的 `editor.onDidDispose` 回调中 clear；或者改用 `MutationObserver` 监听 DOM 变化移除 hover 节点。

- **解决方式**：采用"保存 id + onDidDispose 清理"方案。代码变化（[`frontend/src/App.jsx:1144-1162`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1144-L1162)）：

  ```js
  const hideHoverWidgets = () => {
    const widgets = document.querySelectorAll('.monaco-hover, .monaco-editor-hover, .workbench-hover, .monaco-tooltip');
    widgets.forEach(w => {
      if (w.style.display !== 'none') w.style.display = 'none';
    });
  };

  const hoverClearInterval = setInterval(hideHoverWidgets, 100);
  // 编辑器销毁时清理定时器，避免内存泄漏
  const disposeDisposable = editor.onDidDispose(() => {
    clearInterval(hoverClearInterval);
    disposeDisposable?.dispose();
  });
  ```

  验证：`npm run build` 一次通过，无语法错误。Monaco 在组件卸载/编辑器销毁时会自动触发 `onDidDispose`，定时器随之清除，不再泄漏。

### B3. `killProcessOnPort` 可能误杀非 LISTENING 进程

- **严重度**：🟠 M（用户澄清后降级，见下）
- **状态**：🚫 **不改**（2026-06-09）— 设计原意如此
- **文件**：[`electron/main.js:122-160`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L122-L160)
- **问题**：

  ```js
  exec(`netstat -ano | findstr ":${port}"`, ...)
  ```

  `netstat -ano | findstr` 会返回所有 4-tuple 含该端口的行，包括 `ESTABLISHED` 状态（即真正的客户端连接）。后续 `taskkill /F /PID` 全部杀掉 → **可能误杀正在使用该端口的数据库连接、远端服务进程**。

- **建议**：仅筛选 `LISTENING` 状态行，例如用 `netstat -ano | findstr "LISTENING" | findstr ":5002"`；或更优地使用 `Get-NetTCPConnection -LocalPort 5002 -State Listen`（PowerShell）。

- **用户澄清（2026-06-09）**：

  > "B3 这里我当时要求每次启动时要删除相关的后台进程，之前有时候后台没有手动关闭造成 electron 后台起不起来。"

  行为是**有意为之**：每次启动 Electron 主动清理 5002 端口的占用（即使该进程不是 LISTENING 状态）。当前实现虽然粗放但符合产品需求。考虑到：

  1. 5002 是 Electron 与本机后端之间的私有端口，理论不会暴露给外部服务
  2. 用户的核心痛点是"上次后端没关掉 → 这次启不动"，严格筛选 LISTENING 可能漏掉某些占用场景
  3. 误杀外部进程的概率在单机本机端口上极低

  决定**保持现状不修改**。后续若遇到误杀问题再优化为 PowerShell `Get-NetTCPConnection -State Listen` 方案。

### B4. `skill.js` 中 `SKILL_V2_PATH` 在 `add-tag` 中未定义

- **严重度**：🟠 M
- **状态**：✅ **已解决**（2026-06-09）
- **文件**：[`backend/src/routes/skill.js:115-118`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L115-L118)（原行号）
- **问题**：

  ```js
  // line 115 add-tag 路由中
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  ```

  `SKILL_V2_PATH` 实际定义在文件末尾的 line 285，前置的 `add-tag` 路由会抛 `ReferenceError: SKILL_V2_PATH is not defined`，返回 500。

- **建议**：把 `const SKILL_V2_PATH = path.join(skillsPath, 'sql-creator-skill-v2');` 移到文件顶部。

- **解决方式**：将常量定义上移到 `skillsPath` / `skillBackPath` 同一区域（[`backend/src/routes/skill.js:17`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/skill.js#L17)），删除原 line 285 的旧定义。`add-tag` 等所有路由处理器现已能正确访问 `SKILL_V2_PATH`。验证：模块 `import` 测试 `module ok, router exported: function`；grep 确认 5 个引用点全部可见且仅一处定义。

### B5. SQLite `initDatabase` 中 `total_tokens` 列重复 ALTER

- **严重度**：🟠 M
- **状态**：✅ **已解决**（2026-06-09）
- **文件**：[`backend/src/db/sqlite.js:53-60`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L53-L60)（原行号）
- **问题**：同一个 `ALTER TABLE sessions ADD COLUMN total_tokens INTEGER DEFAULT 0` 出现两次，第二次的 try 块为空，代码冗余且未来出现 schema 错误不易发现。

- **建议**：删除重复块。

- **解决方式**：保留第一个（带 `logger.debug`）的 ALTER 块，删除第二个重复块（[`backend/src/db/sqlite.js:55-61`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/db/sqlite.js#L55-L61)）。`grep` 确认 `sessions.total_tokens` 的 ALTER 现仅 1 处（line 56），`messages.total_tokens` 1 处（line 93），共 2 处。模块 `import` 测试通过：`module ok: getDb, initDatabase, initSkillLogTable`。

### B6. 流式响应时不自动滚动到底部

- **严重度**：🟠 M
- **文件**：[`frontend/src/App.jsx:165-168`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L165-L168)
- **问题**：

  ```js
  useEffect(() => {
    if (messages.length > messageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      messageCountRef.current = messages.length;
    }
  }, [messages.length]);
  ```

  只监听 `messages.length` 变化，但流式 chunk 只更新 `content`，`messages.length` 不变 → **用户在底部发送问题后，看不到 LLM 在打字**。

- **建议**：在 `setMessages` 更新 content 时也调用 `scrollIntoView`；或监听 `content` 变化 + 加 rAF 防抖。

### B7. `<ChatMessage key={idx}>` 在流式中 splice log 时重渲染

- **严重度**：🟠 M
- **状态**：✅ **已解决**（2026-06-09）
- **文件**：[`frontend/src/App.jsx:1099`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1099)（现位置，原 line 1245 → 1099 因 B6 插入 rAF 句柄导致行号下移）
- **问题**：消息列表用 `key={idx}`，流式过程中调用 `newMsgs.splice(lastAssistantIdx, 0, logMsg)` 插入 log 消息，**所有后续组件的 key 错位**，React 卸载并重建这些组件 → 性能损耗 + 用户看到的展开状态丢失。

- **建议**：每条消息生成稳定 id（可用时间戳 + 角色），用 `key={msg.id}` 替代 `key={idx}`。

- **解决方式**：双命名空间稳定 id 方案。
  1. 客户端计数器：[`App.jsx:104`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L104) `const clientMsgIdRef = useRef(0)`
  2. DB 加载的消息：[`App.jsx:291`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L291) `id: \`db-${m.id}\`` 用后端 row id
  3. 新创建的 user/assistant：[`App.jsx:497-498`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L497-L498) `id: \`c-${++clientMsgIdRef.current}\``
  4. 流式插入的 log：[`App.jsx:579`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L579) 同样 `c-N`
  5. 渲染：[`App.jsx:1099`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1099) `key={msg.id}`

  后续所有 `setMessages` 更新路径（流式 chunk line 528、done line 600、error line 622）都用 spread `{ ...msg, ... }`，id 字段自动保留。`npm run build` 通过（24.79s）。

- **关于显示一致性**：id 只作 React 内部 key，**不参与渲染**。ChatMessage 渲染由 `role/content/logType/collapsed/timestamp` 决定。**附带发现**：DB messages 表无 `collapsed` 列，log 展开/收起状态不持久化（重启 app 后全部回到默认折叠）——用户已知晓，暂不修。

### B8. `/api/tables` 路由是空 router

- **严重度**：🟡 L
- **文件**：[`backend/src/routes/tables.js`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/tables.js) + [`backend/src/index.js:24`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js#L24)
- **问题**：整个 `tables.js` 只有 5 行，但 `app.use('/api/tables', tablesRouter)` 仍被注册。无用代码、误导维护。

- **建议**：删除 `tables.js` 和对应 `app.use`。

### B9. 给函数对象挂属性做"全局去重"

- **严重度**：🟡 L
- **文件**：[`frontend/src/App.jsx:97-99, 138-140, 190-192`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L97-L99)
- **问题**：

  ```js
  const loadCurrentModel = async () => {
    if (loadCurrentModel.loading) return;
    loadCurrentModel.loading = true;
    ...
  };
  loadCurrentModel.loading = false;
  ```

  这种"把状态挂在函数对象上"的写法是非标准模式，多个组件同时调用、Hot Reload、HMR 时容易出错（loading 标志可能残留）。

- **建议**：改用 `useRef` 或 `useState` + React Query / SWR 之类的请求去重方案。

### B10. useEffect 重复 appendChild `<style>`

- **严重度**：🟡 L
- **状态**：✅ **已解决**（2026-06-09）
- **文件**：[`frontend/src/App.jsx:153-228`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L153-L228)（原行号，删除前）
- **问题**：useEffect 每次组件重渲染时都创建一个新的 `<style>` 标签并 `appendChild` 到 head，再在 cleanup 中 remove。**style 内容完全是固定的**（CSS 类选择器 + 自定义滚动条），浪费性能，可能在低性能机器上看到视觉抖动。

- **建议**：将 style 内容移到 `App.css`，用普通 className 引用。

- **解决方式**：把 useEffect 内的 79 行 CSS 全部提取到 [`frontend/src/App.css`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.css)（已在文件顶部 `import './App.css'`），分类三段：表头固定、配置面板字体、隐藏滚动条。删除 App.jsx 中 79 行的 useEffect。`npm run build` 通过（29.04s）。`App.jsx` 搜索 `createElement('style')` 仅剩 1 处（line 1065，是 B2 修复中 Monaco hover 的另一个独立 useEffect，与 B10 无关）。

### B11. 启动 splash 60s 后强制 quit，但卡在初始化无响应

- **严重度**：🟡 L
- **状态**：✅ **此前已解决**（commit `110cd12` "feat: 新增 admin_category 相关配置与优化启动流程"）— 2026-06-09 阶段性分析中再次确认
- **文件**：[`electron/main.js:430-440`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L430-L440) + [`electron/splash.html`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/splash.html)
- **问题**：`setTimeout(() => { app.quit(); }, 60000)` 后端错误时 60 秒后强制退出；如果后端在 15s 启动超时前没产生任何 stderr（如 spawn 后立即被系统拦截），用户看到的是 splash 卡死 + 60s 后黑屏。

- **建议**：在 splash 上加 "**复制日志**""**退出**" 按钮，让用户能立即获取错误信息或主动退出；监听 `backendProcess.on('exit')` 在异常时立即提示。

- **验证（本次分析中）**：
  - [`electron/splash.html:117-120`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/splash.html#L117-L120) — 已有"复制日志" / "退出" 按钮
  - [`electron/splash.html:144-159`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/splash.html#L144-L159) — `copyBtn` / `exitBtn` 事件处理器已实现（`navigator.clipboard.writeText` / `window.close()`）
  - [`electron/main.js:288-296`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L288-L296) — `backendProcess.on('close')` 监听非零退出
  - [`electron/main.js:298-309`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L298-L309) — `backendProcess.on('error')` 监听 spawn 错误（含 ENOENT / EACCES 详细诊断）
  - [`electron/main.js:329-337`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L329-L337) — 15s 启动超时检测
  - [`electron/main.js:276-281`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L276-L281) — `finish` 幂等，多次调用不会重复 resolve

  60s 倒计时本身保留是合理 UX（用户有充裕时间阅读/复制错误信息），点击"退出"按钮后 `window.close()` 触发 `window-all-closed` → `app.quit()`，跳过 60s 等待。**无新增代码改动**。

### B12. ChatMessage 状态在切会话时不重置

- **严重度**：🟡 L
- **文件**：[`frontend/src/App.jsx:1245-1268`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1245-L1268)
- **问题**：`collapsed` 状态被持久化在消息对象中，切到新会话后旧消息的状态仍带着，刷新或回到旧会话会保持之前的状态（这本身没问题），但 `logType` 推断依赖 `m.role === 'LLM' ? 'llm' : ...` 当数据缺失时降级为 `'call'`，可能导致样式错乱。

- **建议**：在 `loadMessages` 时显式归一化 `logType`。

---

## 二、性能优化（9 项）

### P1. 多个 resizer 拖动时无 rAF / throttle

- **严重度**：🔴 H
- **状态**：✅ 2026-06-09
- **文件**：[`App.jsx:1138-1156, 1184-1202, 1323-1341, 1444-1462, 1491-1509, 1543-1561`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1138-L1156)
- **问题**：6 个 resizer（sqlPreview / resultTable / input / skillDrawer / skillTree / skillEditor）拖动时每像素 `setState`，鼠标移动 1 像素就触发 React 重渲染整个 App 树。

- **解决方式**：在每个 `handleMove` 内加入 rAF 节流——同帧内多次 mousemove 只触发一次 setState。`handleUp` 增加 `cancelAnimationFrame` 兜底。每处改动 +6 行，最小 diff 不动状态结构。`npm run build` 通过（26.15s）。

### P2. `columns` / `explainColumns` 每次渲染重新构造

- **严重度**：🟠 M
- **文件**：[`App.jsx:935-960`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L935-L960)
- **问题**：未用 `useMemo`，结果集变化时整张 table 重渲染（column 对象身份变化 → AntD Table 全部 cell 重渲）。

- **建议**：用 `useMemo` 包装 `columns`、`explainColumns`。

### P3. `<ChatMessage>` 没用 `React.memo`

- **严重度**：🟠 M
- **文件**：[`App.jsx:1245-1268`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1245-L1268)
- **问题**：流式响应时所有历史消息跟着重渲染（因 `setMessages` 整个数组引用变化）。

- **建议**：用 `React.memo(ChatMessage)` 包装；并将 `onToggleCollapse` 等用 `useCallback` 包装保持稳定。

### P4. 后端 `loadTableIndex` / `loadSkillMd` 每次都同步读盘

- **严重度**：🟠 M
- **状态**：🚫 2026-06-09（用户决定不修，要保证实时性）
- **文件**：[`backend/src/services/toolFuncs.js:11-25`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L11-L25)
- **问题**：每次 LLM 工具调用（get_tables / get_table_schema / get_table_ddl）都 `fs.readFileSync`，IO 频繁。

- **建议**：加内存缓存 + 文件 mtime 失效机制（参照 query.js 中 `loadSkillV2` 的 md5 缓存模式）。

- **决定**：用户明确表示**保持现状，不加缓存**。理由：业务要求 schema/table 变更后 LLM 工具调用必须立即看到最新结构，缓存 + mtime 失效一旦配置不当（如监听失败 / 失效延迟）会导致 LLM 拿到陈旧 schema，进而生成错误 SQL。IO 性能损耗相对错误 SQL 的代价可以接受。**无代码改动**。

### P5. 流式循环中 `JSON.stringify(messages, null, 2)` 序列化整个历史

- **严重度**：🟠 M
- **文件**：[`backend/src/services/llm.js:430-450`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L430-L450)
- **问题**：每次 round 都把整个 messages 数组用缩进格式序列化（仅用于 log），长对话时 CPU 浪费。

- **建议**：log 用紧凑 `JSON.stringify(req, null, 0)` 或完全跳过；只序列化必要字段（`model`、`messages.length`、`stream`）。

### P6. winston logger 单文件无限增长

- **严重度**：🟡 L
- **文件**：[`backend/src/logger.js`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/logger.js)
- **问题**：`app.log` 和 `error.log` 不会轮转，长期运行会占满磁盘。

- **建议**：使用 `winston-daily-rotate-file`，按天切分并保留 7-30 天。

### P7. 多个并发请求可合并

- **严重度**：🟡 L
- **文件**：[`App.jsx:117-135`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L117-L135)
- **问题**：`getSessions` → `getQueryMessages` → `getAgentConfig` 在加载第一个 session 时并发跑三次。

- **建议**：考虑后端聚合接口 `/api/sessions/initial`；或前端用 `Promise.all`。

### P8. SSE 写入未显式 `socket.setNoDelay(true)`

- **严重度**：🟡 L
- **文件**：[`backend/src/routes/query.js:255-280`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L255-L280)
- **问题**：小包数据可能因 Nagle 算法延迟。

- **建议**：在 `req.socket.setNoDelay(true)`。

### P9. 死代码：合并 allLogs 仅 logger.info 未实际存储

- **严重度**：🟡 L
- **文件**：[`backend/src/routes/query.js:306-318`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L306-L318)
- **问题**：

  ```js
  if (sessionId && allLogs.length > 0) {
    try {
      const logContent = allLogs.join('\n---\n');
      logger.info('保存日志', { sessionId: String(sessionId), logLength: logContent.length, logCount: allLogs.length });
    } catch (e) { ... }
  }
  ```

  实际上 `allLogs` 中的每条日志已经在 for 循环里实时单独保存了（line 280-291），这里只是 `logger.info` 一行，"保存"名不副实。

- **建议**：删除该块或实际写库。

---

## 三、操作优化（8 项）

| # | 严重度 | 建议 | 涉及位置 |
|---|------|------|---------|
| **O1** | 🟠 M | 添加 **Ctrl+N** 新建对话、**Ctrl+K** 搜索 session、**Ctrl+/** 注释 SQL、**Ctrl+Shift+F** 格式化 SQL 快捷键 | `App.jsx` |
| **O2** | 🟠 M | 结果区加"**复制 SQL**""**复制为 Markdown**"按钮；加"**格式化 SQL**"按钮（用 `sql-formatter`） | `App.jsx:1216-1230` |
| **O3** | 🟠 M | 助手消息加"**重新生成**"按钮（重用上一条问题） | `ChatMessage.jsx` |
| **O4** | 🟠 M | session 列表加搜索框（按名称/ID 过滤），超过 10 个 session 时尤其有用 | `App.jsx:1130-1145` |
| **O5** | 🟡 L | 输入框加 **↑/↓ 历史命令**（参考终端行为） | `App.jsx:1395-1405` |
| **O6** | 🟡 L | 右上角加"**清空当前对话**""**导出对话**"（JSON / Markdown）操作 | `App.jsx` |
| **O7** | 🟡 L | SQL Tab 加右键菜单（重命名、复制、关闭其他） | `App.jsx:1060-1100` |
| **O8** | 🟡 L | 编辑器加"跳转到行"快捷键（Ctrl+G） | `App.jsx` |

---

## 四、界面美观（12 项）

| # | 严重度 | 建议 | 涉及位置 |
|---|------|------|---------|
| **U1** | 🟠 M | ChatMessage 时间戳 `9px` 过小且对比度低，建议 `11px` + `#666` | [ChatMessage.jsx:21, 30, 110, 118](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/components/ChatMessage.jsx#L21) |
| **U2** | 🟠 M | 侧边栏 session 列表标题 `11px`、描述 `9px` 过小，建议 `13px` / `11px`；增加 `lineHeight` | [App.jsx:1214-1218](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1214-L1218) |
| **U3** | 🟠 M | token 进度条只有颜色，没有数字；建议显示 `xxx / xxx tokens` | [App.jsx:1431-1450](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1431-L1450) |
| **U4** | 🟠 M | 启动 splash 增加 spinner / 进度环 / 品牌 logo 替代纯文字 | [splash.html](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/splash.html) |
| **U5** | 🟠 M | 加**暗色模式**切换（现在只有 Monaco 是 dark，整体白色，长时间使用疲劳） | 整个 `App.css` |
| **U6** | 🟠 M | 流式响应助手消息在拿到第一个 chunk 前没有 spinner，建议加 `<Spin>` 兜底 | [App.jsx:1252-1262](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1252-L1262) |
| **U7** | 🟡 L | SQL 编辑器 `11px` 偏小，建议 `13px` | [App.jsx:1158](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1158) |
| **U8** | 🟡 L | Markdown 表格样式补充 `tableLayout: 'fixed'` 和斑马纹 | [ChatMessage.jsx:74-99](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/components/ChatMessage.jsx#L74) |
| **U9** | 🟡 L | 错误提示文案统一中文化 + 友好化（当前直接显示后端英文） | `App.jsx` + 后端 |
| **U10** | 🟡 L | 滚动条过细（6px）建议 8px 提升可见性 | [App.css:1-9](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.css#L1-L9) |
| **U11** | 🟡 L | Skill drawer 内编辑器锁定时没有明显视觉提示（应加遮罩/水印） | [App.jsx:1570-1600](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx#L1570-L1600) |
| **U12** | 🟡 L | 按钮 / 卡片无 hover 动效，整体偏静态 | `App.css` |

---

## 推荐修复顺序（Top 10）

> 状态更新会随着实际修复情况追加 ✅ / ⏳ / 🚧 标记。

| 排序 | 项 | 类别 | 理由 | 状态 |
|-----|----|------|------|------|
| 1 | **B1** `toolsMap` 未定义 | Bug | `langchain` 模式直接崩 | ✅ 2026-06-09（废弃整函数） |
| 2 | **B2** setInterval 不清理 | Bug | 真实内存泄漏 + CPU 浪费 | ✅ 2026-06-09（onDidDispose 清理） |
| 3 | **B3** killProcessOnPort 误杀 | Bug | 用户澄清是设计原意 | 🚫 2026-06-09（设计如此，保持） |
| 4 | **B4** SKILL_V2_PATH 未定义 | Bug | `add-tag` 直接报 500 | ✅ 2026-06-09（上移常量到顶部） |
| 5 | **B5** 重复 ALTER | Bug | 沉默错误 | ✅ 2026-06-09（删除第二个 ALTER） |
| 6 | **B6 / B7** 流式滚动 + key=idx | Bug | 用户体验问题 | ✅ 2026-06-09（B6 rAF 滚动，B7 双命名空间稳定 id） |
| 7 | **P1** resizer 无防抖 | 性能 | 拖动卡顿 | ✅ 2026-06-09（rAF 节流 6 处） |
| 8 | **P3** ChatMessage 加 React.memo | 性能 | 流式响应性能 | ⏳ |
| 9 | **P4** loadSkillMd/loadTableIndex 缓存 | 性能 | 后端 IO 优化 | 🚫 2026-06-09（用户决定不修，要保证实时性） |
| 10 | **U3** token 进度条加数字 | 界面 | 用户一目了然 | ⏳ |
| 11 | **B10** 动态 `<style>` useEffect | Bug | 性能浪费 | ✅ 2026-06-09（CSS 提到 App.css，删除 useEffect） |
| 12 | **B11** splash 60s 卡死 | Bug | 用户体验问题 | ✅ 此前已修（commit `110cd12`，本次复核） |

---

## 总结

- **Bug**：12 项，其中 3 项高严重度（崩溃 / 内存泄漏 / 误杀进程），建议优先处理 B1-B7
- **性能**：9 项，主要是 resizer 防抖、组件 memo、读盘缓存、字符串优化
- **操作**：8 项，主要加快捷键、复制 SQL、搜索 session、历史命令
- **UI**：12 项，主要调整字号、对比度、增加暗色模式、Markdown 表格样式、错误提示文案

整体代码质量良好（结构清晰、有 logger、有 error 处理），主要问题集中在前端流式响应状态管理和 Electron 启动器边界条件处理。

## 修复进度

| 日期 | 进展 |
|------|------|
| 2026-06-09 | ✅ **B1**：`generateSQLWithLangChain` 中 `toolsMap` 未定义。处理方式：废弃并删除 `generateSQLWithLangChain`、`generateSQLWithLangChainStreamGen`、`generateSQLWithLangChainStreamGenV2` 三个未使用函数；移除 `query.js` 的 import 与 `langchain` 死代码分支。 |
| 2026-06-09 | ✅ **B2**：Monaco `setInterval` 永远不清理。处理方式：保存 interval id，在 `editor.onDidDispose` 中 `clearInterval` 并 dispose disposable。`npm run build` 验证通过。 |
| 2026-06-09 | 🚫 **B3**：`killProcessOnPort` 误杀非 LISTENING 进程。用户澄清该行为是设计原意（启动时清理 5002 残留进程，防止上轮后端没关导致本轮启不动），决定保持现状不修改。 |
| 2026-06-09 | ✅ **B4**：`skill.js` 中 `SKILL_V2_PATH` 在 `add-tag` 等前置路由中未定义。处理方式：将常量上移到文件顶部（line 17），删除原 line 285 的旧定义。模块 import 测试通过。 |
| 2026-06-09 | ✅ **B5**：`sqlite.js` 中 `ALTER TABLE sessions ADD COLUMN total_tokens` 重复。处理方式：删除第二个重复块（含空 catch），保留带 `logger.debug` 的第一个。grep 确认 sessions/messages 各 1 处。 |
| 2026-06-09 | ✅ **B6**：流式 chunk 不触发滚动。处理方式：streaming chunk handler 末尾追加 rAF 节流的 `scrollIntoView`，并新增 `streamingScrollRafRef` 句柄。`npm run build` 验证通过。 |
| 2026-06-09 | ✅ **B7**：`<ChatMessage key={idx}>` 在流式 splice log 时触发不必要的 re-render。处理方式：双命名空间稳定 id 方案——`db-N`（后端 row id） + `c-N`（前端计数器 `clientMsgIdRef`），`key={msg.id}`。`npm run build` 通过。**附带发现**：DB messages 表无 `collapsed` 列，log 展开/收起状态不持久化，用户表示影响不大暂不修。 |
| 2026-06-09 | ✅ **B10**：App.jsx 中 79 行的 `useEffect(() => { createElement('style') ... })` 块。处理方式：把全部 CSS 提取到 `App.css`（已 import），分类表头固定 / 配置面板字体 / 隐藏滚动条三段；删除原 useEffect。`npm run build` 通过。 |
| 2026-06-09 | ✅ **B11**（此前已修）：复核 [`electron/splash.html`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/splash.html) 与 [`main.js:276-337`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L276-L337)，"复制日志" / "退出" 按钮、backend `close` / `error` 监听、15s 启动超时、`finish` 幂等均已就位（commit `110cd12` 引入）。**无新代码改动**。 |
| 2026-06-09 | ✅ **P1**：[`App.jsx`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/frontend/src/App.jsx) 6 处 resizer 拖动无 rAF 节流。处理方式：每个 `handleMove` 内 `cancelAnimationFrame` + 重新 `requestAnimationFrame`，`handleUp` 兜底 `cancelAnimationFrame`；状态结构不动。`npm run build` 通过（26.15s）。 |

下一步行动：用户决定修复范围后，按项修改，每个修改做最小化 diff，不动现有业务逻辑。

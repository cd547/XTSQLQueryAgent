# 更新日志

## 2026-04-24

### 代码拆分

#### 拆分 ChatMessage 和 ResizableTitle 组件
- 拆分为独立组件：
  - `components/ChatMessage.jsx` - 聊天消息组件 (~180行)
  - `components/ResizableTitle.jsx` - 表格列宽可调组件 (~14行)
- 清理未使用的 import：Card, Resizable
- App.jsx 从 1879 行减少到 1728 行

#### 删除未使用的组件
- 删除 `components/ConfigPanel.jsx` - 未被引用
- 删除 `components/QueryPanel.jsx` - 未被引用
- App.jsx 使用内部定义的 ConfigPanel

### 滚动条优化

#### 功能
- 左侧会话列表滚动条、聊天消息滚动条、右侧配置面板滚动条统一调细
- 从默认粗细调整为 6px 宽度

#### 修改文件
- `frontend/src/App.css` 添加全局滚动条样式：
  ```css
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #f1f1f1; }
  ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
  * { scrollbar-width: thin; scrollbar-color: #c1c1c1 #f1f1f1; }  /* Firefox */
  ```

### 聊天消息表格支持

#### 功能
- 聊天消息中的 Markdown 响应支持 GFM 表格语法渲染
- 添加自定义表格样式：边框、padding、背景色等

#### 修改文件
- `frontend/src/App.jsx` - ChatMessage 组件：
  - 添加 `markdownComponents` 配置表格渲染样式
  - ReactMarkdown 添加 `remarkPlugins={[remarkGfm]}`

### Monaco Editor 搜索框问题修复

#### 问题
- 代码编辑器搜索框 (Ctrl+F) 的关闭按钮无法点击
- 鼠标悬停时提示框不停闪烁

#### 解决方案
- 在 `onMount` 中动态注入 CSS 样式
- 使用定时器每 100ms 检测并隐藏 tooltip 元素
- 禁用 Monaco Editor 的多个提示功能：
  - `hover: { enabled: false }`
  - `quickSuggestions: false`
  - `parameterHints: { enabled: false }`
  - `suggestOnTriggerCharacters: false`
  - `acceptSuggestionOnEnter: 'off'`
  - `tabCompletion: 'off'`
  - `wordBasedSuggestions: 'off'`

#### 修改文件
- `frontend/src/App.jsx` - SQL Editor 配置和 onMount 逻辑
- `frontend/src/App.css` - CSS 样式覆盖

## 2026-04-18

### 总结聊天记录功能 (新增)

#### 功能
- 点击会话列表中每个会话的「更多」按钮，选择「总结聊天」
- 将该会话的 user 和 assistant 对话按顺序发送给大模型
- 大模型生成两个内容：
  - 100字左右的总结 (summary)
  - 20字以内的标签 (name)
- 自动更新 sessions 表的 name 字段为标签内容
- sessions 表新增 summary 字段存储详细总结

#### 后端 API
- `POST /api/sessions/:id/summarize` - 总结指定会话
- 数据库 sessions 表新增 `summary` TEXT 字段

#### 前端
- `summarizeSession()` API 函数
- `handleSummarizeSession()` 处理函数
- 会话下拉菜单新增「总结聊天」选项 (FileTextOutlined 图标)

### 查询结果显示耗时 (新增)

#### 功能
- 查询结果标题显示：查询结果 (100 条 耗时: 300ms)
- 后端返回 queryTime 字段，前端解析并显示

#### 后端 API
- `POST /api/query/execute` 返回新增 `queryTime` 字段（毫秒）

#### 前端
- App.jsx 新增 `queryTime` state
- QueryPanel.jsx 新增 `queryTime` state
- 标题格式：`查询结果 ({rowCount} 条 耗时: {queryTime}ms)`

### Ollama 本地模型支持 (新增)

#### 功能
- 配置面板新增 Ollama (本地) Provider 选项
- 支持连接本地部署的大语言模型
- API Key 填写 Ollama 地址（默认 http://localhost:11434）
- 模型填写本地模型名（如 llama3.2, qwen2.5 等）

#### 后端改动 (backend/src/services/llm.js)
- `getProviderConfig()` 添加 ollama 配置: baseURL=http://localhost:11434, model=llama3.2
- `generateSQLWithLangChainStreamGenV2()` switch 添加 case 'ollama'

#### 前端改动
- ConfigPanel.jsx 下拉选项已支持：`<Select.Option value="ollama">Ollama (本地)</Select.Option>`
- API Key 改为可填写本地地址

### SQL EXPLAIN 功能 (新增)

#### 功能
- 在 SQL 预览区域添加 "EXPLAIN" 按钮
- 点击后执行 SQL 执行计划分析
- 结果显示在查询结果区域
- 优先执行选中的 SQL，无选中则执行全部

#### 后端 API
- `POST /api/query/explain` - 执行 EXPLAIN 语句
- 安全验证：仅允许 SELECT/EXPLAIN 开头
- 禁止：INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE

#### 前端
- `explainQuery()` API 函数
- `handleExplain()` 处理函数
- 按钮使用 `SelectOutlined` 图标

### Skill查看器 - 表格添加功能 (新增)

#### 功能流程
- 点击"添加"按钮 → 弹出 Modal 引导框
- 步骤1：输入表名 → 检查 table_index.json 是否存在
  - 已存在：提示"表已存在，是否继续？"
  - 不存在：进入步骤2
- 步骤2：获取 DDL
  - 后端使用已保存的数据库配置连接真实库
  - 执行 `SHOW CREATE TABLE {table_name}` 获取 DDL
  - 自动提取表注释和关联表（FOREIGN KEY）
- 步骤3：生成文件
  - 更新 table_index.json（添加表节点）
  - 生成 ddl/{表名}.sql
  - 生成 field_config/{表名}.json
  - 操作记录写入 skill_logs 表

#### 后端 API
- `POST /api/skills/check-table`: 检查表是否存在
- `POST /api/skills/fetch-ddl`: 从数据库获取 DDL
- `POST /api/skills/create-table-files`: 创建表格相关文件

#### 前端 API (frontend/src/api/index.js)
- `checkTableExists(tableName)` - 检查表是否存在
- `fetchTableDDL(tableName)` - 获取 DDL
- `createTableFiles(tableName, ddl, description)` - 创建文件

#### 自动提取
- `related_tables`: 从 DDL 的 FOREIGN KEY 自动分析
- `description`: 从 DDL 的 COMMENT 自动提取

#### UI优化
- skill-drawer-content 添加 `paddingTop: 5px`，解决目录结构与顶部线距离过近的问题

### Skill查看器 (新增功能)

#### 锁定机制
- 标题栏右侧添加锁定按钮 (`LockOutlined`/`UnlockOutlined`)
- 初始状态锁定 (`skillLocked: true`)
- 锁定状态：Monaco Editor 为只读模式
- 解锁状态：Editor 可编辑，显示保存按钮

#### 保存功能
- 保存按钮：仅在解锁且文件有改动时显示，小型图标按钮 (`EditOutlined`)
- 备份机制：
  - 备份目录：`skills/skill_back/{YYYYMMDDHHmmss}/{原目录结构}/`
  - 保留完整目录结构
- 数据库日志：`skill_logs` 表记录操作
  - 字段：operation, file_path, backup_path, old_content, new_content, status, error_message

#### 目录树优化
- 后端自动过滤 `skill_back` 目录，不显示在列表中
- 高度拖拽调整：80-400px，拖动条位于底部

#### 文件编辑器优化
- 高度拖拽调整：100-500px，拖动条位于顶部

#### 操作面板
- 位置：目录结构标题下方（仅解锁时显示）
- 包含"添加"按钮：`TableOutlined` 图标，蓝色 #1890ff，悬停提示"添加表格"

### UI调整 - 聊天输入区域

#### 输入框重构
- 分离为两部分：输入区域 + 操作行
- 输入框：去除边框，使用 autoSize 自适应高度
- 操作行：位于底部，包含模型名称 + token消耗 + 发送按钮

#### 发送按钮
- 缩小尺寸 (`size="small"`)
- 图标化：`SendOutlined`，无文字
- 字体 11px，内边距缩小

#### 信息显示
- 模型名称：12px，蓝色 #1890ff，加粗
- Token消耗：11px，灰色 #999
- 位置：发送按钮左侧，作为操作空间区域

### 后端改动

#### 数据库
- `sqlite.js`: 新增 `initSkillLogTable()` 初始化 `skill_logs` 表

#### 路由
- `skill.js`:
  - 新增 `POST /api/skills/save` 接口
  - `buildTree()` 过滤 skill_back 目录
  - 备份逻辑：创建备份目录，写入原文件，保存新内容，记录日志

### Agent配置功能 (backend + frontend)
- **数据库存储**: configs 表新增 agent 配置项
  - `agent_max_tool_calls`: 最大工具调用次数 (默认30)
  - `agent_timeout_ms`: 超时时间 (默认60000)
- **后端接口**: 
  - `GET /config/agent` 获取所有 agent 配置
  - `PUT /config/agent/:key` 更新单个配置
- **读取配置**: llm.js 从数据库读取 `maxToolCalls` 参数
- **配置面板**: Agent 配置区域可修改参数并保存

### Token统计优化
- **每轮记录**: 每次 DeepSeek API 调用保存 `role='usage'` 记录
- **过滤显示**: loadMessages 过滤掉 usage 类型，不在聊天历史显示
- **精确计算**: SQL 查询只统计 role='usage' 的记录，避免重复

### UI调整
- **日志样式**: 思考过程/工具调用/工具返回标签统一
- **图标优化**: 折叠箭头使用 Ant Design 图标 (CaretRightOutlined/DownOutlined)
- **Skill查看器折叠**: 目录结构和文件内容可独立折叠/展开
- **文件编辑器间距**: 底部保留 10px 间距

## 2026-04-11

### Token消耗统计功能 (新增)
- **DeepSeek API token 用量**: 请求时添加 `stream_options: { include_usage: true }`
  - 流式响应的最后一个 chunk 包含 usage 数据
- **解析 usage**: 在 llm.js 中提取并 yield usage 数据
  - `prompt_tokens`: 输入 token 数
  - `completion_tokens`: 输出 token 数
  - `total_tokens`: 总 token 数
- **数据库存储**: 
  - messages 表添加 `prompt_tokens`, `completion_tokens`, `total_tokens` 字段
  - sessions 表添加 `total_tokens` 字段累积
- **动态计算**: 从 messages 表 SUM 计算会话累积 token
  - `/sessions` 接口动态计算 `total_tokens`
  - `/sessions/:id/tokens` 从 messages 表查询
- **前端显示**: 发送按钮下方显示累积 token 消耗
  - `[currentTokens] tokens` 格式
  - 发送完成后累加
  - 切换会话时加载历史 token

### 功能新增 (frontend/src/App.jsx)
- **选中SQL执行**: SQL预览支持选中部分内容执行
  - 新增 `sqlEditorInst` state 和 `onMount` 获取 Monaco Editor 实例
  - 新增 `getSelectedSql()` 函数：优先返回选中文本，无选中则返回全文
  - 查询按钮改为执行 `getSelectedSql()` 而非直接使用 `sqlInput`

### UI调整
- **暗色主题**: SQL预览 Editor 添加 `theme="vs-dark"`
- **字体缩小**: SQL预览 Editor 字体从 12px 改为 11px

### 日志优化 (backend/src/services/llm.js)
- **立即刷新**: `queueLog()` 新增 `immediate` 参数
  - Round请求、工具调用、函数结束使用 `immediate=true` 立即写入日志
- **完成日志**: 每个函数结束添加完成标记日志
  - `queueLog(..., true)` + `flushLogs()` 确保日志不丢失

## 2024-04-11

### 性能优化 (backend src/services/llm.js)
- **抽取 Provider 映射函数**: 新增 `getProviderConfig()` 消除重复 switch 代码
  - 三个版本函数共用：generateSQLWithLangChain、StreamGen_BAK、StreamGen
- **日志缓冲写入**: 新增 `queueLog()` + `flushLogs()` 批量写入（1秒缓冲）
- **流式解析 Buffer 修复**: done=true 时用 `stream: false` 解码全部数据，避免丢失
- **tools 缓存**: 在函数开头创建 `toolsDefinition` 数组，避免每次请求重新创建
- **参数解析优化**: 传递完整 `parsedArgs` 对象给工具函数，支持多参数扩展
- **工具查找优化**: 创建 `toolsMap` (Map) 在 while 外部，查找从 O(n) 变为 O(1)
- **空 Catch 日志**: 添加 `logger.debug()` 记录解析失败，避免静默吞掉错误

### 2024-04-10

### 修复
- **Monaco Editor 本地化**: 解决首次加载一直显示 Loading 的问题
  - 问题原因：默认从 cdn.jsdelivr.net 加载，被浏览器 Tracking Prevention 阻止
  - 解决方案：使用本地 monaco-editor 包
    - 使用 cnpm 安装 monaco-editor 到 node_modules
    - 配置 `@monaco-editor/react` loader 使用本地路径
    - 配置 Vite optimizeDeps 预构建 monaco-editor
    - 更新 worker URL 指向本地路径

### UI 调整
- **隐藏下拉选择框**: 聊天界面底部隐藏了 schemaMode 下拉选择框（固定为 stream 模式）
- **代码字体缩小**: Skill 查看器代码区域字体从 12px 改为 11px
- **左侧栏布局重构**:
  - 顶部固定："新对话"按钮（带 PlusOutlined 图标，size="small"）
  - 中间滚动：会话列表（padding 紧凑）
  - 底部固定："配置"和"Skill"按钮（同一行显示，size="small"）
- **全局暗色主题**: 统一使用 vs-dark 主题，提升加载速度

### 文档更新
- 更新设计文档 `docs/superpowers/specs/2026-04-03-data-query-assistant-design.md`
  - 添加第 14 节：Monaco Editor 本地化
  - 添加第 15 节：UI微调

### 文件变更
- `frontend/src/App.jsx`
- `frontend/vite.config.js`
- `docs/superpowers/specs/2026-04-03-data-query-assistant-design.md`
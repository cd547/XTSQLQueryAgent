# 更新日志

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
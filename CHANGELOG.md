# 更新日志

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
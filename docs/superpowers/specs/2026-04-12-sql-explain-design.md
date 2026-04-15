# SQL EXPLAIN 功能设计

## 概述

在 SQL 预览区域添加 EXPLAIN 按钮，执行 SQL 执行计划分析。

## 功能流程

1. 用户点击 "EXPLAIN" 按钮
2. 获取当前 SQL（优先选中部分，无选中则用全部）
3. 验证 SQL 安全性（仅允许 SELECT/EXPLAIN 开头）
4. 调用后端 API 执行 EXPLAIN
5. 在"执行计划"面板显示结果

## 后端 API

### POST /api/query/explain
执行 EXPLAIN 并返回执行计划

Request:
```json
{ "sql": "SELECT * FROM table WHERE id = 1" }
```

Response:
```json
{
  "results": [
    { "id": 1, "select_type": "SIMPLE", "table": "table", "type": "const", ... }
  ],
  "rowCount": 1
}
```

### SQL 安全验证
- 仅允许 `SELECT` 或 `EXPLAIN` 开头的 SQL
- 禁止：INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE
- 错误返回：`{ "error": "只允许 SELECT/EXPLAIN 查询", "rowCount": 0 }`

## 前端 UI

### SQL 预览区域
- "查询" 按钮左侧添加 "EXPLAIN" 按钮
- 使用 `SelectOutlined` 图标

### 查询结果区域
- Tab区域内显示普通查询结果

### 执行计划面板（新增）
- 位置：查询结果Tab下方，外部独立
- 默认折叠，点击"EXPLAIN"按钮后自动展开
- 包含"AI分析"按钮（使用 `RobotOutlined` 图标）
- 仅在执行EXPLAIN后显示

## 实现文件

### 后端
- `backend/src/routes/query.js` - 新增 `/api/query/explain` 路由

### 前端
- `frontend/src/api/index.js` - 新增 `explainQuery(sql)` API
- `frontend/src/App.jsx` - 添加 EXPLAIN 按钮和处理函数

## 变更记录

- 2026-04-12: 初始实现
- 2026-04-13: 添加 AI 分析功能
  - 新增 /api/query/explain-analyze 路由（流式输出）
  - 前端添加 "AI分析" 按钮和 Modal
- 2026-04-14: UI 调整
  - 移除 SQL 预览区域的 AI 分析按钮
  - AI 分析按钮移至查询结果区域（导出Excel旁边）
  - 仅 EXPLAIN 结果时显示
  - 图标改为 RobotOutlined
- 2026-04-15: 面板分离
  - 新增"执行计划"独立折叠面板
  - 位于查询结果Tab下方
  - 添加 explainColumns 支持
  - AI分析按钮移至执行计划面板内
# SQL EXPLAIN 功能设计

## 概述

在 SQL 预览区域添加 EXPLAIN 按钮，执行 SQL 执行计划分析。

## 功能流程

1. 用户点击 "EXPLAIN" 按钮
2. 获取当前 SQL（优先选中部分，无选中则用全部）
3. 验证 SQL 安全性（仅允许 SELECT/EXPLAIN 开头）
4. 调用后端 API 执行 EXPLAIN
5. 在查询结果区域显示执行计划

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

- "查询" 按钮左侧添加 "EXPLAIN" 按钮
- 使用 `SelectOutlined` 图标
- 点击后调用 API，结果显示在查询结果区域

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
# SQL EXPLAIN 面板分离设计

## 概述

将 EXPLAIN 结果从查询结果中分离出来，单独显示在一个可折叠的"执行计划"面板中。

## 设计目标

1. 查询结果显示正常的查询结果
2. EXPLAIN 结果单独显示在"执行计划"面板中（查询结果Tab下面）
3. "执行计划"面板默认折叠，点击"EXPLAIN"按钮后展开
4. AI 分析按钮在"执行计划"面板内

## 页面布局

```
[SQL查询区域]
├── SQL编辑器
└── [EXPLAIN] [查询]

[Tab: SQL预览]
  └── SQL语句展示

[Tab: 查询结果]
  └── Table显示正常查询结果

[折叠面板: 执行计划]  ← 查询结果Tab下方，外部独立
  ├── 展开时显示EXPLAIN原始结果
  └── 包含"AI分析"按钮
```

## 状态管理

### 新增状态

- `explainResults`: EXPLAIN 原始结果数组 (第236行)
- `explainPanelOpen`: 执行计划面板展开状态，默认 false (第237行)

### 修改状态

- 保留 `isExplainResult` 用于控制"AI分析"按钮显示
- 查询结果保持只存储普通查询结果

## 交互流程

1. 用户点击 "EXPLAIN" 按钮
2. 调用 explainQuery API
3. 设置结果到 `explainResults`
4. 设置 `explainPanelOpen = true` (展开面板)
5. 设置 `isExplainResult = true`
6. 执行计划面板自动展开，显示EXPLAIN结果

### AI 分析

- "AI分析"按钮位置：执行计划面板内
- 调用 handleExplainAnalyze 时传入 explainResults

## 实现文件

### 前端变更

- `frontend/src/App.jsx`
  - 第236行: 新增 `explainResults` 状态
  - 第237行: 新增 `explainPanelOpen` 状态
  - 第880-892行: 新增 `explainColumns` 用于EXPLAIN结果表格
  - 第1154-1186行: 添加"执行计划"折叠面板组件
  - 第640-661行: handleExplain 函数设置 explainResults
  - 第664-683行: handleExplainAnalyze 使用 explainResults

## 变更记录

- 2026-04-15: 初始设计
  - 新增"执行计划"折叠面板
  - 分离 EXPLAIN 结果和查询结果
- 2026-04-15: 实现修复
  - 添加 explainColumns 解决EXPLAIN结果不显示问题
  - 执行计划面板移至Tab外部（查询结果下方）
  - 默认折叠，点击EXPLAIN后自动展开
# Skill 表格添加功能设计

## 概述

在 Skill 查看器中实现添加表格功能，通过引导流程自动创建表格相关的 skill 文件。

## 流程

```
[点击添加] → 输入表名 → 检查存在性 → 获取DDL → 生成文件 → 完成
```

### 步骤1：输入表名
- Modal 弹窗，输入框让用户填写表名
- 点击「下一步」时：
  - 调用后端 API 检查 table_index.json 中是否已存在该表
  - 已存在 → 提示「表已存在，是否继续？」，继续则跳过该表
  - 不存在 → 进入步骤2

### 步骤2：获取DDL
- 显示加载状态「正在查询数据库...」
- 后端使用已保存的数据库配置连接真实库
- 执行 `SHOW CREATE TABLE {table_name}` 获取 DDL
- 失败 → 提示错误，可返回修改表名
- 成功 → 进入步骤3

### 步骤3：生成文件
- 后端自动完成以下操作：
  1. 更新 table_index.json（添加表节点）
  2. 生成 ddl/{表名}.sql
  3. 生成 field_config/{表名}.json
- 完成显示成功提示，Modal 关闭

## 后端 API

### POST /api/skill/check-table
检查表是否存在于 table_index.json

Request: `{ "tableName": "xxx" }`

Response:
```json
{
  "success": true,
  "exists": true,
  "message": "表已存在"
}
```

### POST /api/skill/fetch-ddl
从数据库获取 DDL

Request: `{ "tableName": "xxx" }`

Response:
```json
{
  "success": true,
  "ddl": "CREATE TABLE...",
  "tableComment": "表注释内容",
  "relatedTables": ["table1", "table2"]
}
```

### POST /api/skill/create-table-files
创建表格相关文件

Request: `{ "tableName": "xxx", "ddl": "...", "tableComment": "..." }`

Response:
```json
{
  "success": true,
  "files": ["table_index.json", "ddl/xxx.sql", "field_config/xxx.json"]
}
```

## 文件格式

### 1. table_index.json 节点
```json
{
  "name": "表名",
  "description": "从DDL的COMMENT或表名语义生成",
  "tags": [],
  "related_tables": ["从DDL外键自动分析"],
  "business_constraints": [],
  "business_rules": []
}
```

### 2. ddl/{表名}.sql
直接存储 SHOW CREATE TABLE 结果

### 3. field_config/{表名}.json
```json
{
  "table_name": "表名",
  "field_aliases": {},
  "field_enums": {},
  "virtual_associations": [],
  "calculated_fields": {},
  "business_constraints": {},
  "business_rules": []
}
```

## related_tables 自动分析

从 DDL 中提取 `FOREIGN KEY` 关联的表：
```sql
FOREIGN KEY (xxx_id) REFERENCES table_name(...)
```

## 前端组件

- `AddTableModal` 组件实现三步骤引导流程
- 步骤状态：step1(输入) → step2(获取DDL) → step3(生成结果)
- 每步骤完成后可返回上一步

## 注意事项

1. 数据库连接使用已保存的配置（从 config.js 读取）
2. DDL 获取失败时允许用户返回修改表名
3. 生成文件后自动刷新目录树
4. 操作记录写入 skill_logs 表
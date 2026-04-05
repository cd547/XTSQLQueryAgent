---
name: SQL生成器V2
description: 智能SQL语句生成工具，基于数据库架构和业务规则，确保SQL的准确性、安全性和性能。
license: MIT
compatibility: opencode
---

## 技能目标
根据用户需求生成准确、安全的SQL语句。

## 触发条件
当用户提出以下类型的请求时触发：
- "生成SQL查询..."
- "查询...数据"
- "如何获取...信息"
- "SQL语句怎么写"
- "统计...数据"
- "更新...信息"
- "删除...记录"

## 数据源

- **table_index.json** - 表索引，包含所有表的 name/description/tags/related_tables
- **field_config/** - 字段配置，按需读取 (文件名 = 表名.json)
- **ddl/** - 建表语句，仅验证时读取 (文件名 = 表名.sql)

## 查找表的流程

1. 分析用户需求，提取业务关键词
2. 从 table_index.json 通过 tags/description 匹配相关表
3. 从 matched tables 的 related_tables 字段获取直接关联表
4. 如需间接关联，再读取 field_config/*.json 中的 virtual_associations
5. 如有歧义（一个词匹配多个表），询问用户确认
6. 返回涉及的所有表及关联关系

## AI工作方法

### 第一步：理解用户诉求
分析需求，确定查询类型 (SELECT/INSERT/UPDATE/DELETE)

### 第二步：筛选需要的表
从 table_index.json 匹配相关表，处理歧义

### 第三步：应用字段配置
读取对应 field_config/*.json，获取字段别名、枚举、关联、约束

### 第四步：验证结构（DDL）
仅需要验证时读取 ddl/*.sql

### 第五步：生成SQL
遵循 templates/output_format.md 模板生成SQL

## 添加新表流程

> **重要**：SKILL.md 不存储任何表名列表，所有表数据都存储在 table_index.json 中。

1. 用户提供 DDL (建表语句)
2. 通过对话引导填写 field_config/*.json：
   - 表的中文描述 (description)
   - 业务标签 (tags)
   - 字段别名 (field_aliases)
   - 枚举值 (field_enums)
   - 虚拟关联 (virtual_associations)
   - 业务约束 (business_constraints)
   - 业务规则 (business_rules)
3. 自动生成 table_index.json 条目 (包含 related_tables)
4. **将 DDL 保存到 ddl/ 目录 (文件名 = 表名.sql)**
5. 更新关联表的 related_tables（如需要）

## MySQL 5.7 限制

见 docs/mysql57_limits.md

## 输出格式

见 templates/output_format.md
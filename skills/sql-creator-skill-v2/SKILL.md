---
name: SQL生成器V2
description: 智能SQL语句生成工具，基于数据库架构和业务规则，确保SQL的准确性、安全性和性能。
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
2. 从 table_index.json 通过 tags/description 匹配相关表，如果没有找到，或者不确定，需要询问用户提供更多信息（如表名、字段名、业务场景等），绝对不能凭空猜测。
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
输出字段，必须严格按照ddl中对应表中的字段

### 第四步：验证结构（DDL）
仅需要验证时读取 ddl/*.sql

### 第五步：生成SQL
遵循 templates/output_format.md 模板生成SQL

## MySQL 5.7 限制

见 docs/mysql57_limits.md

## 输出格式

见 templates/output_format.md
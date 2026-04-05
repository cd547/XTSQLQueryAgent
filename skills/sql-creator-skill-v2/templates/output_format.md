# SQL 输出格式

## 标准 SQL 输出模板

```sql
-- 生成时间: {时间}
-- 数据库类型: MySQL 5.7
-- 涉及表: {表名1}, {表名2}
-- 业务规则: {应用的field_config中的业务规则}

SELECT column1, column2
FROM table1
JOIN table2 ON table1.id = table2.table1_id
WHERE condition = ?
ORDER BY column1 DESC
LIMIT 1000;

-- 参数: [值1]
-- 说明: {详细业务说明}
-- 警告: {如有风险操作}
-- 数据来源: table_index.json 和 field_config
```

## 生成规则

- 使用参数化查询 `WHERE id = ?`
- 不使用 SELECT *
- 大表查询添加 LIMIT
- DELETE/UPDATE 必须有 WHERE 条件
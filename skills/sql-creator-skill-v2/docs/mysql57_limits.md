# MySQL 5.7 语法限制

## 不支持的特性

- 窗口函数 (ROW_NUMBER, RANK, DENSE_RANK, LEAD, LAG 等)
- 公共表表达式 (CTE: WITH 子句)
- JSON_TABLE() 函数
- 并行查询
- 降序索引
- 其他 MySQL 8.0+ 特性

## 替代方案

| 不支持特性 | 替代方案 |
|-----------|----------|
| 窗口函数 | 使用子查询或用户变量 |
| CTE | 使用临时表 |
| JSON_TABLE | 使用 JSON_EXTRACT() |

## 注意事项

- 始终使用参数化查询，避免 SQL 注入
- 大表查询必须添加 LIMIT，默认 1000
- 避免 SELECT *，明确指定字段名
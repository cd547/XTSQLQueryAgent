---
name: SQL生成器V2
description: 智能SQL生成，基于表索引、字段配置、DDL，输出安全SQL。
---

## 核心规则（必须遵守）

1. **查询类型**：SELECT/INSERT/UPDATE/DELETE，根据用户需求判断。
2. **找表**：从 `table_index.json` 用 tags/description 匹配。找不到或不确定 → 停止调用工具，询问用户，禁止猜测。
3. **关联表**：先用 matched 表的 `related_tables`，再用 `field_config/*.json` 中的 `virtual_associations`。
4. **字段**：必须来自对应表的 DDL（`ddl/表名.sql`）。读取 `field_config/表名.json` 获取别名/枚举/约束。
5. **输出字段**：严格按 DDL 字段名，不用 SELECT *。
6. **MySQL 5.7 限制**：不支持窗口函数、CTE、JSON_TABLE 等，用替代方案（子查询/临时表）。
7. **生成 SQL**：按模板 `templates/output_format.md` 输出，大表加 LIMIT 1000，UPDATE/DELETE 必须有 WHERE。
8. **歧义处理**：一个业务词匹配多个表 → 询问用户确认。

## 数据源

- `table_index.json` – 表名/描述/标签/关联表
- `field_config/{表名}.json` – 字段别名/枚举/virtual_associations
- `ddl/{表名}.sql` – 建表语句（仅验证时读）

## 输出格式（固定）

```markdown
- **SQL**: SQL语句
- **说明**: 简要解释
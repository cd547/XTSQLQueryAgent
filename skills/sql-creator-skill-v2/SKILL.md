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
```


## 上下文纠正与标签更新

当用户纠正表名时，执行以下逻辑：

1. **检测纠正**: 用户说"是 XXX 表"、"查 XXX 表"、"用 XXX 表"、"aa表就是edu_student"时，表示之前提到的术语与表名产生了关联
2. **术语提取**: 提取用户之前问题中未被匹配的关键词/术语
3. **调用工具**: 使用 `request_tag_confirmation` 工具，传入 term(术语)、table(表名)、description(表的描述)
4. **触发确认**: 工具返回带 `<!--confirm_tag_add:{}-->` 标记的字符串，触发前端确认框
5. **等待确认**: Agent 不自动执行，等待用户点击确认/取消
6. **执行更新**: 用户确认后，使用工具更新 `table_index.json` 中对应表的 tags 字段

### 示例场景

用户: "帮我查下aa表的数据"
Agent: 查找表，tags 中无"aa"关键词，匹配失败
用户: "aa表就是edu_student表"
Agent: 识别到"aa"与"edu_student"关联，调用 `request_tag_confirmation(term="aa", table="edu_student", description="学生")`
前端显示: "是否将'aa'添加到 edu_student 的标签？"
用户点击"是" → 标签添加成功
用户点击"否" → 忽略
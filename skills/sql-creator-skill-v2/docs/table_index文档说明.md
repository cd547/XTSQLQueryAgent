表索引文件 (`table_index.json`) 包含以下字段：
- `name`: 表名
- `description`: 表描述
- `tags`: 标签数组（可选）
- `related_tables`: 关联表数组（可选）
- `business_constraints`: 业务约束数组（可选）
- `business_rules`: 业务规则数组（可选）
  
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "table_index.json 数据结构说明",
  "description": "SQL Creator Skill V2 表索引文件的数据结构定义，供 AI Agent 理解字段含义",
  "type": "object",
  "properties": {
    "version": {
      "type": "string",
      "description": "文件版本号，用于版本管理"
    },
    "description": {
      "type": "string",
      "description": "文件描述信息"
    },
    "tables": {
      "type": "array",
      "description": "表索引数组，包含所有可查询的表信息",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "表名，数据库中的实际表名，用于生成 SQL"
          },
          "description": {
            "type": "string",
            "description": "表的中文描述，帮助 AI 理解表的业务含义"
          },
          "tags": {
            "type": "array",
            "description": "表的标签/别名列表，用于自然语言匹配（可选，不存在表示无标签）",
            "items": { "type": "string" }
          },
          "related_tables": {
            "type": "array",
            "description": "关联表名列表，用于多表关联查询（可选，不存在表示无关联）",
            "items": { "type": "string" }
          },
          "business_constraints": {
            "type": "array",
            "description": "业务约束条件列表（可选，不存在表示无约束）",
            "items": { "type": "string" }
          },
          "business_rules": {
            "type": "array",
            "description": "业务规则说明列表（可选，不存在表示无规则）",
            "items": { "type": "string" }
          }
        },
        "required": ["name", "description"]
      }
    }
  }
}
```
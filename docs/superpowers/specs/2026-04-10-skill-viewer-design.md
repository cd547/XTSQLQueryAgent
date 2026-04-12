# Skill查看器设计文档

## 概述

在左侧栏添加Skill按钮，点击后在新右侧Drawer中展示skills文件夹的目录结构和文件内容。

## UI设计

### 1. 左侧栏按钮布局
- 在"配置"按钮下方添加"Skill查看"按钮
- 使用 `FolderOutlined` 图标

### 2. 右侧Drawer
- 宽度: 480px（可拖拽调整，范围300-800px）
- 标题: "Skill查看器"，右侧包含锁定按钮
- 左侧边缘可拖拽调整宽度
- 分为上下两部分，各占50%高度

### 2.1 锁定按钮
- 位置: 标题栏右侧
- 状态:
  - 锁定状态(默认): 显示 `LockOutlined` 图标，颜色灰色 `#999`
  - 解锁状态: 显示 `UnlockOutlined` 图标，颜色绿色 `#52c41a`
- 功能:
  - 点击锁定按钮可切换锁定/解锁状态
  - 锁定状态下 Monaco Editor 为只读模式 (`readOnly: true`)
  - 解锁状态下 Monaco Editor 可编辑 (`readOnly: false`)
- 初始状态: 锁定 (`skillLocked: true`)

### 3. 上半部分 - 目录树
- 使用 Ant Design Tree组件
- 显示 skills/ 目录的完整结构（自动跳过 skill_back 备份目录）
- 支持展开/收起文件夹
- 支持拖拽调整高度（拖动条位于底部，向上拖动缩小，向下拖动增大，范围80-400px）
- 文件夹显示黄色 `FolderOpenOutlined` 图标
- 文件显示蓝色 `FileTextOutlined` 图标
- 隐藏滚动条，但支持鼠标滚轮滚动
- 目录标题下方操作面板（仅解锁状态下显示）
  - 包含"添加"按钮，带 `TableOutlined` 图标，文字和图标颜色为主题蓝色 `#1890ff`，悬停提示"添加表格"

### 4. 下半部分 - 内容显示
- Monaco Editor 始终保持渲染状态（预加载优化性能）
- 支持拖拽调整高度（拖动条位于顶部，向上拖动缩小，向下拖动增大，范围100-500px）
- 根据文件扩展名识别语言：
  - `.md` → markdown
  - `.json` → json
  - `.sql` → sql
  - 其他 → plain text
- 使用 vs-dark 主题
- 只读模式（锁定状态），带语法高亮
- 解锁状态下可编辑，并显示保存按钮

### 4.1 保存按钮
- 位置: 文件名称右侧
- 条件: 仅在未锁定且已选择文件且内容有改动时显示
- 图标: `EditOutlined`
- 点击后执行保存流程

## 保存功能

### 保存流程
1. **备份原始文件**: 在 `skills/skill_back/{时间戳}/{目录结构}/` 目录下保存原始文件
   - 时间戳格式: `YYYYMMDDHHmmss` (如 `20260412094659`)
   - 保留完整目录结构，如 `field_config/edu_course.json`
2. **保存新内容**: 将编辑后的内容写入原文件
3. **记录日志**: 将操作记录保存到数据库

### 后端API - 保存文件
```
POST /api/skills/save
Body: { "path": "field_config/edu_course.json", "content": "..." }
```
返回:
```json
{
  "success": true,
  "message": "File saved successfully",
  "backupPath": "skills/skill_back/20260412094659/field_config/edu_course.json",
  "backupFolder": "20260412094659"
}
```

### 数据库日志表
```sql
CREATE TABLE IF NOT EXISTS skill_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation TEXT,           -- 操作类型: "save"
  file_path TEXT,           -- 文件路径
  backup_path TEXT,         -- 备份文件路径
  old_content TEXT,         -- 原始内容
  new_content TEXT,         -- 新内容
  status TEXT,              -- 状态: "success" 或 "failed"
  error_message TEXT,       -- 错误信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## 后端API

### 1. 获取目录结构
```
GET /api/skills/list
```
返回:
```json
{
  "success": true,
  "tree": [
    {
      "key": "sql-creator-skill-v2",
      "title": "sql-creator-skill-v2",
      "isFolder": true,
      "isLeaf": false,
      "children": [
        { "key": "sql-creator-skill-v2/SKILL.md", "title": "SKILL.md", "isFolder": false, "isLeaf": true, "language": "markdown" },
        { "key": "sql-creator-skill-v2/templates", "title": "templates", "isFolder": true, "isLeaf": false, "children": [...] }
      ]
    }
  ]
}
```

### 2. 读取文件内容
```
GET /api/skills/read?path=xxx
```
返回:
```json
{
  "success": true,
  "content": "文件内容",
  "language": "json"
}
```

## 文件修改清单

### 后端
- `backend/src/routes/skill.js` - 新增路由实现
  - `GET /api/skills/list` - 获取skills目录树结构
  - `GET /api/skills/read` - 读取文件内容，自动识别语言类型
  - `POST /api/skills/save` - 保存文件，包含备份和日志记录
- `backend/src/db/sqlite.js` - 新增 `initSkillLogTable()` 函数
- `backend/src/index.js` - 调用 `initSkillLogTable()` 初始化日志表

### 前端
- `frontend/src/api/index.js` - 新增API函数
  - `getSkillsList()` - 获取目录结构
  - `readSkillFile(path)` - 读取文件内容
  - `saveSkillFile(path, content)` - 保存文件

- `frontend/src/App.jsx` - 主要修改
  - 新增状态: `skillOpen`, `skillTree`, `skillFileContent`, `skillFileLanguage`, `skillSelectedFile`, `skillDrawerWidth`, `skillLocked`, `skillSaving`, `skillOriginalContent`, `skillTreeHeight`, `skillEditorHeight`
  - 新增 `loadSkillsList()` 函数
  - 新增 `handleSkillFileSelect()` 函数（读取文件时保存原始内容到 `skillOriginalContent`）
  - 新增 `handleSkillSave()` 函数
  - 左侧栏添加"Skill查看"按钮
  - 新增 SkillDrawer 组件（Drawer + Tree + Editor）
  - 支持Drawer宽度拖拽调整
  - 目录树高度拖拽调整
  - Editor区域高度拖拽调整
  - Monaco Editor 预加载优化
  - 标题栏添加锁定按钮，切换 `skillLocked` 状态
  - Editor 的 `readOnly` 属性根据 `skillLocked` 动态控制
  - Editor 添加 `onChange` 回调更新 `skillFileContent`
  - 文件名称右侧添加保存按钮（仅未锁定且已选择文件且内容有改动时显示）
  - 目录构建时自动过滤 `skill_back` 目录

## 技术细节

1. **路径计算**: 后端使用 `path.resolve(__dirname, '../../../')` 计算项目根目录
2. **安全检查**: 读取/保存文件时验证路径是否在skills目录内，防止路径穿越攻击
3. **性能优化**: Monaco Editor 始终保持渲染状态，避免首次加载延迟
4. **滚动条隐藏**: 使用CSS隐藏滚动条但保留滚动功能
5. **备份机制**: 保存时自动在 `skills/skill_back/{timestamp}/` 目录下创建备份，保留目录结构
6. **日志记录**: 所有保存操作记录到数据库 `skill_logs` 表，包括操作类型、文件路径、备份路径、原始/新内容、状态和错误信息

## 目录结构示意

```
skills/
└── sql-creator-skill-v2/
    ├── SKILL.md
    ├── table_index.json
    ├── templates/
    │   └── output_format.md
    ├── field_config/
    │   ├── admin_user.json
    │   └── ...
    ├── ddl/
    │   ├── admin_user.sql
    │   └── ...
    └── docs/
        └── mysql57_limits.md
```

## 添加表格功能

### 概述

在 Skill 查看器中实现添加表格功能，通过引导流程自动创建表格相关的 skill 文件。

### 流程

```
[点击添加] → 输入表名 → 检查存在性 → 获取DDL → 生成文件 → 完成
```

### 步骤1：输入表名
- Modal 弹窗，输入框让用户填写表名
- 点击「下一步」时：
  - 调用后端 API 检查 table_index.json 中是否已存在该表
  - 已存在 → 提示「表已存在，是否继续？」
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

### 后端 API

#### POST /api/skills/check-table
检查表是否存在于 table_index.json

Request: `{ "tableName": "xxx" }`

Response:
```json
{
  "success": true,
  "exists": true,
  "message": "表已存在或不存在"
}
```

#### POST /api/skills/fetch-ddl
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

#### POST /api/skills/create-table-files
创建表格相关文件

Request: `{ "tableName": "xxx", "ddl": "...", "description": "..." }`

Response:
```json
{
  "success": true,
  "files": ["table_index.json", "ddl/xxx.sql", "field_config/xxx.json"]
}
```

### 文件格式

#### 1. table_index.json 节点
```json
{
  "name": "表名",
  "description": "从DDL的COMMENT自动提取",
  "tags": [],
  "related_tables": ["从DDL外键自动分析"],
  "business_constraints": [],
  "business_rules": []
}
```

#### 2. ddl/{表名}.sql
直接存储 SHOW CREATE TABLE 结果

#### 3. field_config/{表名}.json
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

### related_tables 自动分析

从 DDL 中提取 `FOREIGN KEY` 关联的表：
```sql
FOREIGN KEY (xxx_id) REFERENCES table_name(...)
```

### 前端组件

- `AddTableModal` 组件实现三步骤引导流程
- 步骤状态：step1(输入) → step1.5(已存在确认) → step2(获取DDL) → step3(生成结果)
- 每步骤完成后可返回上一步
- 使用 Ant Design Steps 组件显示进度

### 数据库连接

- 使用 `getConfig()` 从数据库读取已保存的数据库配置
- 使用 mysql2/promise 创建连接
- 执行完成后关闭连接

### 操作记录

- 操作记录写入 skill_logs 表
- operation: "create_table_files"
- new_content: 包含 tableName, ddl, relatedTables 的 JSON
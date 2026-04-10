# Skill查看器设计文档

## 概述

在左侧栏添加Skill按钮，点击后在新右侧Drawer中展示skills文件夹的目录结构和文件内容。

## UI设计

### 1. 左侧栏按钮布局
- 在"配置"按钮下方添加"Skill查看"按钮
- 使用 `FolderOutlined` 图标

### 2. 右侧Drawer
- 宽度: 480px（可拖拽调整，范围300-800px）
- 标题: "Skill查看器"
- 左侧边缘可拖拽调整宽度
- 分为上下两部分，各占50%高度

### 3. 上半部分 - 目录树
- 使用 Ant Design Tree组件
- 显示 skills/ 目录的完整结构
- 支持展开/收起文件夹
- 文件夹显示黄色 `FolderOpenOutlined` 图标
- 文件显示蓝色 `FileTextOutlined` 图标
- 隐藏滚动条，但支持鼠标滚轮滚动

### 4. 下半部分 - 内容显示
- Monaco Editor 始终保持渲染状态（预加载优化性能）
- 根据文件扩展名识别语言：
  - `.md` → markdown
  - `.json` → json
  - `.sql` → sql
  - 其他 → plain text
- 使用 vs-dark 主题
- 只读模式，带语法高亮

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

### 前端
- `frontend/src/api/index.js` - 新增API函数
  - `getSkillsList()` - 获取目录结构
  - `readSkillFile(path)` - 读取文件内容

- `frontend/src/App.jsx` - 主要修改
  - 新增状态: `skillOpen`, `skillTree`, `skillFileContent`, `skillFileLanguage`, `skillSelectedFile`, `skillDrawerWidth`
  - 新增 `loadSkillsList()` 函数
  - 新增 `handleSkillFileSelect()` 函数
  - 左侧栏添加"Skill查看"按钮
  - 新增 SkillDrawer 组件（Drawer + Tree + Editor）
  - 支持Drawer宽度拖拽调整
  - Monaco Editor 预加载优化

## 技术细节

1. **路径计算**: 后端使用 `path.resolve(__dirname, '../../../')` 计算项目根目录
2. **安全检查**: 读取文件时验证路径是否在skills目录内，防止路径穿越攻击
3. **性能优化**: Monaco Editor 始终保持渲染状态，避免首次加载延迟
4. **滚动条隐藏**: 使用CSS隐藏滚动条但保留滚动功能

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
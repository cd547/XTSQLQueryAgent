# 标签智能添加功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SQL 查询助手中实现智能标签添加功能：当 Agent 因无法匹配表而查询失败，用户纠正后，询问用户是否将"术语"添加到对应表的 tags 字段，并通过前端确认框让用户确认。

**Architecture:** 在现有流式响应架构基础上，新增 `confirm_tag_add` 消息类型。前端识别该类型时在输入框下方弹出确认框，用户确认后调用 skill 保存接口更新 JSON 文件。

**Tech Stack:** React + Ant Design, Express, SSE 流式响应

---

## 文件结构

```
backend/src/routes/query.js      # 新增 confirm_tag_add 消息类型
frontend/src/components/
├── QueryPanel.jsx                # 新增确认框状态和渲染
├── ConfirmDialog.jsx             # 新增：确认框组件
skills/sql-creator-skill-v2/
└── SKILL.md                      # 新增上下文纠正规则
```

---

## Task 1: 更新 SKILL.md 增加上下文纠正规则

**Files:**
- Modify: `skills/sql-creator-skill-v2/SKILL.md:1-30`

- [ ] **Step 1: 读取当前 SKILL.md 内容**

```bash
read skills/sql-creator-skill-v2/SKILL.md
```

- [ ] **Step 2: 添加上下文纠正与标签更新规则**

在文件末尾新增：

```markdown
## 上下文纠正与标签更新

当用户纠正表名时，执行以下逻辑：

1. **检测纠正**: 用户说"是 XXX 表"、"查 XXX 表"、"用 XXX 表"时，表示之前提到的术语与表名产生了关联
2. **术语提取**: 提取用户之前问题中未被匹配的关键词/术语
3. **主动询问**: 发送特殊消息类型 `confirm_tag_add`，前端弹出确认框：
   - 消息格式: `{ type: 'confirm_tag_add', term: '术语', table: '表名', description: '表描述' }`
4. **等待确认**: Agent 不自动执行，等待用户点击确认/取消
5. **执行更新**: 用户确认后，使用工具更新 `table_index.json` 中对应表的 tags 字段

### 示例场景

用户: "帮我查下课程销量"
Agent: 查找表，tags 中无"课程"关键词，匹配失败
用户: "是 edu_course 表"
Agent: 识别到"课程"与"edu_course"关联，发送 confirm_tag_add 类型消息
前端显示: "是否将'课程'添加到 edu_course 的标签？"
用户点击"是" → Agent 执行更新
用户点击"否" → 忽略
```

- [ ] **Step 3: 提交**

```bash
git add skills/sql-creator-skill-v2/SKILL.md
git commit -m "feat: add context-aware tag update rules to SKILL.md"
```

---

## Task 2: 后端 - 新增 confirm_tag_add 消息类型

**Files:**
- Modify: `backend/src/routes/query.js:295-310`

- [ ] **Step 1: 在 query.js 中找到流式响应 done 消息位置**

读取 `backend/src/routes/query.js` 第 295-315 行，找到 `data.type === 'done'` 的位置。

- [ ] **Step 2: 新增 confirm_tag_add 类型处理函数**

在 `generateSQLWithLangChainStreamGen_BAK` 函数中，找到发送 `done` 类型的位置（第 361 行附近），在其前添加：

```javascript
// 检查是否需要触发标签添加确认
function checkTagAddConfirmation(historyText, currentQuestion) {
  // 如果用户纠正了表名（包含"是...表"、"用...表"等模式）
  // 且之前有未匹配的术语，返回 confirm_tag_add 类型
  // 这里由 LLM 判断是否触发，后端只负责转发
  return null; // 默认不触发，由前端/Agent 控制
}

// 在发送 done 消息前检查
// 注意：此功能需要 LLM 配合，在响应中包含 confirm_tag_add 类型
```

- [ ] **Step 3: 修改 SSE 发送逻辑支持 confirm_tag_add**

找到 `res.write` 发送 `done` 的位置（约 361 行），修改为：

```javascript
// 在 done 消息中添加可选的 confirm_tag_add 信息
// 当 LLM 返回的 message 中包含特定标记时触发
const doneData = {
  type: 'done',
  sql,
  message,
  sessionId,
  totalTokens
};

// 检查 message 中是否包含 confirm_tag_add 指令
// 格式: <!--confirm_tag_add:{"term":"课程","table":"edu_course"}-->
const confirmMatch = message.match(/<!--confirm_tag_add:(\{[^}]+\})-->/);
if (confirmMatch) {
  try {
    const confirmData = JSON.parse(confirmMatch[1]);
    doneData.confirm_tag_add = confirmData;
  } catch (e) {
    logger.warn('confirm_tag_add parse failed', { error: e.message });
  }
}

res.write(`data: ${JSON.stringify(doneData)}\n\n`);
```

- [ ] **Step 4: 提交**

```bash
git add backend/src/routes/query.js
git commit -m "feat: support confirm_tag_add message type in SSE"
```

---

## Task 3: 前端 - 新增确认框组件

**Files:**
- Create: `frontend/src/components/ConfirmDialog.jsx`

- [ ] **Step 1: 创建 ConfirmDialog 组件**

```javascript
import React from 'react';
import { Modal, Button, Space } from 'antd';

function ConfirmDialog({ visible, term, table, description, onConfirm, onCancel }) {
  return (
    <Modal
      open={visible}
      title="添加标签确认"
      footer={
        <Space>
          <Button onClick={onCancel}>否</Button>
          <Button type="primary" onClick={onConfirm}>是</Button>
        </Space>
      }
      onCancel={onCancel}
      closable={false}
      maskClosable={false}
    >
      <p>是否将 <strong>"{term}"</strong> 添加到表 <strong>{table}</strong> ({description}) 的标签字段中？</p>
      <p style={{ color: '#999', fontSize: 12 }}>
        添加后，下次查询时 Agent 可以通过"课程"直接匹配到 edu_course 表
      </p>
    </Modal>
  );
}

export default ConfirmDialog;
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/ConfirmDialog.jsx
git commit -m "feat: add ConfirmDialog component"
```

---

## Task 4: 前端 - 在 QueryPanel 中集成确认框

**Files:**
- Modify: `frontend/src/components/QueryPanel.jsx:1-20, 113-130, 295-330`

- [ ] **Step 1: 导入 ConfirmDialog 组件**

在文件顶部添加：

```javascript
import ConfirmDialog from './ConfirmDialog';
```

- [ ] **Step 2: 新增状态**

在 QueryPanel 组件中新增状态：

```javascript
const [confirmTagAdd, setConfirmTagAdd] = useState({
  visible: false,
  term: '',
  table: '',
  description: ''
});
```

- [ ] **Step 3: 处理 SSE 中的 confirm_tag_add**

在 `handleSend` 函数中，找到 `data.type === 'done'` 的处理（约 196-208 行），修改为：

```javascript
} else if (data.type === 'done') {
  // 检查是否有 confirm_tag_add
  if (data.confirm_tag_add) {
    setConfirmTagAdd({
      visible: true,
      term: data.confirm_tag_add.term,
      table: data.confirm_tag_add.table,
      description: data.confirm_tag_add.description || ''
    });
  }
  setMessages(prev => {
    const newMsgs = [...prev];
    const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
    if (lastAssistantIdx !== -1) {
      // 移除 confirm_tag_add 标记，只显示实际消息
      const cleanMessage = (data.message || data.sql || fullContent)
        .replace(/<!--confirm_tag_add:\{[^}]+\}-->/g, '');
      newMsgs[lastAssistantIdx] = {
        ...newMsgs[lastAssistantIdx],
        content: cleanMessage,
        isStreaming: false
      };
    }
    return newMsgs;
  });
}
```

- [ ] **Step 4: 添加确认框处理函数**

在 `handleExecute` 函数后添加：

```javascript
const handleConfirmTagAdd = async () => {
  const { table, term } = confirmTagAdd;
  try {
    // 调用 skill 保存接口更新 table_index.json
    const res = await fetch(`${API_BASE}/skills/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'skills/sql-creator-skill-v2/table_index.json',
        action: 'add_tag',
        tableName: table,
        tag: term
      })
    });
    if (res.ok) {
      message.success(`已将 "${term}" 添加到 ${table} 的标签`);
    } else {
      message.error('添加标签失败');
    }
  } catch (e) {
    message.error('添加标签失败: ' + e.message);
  }
  setConfirmTagAdd(prev => ({ ...prev, visible: false }));
};

const handleCancelTagAdd = () => {
  setConfirmTagAdd(prev => ({ ...prev, visible: false }));
};
```

- [ ] **Step 5: 渲染确认框**

在组件 return 的根 div 中，在 TextArea 上方添加：

```jsx
<ConfirmDialog
  visible={confirmTagAdd.visible}
  term={confirmTagAdd.term}
  table={confirmTagAdd.table}
  description={confirmTagAdd.description}
  onConfirm={handleConfirmTagAdd}
  onCancel={handleCancelTagAdd}
/>
```

- [ ] **Step 6: 提交**

```bash
git add frontend/src/components/QueryPanel.jsx
git commit -m "feat: integrate ConfirmDialog in QueryPanel"
```

---

## Task 5: 后端 - 实现 add_tag 保存逻辑

**Files:**
- Modify: `backend/src/routes/skill.js`

- [ ] **Step 1: 读取 skill.js**

```bash
read backend/src/routes/skill.js
```

- [ ] **Step 2: 在 save 接口中处理 add_tag action**

找到 POST `/save` 接口，添加新的 action 处理：

```javascript
// 在 save 接口中，action 为 'add_tag' 时处理
if (action === 'add_tag') {
  const { tableName, tag } = body;
  
  // 读取当前 table_index.json
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  const tableIndex = JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  
  // 找到对应表，添加 tag
  const table = tableIndex.tables.find(t => t.name === tableName);
  if (!table) {
    return res.json({ error: `表 ${tableName} 不存在` });
  }
  
  // 检查 tag 是否已存在
  if (!table.tags) {
    table.tags = [];
  }
  if (!table.tags.includes(tag)) {
    table.tags.push(tag);
  }
  
  // 备份并保存
  const backupPath = path.join(skillBackupPath, `table_index_${Date.now()}.json`);
  fs.copyFileSync(tableIndexPath, backupPath);
  fs.writeFileSync(tableIndexPath, JSON.stringify(tableIndex, null, 2), 'utf-8');
  
  logger.info('Tag added', { tableName, tag });
  return res.json({ success: true, message: `已将 "${tag}" 添加到 ${tableName} 的标签` });
}
```

- [ ] **Step 3: 提交**

```bash
git add backend/src/routes/skill.js
git commit -m "feat: support add_tag action in skill save API"
```

---

## Task 6: 集成测试

**Files:**
- 测试手动

- [ ] **Step 1: 启动服务**

```bash
# 后端
cd backend && npm start

# 前端
cd frontend && npm run dev
```

- [ ] **Step 2: 测试场景**

1. 在聊天中输入: "帮我查下课程销量"
2. Agent 无法匹配，回复无法找到相关表
3. 用户输入: "是 edu_course 表"
4. Agent 识别关联，发送 confirm_tag_add 类型
5. 前端弹出确认框: "是否将'课程'添加到 edu_course 的标签？"
6. 点击"是" → 标签添加成功
7. 点击"否" → 确认框关闭，无变化

- [ ] **Step 3: 验证 table_index.json 更新**

检查 `skills/sql-creator-skill-v2/table_index.json`，确认 edu_course 的 tags 中是否包含"课程"。

---

## 执行顺序

1. Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6
2. 每个 Task 的所有步骤完成后才能进入下一个 Task
3. Task 6 为集成测试，需要前后端同时运行
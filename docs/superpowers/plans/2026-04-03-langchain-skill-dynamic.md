# LangChain动态Skill调用实现计划

**Goal:** 使用LangChain LCEL + Function Calling实现动态skill调用，LLM按需获取表结构而非一次性注入所有数据

**Architecture:** 
- 定义Tool: get_tables (获取表列表), get_table_schema (获取表结构)
- 双模式: 用户可选fetch API或langchain模式
- 两轮对话: 第一轮确定所需表，第二轮生成SQL

**Tech Stack:** LangChain ^0.3.0, DynamicTool

---

## Task 1: 创建LangChain LLM服务

**Files:**
- Create: `backend/src/services/llm.js`

- [ ] **Step 1: 创建LLM服务**

```javascript
import { getLlmConfig } from './config.js';
import { logger } from '../logger.js';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_V2_PATH = path.join(__dirname, '../../../skills/sql-creator-skill-v2');

let cachedTableIndex = null;

function loadTableIndex() {
  if (cachedTableIndex) return cachedTableIndex;
  
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  if (fs.existsSync(tableIndexPath)) {
    cachedTableIndex = JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  }
  return cachedTableIndex;
}

function getTableSchema(tableName) {
  const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${tableName}.json`);
  if (fs.existsSync(fieldConfigPath)) {
    return JSON.parse(fs.readFileSync(fieldConfigPath, 'utf-8'));
  }
  return { error: `表 ${tableName} 的配置不存在` };
}

const tools = [
  new DynamicTool({
    name: "get_tables",
    description: "获取所有可用的表列表。每个表包含name(表名)、description(描述)、tags(标签)。用于了解数据库中有哪些表可用。",
    func: () => {
      const tableIndex = loadTableIndex();
      if (!tableIndex || !tableIndex.tables) return '暂无表数据';
      
      return tableIndex.tables.map(t => 
        `- ${t.name}: ${t.description} (标签: ${t.tags?.join(', ')})`
      ).join('\n');
    }
  }),
  new DynamicTool({
    name: "get_table_schema",
    description: "获取指定表的详细信息，包括字段别名、枚举值、业务约束等。参数: table_name(表名，必须)",
    func: (tableName) => {
      if (!tableName) return '请提供表名参数';
      return JSON.stringify(getTableSchema(tableName), null, 2);
    }
  })
];

export async function generateSQLWithLangChain(question, history = '') {
  const config = getLlmConfig();
  const { provider, apiKey, model } = config;
  
  let baseURL, llmModel;
  
  switch (provider) {
    case 'openai':
      baseURL = 'https://api.openai.com/v1';
      llmModel = model || 'gpt-4o';
      break;
    case 'deepseek':
      baseURL = 'https://api.deepseek.com/v1';
      llmModel = model || 'deepseek-chat';
      break;
    case 'minimax':
      baseURL = 'https://api.minimax.chat/v1';
      llmModel = model || 'abab6.5s-chat';
      break;
    default:
      throw new Error(`不支持的provider: ${provider}`);
  }
  
  const llm = new ChatOpenAI({
    model: llmModel,
    temperature: 0,
    apiKey: apiKey,
    baseURL: baseURL
  }).bindTools(tools);
  
  const systemMessage = `你是一个SQL查询专家。根据用户问题，使用提供的Tools获取必要的表结构信息，然后生成SQL。

## 可用Tools
- get_tables: 获取所有可用表列表
- get_table_schema(table_name): 获取指定表的详细信息

## 规则
1. 先使用get_tables了解有哪些表
2. 选择相关的表，使用get_table_schema获取字段信息
3. 只生成SELECT查询，不要生成INSERT/UPDATE/DELETE
4. 使用标准的MySQL语法
5. 如需限制结果条数，使用LIMIT默认1000
6. 返回JSON格式：{"sql": "SQL语句", "message": "简要说明"}

## 历史上下文
${history}

## 用户问题`;

  const response = await llm.invoke([
    { role: 'system', content: systemMessage },
    { role: 'user', content: question }
  ]);
  
  const content = response.content;
  
  let sql = '';
  let message = '';
  try {
    const parsed = JSON.parse(content);
    sql = parsed.sql || content;
    message = parsed.message || '';
  } catch {
    sql = content;
  }
  
  return { sql, message };
}

export default { generateSQLWithLangChain };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/llm.js
git commit -m "feat: add LangChain LLM service with Tools"
```

---

## Task 2: 修改query.js支持双模式

**Files:**
- Modify: `backend/src/routes/query.js`

- [ ] **Step 1: 添加langchain导入和模式判断**

在 query.js 顶部添加:
```javascript
import { generateSQLWithLangChain } from '../services/llm.js';
```

- [ ] **Step 2: 修改generate接口支持模式选择**

在 `/generate` 接口中，将:
```javascript
if (schemaMode === 'skill' || schemaMode === undefined) {
  // 原有静态注入逻辑
}
```

改为:
```javascript
if (schemaMode === 'langchain') {
  // 使用LangChain动态调用
  const result = await generateSQLWithLangChain(question, historyText);
  return res.json(result);
} else if (schemaMode === 'skill' || schemaMode === undefined) {
  // 原有静态注入逻辑
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/query.js
git commit -m "feat: add langchain mode support in query API"
```

---

## Task 3: 更新前端添加模式选择

**Files:**
- Modify: `frontend/src/components/QueryPanel.jsx`

- [ ] **Step 1: 添加langchain选项**

修改 Select:
```javascript
<Select value={schemaMode} onChange={setSchemaMode} style={{ width: 150 }}>
  <Select.Option value="langchain">LangChain (推荐)</Select.Option>
  <Select.Option value="skill">Skill静态</Select.Option>
  <Select.Option value="manual">本地存储</Select.Option>
  <Select.Option value="auto">自动获取</Select.Option>
</Select>
```

- [ ] **Step 2: 修改默认值**

```javascript
const [schemaMode, setSchemaMode] = useState('langchain');
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/QueryPanel.jsx
git commit -m "feat: add langchain mode option in frontend"
```

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-04-03-langchain-skill-dynamic.md`.

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task
**2. Inline Execution** - execute tasks in this session using executing-plans

Which approach?
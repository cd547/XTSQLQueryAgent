# 数据查询助手实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建公司内部数据查询助手Web应用，通过自然语言与AI Agent对话实现对公司MySQL数据库的数据查询

**Architecture:** 
- 前端：React + Ant Design + Vite (端口5173)
- 后端：Express + better-sqlite3（本地存储，端口5002）
- LLM：LangChain.js集成多provider
- 数据库：mysql2（目标库）+ SQLite（本地配置/会话存储）

**Tech Stack:** React 18, Express, LangChain.js ^0.3, mysql2, better-sqlite3, xlsx, winston

---

## M1: 项目初始化 + 基础框架搭建

### Task 1.1: 创建项目目录结构

**Files:**
- Create: `package.json`
- Create: `frontend/package.json`
- Create: `backend/package.json`

- [ ] **Step 1: 创建根目录 package.json**

```json
{
  "name": "xt-sql-query-agent",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
    "dev:frontend": "cd frontend && npm run dev",
    "dev:backend": "cd backend && npm run dev",
    "build": "npm run build:frontend && npm run build:backend",
    "build:frontend": "cd frontend && npm run build",
    "build:backend": "cd backend && npm run build"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

- [ ] **Step 2: 创建 backend/package.json**

```json
{
  "name": "backend",
  "version": "1.0.0",
  "main": "src/index.js",
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js"
  },
  "dependencies": {
    "express": "^4.21.0",
    "cors": "^2.8.5",
    "mysql2": "^3.11.0",
    "better-sqlite3": "^11.1.0",
    "langchain": "^0.3.0",
    "xlsx": "^0.18.5",
    "winston": "^3.14.0",
    "sql-parser": "^0.5.0",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 3: 创建 frontend/package.json**

```json
{
  "name": "frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "antd": "^5.20.0",
    "axios": "^1.7.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 4: 创建目录结构**

```bash
mkdir -p backend/src/routes backend/src/services backend/src/db frontend/src/components frontend/src/pages frontend/src/api skills data logs
```

- [ ] **Step 5: Commit**

```bash
git add package.json backend/package.json frontend/package.json
git commit -m "M1: init project structure"
```

---

### Task 1.2: 实现后端基础服务

**Files:**
- Create: `backend/src/index.js`
- Create: `backend/src/db/sqlite.js`
- Create: `backend/src/config.js`

- [ ] **Step 1: 创建后端入口**

```javascript
import express from 'express';
import cors from 'cors';
import { initDatabase } from './db/sqlite.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 初始化SQLite
initDatabase();

// 路由
import configRouter from './routes/config.js';
import queryRouter from './routes/query.js';
import sessionRouter from './routes/session.js';
import tableSchemaRouter from './routes/tableSchema.js';
import skillRouter from './routes/skill.js';

app.use('/api/config', configRouter);
app.use('/api/query', queryRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/table-schema', tableSchemaRouter);
app.use('/api/skills', skillRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

- [ ] **Step 2: 创建SQLite初始化**

```javascript
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/app.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

export function initDatabase() {
  const db = getDb();
  
  // 会话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 消息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      role TEXT,
      content TEXT,
      sql TEXT,
      results TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 表结构存储
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      description TEXT,
      columns TEXT,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'synced',
      auto_schema TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('SQLite initialized');
}
```

- [ ] **Step 3: 创建配置文件**

```javascript
export const config = {
  port: process.env.PORT || 3001,
  dbPath: process.env.DB_PATH || './data/app.db',
  skillPath: process.env.SKILL_PATH || './skills',
  logPath: process.env.LOG_PATH || './logs',
};
```

- [ ] **Step 4: 创建日志服务**

```javascript
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/app.log') 
    })
  ]
});
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.js backend/src/db/sqlite.js backend/src/config.js backend/src/logger.js
git commit -m "M1: add backend basic structure"
```

---

### Task 1.3: 实现前端基础结构

**Files:**
- Create: `frontend/vite.config.js`
- Create: `frontend/index.html`
- Create: `frontend/src/main.jsx`
- Create: `frontend/src/App.jsx`

- [ ] **Step 1: 创建Vite配置**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
```

- [ ] **Step 2: 创建入口HTML**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>数据查询助手</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 3: 创建React入口**

```javascript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'antd/dist/reset.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: 创建App组件**

```javascript
import React from 'react';
import { ConfigProvider, Layout } from 'antd';
import ConfigPanel from './components/ConfigPanel';
import QueryPanel from './components/QueryPanel';

const { Header, Content } = Layout;

function App() {
  return (
    <ConfigProvider>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ background: '#001529', padding: '0 24px', color: '#fff' }}>
          <h1 style={{ color: '#fff', margin: 0 }}>数据查询助手</h1>
        </Header>
        <Content style={{ padding: '24px' }}>
          <ConfigPanel />
          <QueryPanel />
        </Content>
      </Layout>
    </ConfigProvider>
  );
}

export default App;
```

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.js frontend/index.html frontend/src/
git commit -m "M1: add frontend basic structure"
```

---

## M2: 数据库连接 + 表结构获取

### Task 2.1: 配置接口

**Files:**
- Create: `backend/src/routes/config.js`
- Modify: `frontend/src/components/ConfigPanel.jsx`

- [ ] **Step 1: 创建配置路由**

```javascript
import express from 'express';
import mysql from 'mysql2/promise';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';

const router = express.Router();

// 测试数据库连接
router.post('/test', async (req, res) => {
  const { host, port, user, password, database } = req.body;
  
  try {
    const connection = await mysql.createConnection({
      host, port: port || 3306, user, password, database
    });
    await connection.end();
    res.json({ success: true, message: '连接成功' });
  } catch (error) {
    logger.error('DB connection failed', { error: error.message });
    res.json({ success: false, message: error.message });
  }
});

// 保存数据库配置
router.post('/db', async (req, res) => {
  const { host, port, user, password, database } = req.body;
  const db = getDb();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO configs (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);
  
  const configData = JSON.stringify({ host, port, user, password, database });
  stmt.run('db_config', configData);
  
  res.json({ success: true });
});

// 获取数据库配置（不包含密码）
router.get('/db', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('db_config');
  
  if (row) {
    const config = JSON.parse(row.value);
    delete config.password;
    res.json(config);
  } else {
    res.json({});
  }
});

// 保存LLM配置
router.post('/llm', async (req, res) => {
  const { provider, apiKey, model } = req.body;
  const db = getDb();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO configs (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);
  
  const llmConfig = JSON.stringify({ provider, apiKey, model });
  stmt.run('llm_config', llmConfig);
  
  res.json({ success: true });
});

// 获取LLM配置（不包含apiKey）
router.get('/llm', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');
  
  if (row) {
    const config = JSON.parse(row.value);
    delete config.apiKey;
    res.json(config);
  } else {
    res.json({});
  }
});

export default router;
```

- [ ] **Step 2: 创建ConfigPanel组件**

```javascript
import React, { useState, useEffect } from 'react';
import { Form, Button, Input, Select, message, Card, Space } from 'antd';
import { testConnection, saveDbConfig, getDbConfig, saveLlMConfig, getLlMConfig } from '../api/config';

function ConfigPanel() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [dbConfig, setDbConfig] = useState({});
  const [llmConfig, setLlmConfig] = useState({});

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    const [db, llm] = await Promise.all([getDbConfig(), getLlMConfig()]);
    setDbConfig(db);
    setLlmConfig(llm);
    form.setFieldsValue({ ...db, ...llm });
  };

  const handleTest = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const res = await testConnection(values);
      if (res.success) {
        message.success('连接成功');
      } else {
        message.error(res.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    await Promise.all([
      saveDbConfig(values),
      saveLlMConfig({ provider: values.provider, apiKey: values.apiKey, model: values.model })
    ]);
    message.success('配置已保存');
  };

  return (
    <Card title="配置" style={{ marginBottom: 16 }}>
      <Form form={form} layout="vertical">
        <Form.Item label="数据库Host" name="host" rules={[{ required: true }]}>
          <Input placeholder="localhost" />
        </Form.Item>
        <Form.Item label="端口" name="port" initialValue={3306}>
          <Input type="number" />
        </Form.Item>
        <Form.Item label="用户名" name="user" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item label="密码" name="password">
          <Input.Password />
        </Form.Item>
        <Form.Item label="数据库名" name="database" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Space>
          <Button onClick={handleTest} loading={loading}>测试连接</Button>
          <Button type="primary" onClick={handleSave}>保存配置</Button>
        </Space>
      </Form>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item label="LLM Provider" name="provider" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="openai">OpenAI</Select.Option>
            <Select.Option value="deepseek">DeepSeek</Select.Option>
            <Select.Option value="minimax">MiniMax</Select.Option>
            <Select.Option value="ollama">Ollama</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item label="API Key" name="apiKey" rules={[{ required: true }]}>
          <Input.Password />
        </Form.Item>
        <Form.Item label="模型" name="model">
          <Input placeholder="如: gpt-4o, deepseek-chat" />
        </Form.Item>
      </Form>
    </Card>
  );
}

export default ConfigPanel;
```

- [ ] **Step 3: 创建API文件**

```javascript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

export function testConnection(config) {
  return api.post('/config/test', config).then(r => r.data);
}

export function saveDbConfig(config) {
  return api.post('/config/db', config).then(r => r.data);
}

export function getDbConfig() {
  return api.get('/config/db').then(r => r.data);
}

export function saveLlMConfig(config) {
  return api.post('/config/llm', config).then(r => r.data);
}

export function getLlMConfig() {
  return api.get('/config/llm').then(r => r.data);
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/config.js frontend/src/components/ConfigPanel.jsx frontend/src/api/
git commit -M2: add config API and UI"
```

---

### Task 2.2: 表结构获取

**Files:**
- Create: `backend/src/routes/tables.js`
- Modify: `backend/src/routes/index.js`

- [ ] **Step 1: 修改后端路由添加表结构**

```javascript
// 在 index.js 中添加
import tablesRouter from './routes/tables.js';
app.use('/api/tables', tablesRouter);
```

- [ ] **Step 2: 创建表结构路由**

```javascript
import express from 'express';
import mysql from 'mysql2/promise';
import { getDb } from '../db/sqlite.js';
import { getConfig } from '../services/config.js';

const router = express.Router();

// 获取表列表
router.get('/', async (req, res) => {
  try {
    const config = await getConfig();
    const connection = await mysql.createConnection(config);
    const [rows] = await connection.query('SHOW TABLES');
    await connection.end();
    
    const tables = rows.map(row => Object.values(row)[0]);
    res.json({ tables });
  } catch (error) {
    res.json({ error: error.message, tables: [] });
  }
});

// 获取表结构（支持模式区分）
router.get('/schema', async (req, res) => {
  const { mode } = req.query; // auto, manual, skill
  
  try {
    if (mode === 'manual') {
      // 手动模式：从SQLite加载
      const db = getDb();
      const rows = db.prepare('SELECT table_name, description, columns FROM table_schemas').all();
      res.json({ schema: rows, mode: 'manual' });
    } else if (mode === 'skill') {
      // Skill模式：从文件加载
      const skill = loadSkills();
      res.json({ schema: skill.tables || [], mode: 'skill' });
    } else {
      // 自动模式：从数据库获取
      const config = await getConfig();
      const connection = await mysql.createConnection(config);
      const [tables] = await connection.query('SHOW TABLES');
      
      const schema = [];
      for (const table of tables) {
        const name = Object.values(table)[0];
        const [columns] = await connection.query(`DESCRIBE \`${name}\``);
        schema.push({ table: name, columns });
      }
      
      await connection.end();
      res.json({ schema, mode: 'auto' });
    }
  } catch (error) {
    res.json({ error: error.message, schema: [] });
  }
});

export default router;
```

- [ ] **Step 3: 创建配置服务**

```javascript
import { getDb } from '../db/sqlite.js';

export function getConfig() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('db_config');
  if (!row) throw new Error('数据库未配置');
  return JSON.parse(row.value);
}

export function getLlmConfig() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');
  if (!row) throw new Error('LLM未配置');
  return JSON.parse(row.value);
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/tables.js backend/src/services/config.js
git commit -M2: add table schema API"
```

---

## M3: LLM集成 + 自然语言转SQL

### Task 3.1: LLM服务

**Files:**
- Create: `backend/src/services/llm.js`

- [ ] **Step 1: 创建LLM服务**

```javascript
import { getLlmConfig } from './config.js';
import { logger } from '../logger.js';

const llmProviders = {
  openai: async (prompt, apiKey, model = 'gpt-4o') => {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  },
  
  deepseek: async (prompt, apiKey, model = 'deepseek-chat') => {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  },
  
  minimax: async (prompt, apiKey, model = 'abab6.5s-chat') => {
    const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  },
  
  ollama: async (prompt, host = 'http://localhost:11434', model = 'llama2') => {
    const response = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false })
    });
    const data = await response.json();
    return data.response || '';
  }
};

// 添加超时和重试
export async function generateSQL(question, schema, history = '', retries = 2) {
  const config = getLlmConfig();
  const { provider, apiKey, model } = config;
  
  const prompt = `你是一个SQL查询专家。根据以下数据库表结构，回答用户的问题并生成对应的SQL查询。

## 表结构
${schema}

## Skill
${skill}

## 历史上下文（参考之前对话）
${history}

## 规则
1. 只生成SELECT查询，不要生成INSERT/UPDATE/DELETE
2. 使用标准的MySQL语法
3. 如需限制结果条数，使用LIMIT默认1000
4. 返回JSON格式：{"sql": "SQL语句", "message": "简要说明"}

## 用户问题
${question}`;

  // 带超时的调用
  const callWithTimeout = async (fn, timeout = 10000) => {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('LLM调用超时')), timeout)
      )
    ]);
  };
  
  // 尝试主provider，失败时重试
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const providerFn = llmProviders[provider];
      if (!providerFn) throw new Error(`不支持的provider: ${provider}`);
      
      const result = await callWithTimeout(() => providerFn(prompt, apiKey, model));
      return result;
    } catch (error) {
      logger.error(`LLM调用失败 (尝试 ${attempt + 1})`, { error: error.message });
      
      // 最后一次尝试失败则抛出
      if (attempt === retries) {
        throw error;
      }
    }
  }
}

export default { generateSQL };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/services/llm.js
git commit -M3: add LLM service"
```

---

### Task 3.2: SQL生成和执行接口

**Files:**
- Create: `backend/src/routes/query.js`

- [ ] **Step 1: 创建查询路由**

```javascript
import express from 'express';
import mysql from 'mysql2/promise';
import { getDb } from '../db/sqlite.js';
import { getConfig } from '../services/config.js';
import { generateSQL } from '../services/llm.js';
import { validateSQL } from '../services/sqlValidator.js';
import { logger } from '../logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = express.Router();

// Skill缓存（模块加载时初始化，应用重启自动重载）
let cachedSkill = { content: '', version: 0, md5: '', lastLoad: null };

function loadSkills(forceReload = false) {
  try {
    const skillPath = path.join(__dirname, '../../skills/db_schema_skill.json');
    if (!fs.existsSync(skillPath)) return cachedSkill.content;
    
    const content = fs.readFileSync(skillPath, 'utf-8');
    const json = JSON.parse(content);
    const md5 = require('crypto').createHash('md5').update(content).digest('hex');
    
    // 检查是否需要重载（首次加载、强制重载、或MD5变化）
    const needsReload = !cachedSkill.md5 || forceReload || cachedSkill.md5 !== md5;
    
    if (!needsReload) {
      return cachedSkill.content;
    }
    
    // 版本变化，记录新版本
    const newVersion = (cachedSkill.version || 0) + 1;
    logger.info('Skill reloaded', { version: newVersion, md5 });
    
    cachedSkill = { 
      content: json, 
      version: newVersion, 
      md5,
      lastLoad: new Date()
    };
    
    return json;
  } catch (e) {
    logger.error('Skill load failed', { error: e.message });
    return cachedSkill.content;
  }
}

// 初始化加载（应用启动时）
loadSkills();

// 获取skill版本（供前端检查）
router.get('/version', async (req, res) => {
  loadSkills(); // 检查并重载
  res.json({ version: cachedSkill.version, md5: cachedSkill.md5, lastLoad: cachedSkill.lastLoad });
});

// 生成SQL（不执行）
router.post('/generate', async (req, res) => {
  const { question, sessionId, schemaMode } = req.body;
  
  try {
    // 获取历史
    const db = getDb();
    const messages = db.prepare(`
      SELECT content, sql FROM messages 
      WHERE session_id = ? 
      ORDER BY id DESC LIMIT 10
    `).all(sessionId || 0);
    const history = messages.reverse().map(m => m.content).join('\n');
    
    // 获取schema（根据模式）
    let schema = '';
    if (schemaMode === 'manual') {
      const rows = db.prepare('SELECT table_name, description, columns FROM table_schemas').all();
      schema = rows.map(r => `${r.table_name}: ${r.description}\n${r.columns}`).join('\n');
    } else if (schemaMode === 'skill') {
      schema = loadSkills();
    }
    
    // 截取最近10条历史消息，避免Prompt过长
    const historyText = messages.map(m => `用户: ${m.content}\n助手: ${m.sql || ''}`).join('\n');
    
    const result = await generateSQL(question, schema, historyText);
    
    // 解析JSON
    let sql = '';
    let message = '';
    try {
      const parsed = JSON.parse(result);
      sql = parsed.sql || result;
      message = parsed.message || '';
    } catch {
      sql = result;
    }
    
    res.json({ sql, message });
  } catch (error) {
    logger.error('SQL generation failed', { error: error.message });
    res.json({ error: error.message, sql: '' });
  }
});

// 执行SQL
router.post('/execute', async (req, res) => {
  const { sql, sessionId } = req.body;
  
  // 安全验证
  const validation = validateSQL(sql);
  if (!validation.valid) {
    return res.json({ error: validation.error, rowCount: 0 });
  }
  
  try {
    const config = getConfig();
    const connection = await mysql.createConnection(config);
    
    // 分页
    const countSql = sql.includes('LIMIT') ? sql : sql + ' LIMIT 1000';
    const [rows] = await connection.query(countSql);
    await connection.end();
    
    // 保存消息
    if (sessionId) {
      const db = getDb();
      db.prepare(`
        INSERT INTO messages (session_id, role, sql, results) 
        VALUES (?, 'user', ?, ?)
      `).run(sessionId, sql, JSON.stringify(rows));
      db.prepare(`
        INSERT INTO messages (session_id, role, results) 
        VALUES (?, 'assistant', ?)
      `).run(sessionId, JSON.stringify({ rowCount: rows.length }));
    }
    
    res.json({ results: rows, rowCount: rows.length });
  } catch (error) {
    logger.error('SQL execution failed', { error: error.message, sql });
    res.json({ error: error.message, rowCount: 0 });
  }
});

export default router;
```

- [ ] **Step 2: 创建SQL验证服务**

```javascript
import SQLParser from 'sql-parser';

export function validateSQL(sql) {
  if (!sql || typeof sql !== 'string') {
    return { valid: false, error: 'SQL不能为空' };
  }
  
  try {
    // 使用sql-parser解析
    const ast = SQLParser.parse(sql);
    if (!ast || !ast.statements || ast.statements.length === 0) {
      return { valid: false, error: '无效的SQL语句' };
    }
    
    const statement = ast.statements[0];
    
    // 检查statement type
    const allowedTypes = ['SELECT'];
    const stmtType = statement.type?.toUpperCase();
    
    if (!allowedTypes.includes(stmtType)) {
      return { valid: false, error: `只允许SELECT查询，不允许${stmtType}` };
    }
    
    // 额外字符串检查（双重保险）
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    const upper = sql.toUpperCase();
    for (const word of forbidden) {
      if (upper.includes(word)) {
        return { valid: false, error: `不允许执行 ${word} 操作` };
      }
    }
    
    return { valid: true };
  } catch (e) {
    // 解析失败时回退到字符串检查
    const upper = sql.toUpperCase().trim();
    if (!upper.startsWith('SELECT')) {
      return { valid: false, error: '只允许SELECT查询' };
    }
    
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    for (const word of forbidden) {
      if (upper.includes(word)) {
        return { valid: false, error: `不允许执行 ${word} 操作` };
      }
    }
    
    return { valid: true };
  }
}
```

- [ ] **Step 3: 添加路由到index.js**

```javascript
import queryRouter from './routes/query.js';
app.use('/api/query', queryRouter);
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/query.js backend/src/services/sqlValidator.js
git commit -M3: add query API with SQL generation"
```

---

## M4: 结果展示 + Excel导出

### Task 4.1: 前端查询界面

**Files:**
- Create: `frontend/src/components/QueryPanel.jsx`

- [ ] **Step 1: 创建查询面板**

```javascript
import React, { useState } from 'react';
import { Form, Input, Button, Table, Space, Card, Modal, message, Select } from 'antd';
import { queryGenerate, queryExecute } from '../api/query';

function QueryPanel() {
  const [loading, setLoading] = useState(false);
  const [sql, setSql] = useState('');
  const [results, setResults] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [schemaMode, setSchemaMode] = useState('auto');
  const [question, setQuestion] = useState('');
  const [currentSql, setCurrentSql] = useState('');

  const handleGenerate = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await queryGenerate({ question, schemaMode });
      if (res.error) {
        message.error(res.error);
      } else {
        setCurrentSql(res.sql || '');
        setShowSqlModal(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setShowSqlModal(false);
    try {
      const res = await queryExecute({ sql: currentSql });
      if (res.error) {
        message.error(res.error);
      } else {
        setResults(res.results || []);
        setRowCount(res.rowCount || 0);
        message.success(`查询成功，${res.rowCount} 条结果`);
      }
    } finally {
      setLoading(false);
    }
  };

  const columns = results.length > 0 
    ? Object.keys(results[0]).map(key => ({ title: key, dataIndex: key, key }))
    : [];

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Select value={schemaMode} onChange={setSchemaMode} style={{ width: 120 }}>
            <Select.Option value="auto">自动获取</Select.Option>
            <Select.Option value="manual">本地存储</Select.Option>
            <Select.Option value="skill">Skill</Select.Option>
          </Select>
          <Input.Search
            placeholder="输入自然语言查询，如：查询2024年销售额"
            enterButton="生成SQL"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onSearch={handleGenerate}
            loading={loading}
            style={{ width: 500 }}
          />
        </Space>
        
        {rowCount > 0 && (
          <Table
            dataSource={results}
            columns={columns}
            pagination={{ pageSize: 100 }}
            scroll={{ x: 'max-content' }}
            size="small"
          />
        )}
      </Space>

      <Modal
        title="生成的SQL"
        open={showSqlModal}
        onOk={handleExecute}
        onCancel={() => setShowSqlModal(false)}
        width={600}
      >
        <Input.TextArea
          value={currentSql}
          onChange={e => setCurrentSql(e.target.value)}
          rows={6}
          style={{ fontFamily: 'monospace' }}
        />
      </Modal>
    </Card>
  );
}

export default QueryPanel;
```

- [ ] **Step 2: 创建查询API**

```javascript
export function queryGenerate(data) {
  return api.post('/query/generate', data).then(r => r.data);
}

export function queryExecute(data) {
  return api.post('/query/execute', data).then(r => r.data);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/QueryPanel.jsx frontend/src/api/
git commit -M4: add query UI"
```

---

### Task 4.2: Excel导出

**Files:**
- Create: `backend/src/routes/export.js`
- Modify: `frontend/src/components/QueryPanel.jsx`

- [ ] **Step 1: 创建导出路由**

```javascript
import express from 'express';
import XLSX from 'xlsx';

const router = express.Router();

router.post('/', async (req, res) => {
  const { data, format } = req.body;
  
  if (format === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=query_result.xlsx');
    res.send(buffer);
  } else if (format === 'html') {
    let html = '<table border="1"><tr>';
    if (data.length > 0) {
      html += Object.keys(data[0]).map(k => `<th>${k}</th>`).join('');
      html += '</tr>';
      html += data.map(row => 
        '<tr>' + Object.values(row).map(v => `<td>${v}</td>`).join('') + '</tr>'
      ).join('');
    }
    html += '</table>';
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } else if (format === 'markdown') {
    let md = '';
    if (data.length > 0) {
      md += '|' + Object.keys(data[0]).join('|') + '|\n';
      md += '|' + Object.keys(data[0]).map(() => '---').join('|') + '|\n';
      md += data.map(row => 
        '|' + Object.values(row).join('|') + '|'
      ).join('\n');
    }
    res.setHeader('Content-Type', 'text/markdown');
    res.send(md);
  } else {
    res.json(data);
  }
});

export default router;
```

- [ ] **Step 2: 添加导出按钮**

```javascript
const handleExport = async (format) => {
  if (results.length === 0) return;
  
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: results, format })
    });
    
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `query_result.${format}`;
    link.click();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    message.error('导出失败');
  }
};

// 添加按钮
{rowCount > 0 && (
  <Space>
    <Button onClick={() => handleExport('xlsx')}>导出Excel</Button>
    <Button onClick={() => handleExport('html')}>导出HTML</Button>
    <Button onClick={() => handleExport('markdown')}>导出Markdown</Button>
  </Space>
)}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/export.js
git commit -M4: add Excel export"
```

---

## M5: 会话管理 + 优化

### Task 5.1: 会话管理

**Files:**
- Create: `backend/src/routes/session.js`

- [ ] **Step 1: 创建会话路由**

```javascript
import express from 'express';
import { getDb } from '../db/sqlite.js';

const router = express.Router();

// 获取会话列表
router.get('/', async (req, res) => {
  const db = getDb();
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY id DESC').all();
  res.json({ sessions });
});

// 创建会话
router.post('/', async (req, res) => {
  const { name } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO sessions (name) VALUES (?)').run(name || '新会话');
  res.json({ id: result.lastInsertRowid });
});

// 删除会话
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  res.json({ success: true });
});

// 获取会话消息
router.get('/:id/messages', async (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id').all(id);
  res.json({ messages });
});

export default router;
```

- [ ] **Step 2: 更新前端添加会话切换**

```javascript
import { useState, useEffect } from 'react';
import { Select, Button, Modal, Input } from 'antd';

const [sessions, setSessions] = useState([]);
const [currentSession, setCurrentSession] = useState(null);
const [showNewSession, setShowNewSession] = useState(false);
const [newSessionName, setNewSessionName] = useState('');

useEffect(() => {
  loadSessions();
}, []);

const loadSessions = async () => {
  const res = await api.get('/sessions').then(r => r.data);
  setSessions(res.sessions || []);
};

const createSession = async () => {
  await api.post('/sessions', { name: newSessionName });
  setShowNewSession(false);
  setNewSessionName('');
  loadSessions();
};

const deleteSession = async (id) => {
  await api.delete(`/sessions/${id}`);
  loadSessions();
};

// 添加会话选择器
<Space style={{ marginBottom: 16 }}>
  <Select 
    value={currentSession} 
    onChange={setCurrentSession}
    placeholder="选择会话"
    style={{ width: 200 }}
  >
    {sessions.map(s => <Select.Option key={s.id} value={s.id}>{s.name}</Select.Option>)}
  </Select>
  <Button onClick={() => setShowNewSession(true)}>新建会话</Button>
</Space>

<Modal
  title="新建会话"
  open={showNewSession}
  onOk={createSession}
  onCancel={() => setShowNewSession(false)}
>
  <Input 
    value={newSessionName} 
    onChange={e => setNewSessionName(e.target.value)} 
    placeholder="会话名称" 
  />
</Modal>
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/session.js frontend/src/components/QueryPanel.jsx
git commit -M5: add session management"
```

---

### Task 5.2: Skill管理

**Files:**
- Create: `backend/src/routes/skill.js`
- Create: `skills/db_schema_skill.json`

- [ ] **Step 1: 创建Skill路由**

```javascript
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(__dirname, '../../skills');

const router = express.Router();

// 确保目录存在
if (!fs.existsSync(skillDir)) {
  fs.mkdirSync(skillDir, { recursive: true });
}

// 获取skill列表
router.get('/', async (req, res) => {
  const files = fs.readdirSync(skillDir).filter(f => f.endsWith('.json'));
  const skills = files.map(f => ({
    name: f,
    content: JSON.parse(fs.readFileSync(path.join(skillDir, f), 'utf-8'))
  }));
  res.json({ skills });
});

// 保存skill
router.post('/', async (req, res) => {
  const { name, content } = req.body;
  fs.writeFileSync(path.join(skillDir, name), JSON.stringify(content, null, 2));
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: 创建示例Skill文件**

```json
{
  "version": 1,
  "name": "数据库表结构说明",
  "tables": []
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/skill.js skills/db_schema_skill.json
git commit -M5: add skill management"
```

---

### Task 5.3: 单元测试

**Files:**
- Create: `backend/tests/validateSQL.test.js`
- Create: `backend/tests/llm.test.js`

- [ ] **Step 1: 创建SQL验证测试**

```javascript
import { validateSQL } from '../src/services/sqlValidator.js';

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
  }
}

test('只允许SELECT', () => {
  const result = validateSQL('SELECT * FROM users');
  if (!result.valid) throw new Error('应该通过');
});

test('拒绝INSERT', () => {
  const result = validateSQL('INSERT INTO users VALUES(1)');
  if (result.valid) throw new Error('应该拒绝');
});

test('拒绝DELETE', () => {
  const result = validateSQL('DELETE FROM users');
  if (result.valid) throw new Error('应该拒绝');
});

test('拒绝UPDATE', () => {
  const result = validateSQL('UPDATE users SET name=1');
  if (result.valid) throw new Error('应该拒绝');
});
```

- [ ] **Step 2: 运行测试**

```bash
node backend/tests/validateSQL.test.js
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/
git commit -M5: add unit tests"
```

---

## 执行方式

**Plan complete and saved to `docs/superpowers/plans/2026-04-03-data-query-assistant-implementation-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

---

## 已完成的更新 (2026-04-03)

### Task 6: LangChain动态Skill调用 ✅

**完成时间**: 2026-04-03

**Files:**
- Create: `backend/src/services/llm.js`
- Modify: `backend/src/routes/query.js`
- Modify: `frontend/src/components/QueryPanel.jsx`

**实现内容**:
- [x] 创建 LangChain LLM 服务，定义 get_tables 和 get_table_schema Tools
- [x] 修改 query.js 支持 langchain 模式
- [x] 前端添加 LangChain (推荐) 选项，默认启用

### Task 7: 编码问题修复 ✅

**Files:**
- Modify: `backend/src/services/config.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/ConfigPanel.jsx`

**实现内容**:
- [x] 修复中文乱码问题

### Task 8: 流式输出预留 ✅

**Files:**
- Modify: `backend/src/routes/query.js`
- Modify: `backend/src/services/llm.js`

**实现内容**:
- [x] 预留流式输出扩展点（TODO注释）
- 后续可通过 `?stream=true` 参数启用SSE流式输出
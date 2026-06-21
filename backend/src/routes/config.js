import { Router } from 'express';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';
import { getAgentConfig, updateAgentConfig, getTokenWarningLevel } from '../services/config.js';
import { authRequired } from '../services/auth.js';

const router = Router();

// 配置接口要求登录
router.use(authRequired);

router.post('/test', async (req, res) => {
  try {
    const mysql = await import('mysql2/promise');
    const { host, port, user, password, database } = req.body;

    const connection = await mysql.default.createConnection({
      host, port: port || 3306, user, password, database
    });
    await connection.end();
    res.json({ success: true, message: '连接成功' });
  } catch (error) {
    logger.error('DB connection failed', { error: error.message });
    res.json({ success: false, message: error.message });
  }
});

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

router.get('/llm', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');

  if (row) {
    const config = JSON.parse(row.value);
    const hasApiKey = !!config.apiKey;
    delete config.apiKey;
    res.json({ ...config, hasApiKey });
  } else {
    res.json({ hasApiKey: false });
  }
});

router.get('/llm/models', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');

  if (!row) {
    return res.json({ success: false, message: '请先配置DeepSeek API Key' });
  }

  const config = JSON.parse(row.value);
  if (!config.apiKey) {
    return res.json({ success: false, message: '请先配置DeepSeek API Key' });
  }

  try {
    const response = await fetch('https://api.deepseek.com/models', {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('DeepSeek models API error', { status: response.status, error: errorText });
      return res.json({ success: false, message: `API错误: ${response.status}` });
    }

    const data = await response.json();
    const models = data.data.map(m => ({ id: m.id, name: m.id }));
    res.json({ success: true, models });
  } catch (error) {
    logger.error('Failed to fetch deepseek models', { error: error.message });
    res.json({ success: false, message: error.message });
  }
});

router.get('/agent', async (req, res) => {
  try {
    const config = getAgentConfig();
    // 添加 token 警告上限到 agent 配置中
    const tokenWarningLevel = getTokenWarningLevel();
    config['agent_token_warning_level'] = String(tokenWarningLevel);
    res.json(config);
  } catch (e) {
    res.json({});
  }
});

router.put('/agent/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const config = updateAgentConfig(`agent_${key}`, value);
    res.json({ success: true, config });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

export default router;
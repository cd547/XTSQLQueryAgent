import { Router } from 'express';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';

const router = Router();

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
    delete config.apiKey;
    res.json(config);
  } else {
    res.json({});
  }
});

export default router;
import { Router } from 'express';
import { getDb } from '../db/sqlite.js';

const router = Router();

// 获取所有会话
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY id DESC').all();
    res.json({ sessions });
  } catch (error) {
    res.json({ error: error.message, sessions: [] });
  }
});

// 创建新会话
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body || {};
    // 获取当前最大的 sort_order
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM sessions').get();
    const newOrder = (maxOrder?.max || 0) + 1;
    const result = db.prepare('INSERT INTO sessions (name, sort_order) VALUES (?, ?)').run(name || '新对话', newOrder);
    res.json({ id: result.lastInsertRowid, name: name || '新对话', sort_order: newOrder });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// 获取会话消息
router.get('/:id/messages', (req, res) => {
  try {
    const db = getDb();
    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json({ messages });
  } catch (error) {
    res.json({ error: error.message, messages: [] });
  }
});

// 保存消息
router.post('/:id/messages', (req, res) => {
  try {
    const db = getDb();
    const { role, content, sql, results } = req.body;
    console.log('保存消息:', { sessionId: req.params.id, role, content: content?.substring(0, 30), sql: sql?.substring(0, 30) });
    db.prepare('INSERT INTO messages (session_id, role, content, sql, results) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, role, content, sql || '', results || '');
    res.json({ success: true });
  } catch (error) {
    console.error('保存消息失败:', error);
    res.json({ error: error.message });
  }
});

// 更新会话名称
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body;
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// 删除会话
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.json({ error: error.message });
  }
});

export default router;


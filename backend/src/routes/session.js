import { Router } from 'express';
import { getDb } from '../db/sqlite.js';
import { getLlmConfig } from '../services/config.js';
import { clearSessionRegistry } from '../services/llm.js';
import { authRequired, sessionBelongsToUser } from '../services/auth.js';
import { logger } from '../logger.js';

const router = Router();

// 所有会话接口都要求登录
router.use(authRequired);

// 获取所有会话（分页）
router.get('/', (req, res) => {
  try {
    const db = getDb();
    // 分页参数：默认 20 条/页，单次上限 100 防止误传大数
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // #PERF-06：把相关子查询改成 LEFT JOIN + GROUP BY。
    // 旧写法依赖 SQLite 优化器把子查询"展开"为 join；
    // 显式 JOIN 后总是 1 次扫描 messages 表（可走 idx_messages_session_role 索引），
    // 避免 N+1 风险（每个 session 一次 SUM 扫描）。
    const sessions = db.prepare(`
      SELECT s.id, s.name, s.sort_order, s.created_at,
             COALESCE(SUM(CASE WHEN m.role = 'usage' THEN m.total_tokens END), 0) AS total_tokens
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    const total = db.prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = ?').get(req.user.id).cnt;
    res.json({ sessions, total, hasMore: offset + sessions.length < total });
  } catch (error) {
    logger.error('Get sessions failed', { error: error.message, userId: req.user.id });
    res.status(500).json({ error: error.message, sessions: [], total: 0, hasMore: false });
  }
});

// 获取会话的 token 统计
router.get('/:id/tokens', (req, res) => {
  try {
    if (!sessionBelongsToUser(req.params.id, req.user.id)) {
      return res.status(404).json({ error: '会话不存在', total_tokens: 0 });
    }
    const db = getDb();
    const result = db.prepare('SELECT COALESCE(SUM(total_tokens), 0) as total_tokens FROM messages WHERE session_id = ? AND role = ?').get(req.params.id, 'usage');
    res.json({ total_tokens: result?.total_tokens || 0 });
  } catch (error) {
    logger.error('Get session tokens failed', { error: error.message, sessionId: req.params.id });
    res.status(500).json({ error: error.message, total_tokens: 0 });
  }
});

// 创建新会话
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body || {};
    // 获取当前用户会话中的最大 sort_order
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM sessions WHERE user_id = ?').get(req.user.id);
    const newOrder = (maxOrder?.max || 0) + 1;
    const sessionName = name || `新对话#${newOrder}`;
    const result = db.prepare('INSERT INTO sessions (name, sort_order, user_id) VALUES (?, ?, ?)').run(sessionName, newOrder, req.user.id);
    res.json({ id: result.lastInsertRowid, name: sessionName, sort_order: newOrder });
  } catch (error) {
    logger.error('Create session failed', { error: error.message, userId: req.user.id });
    res.status(500).json({ error: error.message });
  }
});

// 获取会话消息
router.get('/:id/messages', (req, res) => {
  try {
    if (!sessionBelongsToUser(req.params.id, req.user.id)) {
      return res.status(404).json({ error: '会话不存在', messages: [] });
    }
    const db = getDb();
    const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id);
    res.json({ messages });
  } catch (error) {
    logger.error('Get session messages failed', { error: error.message, sessionId: req.params.id });
    res.status(500).json({ error: error.message, messages: [] });
  }
});

// 保存消息
router.post('/:id/messages', (req, res) => {
  try {
    if (!sessionBelongsToUser(req.params.id, req.user.id)) {
      return res.status(403).json({ error: '无权访问此会话' });
    }
    const db = getDb();
    const { role, content, sql, results } = req.body;
    db.prepare('INSERT INTO messages (session_id, role, content, sql, results) VALUES (?, ?, ?, ?, ?)')
      .run(req.params.id, role, content, sql || '', results || '');
    res.json({ success: true });
  } catch (error) {
    logger.error('Save message failed', { error: error.message, sessionId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// 更新会话名称
router.put('/:id', (req, res) => {
  try {
    if (!sessionBelongsToUser(req.params.id, req.user.id)) {
      return res.status(403).json({ error: '无权访问此会话' });
    }
    const db = getDb();
    const { name } = req.body;
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Update session name failed', { error: error.message, sessionId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// 删除会话
router.delete('/:id', (req, res) => {
  try {
    if (!sessionBelongsToUser(req.params.id, req.user.id)) {
      return res.status(403).json({ error: '无权访问此会话' });
    }
    const db = getDb();
    // 先删除 llm_messages 表中相关记录（有外键约束）
    db.prepare('DELETE FROM llm_messages WHERE session_id = ?').run(req.params.id);
    // 再删除 messages 表中相关记录
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(req.params.id);
    // 最后删除会话记录
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
    // 释放工具调用注册表
    clearSessionRegistry(req.params.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Delete session failed', { error: error.message, sessionId: req.params.id });
    res.status(500).json({ error: error.message });
  }
});

// 总结会话
router.post('/:id/summarize', async (req, res) => {
  const sessionId = req.params.id;

  try {
    if (!sessionBelongsToUser(sessionId, req.user.id)) {
      return res.status(403).json({ error: '无权访问此会话' });
    }
    const db = getDb();
    
    // 获取会话消息
    const messages = db.prepare(`
      SELECT role, content, sql, results FROM messages 
      WHERE session_id = ? AND role IN ('user', 'assistant')
      ORDER BY id ASC
    `).all(sessionId);
    
    if (messages.length === 0) {
      return res.status(400).json({ error: '没有聊天记录可以总结', summary: '', name: '' });
    }
    
    // 构建对话内容
    let conversationText = '';
    for (const msg of messages) {
      if (msg.role === 'user') {
        conversationText += `用户: ${msg.content}\n`;
      } else if (msg.role === 'assistant') {
        if (msg.sql) {
          conversationText += `助手: SQL: ${msg.sql}\n`;
        }
        if (msg.content) {
          conversationText += `助手: ${msg.content}\n`;
        }
      }
    }
    
    // 获取LLM配置
    let config;
    try {
      config = getLlmConfig();
    } catch (e) {
      return res.status(400).json({ error: 'LLM未配置', summary: '', name: '' });
    }
    
    const { provider, apiKey, model } = config;
    
    // 调用LLM API
    const prompt = `请总结以下对话内容，生成：
1. 一个简洁的总结（100字左右）
2. 一个20字以内的会话标签（用于显示在会话列表中，直接返回标签文字，不要加引号）

请用JSON格式返回：
{"summary": "总结内容", "name": "标签内容"}

对话内容：
${conversationText}`;
    
    let baseURL, llmModel;
    switch (provider) {
      case 'openai':
        baseURL = 'https://api.openai.com/v1';
        llmModel = model || 'gpt-4o';
        break;
      case 'deepseek':
        baseURL = 'https://api.deepseek.com';
        llmModel = model || 'deepseek-chat';
        break;
      case 'minimax':
        baseURL = 'https://api.minimax.chat/v1';
        llmModel = model || 'abab6.5s-chat';
        break;
      case 'ollama':
        baseURL = apiKey || 'http://localhost:11434';
        llmModel = model || 'llama3.2';
        break;
      default:
        return res.status(400).json({ error: `不支持的provider: ${provider}`, summary: '', name: '' });
    }
    
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: llmModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      })
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'API调用失败');
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // 解析JSON
    let summary = '';
    let name = '';
    
    try {
      // 尝试提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        summary = parsed.summary || '';
        name = parsed.name || '';
      } else {
        throw new Error('未找到JSON');
      }
    } catch (e) {
      // 尝试简单解析
      const summaryMatch = content.match(/["']summary["']\s*[:：]\s*["']([^"']+)["']/);
      const nameMatch = content.match(/["']name["']\s*[:：]\s*["']([^"']+)["']/);
      summary = summaryMatch ? summaryMatch[1] : content.substring(0, 100);
      name = nameMatch ? nameMatch[1] : content.substring(0, 20);
    }
    
    // 截断name到20字
    if (name.length > 20) {
      name = name.substring(0, 20);
    }
    
    // 更新会话记录
    db.prepare('UPDATE sessions SET name = ?, summary = ? WHERE id = ?')
      .run(name, summary, sessionId);
    
    logger.info('Session summarized', { sessionId, name, summaryLength: summary.length });

    res.json({ success: true, summary, name });
  } catch (error) {
    logger.error('Summarize session failed', { error: error.message, sessionId });
    res.status(500).json({ error: error.message, summary: '', name: '' });
  }
});

export default router;


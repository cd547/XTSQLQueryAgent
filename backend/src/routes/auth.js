import { Router } from 'express';
import { getDb } from '../db/sqlite.js';
import { authRequired, hashPassword, comparePassword, signToken, setAuthCookie, clearAuthCookie } from '../services/auth.js';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '../logger.js';

const router = Router();

// 用户名合法性：3-32 位，字母数字下划线
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/;

// POST /api/auth/register  注册
router.post('/register', authRateLimiter, (req, res) => {
  try {
    const { username, password, displayName } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: '用户名需为 2-32 位字母/数字/下划线/中文' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: '密码长度不能少于 6 位' });
    }
    const db = getDb();
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) {
      return res.status(409).json({ error: '用户名已被占用' });
    }
    const passwordHash = hashPassword(password);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name, role, token_version) VALUES (?, ?, ?, ?, 0)'
    ).run(username, passwordHash, displayName || username, 'user');

    const user = {
      id: result.lastInsertRowid,
      username,
      display_name: displayName || username,
      role: 'user',
      token_version: 0
    };
    const token = signToken(user);
    setAuthCookie(res, token);
    logger.info('用户注册成功', { userId: user.id, username });
    res.json({ success: true, user });
  } catch (e) {
    logger.error('注册失败', { error: e.message });
    res.status(500).json({ error: '注册失败: ' + e.message });
  }
});

// POST /api/auth/login  登录
router.post('/login', authRateLimiter, (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, password_hash, display_name, role, token_version FROM users WHERE username = ?'
    ).get(username);

    if (!user || !comparePassword(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const safeUser = {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      token_version: user.token_version || 0
    };
    const token = signToken(safeUser);
    setAuthCookie(res, token);
    logger.info('用户登录成功', { userId: safeUser.id, username: safeUser.username });
    res.json({ success: true, user: safeUser });
  } catch (e) {
    logger.error('登录失败', { error: e.message });
    res.status(500).json({ error: '登录失败: ' + e.message });
  }
});

// GET /api/auth/me  当前登录用户信息
router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/logout  退出登录（清理 cookie；前端跳转登录页）
router.post('/logout', authRequired, (req, res) => {
  try {
    // 递增 token_version 让当前 token 立刻失效（即便客户端保留旧的也用不了）
    const nextTv = (req.user.token_version || 0) + 1;
    getDb().prepare('UPDATE users SET token_version = ? WHERE id = ?').run(nextTv, req.user.id);
  } catch (e) {
    logger.warn('logout: 递增 token_version 失败', { error: e.message });
  }
  clearAuthCookie(res);
  res.json({ success: true });
});

// POST /api/auth/change-password  修改密码（需要登录）
router.post('/change-password', authRateLimiter, authRequired, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '旧密码和新密码不能为空' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于 6 位' });
    }
    const db = getDb();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!row || !comparePassword(oldPassword, row.password_hash)) {
      return res.status(400).json({ error: '旧密码错误' });
    }
    // 改密同时递增 token_version，吊销该用户所有旧 token
    const nextTv = (req.user.token_version || 0) + 1;
    db.prepare('UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?')
      .run(hashPassword(newPassword), nextTv, req.user.id);
    res.json({ success: true });
  } catch (e) {
    logger.error('修改密码失败', { error: e.message });
    res.status(500).json({ error: '修改密码失败: ' + e.message });
  }
});

export default router;

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';

// JWT 密钥：优先从环境变量读取，否则随机生成并保存到数据库中以便重启后仍可验签
function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const db = getDb();
    let row = db.prepare('SELECT value FROM configs WHERE key = ?').get('jwt_secret');
    if (!row) {
      const secret = crypto.randomBytes(48).toString('hex');
      db.prepare('INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)').run('jwt_secret', secret);
      logger.info('已生成新的 JWT 密钥并持久化');
      return secret;
    }
    return row.value;
  } catch (e) {
    logger.error('获取 JWT 密钥失败', { error: e.message });
    // 兜底：进程级随机密钥（重启后失效，但至少能让本次启动的所有请求通过）
    return crypto.randomBytes(48).toString('hex');
  }
}

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// 从请求头提取 token：兼容 "Bearer xxx" 与直接传 xxx
function extractToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth) return null;
  const parts = String(auth).split(' ');
  return parts.length === 2 ? parts[1] : parts[0];
}

// 鉴权中间件：未通过则 401；通过则把 user 信息挂到 req.user
export function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: '未登录', code: 'AUTH_REQUIRED' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: '登录已过期，请重新登录', code: 'AUTH_INVALID' });
  }
  // 重新查库，确保用户仍存在且未被禁用
  try {
    const db = getDb();
    const user = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(payload.id);
    if (!user) {
      return res.status(401).json({ error: '账号不存在', code: 'AUTH_INVALID' });
    }
    req.user = user;
    next();
  } catch (e) {
    logger.error('鉴权中间件查询用户失败', { error: e.message });
    return res.status(500).json({ error: '鉴权服务异常' });
  }
}

// 辅助函数：校验指定 sessionId 是否属于当前用户；不属于则返回 false
export function sessionBelongsToUser(sessionId, userId) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT 1 FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
    return !!row;
  } catch (e) {
    logger.error('校验会话归属失败', { error: e.message, sessionId, userId });
    return false;
  }
}

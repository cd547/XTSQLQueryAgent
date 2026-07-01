import { Router } from 'express';
import { authRequired } from '../services/auth.js';
import { saveFavoriteQuery, checkFavorites, deleteFavoriteQuery } from '../services/favoriteQuery.js';
import { logger } from '../logger.js';

const router = Router();

// 我的查询（常用 SQL 收藏）
router.post('/favorite', authRequired, async (req, res) => {
  const { userQuestion, sqlOutput } = req.body || {};
  if (!userQuestion || !sqlOutput) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_PARAMS',
      message: 'userQuestion 与 sqlOutput 均必填'
    });
  }

  try {
    const result = await saveFavoriteQuery({
      userId: req.user.id,
      userQuestion,
      sqlOutput
    });
    res.json({ success: true, ...result });
  } catch (e) {
    logger.error('saveFavoriteQuery failed', {
      userId: req.user?.id,
      code: e.code,
      error: e.message
    });
    // 业务参数问题返回 400，LLM/系统错误返回 500
    const status = e.code === 'INVALID_PARAMS' ? 400 : 500;
    res.status(status).json({
      success: false,
      code: e.code || 'FAVORITE_FAILED',
      message: e.message
    });
  }
});

// 批量检查哪些 SQL 已被当前用户收藏（用于会话回显）
router.post('/favorites/check', authRequired, (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items)) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_ITEMS',
      message: 'items 必须为数组'
    });
  }
  const sqlOutputs = items.map(it => it?.sqlOutput || '');
  try {
    const map = checkFavorites(req.user.id, sqlOutputs);
    const resultItems = items.map((it) => {
      const sql = (it?.sqlOutput || '').trim();
      const hit = map.get(sql);
      return hit
        ? { sqlOutput: sql, matched: true, id: hit.id, optimizedQuestion: hit.optimizedQuestion, businessDomains: hit.businessDomains, addTime: hit.addTime }
        : { sqlOutput: sql, matched: false };
    });
    res.json({ success: true, items: resultItems });
  } catch (e) {
    logger.error('checkFavorites failed', { userId: req.user?.id, error: e.message });
    res.status(500).json({ success: false, code: 'CHECK_FAILED', message: e.message });
  }
});

// 取消收藏（按 user_id + sql_output 唯一删除）
router.delete('/favorite', authRequired, (req, res) => {
  const { sqlOutput } = req.body || {};
  if (!sqlOutput || !sqlOutput.trim()) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_PARAMS',
      message: 'sqlOutput 必填'
    });
  }
  try {
    const deleted = deleteFavoriteQuery(req.user.id, sqlOutput);
    res.json({ success: true, deleted });
  } catch (e) {
    logger.error('deleteFavoriteQuery failed', { userId: req.user?.id, error: e.message });
    res.status(500).json({ success: false, code: 'UNFAVORITE_FAILED', message: e.message });
  }
});

export default router;

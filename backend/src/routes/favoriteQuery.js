import { Router } from 'express';
import { authRequired } from '../services/auth.js';
import { saveFavoriteQuery } from '../services/favoriteQuery.js';
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

export default router;

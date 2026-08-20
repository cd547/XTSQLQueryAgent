import { Router } from 'express';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';
import { getAgentConfig, updateAgentConfig, getTokenWarningLevel } from '../services/config.js';
import { authRequired, adminRequired } from '../services/auth.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();

// 配置接口默认要求登录；具体路由再按需加 adminRequired
// （GET /config/agent 普通用户也要用——读 token 警告阈值，所以不加 admin）
router.use(authRequired);

// 数据库连接信息：仅管理员可读/改（含密码字段）
router.post('/test', adminRequired, async (req, res) => {
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

router.post('/db', adminRequired, asyncHandler(async (req, res) => {
  const { host, port, user, password, database } = req.body;
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO configs (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);

  const configData = JSON.stringify({ host, port, user, password, database });
  stmt.run('db_config', configData);

  res.json({ success: true });
}));

router.get('/db', adminRequired, asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('db_config');

  if (row) {
    const config = JSON.parse(row.value);
    delete config.password;
    res.json(config);
  } else {
    res.json({});
  }
}));

router.post('/llm', adminRequired, asyncHandler(async (req, res) => {
  const { provider, apiKey, model, apiMode } = req.body;
  const db = getDb();

  // ★ F3 修复：未传 apiKey 或传空字符串时，保留 DB 已有值
  //   背景：前端 useEffect 不再把明文 key 写进 state（改为 maskedKey 占位），
  //   saveLlm 仅在用户真正改动时才提交 apiKey。但若前端 bug 或手写 API 调用
  //   传了空字符串，会直接把 key 覆盖成空，造成"什么都没改但 key 没了"。
  //   这里兜底：传空 → 保留旧值；只有传非空才覆盖。
  let finalApiKey = '';
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    finalApiKey = apiKey;
  } else {
    const existing = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');
    if (existing) {
      try {
        finalApiKey = JSON.parse(existing.value).apiKey || '';
      } catch (e) {
        // ★ F15 修复：原代码静默吞错（catch(_) { }），DB 里 llm_config JSON 损坏时无任何线索。
        //   改为 logger.warn：保留原行为（finalApiKey 保持空），但留下可观测信号
        //   关键上下文：key 名 + error message + 损坏值的头部（前 100 字符，避开 log 大爆炸）
        logger.warn('POST /llm: llm_config JSON 解析失败，apiKey 保留为空', {
          key: 'llm_config',
          error: e.message,
          rawPreview: typeof existing.value === 'string' ? existing.value.slice(0, 100) : '<non-string>'
        });
        finalApiKey = '';
      }
    }
  }

  // ★ apiMode 兑底：未传 / 非字符串 / 不是已知值时回退到默认 'chat_completions'
  //   理由：未来如果换 default 值，只改这一处；未知值不报错，优雅降级
  const validApiModes = ['chat_completions', 'responses_api'];
  const finalApiMode = (typeof apiMode === 'string' && validApiModes.includes(apiMode))
    ? apiMode
    : 'chat_completions';

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO configs (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `);
  const llmConfig = JSON.stringify({ provider, apiKey: finalApiKey, model, apiMode: finalApiMode });
  stmt.run('llm_config', llmConfig);

  res.json({ success: true });
}));

router.get('/llm', adminRequired, asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM configs WHERE key = ?').get('llm_config');

  if (row) {
    const config = JSON.parse(row.value);
    const rawKey = config.apiKey || '';
    const hasApiKey = rawKey.length > 0;
    // ★ F3 修复：返回掩码（sk-****abcd 风格）供前端占位展示，绝不返回明文
    //   规则：key 长度 ≥ 8 字符 → 前 3 + **** + 末 4；否则全 ****（不暴露长度）
    //   理由：仅前 3 + 末 4 既能"看着像真 key"便于用户识别，又无法被用于鉴权
    const maskedKey = hasApiKey
      ? (rawKey.length >= 8 ? `${rawKey.slice(0, 3)}****${rawKey.slice(-4)}` : '****')
      : '';
    delete config.apiKey;
    // ★ 旧配置兑底：DB 里没 apiMode 字段时默认 'chat_completions'
    //   路径：A 用户更新前已有 llm_config 记录（不含 apiMode）→ GET 拿到 config 后
    //   补默认值；前端 useEffect setFieldsValue 用此值初始化下拉框
    if (!config.apiMode) {
      config.apiMode = 'chat_completions';
    }
    res.json({ ...config, hasApiKey, maskedKey });
  } else {
    res.json({ hasApiKey: false, maskedKey: '', apiMode: 'chat_completions' });
  }
}));

router.get('/llm/models', adminRequired, asyncHandler(async (req, res) => {
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
}));

// ★ 2026-08-17：查询 DeepSeek 账户余额
//   文档：https://api-docs.deepseek.com/zh-cn/api/get-user-balance
//   端点：GET https://api.deepseek.com/user/balance
//   Auth: Authorization: Bearer <apiKey>
//   返回：{ success, is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
router.get('/llm/balance', adminRequired, asyncHandler(async (req, res) => {
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
    const response = await fetch('https://api.deepseek.com/user/balance', {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('DeepSeek balance API error', { status: response.status, error: errorText });
      return res.json({ success: false, message: `API错误: ${response.status}` });
    }

    const data = await response.json();
    res.json({
      success: true,
      is_available: data.is_available,
      balance_infos: data.balance_infos
    });
  } catch (error) {
    logger.error('Failed to fetch deepseek balance', { error: error.message });
    res.json({ success: false, message: error.message });
  }
}));

router.get('/agent', async (req, res) => {  // 普通用户也用：读 token 警告阈值
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

router.put('/agent/:key', adminRequired, async (req, res) => {
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
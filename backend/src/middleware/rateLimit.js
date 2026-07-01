import rateLimit from 'express-rate-limit';

/**
 * 写操作的认证限流器（login / register / change-password）
 *
 * 策略：同一 IP 在 1 小时内最多 10 次请求
 * 适用端点：/api/auth/login、/api/auth/register、/api/auth/change-password
 *
 * 说明：
 *   - 桌面端 Electron 应用：所有请求来自 127.0.0.1；限制是"同机所有用户共享 10 次/小时"
 *     对于单用户/低频使用场景（10 次/小时已很充裕），无影响。
 *   - 反向代理部署时需要在 index.js 设置 `app.set('trust proxy', 1)`，
 *     否则 req.ip 会是代理 IP，所有用户共享额度。
 */
export const authRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 小时
  max: 10,                     // 窗口内最多 10 次
  message: {
    error: '请求过于频繁，请 1 小时后再试',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,       // 返回 RateLimit-* 标准头
  legacyHeaders: false,
  // 默认 keyGenerator 用 req.ip；这里显式声明以便后续扩展
  keyGenerator: (req) => req.ip,
});

/**
 * 读操作的认证限流器（me / logout）
 *
 * 策略：同一 IP 在 1 小时内最多 100 次请求
 * 适用端点：/api/auth/me、/api/auth/logout
 *
 * 设计原因：
 *   - /me 是 bootstrap 时验证 token 是否有效的只读接口，每次页面刷新都会调用。
 *     如果用 authRateLimiter (10/小时)，用户连续刷新几次后被 429 误判为"未登录"踢回登录页。
 *   - 单独额度 (100/小时) 既能防止极端滥用（每小时上百次），又不影响正常使用。
 *   - /logout 也走这个，避免退出登录被限流。
 */
export const authMeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,   // 1 小时
  max: 100,                    // 窗口内最多 100 次
  message: {
    error: '请求过于频繁，请 1 小时后再试',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

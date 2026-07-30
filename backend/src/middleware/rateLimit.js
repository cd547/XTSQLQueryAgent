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
  // ★ B15 修复：复合 key 隔离同机多用户，避免"用户 A 输错 10 次 → B/C/D 全部被锁"
  //   - login/register：取 req.body.username 拼 IP
  //   - change-password：req.body 没有 username（限流器在 authRequired 之前），
  //     统一归入 "::cpw::" key——change-password 本身就是低频操作，可以接受
  //   - username 统一 toLowerCase：防大小写绕过（Admin vs admin 视为同一用户）
  keyGenerator: (req) => {
    const username = String(req.body?.username || '').toLowerCase().trim();
    return username ? `${req.ip}::login::${username}` : `${req.ip}::cpw`;
  },
  // ★ B15 修复：成功请求不计数（401 密码错才计入，200 登录成功不计）
  //   防止"正常用户连续登录 10 次"被误限流
  skipSuccessfulRequests: true,
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

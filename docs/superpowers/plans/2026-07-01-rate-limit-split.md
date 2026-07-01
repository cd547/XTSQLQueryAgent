# 限流拆分 - /me 误判为未登录 修复 实施计划

> **设计文档**: [2026-07-01-rate-limit-split.md](../specs/2026-07-01-rate-limit-split.md)

**Goal:** 拆分 `authRateLimiter` 为"写操作"与"读操作"两组；修复前端 AuthContext 把 429 误判为"未登录"的 bug；axios 拦截器对 429 静默处理。

**Architecture:**
- 后端：新增 `authMeRateLimiter` (100/小时)，`/me` `/logout` 切换
- 前端：AuthContext catch 分流 401 vs 其他；axios 拦截器对 429 不弹 toast

**Tech Stack:** Express, express-rate-limit, React 18

---

## 文件结构

```
backend/src/middleware/rateLimit.js          # 修改：+ authMeRateLimiter
backend/src/routes/auth.js                    # 修改：/me /logout 切换 limiter
frontend/src/context/AuthContext.jsx         # 修改：bootstrap catch 分流
frontend/src/api/index.js                    # 修改：拦截器 429 不弹 toast
```

---

## Task 1: 后端新增 authMeRateLimiter

**Files:**
- Modify: `backend/src/middleware/rateLimit.js`

- [ ] **Step 1: 复制 authRateLimiter，修改 max=100，注释说明用途**

```js
export const authMeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: { error: '请求过于频繁，请 1 小时后再试', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});
```

- [ ] **Step 2: 验证**

```bash
cd backend && node -e "import('./src/middleware/rateLimit.js').then(m => console.log(Object.keys(m)))"
# 期望：['authMeRateLimiter', 'authRateLimiter']
```

---

## Task 2: 路由切换

**Files:**
- Modify: `backend/src/routes/auth.js`

⚠️ **重要**: 之前用 Edit 工具出现过缓存问题（项目记忆里有提），改用 node 脚本：

- [ ] **Step 1: 写 patch 脚本**

```js
// _patch_auth_limiter.mjs
import fs from 'fs';
const file = 'src/routes/auth.js';
const before = fs.readFileSync(file, 'utf-8');
const after = before
  .replace(
    "import { authRateLimiter } from '../middleware/rateLimit.js';",
    "import { authRateLimiter, authMeRateLimiter } from '../middleware/rateLimit.js';"
  )
  .replace(
    "router.get('/me', authRateLimiter, authRequired, (req, res) => {\n  res.json({ user: req.user });\n});",
    `// /me: 用 authMeRateLimiter (100/小时) 而非 authRateLimiter (10/小时)
router.get('/me', authMeRateLimiter, authRequired, (req, res) => {
  res.json({ user: req.user });
});`
  )
  .replace(
    "router.post('/logout', authRateLimiter, authRequired, (req, res) => {",
    "// /logout: 同样放宽到 authMeRateLimiter
router.post('/logout', authMeRateLimiter, authRequired, (req, res) => {"
  );
fs.writeFileSync(file, after, 'utf-8');
const c = fs.readFileSync(file, 'utf-8');
console.log(c !== before ? 'CHANGED' : 'NO CHANGE');
// 校验 6 条
console.log('import:', c.includes('authRateLimiter, authMeRateLimiter'));
console.log('me:', /router\.get\('\/me', authMeRateLimiter/.test(c));
console.log('logout:', /router\.post\('\/logout', authMeRateLimiter/.test(c));
console.log('login:', /router\.post\('\/login', authRateLimiter/.test(c));
console.log('register:', /router\.post\('\/register', authRateLimiter/.test(c));
console.log('change-password:', /router\.post\('\/change-password', authRateLimiter/.test(c));
```

- [ ] **Step 2: 执行并验证 6 个 CHECK 全部 true**

- [ ] **Step 3: 删除 patch 脚本**

`rm _patch_auth_limiter.mjs`

---

## Task 3: 前端 AuthContext 改造

**Files:**
- Modify: `frontend/src/context/AuthContext.jsx`

- [ ] **Step 1: bootstrap catch 分流**

```js
} catch (e) {
  const status = e?.response?.status;
  if (status === 401) {
    if (!cancelled) {
      setUser(null);
      setStoredUser(null);
    }
  } else if (!cancelled) {
    console.warn('bootstrap /me 失败（非 401），保留本地登录态:', status, e?.message);
  }
}
```

---

## Task 4: 前端 axios 拦截器

**Files:**
- Modify: `frontend/src/api/index.js`

- [ ] **Step 1: 429 不弹 toast**

```js
if (status === 401) {
  setStoredUser(null);
  window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
} else if (status === 429) {
  // 限流不弹 toast
} else if (status >= 400 && data && data.error) {
  message.error(data.error);
}
```

---

## Task 5: 验证

- [ ] **Step 1: 后端模块加载**

```bash
cd backend && node -e "import('./src/routes/auth.js').then(m => console.log('OK')).catch(e => console.error('ERR', e.message))"
# 期望：OK
```

- [ ] **Step 2: 全量回归**

```bash
node test-favorite-query.mjs    # 74/74
node test-skill-domains.mjs     # 19/19
node test-skill-cache.mjs       # 全过
node test-fs-utils.mjs          # 全过
node test-llm-timeout.mjs       # 全过
node test-sql-validator.mjs     # 全过
```

- [ ] **Step 3: 前端 build**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: 端到端 5 个用例**

| # | 操作 | 期望 |
|---|------|------|
| 1 | 登录后连续刷新 15 次页面 | 仍保持登录态（不跳登录页） |
| 2 | /me 触 429 时 | 控制台 warn，无 toast，无跳转 |
| 3 | 真实 token 失效 | 跳登录页（401 行为不变） |
| 4 | /login 用尽后 | 弹"请求过于频繁"（10/小时硬约束保留） |
| 5 | 反复登录 + 登出 | 不被 /logout 限流 |

---

## 验证标准

- ✅ 后端模块加载成功
- ✅ 6 个后端测试无回归
- ✅ 前端 build 成功
- ✅ 5 个端到端用例通过
- ✅ 401 行为不变
- ✅ /me /logout 走新 limiter，/login /register /change-password 走原 limiter

## 实施工作量

约 30 分钟（后端 15min + 前端 10min + 验证 5min）

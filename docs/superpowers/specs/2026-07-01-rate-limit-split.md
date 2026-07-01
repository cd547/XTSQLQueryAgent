# 限流拆分 - /me 误判为未登录 修复

> **设计日期**: 2026-07-01
> **关联 plan**: [2026-07-01-rate-limit-split.md](../plans/2026-07-01-rate-limit-split.md)

## 概述

将认证端点限流拆分为"写操作限流"和"读操作限流"两组：`/login` `/register` `/change-password` 保持 10/小时（防暴力破解），`/me` `/logout` 改为 100/小时（容纳频繁刷新）。同时修复前端 AuthContext 把 429 误判为"未登录"导致刷新页面被踢回登录页的 bug。

## 背景

### 现状问题
- `authRateLimiter` (10/小时/IP) 同时用于 `login`、`register`、`me`、`logout`、`change-password`
- 桌面端 Electron 应用所有请求来自 `127.0.0.1`，"同机所有用户共享 10 次/小时"
- 用户连续刷新几次页面后，bootstrap 时的 `/me` 触发 429
- 前端 AuthContext 在 `catch` 块里**把任何错误都视为未登录** → 跳登录页 + 弹"请求过于频繁"toast

### 现象
- 用户在多次刷新页面后突然被踢回登录页
- 即使不刷新，`/login` 也被 `/me` 用完的配额占满，导致无法登录
- 弹出"请求过于频繁，请 1 小时后再试"toast

## 根因分析

| 环节 | 问题 |
|------|------|
| 1. 限流器单例 | `authRateLimiter` 是模块级单例，me + login 共享同一份 10/小时配额 |
| 2. /me 调用频繁 | 每次页面刷新、`loadMessages`、token 验证都触发 /me |
| 3. AuthContext 误判 | bootstrap 的 catch 把 429 当成"未登录"清掉 user |
| 4. axios 拦截器 | 4xx + error 字段一律 `message.error`，429 弹无意义 toast |

## 关键决策

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 1 | 是否拆分限流器 | **是** | /me 是只读验证，不应和 login 同额度 |
| 2 | /me 额度 | 100/小时 | 既能防滥用（每 36s 1 次），又不影响正常使用 |
| 3 | /logout 归属 | 跟随 /me | 登出本身不该被限流 |
| 4 | AuthContext 误判修复 | 401 才清 user；其他错误保留本地 user | 429/网络异常不是"token 失效" |
| 5 | axios 拦截器 429 | 不弹 toast | 限流是后端行为，不是用户错误 |
| 6 | 是否走配置表 | **否** | express-rate-limit 不支持运行时改 max/window；硬编码即可 |
| 7 | 是否提供管理 API | 否 | 限流调整频率低（基本不会改），加管理 API 投入产出比低 |
| 8 | 现场已触发的 429 | 需重启 Electron | in-memory 计数只能靠进程重启清空 |

## 接口设计

### 后端中间件

#### `authRateLimiter`（保持不变，10/小时）
- 适用端点：`POST /api/auth/login` `POST /api/auth/register` `POST /api/auth/change-password`
- 理由：防暴力破解、批量注册、密码爆破

#### `authMeRateLimiter`（**新增**，100/小时）
- 适用端点：`GET /api/auth/me` `POST /api/auth/logout`
- 理由：容纳频繁刷新、登出本身不该被限

### 前端 AuthContext 改造

**改造前**:
```js
try {
  const data = await getMeApi();
  setUser(data.user);
  setStoredUser(data.user);
} catch (e) {
  // 任何错误都视为未登录
  setUser(null);
  setStoredUser(null);
}
```

**改造后**:
```js
try {
  const data = await getMeApi();
  setUser(data.user);
  setStoredUser(data.user);
} catch (e) {
  const status = e?.response?.status;
  if (status === 401) {
    // 只有 401（token 失效）才视为未登录
    setUser(null);
    setStoredUser(null);
  } else {
    // 429/网络异常：保留本地 user，避免刷新页面被踢出
    console.warn('bootstrap /me 失败（非 401），保留本地登录态:', status, e?.message);
  }
}
```

### 前端 axios 拦截器

**改造前**:
```js
if (status === 401) {
  setStoredUser(null);
  window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
} else if (status >= 400 && data && data.error) {
  message.error(data.error);
}
```

**改造后**:
```js
if (status === 401) {
  setStoredUser(null);
  window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
} else if (status === 429) {
  // 限流不弹 toast：后端在限制频率，频繁刷新时不要刷一堆错误
  // 调用方（如 AuthContext.bootstrap）会区分状态码处理
} else if (status >= 400 && data && data.error) {
  message.error(data.error);
}
```

## 行为对比

| /me 响应 | 改造前 | 改造后 |
|----------|--------|--------|
| 200 | 设 user，登录态生效 | 不变 |
| 401 | 清 user，跳登录页 | 不变 |
| 429 | 清 user + 弹 toast + 跳登录页 | 保留 user，console.warn，不弹 toast |
| 网络异常 | 清 user | 保留 user |
| 5xx | 清 user + 弹 toast | 保留 user + 弹 toast |

| /login 响应 | 改造前 | 改造后 |
|-------------|--------|--------|
| 200 | 登录成功 | 不变 |
| 401 | 用户名或密码错误 | 不变 |
| 429 | 弹"请求过于频繁" | **不变**（仍弹） |

## 涉及文件

| 文件 | 变更 |
|------|------|
| `backend/src/middleware/rateLimit.js` | 修改：+ `authMeRateLimiter` |
| `backend/src/routes/auth.js` | 修改：`/me` `/logout` 改用 `authMeRateLimiter` |
| `frontend/src/context/AuthContext.jsx` | 修改：bootstrap catch 分流 401 vs 其他 |
| `frontend/src/api/index.js` | 修改：拦截器 429 不弹 toast |

## 测试覆盖

无新增自动化测试（改动小、风险低）。端到端验证覆盖：

| # | 操作 | 期望 |
|---|------|------|
| 1 | 刷新 15 次页面 | 仍然保持登录态（不会跳登录页） |
| 2 | /me 触 429 时 | 控制台 warn，无 toast，无跳转 |
| 3 | 真实 token 失效 | 跳登录页（401 行为不变） |
| 4 | /login 用尽后 | 弹"请求过于频繁"（10/小时硬约束保留） |
| 5 | 反复登录 + 登出 | 不被 /logout 限流（共用 100/小时） |

## 限制（关键约束）

- **express-rate-limit 限制**：`max` 和 `windowMs` 必须在创建 limiter 时确定
- **运行时改 max 不生效**：必须重启进程
- **in-memory store**：重启清空所有计数
- **结论**：当前采用硬编码常量；如需配置化，需自实现一层 wrap（详见 [未来扩展]）

## 未来扩展（如需要）

### 配置化方案
1. 在 `configs` 表加 `agent_rate_limit_max` / `agent_rate_limit_window_ms`
2. 启动时读一次，构建 limiter
3. 提供管理 API（admin）调整配置
4. 改后**必须重启**才生效（这是 express-rate-limit 限制）

### 热生效方案（投入高）
1. `authMeRateLimiter` 的 `max` 设大值（如 1000）作为占位
2. 自实现一个中间件：拿 DB 配的 `max` / `windowMs` 做实际限流判断
3. 用 Map 存 IP → { count, windowStart }，在中间件内自增自检
4. 改配置立即生效（无重启）

投入产出比：当前场景下不必要。如未来需要多租户、动态调参，再考虑。

## 安全考虑

- /me 100/小时上限仍是防滥用的硬约束（每 36s 1 次仍能完成所有正常操作）
- /logout 走 100/小时是合理的（正常用户不会高频登出）
- 401 行为不变：token 失效仍踢回登录页
- 429 不弹 toast：避免 UI 噪音，不构成安全风险

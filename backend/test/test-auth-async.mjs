// 验证 bcrypt 异步化后端到端功能（使用临时 SQLite，避免污染真实 data/app.db）
import path from 'path';
import os from 'os';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

// ★ 必须在导入 sqlite.js 之前设置 DB_PATH（config.js 在模块加载时读取）
process.env.DB_PATH = path.join(os.tmpdir(), `xtsql-test-auth-${Date.now()}.db`);

const { initDatabase, getDb, initSkillLogTable } = await import('../src/db/sqlite.js');
const { default: authRouter } = await import('../src/routes/auth.js');

const app = express();
app.use(cors({ origin: (o, cb) => cb(null, true), credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);

(async () => {
  await initDatabase();
  initSkillLogTable();

  // 清空测试用户（避免历史数据干扰）
  const db = getDb();
  db.prepare('DELETE FROM users WHERE username = ?').run('testasync');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/auth`;

  function getCookieHeader(resp) {
    const setCookie = resp.headers.get('set-cookie');
    if (!setCookie) return null;
    // 取 xtsql_token 这一条
    return setCookie.split(',').map(c => c.split(';')[0]).join('; ');
  }

  async function postJson(path, body, cookie) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    const resp = await fetch(baseUrl + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    return { status: resp.status, body: await resp.json(), cookie: getCookieHeader(resp) };
  }

  function expect(name, actual, expected) {
    const ok = actual === expected;
    console.log(`  ${ok ? '✅' : '❌'} ${name}: 实际=${actual} 期望=${expected}`);
    if (!ok) process.exitCode = 1;
  }

  try {
    console.log('=== 1. 注册新用户（异步 hashPassword） ===');
    const t0 = Date.now();
    const reg = await postJson('/register', { username: 'testasync', password: 'pass123' });
    const tReg = Date.now() - t0;
    console.log(`  耗时: ${tReg}ms`);
    expect('注册 status', reg.status, 200);
    expect('注册 success', reg.body.success, true);
    expect('返回 username', reg.body.user.username, 'testasync');
    expect('role', reg.body.user.role, 'user');

    console.log('\n=== 2. 登录（异步 comparePassword，密码正确） ===');
    const login = await postJson('/login', { username: 'testasync', password: 'pass123' });
    expect('登录 status', login.status, 200);
    expect('登录 success', login.body.success, true);
    expect('有 cookie', !!login.cookie, true);

    console.log('\n=== 3. 登录（密码错误） ===');
    const loginBad = await postJson('/login', { username: 'testasync', password: 'wrongpass' });
    expect('登录 status', login.status, 200); // 前一个
    expect('错误密码 status', loginBad.status, 401);

    console.log('\n=== 4. 修改密码（异步 hashPassword + comparePassword） ===');
    const cp = await postJson('/change-password',
      { oldPassword: 'pass123', newPassword: 'newpass456' },
      login.cookie
    );
    expect('改密 status', cp.status, 200);
    expect('改密 success', cp.body.success, true);

    console.log('\n=== 5. 用新密码登录（应成功） ===');
    const loginNew = await postJson('/login', { username: 'testasync', password: 'newpass456' });
    expect('新密码登录 status', loginNew.status, 200);
    expect('新密码登录 success', loginNew.body.success, true);

    console.log('\n=== 6. 旧密码登录（应失败） ===');
    const loginOld = await postJson('/login', { username: 'testasync', password: 'pass123' });
    expect('旧密码登录 status', loginOld.status, 401);

    console.log('\n=== 7. 并发测试：3 个请求一起发起（验证事件循环不阻塞） ===');
    // 注：rate-limit 是 10/小时/IP，前 6 步已用掉 6 次，这里只用 3 次避免触发限流
    const concurrentStart = Date.now();
    const promises = Array.from({ length: 3 }, (_, i) =>
      postJson('/login', { username: 'testasync', password: 'newpass456' })
    );
    const results = await Promise.all(promises);
    const concurrentMs = Date.now() - concurrentStart;
    const successCount = results.filter(r => r.status === 200).length;
    console.log(`  总耗时: ${concurrentMs}ms (3 个并发请求)`);
    console.log(`  成功: ${successCount}/3`);
    expect('3 个并发完成', results.length, 3);
    expect('全部成功', successCount, 3);

    // 清理
    db.prepare('DELETE FROM users WHERE username = ?').run('testasync');
    console.log('\n=== 全部通过 ===');
  } catch (e) {
    console.error('测试异常:', e);
    process.exit(1);
  } finally {
    server.close();
  }
})();

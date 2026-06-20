// 通过真实的 Express 服务器验证 rate-limit
import express from 'express';
import { authRateLimiter } from './src/middleware/rateLimit.js';

const app = express();
app.use(express.json());
app.post('/test', authRateLimiter, (req, res) => {
  res.json({ success: true, message: 'passed' });
});

const server = app.listen(0); // 随机端口
const port = server.address().port;
console.log(`Test server on port ${port}`);

async function test() {
  // 1. 前 10 次应通过
  for (let i = 1; i <= 10; i++) {
    const resp = await fetch(`http://127.0.0.1:${port}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ i })
    });
    const data = await resp.json();
    const status = resp.status;
    const ok = status === 200 && data.success === true;
    console.log(`  请求 #${i.toString().padStart(2)}: status=${status} ${ok ? '✅' : '❌'}`);
    if (!ok) {
      console.log('    响应:', data);
    }
  }

  // 2. 第 11 次应被限流（429）
  console.log('\n--- 第 11 次应被限流 ---');
  const resp = await fetch(`http://127.0.0.1:${port}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ i: 11 })
  });
  const data = await resp.json();
  const limited = resp.status === 429;
  console.log(`  状态码: ${resp.status} ${limited ? '✅' : '❌'}`);
  console.log(`  响应:`, data);
  console.log(`  RateLimit-Remaining 头:`, resp.headers.get('RateLimit-Remaining'));
  console.log(`  RateLimit-Reset 头:`, resp.headers.get('RateLimit-Reset'));

  // 3. 不同 IP 应独立计数（这里只模拟 keyGenerator 不变，但实际 IP 都是 127.0.0.1）
  console.log('\n--- X-Forwarded-For 测试（trust proxy 未设置，应忽略） ---');
  const resp2 = await fetch(`http://127.0.0.1:${port}/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '5.6.7.8'
    },
    body: JSON.stringify({ i: 12 })
  });
  console.log(`  状态码: ${resp2.status} (应仍为 429, 表明 X-Forwarded-For 被忽略)`);

  server.close();
  console.log('\n=== 测试完成 ===');
}

test().catch(e => { console.error(e); process.exit(1); });

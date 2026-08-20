/**
 * "我的查询"功能单元测试
 *
 * 覆盖：
 *   A. extractJsonObject 解析容错（8）
 *   B. getDomainsForTables 反查（8）
 *   C. saveFavoriteQuery 集成（mock LLM + 真实 SQLite + 临时 skill v2）（10）
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fav-query-test-'));
process.env.SKILL_PATH = testRoot;
process.env.PROJECT_ROOT = testRoot;

const { extractJsonObject, saveFavoriteQuery, checkFavorites, deleteFavoriteQuery, getFavoriteSuggestions } = await import('../src/services/favoriteQuery.js');
const { getDomainsForTables, invalidateReverseIndex } = await import('../src/services/skillDomains.js');

let pass = 0;
let fail = 0;

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}

function truthy(label, actual) {
  const ok = !!actual;
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        actual: ${JSON.stringify(actual)}`); }
}

function throwsWithMessage(label, fn, snippet) {
  let threw = false;
  let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (threw && err && err.message && err.message.includes(snippet)) {
    pass++; console.log(`  PASS  ${label}`);
  } else {
    fail++; console.log(`  FAIL  ${label}\n        expected msg: ${snippet}\n        threw: ${threw}\n        err.message: ${err && err.message}`);
  }
}

console.log(`Test root: ${testRoot}\n`);

// =========================================================
// A. extractJsonObject
// =========================================================
console.log('=== A. extractJsonObject 解析容错 ===');
eq('A1 直接合法 JSON', extractJsonObject('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
eq('A2 被 ```json 包裹', extractJsonObject('```json\n{"a":2}\n```'), { a: 2 });
eq('A3 被 ``` 包裹（无语言）', extractJsonObject('```\n{"a":3}\n```'), { a: 3 });
eq('A4 前有说明文字', extractJsonObject('好的，结果如下：\n{"a":4,"list":[1,2]}'), { a: 4, list: [1, 2] });
eq('A5 含 unicode 转义', extractJsonObject('{"a":"\\u4e2d\\u6587"}'), { a: '中文' });
throwsWithMessage('A6 空字符串抛错', () => extractJsonObject(''), 'LLM 返回内容为空');
throwsWithMessage('A7 非法 JSON 抛错', () => extractJsonObject('not a json'), 'JSON');
throwsWithMessage('A8 非字符串输入抛错', () => extractJsonObject(null), 'LLM 返回内容为空');

// =========================================================
// B. getDomainsForTables
// =========================================================
const skillV2Path = path.join(testRoot, 'sql-creator-skill-v2');
fs.mkdirSync(path.join(skillV2Path, 'domains'), { recursive: true });
fs.writeFileSync(
  path.join(skillV2Path, 'domain_router_index.json'),
  JSON.stringify({
    domains: [
      { id: 'finance', name: '财务' },
      { id: 'course', name: '课程' },
      { id: 'people', name: '人员' }
    ]
  })
);
fs.writeFileSync(path.join(skillV2Path, 'domains', 'finance.json'),
  JSON.stringify({ id: 'finance', tables: ['t_order', 't_pay'] }));
fs.writeFileSync(path.join(skillV2Path, 'domains', 'course.json'),
  JSON.stringify({ id: 'course', tables: ['t_course', 't_user'] }));
fs.writeFileSync(path.join(skillV2Path, 'domains', 'people.json'),
  JSON.stringify({ id: 'people', tables: ['t_user', 't_teacher'] }));
invalidateReverseIndex();

console.log('\n=== B. getDomainsForTables 反查 ===');
eq('B1 单表单域', getDomainsForTables(['t_order'], skillV2Path), ['finance']);
eq('B2 单表跨域', getDomainsForTables(['t_user'], skillV2Path), ['course', 'people']);
eq('B3 多表去重', getDomainsForTables(['t_order', 't_pay', 't_order'], skillV2Path), ['finance']);
eq('B4 多域混合', getDomainsForTables(['t_order', 't_course', 't_teacher'], skillV2Path), ['course', 'finance', 'people']);
eq('B5 表不存在返回空', getDomainsForTables(['t_unknown'], skillV2Path), []);
eq('B6 大小写不敏感', getDomainsForTables(['T_ORDER'], skillV2Path), ['finance']);
eq('B7 空数组返回空', getDomainsForTables([], skillV2Path), []);
eq('B8 null 安全', getDomainsForTables(null, skillV2Path), []);

// =========================================================
// C. saveFavoriteQuery 集成
// =========================================================
console.log('\n=== C. saveFavoriteQuery 集成 ===');

const dbPath = path.join(testRoot, 'app.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    token_version INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS my_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_question TEXT NOT NULL,
    optimized_question TEXT,
    sql_output TEXT NOT NULL,
    business_domains TEXT,
    add_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, sql_output),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`).run('tester', 'h', 'user');
const testUserId = db.prepare(`SELECT id FROM users WHERE username = ?`).get('tester').id;
const getDbFn = () => db;

// C1. 正常路径
{
  const r = await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: '查所有订单',
    sqlOutput: 'SELECT * FROM t_order',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '查询订单', table_names: ['t_order'] }),
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      model: 'deepseek-chat'
    })
  });
  truthy('C1 id 已分配', r.id > 0);
  eq('C1 optimizedQuestion', r.optimizedQuestion, '查询订单');
  eq('C1 businessDomains', r.businessDomains, ['finance']);
  const row = db.prepare('SELECT * FROM my_queries WHERE id = ?').get(r.id);
  eq('C1 写库 user_id', row.user_id, testUserId);
  eq('C1 写库 user_question', row.user_question, '查所有订单');
  eq('C1 写库 optimized_question', row.optimized_question, '查询订单');
  eq('C1 写库 sql_output', row.sql_output, 'SELECT * FROM t_order');
  eq('C1 写库 business_domains（JSON）', row.business_domains, '["finance"]');
}

// C2. 业务域为空
{
  const r = await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: '问个问题',
    sqlOutput: 'SELECT 1',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '简单查询', table_names: [] }),
      usage: {}, model: 'deepseek-chat'
    })
  });
  eq('C2 空业务域', r.businessDomains, []);
  const row = db.prepare('SELECT * FROM my_queries WHERE id = ?').get(r.id);
  eq('C2 写库 business_domains = "[]"', row.business_domains, '[]');
}

// C3. 重复 (user_id, sql_output) → ON CONFLICT 更新
{
  await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: '原始提问',
    sqlOutput: 'SELECT * FROM t_pay',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '原标题', table_names: ['t_pay'] }),
      usage: {}, model: 'deepseek-chat'
    })
  });
  await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: '更新后提问',
    sqlOutput: 'SELECT * FROM t_pay',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '更新后标题', table_names: ['t_pay'] }),
      usage: {}, model: 'deepseek-chat'
    })
  });
  const rows = db.prepare('SELECT * FROM my_queries WHERE user_id = ? AND sql_output = ?')
    .all(testUserId, 'SELECT * FROM t_pay');
  eq('C3 唯一约束：行数 = 1', rows.length, 1);
  eq('C3 user_question 已更新', rows[0].user_question, '更新后提问');
  eq('C3 optimized_question 已更新', rows[0].optimized_question, '更新后标题');
}

// C4. 跨域表 → 多业务域
{
  const r = await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: '查用户参与的课程',
    sqlOutput: 'SELECT * FROM t_user u JOIN t_course c ON u.id = c.user_id',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '查用户课程', table_names: ['t_user', 't_course'] }),
      usage: {}, model: 'deepseek-chat'
    })
  });
  eq('C4 多业务域', r.businessDomains, ['course', 'people']);
}

// C5/C6/C7. 参数缺失抛错
{
  let threw = false;
  try { await saveFavoriteQuery({ userId: 0, userQuestion: 'x', sqlOutput: 'y' }); }
  catch (e) { threw = e.message.includes('userId'); }
  truthy('C5 userId 缺失抛错', threw);

  threw = false;
  try { await saveFavoriteQuery({ userId: 1, userQuestion: '', sqlOutput: 'y' }); }
  catch (e) { threw = e.message.includes('userQuestion'); }
  truthy('C6 userQuestion 空抛错', threw);

  threw = false;
  try { await saveFavoriteQuery({ userId: 1, userQuestion: 'q', sqlOutput: '' }); }
  catch (e) { threw = e.message.includes('sqlOutput'); }
  truthy('C7 sqlOutput 空抛错', threw);
}

// C8. LLM 返回非法 JSON
{
  let threw = false;
  let msg = '';
  try {
    await saveFavoriteQuery({
      userId: testUserId,
      userQuestion: 'q',
      sqlOutput: 'SELECT 1',
      getDbFn,
      llmCaller: async () => ({ content: '非 JSON 输出', usage: {}, model: 'deepseek-chat' })
    });
  } catch (e) { threw = true; msg = e.message; }
  truthy('C8 LLM 非法 JSON 抛错', threw);
  truthy('C8 错误信息含 JSON', msg.includes('JSON'));
}

// C9. LLM 抛错透传
{
  let threw = false;
  let msg = '';
  try {
    await saveFavoriteQuery({
      userId: testUserId,
      userQuestion: 'q',
      sqlOutput: 'SELECT 2',
      getDbFn,
      llmCaller: async () => { throw new Error('up stream 502'); }
    });
  } catch (e) { threw = true; msg = e.message; }
  truthy('C9 LLM 抛错被透传', threw);
  truthy('C9 错误信息含原始消息', msg.includes('up stream'));
}

// C10. LLM 抛错时不应写入 DB
{
  const before = db.prepare('SELECT COUNT(*) as cnt FROM my_queries').get().cnt;
  let threw = false;
  try {
    await saveFavoriteQuery({
      userId: testUserId,
      userQuestion: 'q',
      sqlOutput: 'SELECT 3',
      getDbFn,
      llmCaller: async () => { throw new Error('LLM 调用失败'); }
    });
  } catch (e) { threw = true; }
  const after = db.prepare('SELECT COUNT(*) as cnt FROM my_queries').get().cnt;
  truthy('C10 LLM 抛错时回滚', threw);
  eq('C10 DB 行数未增加', after, before);
}

// C11. 回归：callLlmForFavorite 在不传 signal 时不抛 addEventListener
// 旧版本 bug：withTimeout / withPromiseTimeout 假设 externalSignal 非空
// 导致路由层不传 signal 时直接抛 "Cannot read properties of undefined (reading 'addEventListener')"
{
  // 直接调底层函数，传 undefined signal
  const { withTimeout, withPromiseTimeout } = await import('../src/services/llm.js');
  let threwWithTimeout = false;
  try {
    const t = withTimeout(undefined, 5000, 'regression-withTimeout');
    t.cancel();
  } catch (e) { threwWithTimeout = true; }
  truthy('C11a withTimeout(undefined) 不抛错', !threwWithTimeout);

  let threwWithPromiseTimeout = false;
  try {
    await withPromiseTimeout(async () => 'ok', undefined, 5000, 'regression-withPromiseTimeout');
  } catch (e) { threwWithPromiseTimeout = true; }
  truthy('C11b withPromiseTimeout(undefined) 不抛错', !threwWithPromiseTimeout);

  // 真实链路：saveFavoriteQuery 不传 signal 走完（mock llmCaller 验证）
  const r = await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: 'q',
    sqlOutput: 'SELECT 4',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '回归测试', table_names: [] }),
      usage: {}, model: 'deepseek-chat'
    })
  });
  truthy('C11c saveFavoriteQuery 不传 signal 走通', r.id > 0);
}

// =========================================================
// D. checkFavorites
// =========================================================
console.log('\n=== D. checkFavorites 批量查 ===');
{
  // 准备：再插入 2 个收藏（tester 用户），userA 收藏 1 个
  await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: 'A',
    sqlOutput: 'SELECT 11',
    getDbFn,
    llmCaller: async () => ({ content: JSON.stringify({ optimized_question: '查 11', table_names: [] }), usage: {}, model: 'deepseek-chat' })
  });
  await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: 'B',
    sqlOutput: 'SELECT 22',
    getDbFn,
    llmCaller: async () => ({ content: JSON.stringify({ optimized_question: '查 22', table_names: ['t_user'] }), usage: {}, model: 'deepseek-chat' })
  });
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`).run('userA', 'h', 'user');
  const userAId = db.prepare(`SELECT id FROM users WHERE username = ?`).get('userA').id;
  await saveFavoriteQuery({
    userId: userAId,
    userQuestion: 'C',
    sqlOutput: 'SELECT 33',
    getDbFn,
    llmCaller: async () => ({ content: JSON.stringify({ optimized_question: 'userA 查 33', table_names: [] }), usage: {}, model: 'deepseek-chat' })
  });

  // D1. 全部命中
  {
    const m = checkFavorites(testUserId, ['SELECT 11', 'SELECT 22'], getDbFn);
    eq('D1a 全部命中：size', m.size, 2);
    truthy('D1b 命中含 optimizedQuestion', m.get('SELECT 11')?.optimizedQuestion === '查 11');
    truthy('D1c 跨域 SQL 命中含业务域', Array.isArray(m.get('SELECT 22')?.businessDomains) && m.get('SELECT 22').businessDomains.length > 0);
  }

  // D2. 部分命中
  {
    const m = checkFavorites(testUserId, ['SELECT 11', 'SELECT_NOT_EXIST'], getDbFn);
    eq('D2 部分命中：size', m.size, 1);
    truthy('D2 命中是 SELECT 11', m.has('SELECT 11'));
    truthy('D2 未命中不在 map', !m.has('SELECT_NOT_EXIST'));
  }

  // D3. 全部未命中
  {
    const m = checkFavorites(testUserId, ['X1', 'X2', 'X3'], getDbFn);
    eq('D3 全无命中：size', m.size, 0);
  }

  // D4. 跨用户隔离：testUserId 查不到 userA 的 SELECT 33
  {
    const m = checkFavorites(testUserId, ['SELECT 33'], getDbFn);
    eq('D4 跨用户隔离：tester 查不到 userA 的', m.size, 0);
    const mA = checkFavorites(userAId, ['SELECT 33'], getDbFn);
    eq('D4 跨用户隔离：userA 查得到', mA.size, 1);
  }

  // D5. 空数组
  {
    const m = checkFavorites(testUserId, [], getDbFn);
    eq('D5 空数组返回空 Map', m.size, 0);
  }

  // D6. 空字符串 / 空白被过滤
  {
    const m = checkFavorites(testUserId, ['', '   ', 'SELECT 11'], getDbFn);
    eq('D6 空字符串被过滤：size', m.size, 1);
    truthy('D6 命中 SELECT 11', m.has('SELECT 11'));
  }

  // D7. 去重
  {
    const m = checkFavorites(testUserId, ['SELECT 11', 'SELECT 11', 'SELECT 11'], getDbFn);
    eq('D7 去重后 size=1', m.size, 1);
  }
}

// =========================================================
// E. deleteFavoriteQuery
// =========================================================
console.log('\n=== E. deleteFavoriteQuery 取消收藏 ===');
{
  // E1. 删存在的
  const ok = deleteFavoriteQuery(testUserId, 'SELECT 11', getDbFn);
  truthy('E1 删存在返回 true', ok);
  const m = checkFavorites(testUserId, ['SELECT 11'], getDbFn);
  eq('E1 删后 checkFavorites 不再命中', m.size, 0);

  // E2. 删不存在的
  const ok2 = deleteFavoriteQuery(testUserId, 'SELECT 11', getDbFn);
  truthy('E2 删不存在的返回 false', !ok2);

  // E3. 跨用户隔离：userA 删不掉 tester 的
  db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`).run('userB', 'h', 'user');
  const userBId = db.prepare(`SELECT id FROM users WHERE username = ?`).get('userB').id;
  const ok3 = deleteFavoriteQuery(userBId, 'SELECT 22', getDbFn);
  truthy('E3 跨用户隔离：userB 删不掉 tester 的', !ok3);
  // 验证 tester 的仍在
  const m3 = checkFavorites(testUserId, ['SELECT 22'], getDbFn);
  eq('E3 tester 的 SELECT 22 仍存在', m3.size, 1);

  // E4. userId 缺失
  truthy('E4a userId 缺失返回 false', !deleteFavoriteQuery(0, 'x', getDbFn));
  truthy('E4b sqlOutput 缺失返回 false', !deleteFavoriteQuery(testUserId, '', getDbFn));
}

// =========================================================
// F. getFavoriteSuggestions
// =========================================================
console.log('\n=== F. getFavoriteSuggestions 新会话建议 ===');
{
  // 当前状态：D 中 tester 用户有 SELECT 22（optimized="查 22"）；E1 删了 SELECT 11
  // 重新查询跨区块的 userA / userB id
  const userAId = db.prepare(`SELECT id FROM users WHERE username = ?`).get('userA').id;
  const userBId = db.prepare(`SELECT id FROM users WHERE username = ?`).get('userB').id;
  // 准备：插入更多数据用于多场景
  //  - tester: 收藏 5 条（不同提问）
  //  - userA: 收藏 2 条
  //  - userB: 收藏 1 条
  const testerSeedSqls = ['SELECT 100', 'SELECT 200', 'SELECT 300', 'SELECT 400', 'SELECT 500'];
  const testerSeedOptimized = ['统计月度活跃用户', '查退款订单', 'Top 10 热销商品', '按渠道分组销售额', '日活趋势'];
  for (let i = 0; i < testerSeedSqls.length; i++) {
    await saveFavoriteQuery({
      userId: testUserId,
      userQuestion: `tester 原始 ${i}`,
      sqlOutput: testerSeedSqls[i],
      getDbFn,
      llmCaller: async () => ({
        content: JSON.stringify({ optimized_question: testerSeedOptimized[i], table_names: [] }),
        usage: {}, model: 'deepseek-chat'
      })
    });
  }
  // 重复收藏同一提问（验证 GROUP BY 去重）
  await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: 'tester 原始 0（重复）',
    sqlOutput: 'SELECT 100_dup',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '统计月度活跃用户', table_names: [] }),
      usage: {}, model: 'deepseek-chat'
    })
  });
  // 优化标题为空的收藏（验证回退到 user_question）
  await saveFavoriteQuery({
    userId: testUserId,
    userQuestion: '只收藏未优化的问题',
    sqlOutput: 'SELECT 999',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: '', table_names: [] }),
      usage: {}, model: 'deepseek-chat'
    })
  });

  // userA、userB 收藏
  for (const [q, sql] of [['userA 查询 1', 'SELECT_A1'], ['userA 查询 2', 'SELECT_A2']]) {
    await saveFavoriteQuery({
      userId: userAId,
      userQuestion: q,
      sqlOutput: sql,
      getDbFn,
      llmCaller: async () => ({
        content: JSON.stringify({ optimized_question: q.replace('userA ', 'userA优'), table_names: [] }),
        usage: {}, model: 'deepseek-chat'
      })
    });
  }
  await saveFavoriteQuery({
    userId: userBId,
    userQuestion: 'userB 查询 1',
    sqlOutput: 'SELECT_B1',
    getDbFn,
    llmCaller: async () => ({
      content: JSON.stringify({ optimized_question: 'userB优 查询', table_names: [] }),
      usage: {}, model: 'deepseek-chat'
    })
  });

  // F1. 普通用户：仅自己
  {
    const s = getFavoriteSuggestions({ userId: testUserId, role: 'user', count: 20, getDbFn });
    // tester 总收藏：5 (D 中 SELECT 22) + 5 (seed) + 1 (重复去重) + 1 (未优化回退) = 11 条（去重后 10 条 unique q）
    truthy('F1a 普通用户只取自己（无 userA/B）',
      s.every(x => !x.includes('userA') && !x.includes('userB')));
    // 含去重后的"统计月度活跃用户"（1 条）
    const countDup = s.filter(x => x === '统计月度活跃用户').length;
    eq('F1b GROUP BY 去重生效', countDup, 1);
    // 含回退的 user_question
    truthy('F1c 含回退的 user_question', s.includes('只收藏未优化的问题'));
    // 含优化标题
    truthy('F1d 含优化标题', s.includes('统计月度活跃用户'));
    // 不超过 count
    truthy('F1e 不超过 count', s.length <= 20);
  }

  // F2. admin：跨用户
  {
    const s = getFavoriteSuggestions({ userId: testUserId, role: 'admin', count: 30, getDbFn });
    // admin 应该能看到 userA 的收藏
    const hasUserA = s.some(x => x.includes('userA优'));
    const hasUserB = s.some(x => x.includes('userB优'));
    truthy('F2a admin 跨用户：含 userA', hasUserA);
    truthy('F2b admin 跨用户：含 userB', hasUserB);
  }

  // F3. admin vs 普通用户：结果不应完全相同（随机 + 数据量差异）
  {
    const admin = getFavoriteSuggestions({ userId: testUserId, role: 'admin', count: 4, getDbFn });
    const user = getFavoriteSuggestions({ userId: testUserId, role: 'user', count: 4, getDbFn });
    // 多次采样验证 admin 至少偶尔出现 userA/B 的内容
    let adminSaw = 0;
    for (let i = 0; i < 30; i++) {
      const s = getFavoriteSuggestions({ userId: testUserId, role: 'admin', count: 5, getDbFn });
      if (s.some(x => x.includes('userA') || x.includes('userB'))) adminSaw++;
    }
    truthy('F3 admin 30 次采样大部分都能跨用户', adminSaw >= 15);
  }

  // F4. 不足 count 条时返回所有
  {
    // userB 只有 1 条收藏
    const s = getFavoriteSuggestions({ userId: userBId, role: 'user', count: 4, getDbFn });
    eq('F4 userB 只有 1 条收藏：返 1 条', s.length, 1);
  }

  // F5. 空收藏：返 []
  {
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`).run('userEmpty', 'h', 'user');
    const emptyId = db.prepare(`SELECT id FROM users WHERE username = ?`).get('userEmpty').id;
    const s = getFavoriteSuggestions({ userId: emptyId, role: 'user', count: 4, getDbFn });
    eq('F5 空收藏返 []', s.length, 0);
  }

  // F6. userId 缺失
  {
    const s = getFavoriteSuggestions({ userId: 0, role: 'admin', count: 4, getDbFn });
    eq('F6 userId 缺失返 []', s.length, 0);
  }

  // F7. 默认 count=4
  {
    const s = getFavoriteSuggestions({ userId: testUserId, role: 'user', getDbFn });
    truthy('F7 默认 count=4：不超过 4', s.length <= 4);
  }
}

// =========================================================
// 清理
// =========================================================
db.close();
fs.rmSync(testRoot, { recursive: true, force: true });

console.log(`\n=== 总结 ===`);
console.log(`通过: ${pass}`);
console.log(`失败: ${fail}`);
console.log(`总计: ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

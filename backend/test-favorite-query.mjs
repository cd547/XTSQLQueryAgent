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

const { extractJsonObject, saveFavoriteQuery } = await import('./src/services/favoriteQuery.js');
const { getDomainsForTables, invalidateReverseIndex } = await import('./src/services/skillDomains.js');

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
  const { withTimeout, withPromiseTimeout } = await import('./src/services/llm.js');
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
// 清理
// =========================================================
db.close();
fs.rmSync(testRoot, { recursive: true, force: true });

console.log(`\n=== 总结 ===`);
console.log(`通过: ${pass}`);
console.log(`失败: ${fail}`);
console.log(`总计: ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);

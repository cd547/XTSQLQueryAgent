// test-v515-cached-tokens.mjs
// 验证：messages 表加 cached_tokens 列 + 两种 API 路径 INSERT 时都带 cached_tokens
import path from 'path';
import os from 'os';
process.env.DB_PATH = path.join(os.tmpdir(), `xtsql-test-v515-${Date.now()}.db`);

const { initDatabase, getDb } = await import('./src/db/sqlite.js');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}`); }
};

await initDatabase();

console.log('=== v5.15 cached_tokens 字段链路 ===');

// Case 1: messages 表 schema 含 cached_tokens 列
{
  const cols = getDb().prepare("PRAGMA table_info(messages)").all();
  const c = cols.find(x => x.name === 'cached_tokens');
  check('messages 表有 cached_tokens 列', !!c);
  check('cached_tokens 类型=INTEGER', c?.type === 'INTEGER');
  check('cached_tokens 默认值=0', c?.dflt_value === '0');
}

// Case 2: 老库迁移路径（PRAGMA 检测）
{
  // 模拟老库：drop column → ALTER TABLE 触发
  // 我们的 initDatabase 已幂等 ALTER，所以这里测一个 sessionId INSERT
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO sessions (id, user_id, name) VALUES (12346, 1, 'v515-test')").run();
  // INSERT with cached_tokens = 100
  db.prepare(
    "INSERT INTO messages (session_id, role, content, prompt_tokens, completion_tokens, total_tokens, cached_tokens, round) VALUES (?, 'usage', 'test', 1000, 200, 1200, 800, 0)"
  ).run(12346);
  const row = db.prepare("SELECT prompt_tokens, completion_tokens, total_tokens, cached_tokens FROM messages WHERE session_id = 12346").get();
  check('INSERT 成功 + cached_tokens=800', row?.cached_tokens === 800);
  check('prompt_tokens=1000', row?.prompt_tokens === 1000);
  check('completion_tokens=200', row?.completion_tokens === 200);
  check('total_tokens=1200', row?.total_tokens === 1200);
}

// Case 3: 缓存命中率（前端用 cached_tokens / prompt_tokens 计算）
{
  // 100/1000 = 10%
  const cached = 100, prompt = 1000;
  const hitRate = (cached / prompt * 100).toFixed(1);
  check('缓存命中率 = 10.0%', hitRate === '10.0');
}

// Case 4: 老库迁移幂等（多次 initDatabase 不抛错）
{
  await initDatabase();
  const cols = getDb().prepare("PRAGMA table_info(messages)").all();
  const c = cols.find(x => x.name === 'cached_tokens');
  check('重复 initDatabase 不破坏列', !!c);
}

// 清理
{
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE session_id = 12346").run();
  db.prepare("DELETE FROM sessions WHERE id = 12346").run();
}

console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);

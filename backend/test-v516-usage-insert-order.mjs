// test-v516-usage-insert-order.mjs
// 验证：最后一个 round（无 tool_call 直接返回 SQL）时，role='usage' 行是否在 role='assistant' 行之前插入
import path from 'path';
import os from 'os';
process.env.DB_PATH = path.join(os.tmpdir(), `xtsql-test-v516-${Date.now()}.db`);

const { initDatabase, getDb } = await import('./src/db/sqlite.js');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}`); }
};

await initDatabase();

// 创建测试 session
const sid = 10012345;
getDb().prepare("INSERT OR IGNORE INTO sessions (id, user_id, name) VALUES (?, 1, 'v516-test')").run(sid);

console.log('=== v5.16 usage 插入顺序验证 ===');

// 模拟最后 round：1 轮 LLM → usage → done → assistant
// 顺序: yield usage → handler case usage → await persistUsageToDb
//       yield done → handler case done → 不写库
//       for-await 结束 → L795 await persistAssistantFinal

// 1) 先写 usage（最后 round 的 usage）—— 复制 responsesApi.js:282-283 的 INSERT
getDb().prepare(
  'INSERT INTO messages (session_id, role, content, prompt_tokens, completion_tokens, total_tokens, cached_tokens, round) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
).run(sid, 'usage', 'Round token: 150 (prompt: 100, completion: 50, cached: 80)', 100, 50, 150, 80, 1);

// 2) 再写 assistant（最后 round 的 assistant 消息）—— 复制 responsesApi.js:303-305 的 INSERT
getDb().prepare(
  'INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, round, interrupted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run(sid, 'assistant', 'SELECT 1', 'SELECT 1', '', 100, 50, 150, 1000, 1, 0);

const rows = getDb().prepare(`
  SELECT role, round, prompt_tokens, completion_tokens, total_tokens, cached_tokens, created_at, id
  FROM messages WHERE session_id = ?
  ORDER BY id ASC
`).all(sid);

console.log('查表结果（按 id 升序）:');
for (const r of rows) {
  console.log(`  [id=${r.id} ${r.role.padEnd(10)}] round=${r.round} prompt=${r.prompt_tokens} comp=${r.completion_tokens} total=${r.total_tokens} cached=${r.cached_tokens} ${r.created_at}`);
}

const usageRow = rows.find(r => r.role === 'usage' && r.round === 1);
const asstRow = rows.find(r => r.role === 'assistant' && r.round === 1);

check('存在 round=1 的 usage 行', !!usageRow);
check('存在 round=1 的 assistant 行', !!asstRow);
check('usage 行在 assistant 行之前（按 id 升序：usage.id < assistant.id）', usageRow && asstRow && usageRow.id < asstRow.id);
check('usage 行有 prompt_tokens=100', usageRow?.prompt_tokens === 100);
check('usage 行有 completion_tokens=50', usageRow?.completion_tokens === 50);
check('usage 行有 total_tokens=150', usageRow?.total_tokens === 150);
check('usage 行有 cached_tokens=80', usageRow?.cached_tokens === 80);

// 清理
getDb().prepare("DELETE FROM messages WHERE session_id = ?").run(sid);
getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sid);

console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);

// test-v514-apimode-persistence.mjs
// 验证：DB schema 升级 + saveMessagesToDb 多接 apiMode + loadMessagesFromDb 返回 apiMode
// ★ 必须在 import 配置之前 setenv，否则 config.js 顶层 dbPath 读不到
import path from 'path';
import os from 'os';
const TEST_DB = path.join(os.tmpdir(), `xtsql-test-v514-${Date.now()}.db`);
process.env.DB_PATH = TEST_DB;

const { saveMessagesToDb, loadMessagesFromDb } = await import('./src/services/llm.js');
const { saveRunState } = await import('./src/services/agentHelpers.js');
const { getDb, initDatabase } = await import('./src/db/sqlite.js');

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else      { fail++; console.log(`  FAIL  ${name}`); }
};

await initDatabase();
const TEST_SID_BASE = 99000000 + Math.floor(Math.random() * 999999);
console.log('=== v5.14 apiMode 持久化链路 ===');
console.log(`(test sessionId range: ${TEST_SID_BASE + 1}..${TEST_SID_BASE + 5})`);
// ★ FK 约束：先插 sessions 测试行（llm_messages.session_id REFERENCES sessions.id）
{
  const db = getDb();
  for (let i = 1; i <= 5; i++) {
    db.prepare(
      "INSERT OR IGNORE INTO sessions (id, user_id, name, created_at) VALUES (?, 1, ?, CURRENT_TIMESTAMP)"
    ).run(TEST_SID_BASE + i, `v5.14-test-${i}`);
  }
}

// Case 1: CC path 默认 apiMode = chat_completions
{
  const sid = TEST_SID_BASE + 1;
  saveMessagesToDb(sid, [{ role: 'user', content: 'hi' }]);  // 不传第3参
  const r = loadMessagesFromDb(sid);
  check('CC path 不传 apiMode → load 返回 chat_completions', r?.apiMode === 'chat_completions');
  check('messages 数组正确', Array.isArray(r?.messages) && r.messages.length === 1);
}

// Case 2: Responses path 显式传 apiMode = responses_api
{
  const sid = TEST_SID_BASE + 2;
  saveMessagesToDb(sid, [{ role: 'user', content: 'hi' }], 'responses_api');
  const r = loadMessagesFromDb(sid);
  check('Responses path 传 responses_api → load 返回 responses_api', r?.apiMode === 'responses_api');
}

// Case 3: saveRunState (helper 5) 传 apiMode='responses_api' 走通
{
  const sid = TEST_SID_BASE + 3;
  saveRunState({
    sessionId: sid,
    messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }],
    apiMode: 'responses_api',
  });
  const r = loadMessagesFromDb(sid);
  check('saveRunState 透传 apiMode=responses_api', r?.apiMode === 'responses_api');
  check('saveRunState 消息数=2', r?.messages.length === 2);
}

// Case 4: saveRunState 不传 apiMode → 默认 responses_api（responsesApi.js 内部默认）
{
  const sid = TEST_SID_BASE + 4;
  saveRunState({ sessionId: sid, messages: [{ role: 'user', content: 'q' }] });
  const r = loadMessagesFromDb(sid);
  check('saveRunState 不传 apiMode → 默认 responses_api', r?.apiMode === 'responses_api');
}

// Case 5: 已存在记录再 save 不同 apiMode → 保留首次（保护历史会话）
{
  const sid = TEST_SID_BASE + 5;
  saveMessagesToDb(sid, [{ role: 'user', content: '1' }], 'chat_completions');
  saveMessagesToDb(sid, [{ role: 'user', content: '2' }, { role: 'assistant', content: 'a' }], 'responses_api');
  const r = loadMessagesFromDb(sid);
  check('已存在 chat_completions 记录再 save responses_api → 保留 chat_completions', r?.apiMode === 'chat_completions');
  check('messages 仍为最新（2 条）', r?.messages.length === 2);
}

// Case 6: 真实 DB schema 含 api_mode 列
{
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(llm_messages)").all();
  const apiModeCol = cols.find(c => c.name === 'api_mode');
  check('DB schema 含 api_mode 列', !!apiModeCol);
  check('api_mode 列类型=TEXT', apiModeCol?.type === 'TEXT');
  check('api_mode 默认值=chat_completions', apiModeCol?.dflt_value === "'chat_completions'");
}

// 清理测试数据
{
  const db = getDb();
  for (let i = 1; i <= 5; i++) {
    db.prepare("DELETE FROM llm_messages WHERE session_id = ?").run(TEST_SID_BASE + i);
  }
}

console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);

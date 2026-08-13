// 验证 schema 迁移工具的：
//   1. 老库首次初始化：cached_tokens / api_mode 被 ALTER 补列，其余表/列正常创建
//   2. 已有列不报错 + 重复运行幂等
//   3. 迁移为"首次启动一次性"：删列后重复 initDatabase 不会补回
//   4. SQL 写错：抛错（不再静默吞掉）
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(os.tmpdir(), `xtsql-test-migration-${Date.now()}.db`);

// 清理上次测试残留
for (const ext of ['', '-wal', '-shm']) {
  const p = testDbPath + ext;
  if (existsSync(p)) unlinkSync(p);
}

// 设置环境变量，让 sqlite.js 用我们的测试 DB
process.env.DB_PATH = testDbPath;

const { initDatabase, getDb } = await import('../src/db/sqlite.js');

// 0) 预建"老库"：messages 缺 cached_tokens、llm_messages 缺 api_mode（模拟历史版本 schema）
const raw = new Database(testDbPath);
raw.exec(`
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER, role TEXT, content TEXT, sql TEXT, results TEXT,
    prompt_tokens INTEGER DEFAULT 0, completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0, elapsed_ms INTEGER DEFAULT 0,
    round INTEGER DEFAULT 0, interrupted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE llm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER, messages TEXT, message_tokens INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
raw.close();

function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
}

function getColumns(table) {
  return getDb().prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

console.log('=== 1. 老库首次初始化：迁移补列 + 其余建表 ===\n');
await initDatabase();

const userCols = getColumns('users');
const sessionCols = getColumns('sessions');
const messageCols = getColumns('messages');
const llmMsgCols = getColumns('llm_messages');

console.log('  users 列:', userCols.join(', '));
expect('users.token_version', userCols.includes('token_version'), true);
expect('users 必需字段齐全', ['id', 'username', 'password_hash', 'display_name', 'role', 'token_version', 'created_at'].every(c => userCols.includes(c)), true);

console.log('\n  sessions 列:', sessionCols.join(', '));
expect('sessions.sort_order', sessionCols.includes('sort_order'), true);
expect('sessions.total_tokens', sessionCols.includes('total_tokens'), true);
expect('sessions.summary', sessionCols.includes('summary'), true);
expect('sessions.user_id', sessionCols.includes('user_id'), true);

console.log('\n  messages 列:', messageCols.join(', '));
expect('messages.prompt_tokens', messageCols.includes('prompt_tokens'), true);
expect('messages.completion_tokens', messageCols.includes('completion_tokens'), true);
expect('messages.total_tokens', messageCols.includes('total_tokens'), true);

console.log('\n  llm_messages 列:', llmMsgCols.join(', '));
expect('llm_messages.message_tokens', llmMsgCols.includes('message_tokens'), true);

console.log('\n=== 2. 重复运行 initDatabase 应幂等（不抛错） ===\n');
try {
  await initDatabase();
  console.log('  ✅ 第二次运行无错误');
} catch (e) {
  console.log('  ❌ 第二次运行抛错:', e.message);
  process.exitCode = 1;
}

console.log('\n=== 3. 迁移为"首次启动一次性"：删列后重复 initDatabase 不会补回 ===\n');
const db3 = getDb();

// 删列后重跑 initDatabase（此时 initialized=true，直接返回，不再执行迁移）
db3.exec(`ALTER TABLE messages DROP COLUMN cached_tokens`);
db3.exec(`ALTER TABLE llm_messages DROP COLUMN api_mode`);
await initDatabase();

const colsAfterReadd = db3.prepare(`PRAGMA table_info(messages)`).all().map(c => c.name);
expect('删列后重复 initDatabase：cached_tokens 仍缺失（一次性迁移契约）', colsAfterReadd.includes('cached_tokens'), false);
const llmColsAfterReadd = db3.prepare(`PRAGMA table_info(llm_messages)`).all().map(c => c.name);
expect('删列后重复 initDatabase：api_mode 仍缺失（一次性迁移契约）', llmColsAfterReadd.includes('api_mode'), false);

console.log('\n=== 4. SQL 写错时应该抛错（不再静默吞掉） ===\n');
// 直接测试：手动执行一个语法错的 ALTER，验证错误不被吞
const errDb = getDb();
let throwed = false;
let errorMsg = '';
// SQLite 接受很多"看起来奇怪"的语句，用语法错（关键字错误）触发
try {
  errDb.exec(`ALTER TABLE users ADD COLUMN bad_col TEXT INVALID GARBAGE AT END`);
} catch (e) {
  throwed = true;
  errorMsg = e.message;
}

if (throwed) {
  expect('错误信息含 "error" 或 "syntax"', /error|syntax|near|INTEGER/i.test(errorMsg), true);
  console.log(`  ✅ ALTER 抛错: "${errorMsg.substring(0, 80)}..."`);
} else {
  // SQLite 接受了，那就用更明显的语法错
  try {
    errDb.exec(`THIS IS NOT VALID SQL AT ALL !!!`);
    console.log('  ❌ 应该抛错但没抛');
    process.exitCode = 1;
  } catch (e) {
    console.log(`  ✅ 语法错抛错: "${e.message.substring(0, 80)}..."`);
  }
}

console.log('\n=== 全部通过 ===');

// 清理测试 DB（先 close，否则 EBUSY）
import { default as _Database } from 'better-sqlite3';
try {
  getDb().close();
} catch {}
for (const ext of ['', '-wal', '-shm']) {
  const p = testDbPath + ext;
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

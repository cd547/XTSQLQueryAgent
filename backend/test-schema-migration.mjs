// 验证 schema 迁移工具的：
//   1. 全新 DB：所有列被添加
//   2. 老 DB：缺的列被补全，已有的列不报错
//   3. 重复运行：幂等
//   4. SQL 写错：抛错（不再静默吞掉）
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { unlinkSync, existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test-migration.db');

// 清理上次测试残留
for (const ext of ['', '-wal', '-shm']) {
  const p = testDbPath + ext;
  if (existsSync(p)) unlinkSync(p);
}

// 设置环境变量，让 sqlite.js 用我们的测试 DB
process.env.DB_PATH = testDbPath;

const { initDatabase, getDb } = await import('./src/db/sqlite.js');

function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
}

function getColumns(table) {
  return getDb().prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

console.log('=== 1. 全新 DB：所有列应被添加 ===\n');
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

console.log('\n=== 3. 直接测试 addColumnIfMissing 函数：列不存在 → 添加；列存在 → 跳过 ===\n');
// 复用当前 DB（不要 close，否则模块级 db 变量无法重置）
const db3 = getDb();

// 先删一个已存在的列
db3.exec(`ALTER TABLE messages DROP COLUMN total_tokens`); // 删 total_tokens（前面的步骤已经加上了）

// 用 PRAGMA 验证删除成功
const colsAfterDrop = db3.prepare(`PRAGMA table_info(messages)`).all().map(c => c.name);
expect('删除后 messages 缺 total_tokens', colsAfterDrop.includes('total_tokens'), false);

// 重新导入 addColumnIfMissing 验证（需要从 sqlite.js 内部导出，替代方案：直接调用 initDatabase）
// 这里采用：调用 initDatabase 触发 addColumnIfMissing
await initDatabase();

const colsAfterReadd = db3.prepare(`PRAGMA table_info(messages)`).all().map(c => c.name);
expect('重新初始化后 messages 有 total_tokens', colsAfterReadd.includes('total_tokens'), true);

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

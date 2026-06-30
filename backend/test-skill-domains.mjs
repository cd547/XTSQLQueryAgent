/**
 * Skill 业务域操作单元测试（10 条）
 *
 * 覆盖：addTableToDomains 的所有错误码 + 正常路径 + 边界
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { addTableToDomains } from './src/services/skillDomains.js';

let pass = 0;
let fail = 0;

function eq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}

function truthy(label, actual) {
  const ok = !!actual;
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        actual: ${JSON.stringify(actual)}`); }
}

function throwsWithCode(label, fn, code) {
  let threw = false;
  let err = null;
  try { fn(); } catch (e) { threw = true; err = e; }
  if (threw && err && err.code === code) {
    pass++; console.log(`  PASS  ${label}`);
  } else {
    fail++; console.log(`  FAIL  ${label}\n        expected code: ${code}\n        threw: ${threw}\n        err.code: ${err && err.code}\n        err.message: ${err && err.message}`);
  }
}

// === Mock dependencies ===
function makeIsPathSafe(basePath) {
  return (base, target) => {
    const rel = path.relative(path.resolve(base), path.resolve(target));
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
}

function makeMockDb() {
  const records = [];
  return {
    records,
    prepare: () => ({
      run: (...args) => { records.push(args); }
    })
  };
}

function makeGetDb(mockDb) {
  return () => mockDb;
}

// === Test fixture: 临时 skill v2 目录 ===
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-domains-test-'));
const skillV2Path = path.join(root, 'sql-creator-skill-v2');
fs.mkdirSync(path.join(skillV2Path, 'domains'), { recursive: true });

// 写 index
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

// 写 2 个域文件
fs.writeFileSync(path.join(skillV2Path, 'domains', 'finance.json'),
  JSON.stringify({ id: 'finance', name: '财务', tables: ['order_student'] }));
fs.writeFileSync(path.join(skillV2Path, 'domains', 'course.json'),
  JSON.stringify({ id: 'course', name: '课程', tables: [] }));

const isPathSafe = makeIsPathSafe(skillV2Path);

console.log(`Test root: ${root}\n`);
console.log('=== A. 正常：单域 ===');
{
  const db = makeMockDb();
  addTableToDomains('new_table_1', ['course'], skillV2Path, isPathSafe, makeGetDb(db));
  const data = JSON.parse(fs.readFileSync(path.join(skillV2Path, 'domains', 'course.json'), 'utf-8'));
  truthy('course.json 包含 new_table_1', data.tables.includes('new_table_1'));
  eq('course.json 表数 = 1', data.tables.length, 1);
  eq('db records 1 条', db.records.length, 1);
}

console.log('\n=== B. 正常：多域 ===');
{
  const db = makeMockDb();
  let threw = false;
  try { addTableToDomains('multi_table', ['finance', 'people'], skillV2Path, isPathSafe, makeGetDb(db)); }
  catch (e) { threw = true; }
  // 顺序遍历：finance 先成功，people 失败（people.json 不存在）
  eq('整体抛错（people 失败）', threw, true);
  const finance = JSON.parse(fs.readFileSync(path.join(skillV2Path, 'domains', 'finance.json'), 'utf-8'));
  truthy('finance.json 包含 multi_table（已写入）', finance.tables.includes('multi_table'));
  truthy('people.json 仍未创建', !fs.existsSync(path.join(skillV2Path, 'domains', 'people.json')));
}

console.log('\n=== C. 幂等：重复添加同一表 ===');
{
  // 上一轮已把 multi_table 写入 finance，再调一次应不重复
  const db = makeMockDb();
  addTableToDomains('multi_table', ['finance'], skillV2Path, isPathSafe, makeGetDb(db));
  const finance = JSON.parse(fs.readFileSync(path.join(skillV2Path, 'domains', 'finance.json'), 'utf-8'));
  const count = finance.tables.filter(t => t === 'multi_table').length;
  eq('finance.json 中 multi_table 仅 1 次', count, 1);
  truthy('db records 仍 1 条（writeFile 跳过）', db.records.length === 1);
}

console.log('\n=== D. 错误码: DOMAIN_NOT_FOUND ===');
{
  const db = makeMockDb();
  throwsWithCode(
    'id 不在 index → DOMAIN_NOT_FOUND',
    () => addTableToDomains('t', ['unknown'], skillV2Path, isPathSafe, makeGetDb(db)),
    'DOMAIN_NOT_FOUND'
  );
}

console.log('\n=== E. 错误码: DOMAIN_FILE_MISSING ===');
{
  const db = makeMockDb();
  throwsWithCode(
    'domains/{id}.json 缺失 → DOMAIN_FILE_MISSING',
    () => addTableToDomains('t', ['people'], skillV2Path, isPathSafe, makeGetDb(db)),
    'DOMAIN_FILE_MISSING'
  );
}

console.log('\n=== F. 错误码: DOMAIN_INDEX_MISSING ===');
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-domains-test-noindex-'));
  const tmpSkillV2 = path.join(tmpRoot, 'sql-creator-skill-v2');
  fs.mkdirSync(tmpSkillV2, { recursive: true });
  const db = makeMockDb();
  throwsWithCode(
    'domain_router_index.json 缺失 → DOMAIN_INDEX_MISSING',
    () => addTableToDomains('t', ['finance'], tmpSkillV2, isPathSafe, makeGetDb(db)),
    'DOMAIN_INDEX_MISSING'
  );
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('\n=== G. 错误码: INVALID_DOMAIN_ID（path safety） ===');
{
  const badIsPathSafe = () => false;
  const db = makeMockDb();
  throwsWithCode(
    'isPathSafe 返回 false → INVALID_DOMAIN_ID',
    () => addTableToDomains('t', ['finance'], skillV2Path, badIsPathSafe, makeGetDb(db)),
    'INVALID_DOMAIN_ID'
  );
}

console.log('\n=== H. 域文件无 tables 字段：自动初始化为 [] ===');
{
  // 创建一个无 tables 字段的域文件
  fs.writeFileSync(path.join(skillV2Path, 'domains', 'people.json'),
    JSON.stringify({ id: 'people', name: '人员' }));
  // 把它加入 index
  const indexPath = path.join(skillV2Path, 'domain_router_index.json');
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  if (!idx.domains.find(d => d.id === 'people')) {
    idx.domains.push({ id: 'people', name: '人员' });
    fs.writeFileSync(indexPath, JSON.stringify(idx));
  }
  const db = makeMockDb();
  addTableToDomains('t1', ['people'], skillV2Path, isPathSafe, makeGetDb(db));
  const people = JSON.parse(fs.readFileSync(path.join(skillV2Path, 'domains', 'people.json'), 'utf-8'));
  truthy('people.json.tables 已自动初始化', Array.isArray(people.tables));
  truthy('包含 t1', people.tables.includes('t1'));
}

console.log('\n=== I. 部分失败不回滚（关键设计） ===');
{
  // 清空 finance 重新测试
  fs.writeFileSync(path.join(skillV2Path, 'domains', 'finance.json'),
    JSON.stringify({ id: 'finance', name: '财务', tables: [] }));
  // 删除 people 域文件，让 finance 成功 + people 失败
  fs.rmSync(path.join(skillV2Path, 'domains', 'people.json'), { force: true });
  const db = makeMockDb();
  let threw = false;
  try { addTableToDomains('partial_table', ['finance', 'people'], skillV2Path, isPathSafe, makeGetDb(db)); }
  catch (e) { threw = true; }
  truthy('抛出错误（people 失败）', threw);
  // 验证 finance 仍然写入了
  const finance = JSON.parse(fs.readFileSync(path.join(skillV2Path, 'domains', 'finance.json'), 'utf-8'));
  truthy('finance 仍写入 partial_table（不回滚）', finance.tables.includes('partial_table'));
  // 验证 db 记录：finance 1 条（people 失败未记录）
  eq('db 记录 1 条', db.records.length, 1);
}

console.log('\n=== J. domainIds 为空数组：什么都不做 ===');
{
  const db = makeMockDb();
  let threw = false;
  try { addTableToDomains('t', [], skillV2Path, isPathSafe, makeGetDb(db)); }
  catch (e) { threw = true; }
  eq('空数组不抛错', threw, false);
  eq('db 无记录', db.records.length, 0);
}

// 清理
fs.rmSync(root, { recursive: true, force: true });

console.log(`\n=========================================`);
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log(`=========================================`);

if (fail > 0) {
  console.log(`\n有 ${fail} 条失败`);
  process.exit(1);
} else {
  console.log(`\nALL TESTS PASSED`);
  process.exit(0);
}

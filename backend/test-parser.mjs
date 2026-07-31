/**
 * sqlParser.js 单元测试
 *
 * 测试策略：直接调用函数 + 断言结果，模拟真实项目 SQL 模式
 * 关键场景：
 * - 字符串字面量里的伪字段（防误报）
 * - 不同表同名字段（防 R1 误判）
 * - CTE / 窗口函数（MySQL 5.7 限制）
 * - parse 失败（特殊别名）→ 返回结果而非抛错
 *
 * 运行：cd backend && node test-parser.mjs
 */

import {
  parseSql,
  extractTables,
  extractColumnRefs,
  hasWindowFunction,
  hasJsonTable,
  hasCte,
  hasLimitClause,
  buildAliasMap,
} from './src/services/sqlParser.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push({ name, actual, expected });
    console.log(`  ❌ ${name}\n     expected: ${e}\n     actual:   ${a}`);
  }
}

function assertTrue(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push({ name, actual: 'false', expected: 'true' });
    console.log(`  ❌ ${name}`);
  }
}

function assertFalse(name, cond) {
  assertTrue(name, !cond);
}

console.log('\n========== 1. parseSql ==========');
{
  // 成功 case
  const r1 = parseSql('SELECT id FROM t');
  assertTrue('parseSql 成功', r1.ok && r1.ast.type === 'select');
  // 失败 case（特殊别名）
  const r2 = parseSql('SELECT id AS 金额(元) FROM a');
  assertTrue('parseSql 失败不抛错', !r2.ok && typeof r2.error === 'string');
}

console.log('\n========== 2. extractTables ==========');
{
  assert('单表', extractTables('SELECT id FROM edu_teacher'), ['edu_teacher']);
  assert('2 表 JOIN', extractTables(
    'SELECT a.id FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id'
  ).sort(), ['admin_user', 'edu_teacher']);
  assert('LEFT JOIN + WHERE', extractTables(
    'SELECT a.id FROM a LEFT JOIN b ON a.id = b.a_id WHERE a.del = 0'
  ).sort(), ['a', 'b']);
  // 嵌套子查询：子查询别名 't' 不是真表，tableList 只返回真表 'a'
  assert('嵌套子查询（t 是别名，非真表）', extractTables(
    'SELECT t.id FROM (SELECT id FROM a WHERE del = 0) t'
  ), ['a']);
}

console.log('\n========== 3. extractColumnRefs（防字符串误报）==========');
{
  // 关键测试：字符串里的伪字段不应被识别（只识别真实的 id 和 name）
  const refs = extractColumnRefs(
    "SELECT id FROM a WHERE name = 'select et.mobile from t'"
  );
  const hasMobile = refs.some(r => r.column === 'mobile');
  assertTrue('字符串里的 et.mobile 不被识别为字段引用', !hasMobile);
  // 真实的 id（SELECT）和 name（WHERE）都被识别；字符串里的伪字段不识别
  assert('只识别真实字段 id/name（不含 et.mobile）', refs.map(r => r.column).sort(), ['id', 'name']);

  // 正常 case
  const refs2 = extractColumnRefs(
    'SELECT et.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id'
  );
  assert('JOIN 提取 table.column', refs2.map(r => `${r.table}.${r.column}`).sort(),
    ['admin_user.id', 'edu_teacher.admin_user_id', 'edu_teacher.mobile']);
}

console.log('\n========== 4. hasCte / hasWindowFunction / hasJsonTable ==========');
{
  const normalAst = parseSql('SELECT id FROM a').ast;
  const cteAst = parseSql('WITH t AS (SELECT * FROM a) SELECT * FROM t').ast;
  const winAst = parseSql('SELECT id, ROW_NUMBER() OVER (PARTITION BY x ORDER BY y) FROM a').ast;
  assertFalse('hasCte 正常 SQL', hasCte(normalAst));
  assertTrue('hasCte CTE', hasCte(cteAst));
  // ★ 防 false-positive：带分号的 UPDATE 之前被误报为 CTE
  //   原因：parser 对带 ; 的 SQL 返回 Array，Array.prototype.with 命中旧实现的 ast.with 判据
  assertFalse('hasCte UPDATE 带分号 不误报',
    hasCte(parseSql('UPDATE edu_student SET phone = 18971368386 WHERE id = 200601 AND del = 0;').ast));
  assertFalse('hasCte SELECT 带分号 不误报',
    hasCte(parseSql('SELECT id FROM a LIMIT 100;').ast));
  assertFalse('hasCte 多条 SQL 不误报',
    hasCte(parseSql('SELECT id FROM a LIMIT 100; SELECT id FROM b LIMIT 100;').ast));
  assertTrue('hasCte CTE 带分号 仍能识别',
    hasCte(parseSql('WITH t AS (SELECT * FROM a) SELECT * FROM t LIMIT 100;').ast));
  assertFalse('hasWindowFunction 正常', hasWindowFunction(normalAst));
  assertTrue('hasWindowFunction ROW_NUMBER OVER', hasWindowFunction(winAst));
  // ★ 防 false-positive：CURDATE / DATE / UNIX_TIMESTAMP 等普通函数
  //   node-sql-parser 给所有 function call 节点都预置 over:null
  //   错误实现 'over' in ast 会把普通函数都误判为窗口函数
  assertFalse('hasWindowFunction CURDATE 不误报',
    hasWindowFunction(parseSql("SELECT id FROM t WHERE created_at > UNIX_TIMESTAMP(CURDATE()) LIMIT 100").ast));
  assertFalse('hasWindowFunction DATE_ADD 不误报',
    hasWindowFunction(parseSql("SELECT id FROM t WHERE created_at > UNIX_TIMESTAMP(DATE(DATE_ADD(CURDATE(), INTERVAL 1 DAY))) LIMIT 100").ast));
  // 真实复现场景：用户之前被误报为 WINDOW_FUNCTION
  const realWorldSql = `SELECT t.id AS teacher_id, t.name AS teacher_name, au.mobile
FROM edu_study es
INNER JOIN admin_user au ON au.id = es.edu_admin_user_id
INNER JOIN edu_teacher t ON t.admin_user_id = au.id
WHERE es.class_time_start >= UNIX_TIMESTAMP(DATE(CURDATE())) * 1000
  AND es.class_time_start < UNIX_TIMESTAMP(DATE(DATE_ADD(CURDATE(), INTERVAL 1 DAY))) * 1000
  AND es.del = 0
  AND au.del = 0
  AND t.del = 0
LIMIT 1000`;
  assertFalse('hasWindowFunction 真实 JOIN+UNIX_TIMESTAMP 不误报',
    hasWindowFunction(parseSql(realWorldSql).ast));
  // JSON_TABLE 在 MySQL 5.7 不可用，parser 直接挂
  const jsonSql = "SELECT * FROM JSON_TABLE('[]', '$[*]' COLUMNS (id INT PATH '$[0]'))";
  const parseResult = parseSql(jsonSql);
  assertTrue('hasJsonTable parse 失败（5.7 拦截）', !parseResult.ok);
}

console.log('\n========== 5. hasLimitClause ==========');
{
  assertTrue('含 LIMIT', hasLimitClause('SELECT id FROM a LIMIT 100'));
  assertTrue('含 LIMIT 0', hasLimitClause('SELECT id FROM a LIMIT 0'));
  assertTrue('含 LIMIT @var', hasLimitClause('SELECT id FROM a LIMIT @limit'));
  assertFalse('无 LIMIT', hasLimitClause('SELECT id FROM a'));
  assertTrue('UNION + LIMIT', hasLimitClause('SELECT id FROM a UNION SELECT id FROM b LIMIT 100'));
  // ⚠️ 已知限制：regex 简单匹配 LIMIT 关键字
  //   子查询里的 LIMIT 也会被匹配 → 可能误报"有 LIMIT"
  //   如果未来需要更精确，改用 parser 检查顶层 limit 节点
  assertTrue('LIMIT 仅在子查询（regex 误报为有 LIMIT，已知限制）', hasLimitClause(
    'SELECT id FROM (SELECT id FROM a LIMIT 5) t'
  ));
}

console.log('\n========== 6. buildAliasMap ==========');
{
  const m1 = buildAliasMap('SELECT a.id FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id');
  assert('JOIN 别名映射', [...m1.entries()].sort(), [['au', 'admin_user'], ['et', 'edu_teacher']]);

  const m2 = buildAliasMap('SELECT id FROM admin_user');
  assert('无别名（不映射）', [...m2.entries()], []);

  // parse 失败返回空 map
  const m3 = buildAliasMap('SELECT id AS 金额(元) FROM a');
  assert('parse 失败返回空 map', [...m3.entries()], []);
}

console.log('\n========== Summary ==========');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}`);
  }
  process.exit(1);
}

process.exit(0);

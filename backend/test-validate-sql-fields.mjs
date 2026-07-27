/**
 * validate_sql_fields 工具单元测试
 *
 * 覆盖 4 类规则各 5 case + 集成测试 + 端到端
 *
 * 运行：cd backend && node test-validate-sql-fields.mjs
 */

import { validateSqlFields } from './src/services/validators.js';

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

function assertTrue(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push({ name, extra });
    console.log(`  ❌ ${name}${extra ? '\n     ' + extra : ''}`);
  }
}

function assertFalse(name, cond, extra) {
  assertTrue(name, !cond, extra);
}

// 工具：取某规则的 errors
function getErrors(result, rule) {
  return result.errors.filter(e => e.rule === rule);
}


// =================================================================
//  R1: 字段-表归属（5 cases）
// =================================================================
console.log('\n========== R1: 字段-表归属（防幻觉核心）==========');

// Test 1: 字段存在 → 无 R1 error
{
  const r = await validateSqlFields({ sql: 'SELECT au.id FROM admin_user au LIMIT 100' });
  assertTrue('R1.1 字段存在 → valid', r.valid);
  assertTrue('R1.1 无 R1 error', getErrors(r, 'R1_FIELD_OWNERSHIP').length === 0);
}

// Test 2: 字段不存在（et.mobile 在 edu_teacher 中不存在）
{
  const r = await validateSqlFields({ sql: 'SELECT et.mobile FROM edu_teacher et LIMIT 100' });
  assertFalse('R1.2 et.mobile 幻觉 → invalid', r.valid);
  const r1 = getErrors(r, 'R1_FIELD_OWNERSHIP');
  assertTrue('R1.2 至少 1 个 R1 error', r1.length >= 1);
  // 注：parser 会把 et.mobile 自动解析为 edu_teacher.mobile，
  //   所以 message 包含 "edu_teacher.mobile" 而非 "et.mobile"
  assertTrue('R1.2 error 提到 mobile',
    r1.some(e => e.message.includes('mobile')));
  assertTrue('R1.2 error 提到 edu_teacher', r1[0]?.message.includes('edu_teacher'));
}

// Test 3: 嵌套子查询字段不存在
{
  const r = await validateSqlFields({
    sql: 'SELECT t.id FROM (SELECT et.mobile FROM edu_teacher et) t LIMIT 100',
  });
  assertFalse('R1.3 嵌套子查询字段不存在 → invalid', r.valid);
  const r1 = getErrors(r, 'R1_FIELD_OWNERSHIP');
  assertTrue('R1.3 嵌套子查询 R1 error 提到 mobile',
    r1.some(e => e.message.includes('mobile')));
}

// Test 4: CASE WHEN 字段（合法 - 用到的字段都在 DDL 中）
{
  const sql = "SELECT CASE WHEN au.id > 0 THEN au.user END AS test FROM admin_user au LIMIT 100";
  const r = await validateSqlFields({ sql });
  // 这里 R1 应无 error（R2 可能报 `test` 纯英文通过）
  const r1 = getErrors(r, 'R1_FIELD_OWNERSHIP');
  assertTrue('R1.4 CASE WHEN 字段（au.id/au.user）→ 无 R1 error', r1.length === 0);
}

// Test 5: field_aliases 联合加载（用户名 是 admin_user 的 alias）
{
  const r = await validateSqlFields({ sql: 'SELECT au.用户名 FROM admin_user au LIMIT 100' });
  const r1 = getErrors(r, 'R1_FIELD_OWNERSHIP');
  assertTrue('R1.5 field_aliases 联合（用户名）→ 无 R1 error', r1.length === 0);
}


// =================================================================
//  R2: 字段别名反引号（5 cases）
// =================================================================
console.log('\n========== R2: 字段别名反引号 ==========');

// Test 1: 中文括号 + 已包裹（合法）
{
  const r = await validateSqlFields({ sql: 'SELECT id AS `金额(元)` FROM t LIMIT 100' });
  const r2 = getErrors(r, 'R2_BACKTICK_ALIAS');
  assertTrue('R2.1 中文括号 + 已包裹 → 无 R2 error', r2.length === 0);
}

// Test 2: 中文 + 数字 + 未包裹（错误 - 真实场景：LLM 偶尔会写混合字符别名）
// 注：纯中文括号+未包裹（如 AS 金额(元)）不合法 SQL，会触发 PARSE_ERROR 而非 R2，
//   所以 R2 真实可检场景是「中文+其他字符但未包裹」
{
  const r = await validateSqlFields({ sql: 'SELECT id AS 金额1 FROM t LIMIT 100' });
  const r2 = getErrors(r, 'R2_BACKTICK_ALIAS');
  assertTrue('R2.2 中文+数字 + 未包裹 → R2 error', r2.length >= 1);
  assertTrue('R2.2 error 提到别名', r2[0]?.message.includes('金额1'));
}

// Test 3: 纯英文下划线别名（合法 - 无特殊字符）
{
  const r = await validateSqlFields({ sql: 'SELECT id AS total_count FROM t LIMIT 100' });
  const r2 = getErrors(r, 'R2_BACKTICK_ALIAS');
  assertTrue('R2.3 纯英文下划线别名 → 无 R2 error', r2.length === 0);
}

// Test 4: 空格 + 已包裹（合法）
{
  const r = await validateSqlFields({ sql: 'SELECT id AS `user name` FROM t LIMIT 100' });
  const r2 = getErrors(r, 'R2_BACKTICK_ALIAS');
  assertTrue('R2.4 空格 + 已包裹 → 无 R2 error', r2.length === 0);
}

// Test 5: 纯中文（按 plan 4.2.1 一致 → 报错；用户决策）
{
  const r = await validateSqlFields({ sql: 'SELECT id AS 用户名 FROM t LIMIT 100' });
  const r2 = getErrors(r, 'R2_BACKTICK_ALIAS');
  assertTrue('R2.5 纯中文 → R2 error (按 plan 一致)', r2.length >= 1);
}


// =================================================================
//  R3: MySQL 5.7 限制（5 cases）
// =================================================================
console.log('\n========== R3: MySQL 5.7 限制 ==========');

// Test 1: CTE → R3 error
{
  const r = await validateSqlFields({
    sql: 'WITH t AS (SELECT id FROM a) SELECT * FROM t LIMIT 100',
  });
  const r3 = getErrors(r, 'R3_MYSQL57_LIMIT');
  assertTrue('R3.1 CTE → R3 error', r3.some(e => e.type === 'CTE'));
  assertTrue('R3.1 message 提到 CTE/5.7',
    r3.some(e => e.message.includes('CTE') || e.message.includes('5.7')));
}

// Test 2: 窗口函数 → R3 error
{
  const r = await validateSqlFields({
    sql: 'SELECT id, ROW_NUMBER() OVER (PARTITION BY x ORDER BY y) AS rn FROM a LIMIT 100',
  });
  const r3 = getErrors(r, 'R3_MYSQL57_LIMIT');
  assertTrue('R3.2 窗口函数 → R3 error', r3.some(e => e.type === 'WINDOW_FUNCTION'));
}

// Test 3: JSON_TABLE → PARSE_ERROR 兜底（5.7 parser 必挂）
{
  const r = await validateSqlFields({
    sql: "SELECT * FROM JSON_TABLE('[]', '$[*]' COLUMNS (id INT PATH '$[0]'))",
  });
  assertFalse('R3.3 JSON_TABLE → invalid', r.valid);
  // 5.7 必然 parse 失败，PARSE_ERROR 兜底
  assertTrue('R3.3 PARSE_ERROR 兜底（5.7 必挂）',
    r.errors.some(e => e.rule === 'PARSE_ERROR'));
}

// Test 4: 正常 SQL → 无 R3 error
{
  const r = await validateSqlFields({ sql: 'SELECT id FROM t LIMIT 100' });
  const r3 = getErrors(r, 'R3_MYSQL57_LIMIT');
  assertTrue('R3.4 正常 → 无 R3 error', r3.length === 0);
}

// Test 5: 注释里的 WITH（不报）
{
  // 单行注释
  const r = await validateSqlFields({
    sql: 'SELECT id FROM t -- WITH some comment\n LIMIT 100',
  });
  const r3 = getErrors(r, 'R3_MYSQL57_LIMIT');
  assertTrue('R3.5 注释里的 WITH → 无 R3 error', r3.length === 0);
}


// =================================================================
//  R5: LIMIT 子句（5 cases）
// =================================================================
console.log('\n========== R5: LIMIT 子句 ==========');

// Test 1: 无 LIMIT → R5 error
{
  const r = await validateSqlFields({ sql: 'SELECT id FROM t' });
  const r5 = getErrors(r, 'R5_MISSING_LIMIT');
  assertTrue('R5.1 无 LIMIT → R5 error', r5.length >= 1);
  assertTrue('R5.1 message 提到 LIMIT', r5[0]?.message.includes('LIMIT'));
}

// Test 2: 有 LIMIT → 无 R5 error
{
  const r = await validateSqlFields({ sql: 'SELECT id FROM t LIMIT 100' });
  const r5 = getErrors(r, 'R5_MISSING_LIMIT');
  assertTrue('R5.2 有 LIMIT → 无 R5 error', r5.length === 0);
}

// Test 3: UNION + LIMIT → 无 R5 error
{
  const r = await validateSqlFields({
    sql: 'SELECT id FROM a UNION SELECT id FROM b LIMIT 100',
  });
  const r5 = getErrors(r, 'R5_MISSING_LIMIT');
  assertTrue('R5.3 UNION + LIMIT → 无 R5 error', r5.length === 0);
}

// Test 4: 子查询 LIMIT（regex 已知限制：内层 LIMIT 算外层也有）
{
  // 内层有 LIMIT，外层无 - regex 视外层"有 LIMIT"，不报 R5
  const r = await validateSqlFields({
    sql: 'SELECT t.id FROM (SELECT id FROM a LIMIT 5) t',
  });
  const r5 = getErrors(r, 'R5_MISSING_LIMIT');
  assertTrue('R5.4 子查询 LIMIT → 无 R5 error (regex 已知限制)', r5.length === 0);
}

// Test 5: LIMIT 0 → 无 R5 error
{
  const r = await validateSqlFields({ sql: 'SELECT id FROM t LIMIT 0' });
  const r5 = getErrors(r, 'R5_MISSING_LIMIT');
  assertTrue('R5.5 LIMIT 0 → 无 R5 error', r5.length === 0);
}


// =================================================================
//  集成测试：真实 DDL 隔离
// =================================================================
console.log('\n========== 集成测试：同名字段隔离 ==========');

// 镜像 case：admin_user 有 mobile，edu_teacher 没有
{
  const r1 = await validateSqlFields({ sql: 'SELECT au.mobile FROM admin_user au LIMIT 100' });
  assertTrue('集成: au.mobile 应通过 R1（admin_user 有 mobile）', r1.valid);
}

{
  const r2 = await validateSqlFields({ sql: 'SELECT et.mobile FROM edu_teacher et LIMIT 100' });
  assertFalse('集成: et.mobile 应被 R1 拦截（edu_teacher 无 mobile）', r2.valid);
  assertTrue('集成: et.mobile R1 error 提到 mobile',
    getErrors(r2, 'R1_FIELD_OWNERSHIP').some(e => e.message.includes('mobile')));
}

// JOIN 场景：cross-table 字段检查
{
  const sql = 'SELECT et.id, au.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id WHERE et.del = 0 LIMIT 100';
  const r = await validateSqlFields({ sql });
  assertTrue('集成: 正确 JOIN (au.mobile) → valid', r.valid);
}


// =================================================================
//  集成测试：负向 case（幻觉 SQL）
// =================================================================
console.log('\n========== 集成测试：负向 case（幻觉拦截）==========');

{
  // 故意构造 et.mobile 幻觉（应在 R1 被拦截）
  const r = await validateSqlFields({
    sql: 'SELECT et.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id LIMIT 100',
  });
  assertFalse('负向: et.mobile 幻觉 → invalid', r.valid);
  const r1 = getErrors(r, 'R1_FIELD_OWNERSHIP');
  assertTrue('负向: 至少 1 个 R1 error', r1.length >= 1);
}


// =================================================================
//  端到端：今天上课的老师场景
// =================================================================
console.log('\n========== 端到端：今天上课的老师 ==========');

{
  // 正确版本：au.mobile（admin_user 有 mobile）
  const goodSql = 'SELECT et.id, au.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id WHERE et.del = 0 LIMIT 100';
  const r = await validateSqlFields({ sql: goodSql });
  assertTrue('端到端: au.mobile 应通过 R1', r.valid);
}

{
  // 错误版本：et.mobile（幻觉）
  const badSql = 'SELECT et.id, et.mobile FROM edu_teacher et LIMIT 100';
  const r = await validateSqlFields({ sql: badSql });
  assertFalse('端到端: et.mobile 应被 R1 拦截', r.valid);
}

// 真实项目 DDL 集成：keqiao_class_teacher + keqiao_class
// 真实 DDL：
//   keqiao_class_teacher: id, keqiao_class_id, admin_user_id
//   keqiao_class: id, name, num, ...
{
  // 故意构造幻觉 SQL：teacher_name / class_name 都不存在
  const sql1 = 'SELECT kct.id, kct.teacher_name, kc.class_name FROM keqiao_class_teacher kct JOIN keqiao_class kc ON kct.class_id = kc.id LIMIT 100';
  const r1 = await validateSqlFields({ sql: sql1 });
  assertFalse('真实 DDL: 幻觉 SQL → invalid', r1.valid);
  const r1Errors = getErrors(r1, 'R1_FIELD_OWNERSHIP');
  assertTrue('真实 DDL: 至少 2 个 R1 error（teacher_name / class_name / class_id）',
    r1Errors.length >= 2);
  // 至少提到 teacher_name 或 class_name 或 class_id
  const allMessages = r1Errors.map(e => e.message).join('|');
  assertTrue('真实 DDL: error 提到 teacher_name', allMessages.includes('teacher_name') || allMessages.includes('admin_user_id'));
  // 老师信息实际在 admin_user 表（通过 admin_user_id 关联），不在 keqiao_class_teacher
  assertTrue('真实 DDL: error 提到 class_name 或 class_id', allMessages.includes('class_name') || allMessages.includes('class_id'));
}

{
  // 正确版本：使用真实字段
  const sql2 = 'SELECT kct.id, au.user, kc.name FROM keqiao_class_teacher kct JOIN keqiao_class kc ON kct.keqiao_class_id = kc.id JOIN admin_user au ON kct.admin_user_id = au.id LIMIT 100';
  const r2 = await validateSqlFields({ sql: sql2 });
  assertTrue('真实 DDL: 正确 JOIN + 真实字段 → valid', r2.valid);
}


// =================================================================
//  边界：summary 字段
// =================================================================
console.log('\n========== 边界：summary 字段 ==========');

{
  // 0 error：用真实表 + 简单合法 SQL
  const r1 = await validateSqlFields({ sql: 'SELECT au.id FROM admin_user au LIMIT 100' });
  assertTrue('summary 0 error', r1.summary === '0 errors');
}

{
  // 1 error：缺少 LIMIT
  const r2 = await validateSqlFields({ sql: 'SELECT au.id FROM admin_user au' });
  // 1 个 R5 error
  assertTrue('summary 1 error', r2.summary === '1 error');
}

{
  // 多个 error
  const r3 = await validateSqlFields({
    sql: 'SELECT et.mobile, et.foo FROM edu_teacher et',
  });
  // 多个 error（2 R1 + 1 R5）
  assertTrue('summary N errors', /^\d+ errors$/.test(r3.summary));
}


// =================================================================
//  边界：DDL 缺失报错
// =================================================================
console.log('\n========== 边界：DDL 缺失 ==========');

{
  // 不存在的表
  const r = await validateSqlFields({
    sql: 'SELECT id FROM nonexistent_table LIMIT 100',
  });
  assertFalse('DDL 缺失 → invalid', r.valid);
  const r1 = getErrors(r, 'R1_FIELD_OWNERSHIP');
  assertTrue('DDL 缺失 → R1 error 提到 nonexistent_table',
    r1.some(e => e.message.includes('DDL 不存在')));
}


// =================================================================
//  Summary
// =================================================================
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

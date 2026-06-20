import { validateReadOnlySql, RULES, stripSqlComments } from './src/services/sqlValidator.js';

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push({ name, expected, actual });
    console.log(`  FAIL  ${name}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

const EXEC = { allowedPrefixes: ['SELECT', 'WITH'] };
const EXPL = { allowedPrefixes: ['SELECT', 'WITH', 'EXPLAIN'] };

// 工具：取 valid 字段
const v = (sql, opts = EXEC) => validateReadOnlySql(sql, opts).valid;
const code = (sql, opts = EXEC) => validateReadOnlySql(sql, opts).code;

console.log('\n=== A. 合法 SQL（应 valid=true） ===');
eq('SELECT 1',                              v('SELECT 1'), true);
eq('SELECT * FROM users',                   v('SELECT * FROM users'), true);
eq('WITH t AS (SELECT 1) SELECT * FROM t',  v('WITH t AS (SELECT 1) SELECT * FROM t'), true);
eq("SELECT 'DROP' FROM t（字面量）",         v("SELECT 'DROP' FROM t"), true);
eq('SELECT * FROM dropped_logs（表名）',     v('SELECT * FROM dropped_logs'), true);
eq('SELECT 1;（末尾分号）',                 v('SELECT 1;'), true);
eq('SELECT 1 /* 块注释 */',                 v('SELECT 1 /* 块注释 */'), true);
eq('SELECT 1 -- 行注释',                    v('SELECT 1 -- 行注释'), true);
eq('SELECT 1 # MySQL 注释',                 v('SELECT 1 # MySQL 注释'), true);
eq('EXPLAIN SELECT 1（/explain 端点）',      v('EXPLAIN SELECT 1', EXPL), true);
eq('EXPLAIN SELECT 1（/execute 端点不允许）', v('EXPLAIN SELECT 1', EXEC), false);

console.log('\n=== B. 非查询语句（应被 FORBIDDEN_PREFIX 拦） ===');
eq('INSERT INTO x VALUES (1)',     code('INSERT INTO x VALUES (1)'),       'FORBIDDEN_PREFIX');
eq('UPDATE x SET y=1',             code('UPDATE x SET y=1'),               'FORBIDDEN_PREFIX');
eq('DELETE FROM x',                code('DELETE FROM x'),                  'FORBIDDEN_PREFIX');
eq('DROP TABLE x',                 code('DROP TABLE x'),                   'FORBIDDEN_PREFIX');
eq('CREATE TABLE x',               code('CREATE TABLE x'),                 'FORBIDDEN_PREFIX');
eq('ALTER TABLE x',                code('ALTER TABLE x'),                  'FORBIDDEN_PREFIX');
eq('TRUNCATE x',                   code('TRUNCATE x'),                     'FORBIDDEN_PREFIX');
eq('LOCK TABLES x WRITE',          code('LOCK TABLES x WRITE'),            'FORBIDDEN_PREFIX');
eq('CALL my_proc()',               code('CALL my_proc()'),                 'FORBIDDEN_PREFIX');
eq('SET @x = 1',                   code('SET @x = 1'),                     'FORBIDDEN_PREFIX');

console.log('\n=== C. 危险函数（应被 FORBIDDEN_FUNCTION 拦） ===');
eq("SELECT 1 INTO OUTFILE '/tmp/x'",     code(`SELECT 1 INTO OUTFILE '/tmp/x'`),  'FORBIDDEN_FUNCTION');
eq("SELECT 1 INTO DUMPFILE '/tmp/x'",    code(`SELECT 1 INTO DUMPFILE '/tmp/x'`), 'FORBIDDEN_FUNCTION');
eq('SELECT SLEEP(60)',                   code('SELECT SLEEP(60)'),                 'FORBIDDEN_FUNCTION');
eq('SELECT BENCHMARK(1000000,MD5(1))',   code('SELECT BENCHMARK(1000000,MD5(1))'), 'FORBIDDEN_FUNCTION');
eq("SELECT LOAD_FILE('/etc/passwd')",    code(`SELECT LOAD_FILE('/etc/passwd')`),  'FORBIDDEN_FUNCTION');
eq("SELECT GET_LOCK('x', 1000)",         code(`SELECT GET_LOCK('x', 1000)`),       'FORBIDDEN_FUNCTION');
eq("SELECT RELEASE_LOCK('x')",           code(`SELECT RELEASE_LOCK('x')`),         'FORBIDDEN_FUNCTION');
eq('SELECT USER()',                      code('SELECT USER()'),                    'FORBIDDEN_FUNCTION');
eq('SELECT SYSTEM_USER()',               code('SELECT SYSTEM_USER()'),             'FORBIDDEN_FUNCTION');

console.log('\n=== D. 多语句注入（应被 MULTI_STATEMENT 拦） ===');
eq('SELECT 1; DROP TABLE x',     code('SELECT 1; DROP TABLE x'), 'MULTI_STATEMENT');

// 带注释的变体：注释被剥离后剩 "SELECT 1"，本身是合法的。
// 但 mysql2 multipleStatements:false 会基于原始字符串拒绝多语句。
// 这里验证的是：validator 不会误伤合法 SQL（驱动层兜底）。
eq('SELECT 1; -- 注释（剥离后剩 SELECT 1）',       v('SELECT 1; -- 注释'),        true);
eq('SELECT 1; # 注释（剥离后剩 SELECT 1）',        v('SELECT 1; # 注释'),         true);
eq('SELECT 1; /* 注释 */（剥离后剩 SELECT 1）',    v('SELECT 1; /* 注释 */'),     true);

console.log('\n=== E. 边界情况 ===');
eq('空字符串',                    code(''),         'EMPTY_SQL');
eq('纯空格',                      code('   '),      'EMPTY_SQL');
eq('null',                        code(null),       'EMPTY_SQL');
eq('undefined',                   code(undefined),  'EMPTY_SQL');
eq('数字 123',                    code(123),        'EMPTY_SQL');
eq('只有注释的 SQL',              code('-- 只有注释'), 'EMPTY_AFTER_CLEAN');
eq('只有 /* */ 的 SQL',           code('/* 只有块注释 */'), 'EMPTY_AFTER_CLEAN');
eq('只有 # 注释的 SQL',           code('# 只有 # 注释'), 'EMPTY_AFTER_CLEAN');
eq('20001 字符',                  code('SELECT ' + 'a'.repeat(20000)), 'TOO_LONG');

console.log('\n=== F. stripSqlComments 单独测试 ===');
eq('剥离块注释',     stripSqlComments('SELECT 1 /* block */ end'),  'SELECT 1  end');
eq('剥离 -- 注释',   stripSqlComments('SELECT 1 -- line'),          'SELECT 1 ');
eq('剥离 # 注释',    stripSqlComments('SELECT 1 # line'),           'SELECT 1 ');
eq('混合注释',       stripSqlComments('SELECT 1 /* a */ -- b\n # c'), 'SELECT 1  \n ');

console.log('\n=== G. 结构化返回值 ===');
const r1 = validateReadOnlySql(`SELECT 1 INTO OUTFILE '/tmp/x'`, EXEC);
eq('返回 code',         r1.code,     'FORBIDDEN_FUNCTION');
eq('返回 detail',       r1.detail,   'INTO OUTFILE / INTO DUMPFILE');
eq('返回 severity',     r1.severity, 'error');
eq('返回 cleaned',      r1.cleaned,  `SELECT 1 INTO OUTFILE '/tmp/x'`);
eq('返回 message',      r1.message,  'SQL 中包含不允许的函数或操作：INTO OUTFILE / INTO DUMPFILE');

const r2 = validateReadOnlySql('SELECT 1; DROP TABLE x', EXEC);
eq('多语句返回 cleaned', r2.cleaned, 'SELECT 1; DROP TABLE x');

const r3 = validateReadOnlySql('SELECT 1 /* comment */ -- line', EXEC);
eq('剥离后 cleaned 干净', r3.cleaned, 'SELECT 1');

console.log('\n=== H. RULES 注册表完整性 ===');
eq('RULES.EMPTY_SQL.code',     RULES.EMPTY_SQL.code,     'EMPTY_SQL');
eq('RULES.MULTI_STATEMENT.code', RULES.MULTI_STATEMENT.code, 'MULTI_STATEMENT');
eq('RULES.FORBIDDEN_FUNCTION.code', RULES.FORBIDDEN_FUNCTION.code, 'FORBIDDEN_FUNCTION');
eq('RULES.FORBIDDEN_PREFIX.code', RULES.FORBIDDEN_PREFIX.code, 'FORBIDDEN_PREFIX');
eq('RULES.TOO_LONG.code', RULES.TOO_LONG.code, 'TOO_LONG');
eq('RULES.EMPTY_AFTER_CLEAN.code', RULES.EMPTY_AFTER_CLEAN.code, 'EMPTY_AFTER_CLEAN');

console.log(`\n=========================================`);
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log(`=========================================`);

if (fail > 0) {
  console.log('\n失败用例:');
  for (const f of failures) {
    console.log(`  - ${f.name}`);
    console.log(`    expected: ${JSON.stringify(f.expected)}`);
    console.log(`    actual:   ${JSON.stringify(f.actual)}`);
  }
  process.exit(1);
} else {
  console.log('\nALL TESTS PASSED');
  process.exit(0);
}

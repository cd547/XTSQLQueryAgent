import sqlParser from 'sql-parser';

const cases = [
  'SELECT 1',
  'SELECT * FROM users',
  'SELECT 1 INTO OUTFILE "/tmp/x"',
  'SELECT SLEEP(10)',
  'SELECT BENCHMARK(1000000, MD5(1))',
  'DROP TABLE x',
  'SELECT 1; DROP TABLE x',
  'WITH t AS (SELECT 1) SELECT * FROM t',
  'SHOW CREATE TABLE x',
  'EXPLAIN SELECT 1',
  'SELECT * INTO DUMPFILE "/tmp/x"',
  'SELECT LOAD_FILE("/etc/passwd")',
  "SELECT 'DROP' FROM t",  // false-positive test for blacklist
];

for (const s of cases) {
  try {
    const r = sqlParser.parse(s);
    console.log('OK ', s);
    console.log('   type:', r?.type, 'ast:', JSON.stringify(r).slice(0, 200));
  } catch (e) {
    console.log('ERR', s, '->', e.message);
  }
}

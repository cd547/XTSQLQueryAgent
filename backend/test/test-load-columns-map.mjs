/**
 * loadColumnsMap 单元测试
 *
 * 关键测试：不同表同名字段天然隔离
 *   - admin_user 有 mobile 字段
 *   - edu_teacher 没有 mobile 字段
 *   - 但 R1 校验 et.mobile 时不应因为 admin_user 有 mobile 而误报通过
 *
 * 运行：cd backend && node test-load-columns-map.mjs
 */

import { loadColumnsMap, extractColumnsFromDDL } from '../src/services/ddlUtils.js';

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
    failures.push({ name });
    console.log(`  ❌ ${name}`);
  }
}

console.log('\n========== 真实 DDL 加载（admin_user + edu_teacher）==========');
const map = await loadColumnsMap(['admin_user', 'edu_teacher']);
assertTrue('loadColumnsMap 返回 Map', map instanceof Map);
assertTrue('admin_user 加载成功', map.has('admin_user'));
assertTrue('edu_teacher 加载成功', map.has('edu_teacher'));
assertTrue('admin_user.columns 是 Set', map.get('admin_user') instanceof Set);
assertTrue('edu_teacher.columns 是 Set', map.get('edu_teacher') instanceof Set);

console.log('\n========== Test 1: admin_user 和 edu_teacher 都有 mobile 字段？==========');
// 实际：admin_user 有 mobile，edu_teacher 没有
const auHasMobile = map.get('admin_user').has('mobile');
const etHasMobile = map.get('edu_teacher').has('mobile');
assertTrue('admin_user 有 mobile 字段', auHasMobile);
assertTrue('edu_teacher 没有 mobile 字段（**关键**）', !etHasMobile);
assertTrue('admin_user 有 id 字段', map.get('admin_user').has('id'));
assertTrue('edu_teacher 有 id 字段', map.get('edu_teacher').has('id'));

console.log('\n========== Test 2: 字段不串味 ==========');
const auHasTeacherNo = map.get('admin_user').has('teacher_no');
const etHasMobileAu = map.get('edu_teacher').has('mobile');
assertTrue('admin_user 没有 teacher_no（edu_teacher 独有）', !auHasTeacherNo);
assertTrue('edu_teacher 没有 mobile（admin_user 独有）', !etHasMobileAu);
// 实际字段验证
assertTrue('edu_teacher 有 teacher_no', map.get('edu_teacher').has('teacher_no') || [...map.get('edu_teacher')].some(c => c.includes('teacher')));

console.log('\n========== Test 3: field_aliases 联合加载 ==========');
// admin_user.field_aliases 有 'parent_id' → ['上级ID']
//   'department_id' → ['部门ID', '二级部门ID']
const auAliases = [...map.get('admin_user')].filter(c =>
  c === '上级ID' || c === '部门ID' || c === '二级部门ID' || c === '用户名'
);
assertTrue('admin_user 联合加载 field_aliases：上级ID', auAliases.includes('上级ID'));
assertTrue('admin_user 联合加载 field_aliases：部门ID', auAliases.includes('部门ID'));

// ⚠️ 关键：alias 也只在该表的 Set 里，**不会**污染 edu_teacher
const etHasDeptAlias = map.get('edu_teacher').has('部门ID');
assertTrue('edu_teacher 不会包含 admin_user 的 alias "部门ID"（隔离验证）', !etHasDeptAlias);

console.log('\n========== Test 4: R1 集成验证（同名字段场景）==========');
// 模拟 R1 校验流程：
//   SQL: SELECT et.mobile FROM edu_teacher et
//   R1 应报错（edu_teacher 没有 mobile）

// 实际项目里：columnRef 来自 sqlParser.extractColumnRefs
// 这里直接验证 lookup 逻辑
const { extractColumnRefs, buildAliasMap } = await import('../src/services/sqlParser.js');

const sql1 = 'SELECT et.mobile FROM edu_teacher et';
const refs1 = extractColumnRefs(sql1);
const aliasMap1 = buildAliasMap(sql1);
assert('SQL1 提取字段', refs1.map(r => `${r.table}.${r.column}`), ['edu_teacher.mobile']);

// R1 校验：et.mobile 是否在 edu_teacher.columns？
const ref = refs1[0];
const resolvedTable = aliasMap1.get(ref.table) || ref.table; // alias → table
const isValid = map.get(resolvedTable)?.has(ref.column);
assertTrue('R1 检出 et.mobile 是幻觉（不在 edu_teacher）', !isValid);

// 镜像 case：admin_user 有 mobile
const sql2 = 'SELECT au.mobile FROM admin_user au';
const refs2 = extractColumnRefs(sql2);
const aliasMap2 = buildAliasMap(sql2);
const ref2 = refs2[0];
const resolvedTable2 = aliasMap2.get(ref2.table) || ref2.table;
const isValid2 = map.get(resolvedTable2)?.has(ref2.column);
assertTrue('R1 正确通过 au.mobile（admin_user 有 mobile）', isValid2);

// JOIN 场景：et.mobile 应报错
// 注：columnList 返回的 table 是已解析的表名（不是别名）
//   'et' (alias) → 'edu_teacher' (real table)
const sql3 = 'SELECT et.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id';
const refs3 = extractColumnRefs(sql3);
const aliasMap3 = buildAliasMap(sql3);
const hallucinationCheck = refs3
  .filter(r => r.table)
  .map(r => {
    // r.table 可能是 'edu_teacher' (已解析) 或 'et' (未解析)
    const t = aliasMap3.get(r.table) || r.table;
    return { ref: `${t}.${r.column}`, table: t, valid: map.get(t)?.has(r.column) };
  });
const hallucinations = hallucinationCheck.filter(h => !h.valid);
assert('JOIN 场景 R1 检出 et.mobile 幻觉（已解析为 edu_teacher.mobile）', hallucinations.map(h => h.ref), ['edu_teacher.mobile']);

console.log('\n========== Test 5: extractColumnsFromDDL 直接验证 ==========');
// 构造一个 mock DDL
const mockDDL = `-- @@TABLE admin_user
id INT
del INT
mobile VARCHAR
PRIMARY KEY (id)

-- @@TABLE edu_teacher
id INT
del INT
teacher_no VARCHAR
PRIMARY KEY (id)`;
const auCols = extractColumnsFromDDL(mockDDL, 'admin_user');
const etCols = extractColumnsFromDDL(mockDDL, 'edu_teacher');
assert('admin_user 提取列（含 id/del/mobile）', auCols.sort(), ['del', 'id', 'mobile']);
assert('edu_teacher 提取列（含 id/del/teacher_no）', etCols.sort(), ['del', 'id', 'teacher_no']);
assertTrue('admin_user 不包含 teacher_no（分段隔离）', !auCols.includes('teacher_no'));
assertTrue('edu_teacher 不包含 mobile（分段隔离）', !etCols.includes('mobile'));
assertTrue('过滤 PRIMARY KEY 关键字', !auCols.includes('PRIMARY') && !etCols.includes('PRIMARY'));

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

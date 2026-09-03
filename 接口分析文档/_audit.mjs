// 临时审计：table_index 全量表数据一致性检查
import fs from 'fs';
import path from 'path';
const p = 'd:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/';
const idx = JSON.parse(fs.readFileSync(p + 'table_index.json', 'utf8'));
const indexTables = idx.tables.map((t) => t.name);
const indexSet = new Set(indexTables);

const colRe = /^\s*`([a-zA-Z0-9_]+)`/gm;
const ddlDir = fs.readdirSync(p + 'ddl').filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, ''));
const ddlSet = new Set(ddlDir);
const ddlCols = {};
for (const t of ddlDir) {
  ddlCols[t] = new Set([...fs.readFileSync(p + `ddl/${t}.sql`, 'utf8').matchAll(colRe)].map((m) => m[1].toLowerCase()));
}
const fcDir = fs.readdirSync(p + 'field_config').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const fcSet = new Set(fcDir);
const fcData = {};
for (const t of fcDir) {
  try { fcData[t] = JSON.parse(fs.readFileSync(p + `field_config/${t}.json`, 'utf8')); } catch (e) { fcData[t] = { __parseError: e.message }; }
}
// 域文件
const domainDir = fs.readdirSync(p + 'domains').filter((f) => f.endsWith('.json'));
const domainOf = {}; // table -> [domains]
for (const d of domainDir) {
  try {
    const j = JSON.parse(fs.readFileSync(p + 'domains/' + d, 'utf8'));
    for (const t of j.tables || []) (domainOf[t] = domainOf[t] || []).push(d.replace(/\.json$/, ''));
  } catch { console.log('✗ 域文件解析失败:', d); }
}

const problems = [];
const warn = [];
for (const t of indexTables) {
  if (!ddlSet.has(t)) problems.push(`[A] ${t}: 无 DDL`);
  if (!fcSet.has(t)) problems.push(`[B] ${t}: 无 field_config`);
  else {
    const fc = fcData[t];
    if (fc.__parseError) { problems.push(`[B] ${t}: field_config JSON 解析失败 ${fc.__parseError}`); continue; }
    const empty = !((fc.virtual_associations || []).length || Object.keys(fc.field_enums || {}).length || Object.keys(fc.field_aliases || {}).length || (fc.business_rules || []).length || Object.keys(fc.business_constraints || {}).length);
    if (empty) warn.push(`[C] ${t}: field_config 全空（无 VA/枚举/别名/规则）`);
    for (const va of fc.virtual_associations || []) {
      if (!indexSet.has(va.target_table)) problems.push(`[D] ${t} VA → ${va.target_table}: 目标表不在 table_index`);
      else if (!ddlSet.has(va.target_table)) problems.push(`[D] ${t} VA → ${va.target_table}: 目标表无 DDL`);
      for (const [, tab, col] of va.join_condition.matchAll(/([a-z0-9_]+)\.([a-z0-9_]+)/g)) {
        const real = tab === t ? ddlCols[t] : ddlCols[tab];
        if (real && !real.has(col)) problems.push(`[E] ${t} VA 列不存在: ${va.join_condition} | ${tab}.${col}`);
      }
    }
    for (const k of Object.keys(fc.field_enums || {})) {
      const key = k.toLowerCase();
      if (key !== 'id' && ddlCols[t] && !ddlCols[t].has(key)) warn.push(`[F] ${t}: field_enums 键 "${k}" 不在 DDL 列中`);
    }
    for (const k of Object.keys(fc.field_aliases || {})) {
      if (ddlCols[t] && !ddlCols[t].has(k.toLowerCase())) warn.push(`[G] ${t}: field_aliases 键 "${k}" 不在 DDL 列中`);
    }
  }
  for (const r of idx.tables.find((x) => x.name === t).related_tables || []) {
    if (!indexSet.has(r)) warn.push(`[H] ${t}: related_tables 引用 "${r}" 不在 table_index`);
  }
  if (!domainOf[t]) warn.push(`[I] ${t}: 不在任何业务域中（get_sliced_index 无法路由到）`);
}
// 孤儿文件
for (const t of ddlDir) if (!indexSet.has(t)) warn.push(`[J] ddl/${t}.sql 存在但不在 table_index`);
for (const t of fcDir) if (!indexSet.has(t)) warn.push(`[K] field_config/${t}.json 存在但不在 table_index`);
// 域引用但不在索引
for (const d of domainDir) {
  try {
    const j = JSON.parse(fs.readFileSync(p + 'domains/' + d, 'utf8'));
    for (const t of j.tables || []) if (!indexSet.has(t)) problems.push(`[L] 域 ${d} 引用 "${t}" 不在 table_index`);
  } catch {}
}

console.log('=== 硬伤（会直接影响生成） ===');
console.log(problems.length ? problems.join('\n') : '（无）');
console.log('\n=== 提示（不阻塞但值得知道） ===');
console.log(warn.length ? warn.join('\n') : '（无）');
console.log(`\n=== 摘要: 索引 ${indexTables.length} | DDL ${ddlDir.length} | field_config ${fcDir.length} | 域 ${domainDir.length} ===`);

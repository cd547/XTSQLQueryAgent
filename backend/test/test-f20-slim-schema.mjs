// test-f20-slim-schema.mjs - F20 LLM 永远拿精简版；内部 API 仍支持 verbose
import { getTableSchema, tools } from '../src/services/toolFuncs.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name); fail++; }
}

console.log('=== F20 默认精简模式（LLM 看到的）===');
const slim = await getTableSchema(['admin_user']);
const allKeys = new Set();
for (const f of Object.values(slim.fields)) Object.keys(f).forEach(k => allKeys.add(k));
const slimKeys = [...allKeys].sort();
console.log('  slim keys:', slimKeys.join(','));
check('默认输出不含 k', !slimKeys.includes('k'));
check('默认输出不含 nn', !slimKeys.includes('nn'));
check('默认输出不含 d', !slimKeys.includes('d'));
check('默认输出保留 t', slimKeys.includes('t'));

console.log('\n=== F20 内部 API verbose=true 仍可拿全量 ===');
const full = await getTableSchema(['admin_user'], { verbose: true });
const fullKeySet = new Set();
for (const f of Object.values(full.fields)) Object.keys(f).forEach(k => fullKeySet.add(k));
const fullKeys = [...fullKeySet].sort();
console.log('  full keys:', fullKeys.join(','));
check('verbose=true 含 k', fullKeys.includes('k'));
check('verbose=true 含 nn', fullKeys.includes('nn'));
check('verbose=true 含 d', fullKeys.includes('d'));

console.log('\n=== F20 工具 func 永返回精简版（LLM 调不传 verbose）===');
const tool = tools.find(t => t.name === 'get_table_schema');
check('工具存在', !!tool);
const toolResult = await tool.func({ table_names: ['admin_user'] });
const parsed = JSON.parse(toolResult);
const toolKeys = new Set();
for (const f of Object.values(parsed.fields)) Object.keys(f).forEach(k => toolKeys.add(k));
const toolKeyArr = [...toolKeys].sort();
console.log('  tool func 输出的 keys:', toolKeyArr.join(','));
check('工具 func 输出不含 k', !toolKeyArr.includes('k'));
check('工具 func 输出不含 nn', !toolKeyArr.includes('nn'));
check('工具 func 输出不含 d', !toolKeyArr.includes('d'));
// 关键：工具 description 不暴露 verbose 参数（LLM 看到的是 description + Zod schema）
check('工具 description 无 verbose 字符串', !tool.description.toLowerCase().includes('verbose'));

console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);


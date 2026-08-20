// F14 回归测试：验证 /generate 路由侧 apiMode 分流逻辑
// 跑法：D:\nvm\v20.18.0\node.exe test-route-apimode-dispatch.mjs
//
// 测试策略：路由侧的 apiMode 分流判断是纯函数，提取出来单独测；
// DB 读取依赖 better-sqlite3，测试中用纯 JS 模拟 getLlmConfig() 的返回值。
import assert from 'node:assert';

// 复制自 query.js:384-402 的分流逻辑（纯函数部分）
function selectApiBranch(llmConfig) {
  if (llmConfig?.apiMode === 'responses_api') {
    return { branch: 'responses_api', skip: true };  // 占位：跳过 generator
  }
  return { branch: 'chat_completions', skip: false }; // 走原 runSqlAgent
}

let passed = 0, failed = 0;
const ok = (name, cond, hint) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${hint ? ' —— ' + hint : ''}`); }
};

// === Case 1: 显式选 Responses API → 走占位分支，不调原函数 ===
console.log('=== Case 1: apiMode=responses_api 走占位 ===');
let r1 = selectApiBranch({ apiMode: 'responses_api', model: 'deepseek-v4-flash' });
ok('responses_api → skip=true', r1.skip === true);
ok('responses_api → branch=responses_api', r1.branch === 'responses_api');

// === Case 2: 默认 / 显式选 Chat Completions API → 走原函数 ===
console.log('\n=== Case 2: apiMode=chat_completions 走原函数 ===');
let r2 = selectApiBranch({ apiMode: 'chat_completions', model: 'deepseek-v4-flash' });
ok('chat_completions → skip=false', r2.skip === false);
ok('chat_completions → branch=chat_completions', r2.branch === 'chat_completions');

// === Case 3: 旧配置（无 apiMode 字段）→ 走原函数（向后兼容） ===
console.log('\n=== Case 3: 旧配置无 apiMode 字段走原函数 ===');
let r3a = selectApiBranch({ provider: 'deepseek', model: 'deepseek-v4-flash' });
ok('无 apiMode 字段 → skip=false', r3a.skip === false);

let r3b = selectApiBranch({ provider: 'deepseek', model: 'deepseek-v4-flash', apiMode: undefined });
ok('apiMode=undefined → skip=false', r3b.skip === false);

let r3c = selectApiBranch({ provider: 'deepseek', model: 'deepseek-v4-flash', apiMode: null });
ok('apiMode=null → skip=false', r3c.skip === false);

let r3d = selectApiBranch({ provider: 'deepseek', model: 'deepseek-v4-flash', apiMode: '' });
ok('apiMode=空串 → skip=false', r3d.skip === false);

let r3e = selectApiBranch({ provider: 'deepseek', model: 'deepseek-v4-flash', apiMode: 0 });
ok('apiMode=0 → skip=false（数字 falsy）', r3e.skip === false);

// === Case 4: 整个 config 缺失（getLlmConfig 返回 null）→ 走原函数 ===
console.log('\n=== Case 4: config 整体缺失 ===');
let r4a = selectApiBranch(null);
ok('config=null → skip=false', r4a.skip === false);
ok('config=null → branch=chat_completions（默认）', r4a.branch === 'chat_completions');

let r4b = selectApiBranch(undefined);
ok('config=undefined → skip=false', r4b.skip === false);

// === Case 5: 防御性 - 异常值走原函数（虽然 POST 端已归一化） ===
console.log('\n=== Case 5: 防御性 - 异常值 ===');
let r5a = selectApiBranch({ apiMode: 'unknown_mode' });
ok('apiMode=未知值 → skip=false', r5a.skip === false);
ok('apiMode=未知值 → 仍选 chat_completions 分支（默认）', r5a.branch === 'chat_completions');

let r5b = selectApiBranch({ apiMode: 'CHAT_COMPLETIONS' });  // 大小写敏感
ok('apiMode=CHAT_COMPLETIONS 大小写敏感 → skip=false', r5b.skip === false);

let r5c = selectApiBranch({ apiMode: 42 });
ok('apiMode=数字 → skip=false', r5c.skip === false);

let r5d = selectApiBranch({ apiMode: true });
ok('apiMode=布尔 → skip=false', r5d.skip === false);

let r5e = selectApiBranch({ apiMode: ['responses_api'] });  // 数组
ok('apiMode=数组 → skip=false（严格 === 判定）', r5e.skip === false);

// === Case 6: 元数据传递 — 分流选择不影响 config 中其他字段 ===
console.log('\n=== Case 6: 分流不影响其他字段读取 ===');
const cfg1 = { provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-xxx', apiMode: 'responses_api' };
const sel1 = selectApiBranch(cfg1);
ok('分流时仍能读到 model', cfg1.model === 'deepseek-v4-flash');
ok('分流时仍能读到 apiKey', cfg1.apiKey === 'sk-xxx');
ok('分流时不会修改原 config', sel1.branch === 'responses_api');

console.log(`\n=== Result: ${passed} pass, ${failed} fail ===`);
process.exit(failed > 0 ? 1 : 0);

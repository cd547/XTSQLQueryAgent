// F13 回归测试：验证 llm_config 的 apiMode 透传 + GET 兜底逻辑
// 跑法：D:\nvm\v20.18.0\node.exe test-llm-config-apimode.mjs
//
// 测试策略：route 里的 apiMode 处理逻辑是纯函数（无副作用），
// 提取出来单独测；DB 读写是 standard SQL，不需 mock。
import assert from 'node:assert';

// 复制自 config.js:78-83 的归一化逻辑
const VALID_API_MODES = ['chat_completions', 'responses_api'];
function normalizeApiMode(input) {
  return (typeof input === 'string' && VALID_API_MODES.includes(input))
    ? input
    : 'chat_completions';
}

// 复制自 config.js:110-115 的 GET 兜底逻辑
function backfillApiMode(config) {
  if (!config.apiMode) {
    config.apiMode = 'chat_completions';
  }
  return config;
}

let passed = 0, failed = 0;
const ok = (name, cond, hint) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${hint ? ' —— ' + hint : ''}`); }
};

// === Case 1: POST normalize — 合法值透传 ===
console.log('=== Case 1: POST normalize — 合法值透传 ===');
ok('chat_completions 透传', normalizeApiMode('chat_completions') === 'chat_completions');
ok('responses_api 透传', normalizeApiMode('responses_api') === 'responses_api');

// === Case 2: POST normalize — 缺省/非法/类型错都回退到 chat_completions ===
console.log('\n=== Case 2: POST normalize — 缺省/非法回退 ===');
ok('undefined → chat_completions', normalizeApiMode(undefined) === 'chat_completions');
ok('null → chat_completions', normalizeApiMode(null) === 'chat_completions');
ok('空字符串 → chat_completions', normalizeApiMode('') === 'chat_completions');
ok('未知字符串 → chat_completions', normalizeApiMode('foo_bar') === 'chat_completions');
ok('大小写敏感：CHAT_COMPLETIONS 视为非法', normalizeApiMode('CHAT_COMPLETIONS') === 'chat_completions');
ok('数字 → chat_completions', normalizeApiMode(42) === 'chat_completions');
ok('布尔 → chat_completions', normalizeApiMode(true) === 'chat_completions');
ok('对象 → chat_completions', normalizeApiMode({}) === 'chat_completions');
ok('数组 → chat_completions', normalizeApiMode(['chat_completions']) === 'chat_completions');

// === Case 3: GET backfill — 旧配置没 apiMode 字段时补默认 ===
console.log('\n=== Case 3: GET backfill — 旧配置兼容 ===');
ok('缺 apiMode 字段 → 补 chat_completions',
   backfillApiMode({ provider: 'deepseek', model: 'deepseek-v4-flash' }).apiMode === 'chat_completions');
ok('已有 apiMode 字段 → 不动',
   backfillApiMode({ provider: 'deepseek', apiMode: 'responses_api' }).apiMode === 'responses_api');
ok('已有 apiMode=null → 视为缺省，补默认',
   backfillApiMode({ apiMode: null }).apiMode === 'chat_completions');
ok('已有 apiMode=空字符串 → 视为缺省，补默认',
   backfillApiMode({ apiMode: '' }).apiMode === 'chat_completions');
ok('已有 apiMode=0 → 视为缺省，补默认（数字 falsy）',
   backfillApiMode({ apiMode: 0 }).apiMode === 'chat_completions');
ok('已有 apiMode=undefined → 视为缺省，补默认',
   backfillApiMode({ apiMode: undefined }).apiMode === 'chat_completions');

// === Case 4: 端到端 — POST 后 GET 的数据流模拟 ===
console.log('\n=== Case 4: 端到端 — POST 存值 + GET 读取 + 兼容旧值 ===');
// 模拟 POST 收到的 body
const postBody = { provider: 'deepseek', model: 'deepseek-v4-flash', apiMode: 'responses_api' };
// POST 归一化（只过滤 apiMode，其他字段原样保留）
const stored = {
  provider: postBody.provider,
  model: postBody.model,
  apiMode: normalizeApiMode(postBody.apiMode)
};
ok('POST 后存储：apiMode 正确', stored.apiMode === 'responses_api');
// 模拟 GET：从 DB 读出 + backfill
const getResult = backfillApiMode({ ...stored });
ok('GET 后返回：apiMode 保留', getResult.apiMode === 'responses_api');

// 模拟 GET 旧配置：DB 里有老记录但没 apiMode
const oldStored = { provider: 'deepseek', model: 'deepseek-v3' };
const getOldResult = backfillApiMode({ ...oldStored });
ok('GET 旧配置：apiMode 兜底为 chat_completions', getOldResult.apiMode === 'chat_completions');
ok('GET 旧配置：其他字段保留', getOldResult.provider === 'deepseek' && getOldResult.model === 'deepseek-v3');

// === Case 5: 边界 — POST 整批字段透传（模拟未来添加新字段）===
console.log('\n=== Case 5: 边界 — 透传不影响其他字段 ===');
const newConfig = normalizeApiMode('responses_api');
const fullPostStored = JSON.stringify({
  provider: 'deepseek',
  apiKey: 'sk-xxx',
  model: 'deepseek-v4-flash',
  apiMode: newConfig
});
const parsed = JSON.parse(fullPostStored);
ok('完整 JSON 序列化/反序列化后字段全在', parsed.provider === 'deepseek' && parsed.apiKey === 'sk-xxx' && parsed.model === 'deepseek-v4-flash' && parsed.apiMode === 'responses_api');

console.log(`\n=== Result: ${passed} pass, ${failed} fail ===`);
process.exit(failed > 0 ? 1 : 0);

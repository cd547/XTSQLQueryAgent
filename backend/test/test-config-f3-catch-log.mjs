// F15 回归测试：验证 config.js F3 修复中"JSON 解析失败"路径的行为契约
// 跑法：D:\nvm\v20.18.0\node.exe test-config-f3-catch-log.mjs
//
// 测试策略：原代码 `catch (_) { /* malformed json, fall through */ }` 静默吞错。
// F15 修复后行为契约：
//   1. JSON 解析成功 → finalApiKey 取 parsed.apiKey || ''（与原行为一致）
//   2. JSON 解析失败 → logger.warn 被调用 + finalApiKey 保持空（原行为 finalApiKey 也是空）
//   3. 解析失败的损坏值是字符串 → log 中包含 rawPreview（不爆日志）
//   4. 解析失败的损坏值是非字符串 → rawPreview 标记为 <non-string>
import assert from 'node:assert';

// 复制自 config.js:74-86 的 F15 修复逻辑
function parseApiKeyWithLogging(existing, logger) {
  let finalApiKey = '';
  if (existing) {
    try {
      finalApiKey = JSON.parse(existing.value).apiKey || '';
    } catch (e) {
      logger.warn('POST /llm: llm_config JSON 解析失败，apiKey 保留为空', {
        key: 'llm_config',
        error: e.message,
        rawPreview: typeof existing.value === 'string' ? existing.value.slice(0, 100) : '<non-string>'
      });
      finalApiKey = '';
    }
  }
  return finalApiKey;
}

// 创建一个能记录 warn 调用的 mock logger
function makeMockLogger() {
  const calls = [];
  return {
    warn: (msg, ctx) => calls.push({ msg, ctx }),
    calls
  };
}

let passed = 0, failed = 0;
const ok = (name, cond, hint) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  ❿FAIL  ${name}${hint ? ' —— ' + hint : ''}`); }
};

// === Case 1: 正常路径 — JSON 解析成功，apiKey 透传 ===
console.log('=== Case 1: 正常 JSON 解析 ===');
{
  const logger = makeMockLogger();
  const existing = { value: JSON.stringify({ provider: 'deepseek', apiKey: 'sk-real-key-123' }) };
  const result = parseApiKeyWithLogging(existing, logger);
  ok('JSON 解析成功 → finalApiKey = parsed.apiKey', result === 'sk-real-key-123');
  ok('正常路径不调 logger.warn', logger.calls.length === 0);
}

// === Case 2: 正常路径 — parsed.apiKey 为空字符串时回退到空 ===
console.log('\n=== Case 2: parsed.apiKey 为空串 ===');
{
  const logger = makeMockLogger();
  const existing = { value: JSON.stringify({ provider: 'deepseek', apiKey: '' }) };
  const result = parseApiKeyWithLogging(existing, logger);
  ok('空串 → finalApiKey = ""', result === '');
  ok('空串路径不调 logger.warn', logger.calls.length === 0);
}

// === Case 3: 异常路径 — 损坏 JSON 触发 warn + finalApiKey 空 ===
console.log('\n=== Case 3: 损坏 JSON 触发 warn ===');
{
  const logger = makeMockLogger();
  const existing = { value: '{ not valid json, missing quote' };
  const result = parseApiKeyWithLogging(existing, logger);
  ok('损坏 JSON → finalApiKey = ""（与原行为一致）', result === '');
  ok('损坏 JSON → logger.warn 被调用 1 次', logger.calls.length === 1);
  ok('warn 消息文本匹配', logger.calls[0].msg === 'POST /llm: llm_config JSON 解析失败，apiKey 保留为空');
  ok('warn 上下文 key 字段正确', logger.calls[0].ctx.key === 'llm_config');
  ok('warn 上下文 error 字段有值', typeof logger.calls[0].ctx.error === 'string' && logger.calls[0].ctx.error.length > 0);
  ok('warn 上下文 rawPreview 是损坏值的前 100 字符',
     logger.calls[0].ctx.rawPreview === '{ not valid json, missing quote');
}

// === Case 4: 异常路径 — 超长损坏值被截断到 100 字符 ===
console.log('\n=== Case 4: 超长损坏值截断 ===');
{
  const logger = makeMockLogger();
  const longGarbage = 'X'.repeat(500);  // 500 字符的损坏值
  const existing = { value: longGarbage };
  const result = parseApiKeyWithLogging(existing, logger);
  ok('超长损坏值 → finalApiKey = ""', result === '');
  ok('warn 被调用', logger.calls.length === 1);
  ok('rawPreview 截断到 100 字符', logger.calls[0].ctx.rawPreview.length === 100);
  ok('rawPreview 内容是 X', /^X+$/.test(logger.calls[0].ctx.rawPreview));
}

// === Case 5: 异常路径 — 损坏值为非字符串（value=null）===
console.log('\n=== Case 5: 损坏值为非字符串（null 触发 (null).apiKey 抛错）===');
{
  const logger = makeMockLogger();
  const existing = { value: null };  // 防御性：理论上 better-sqlite3 TEXT 列不会返回 null，但兜底
  const result = parseApiKeyWithLogging(existing, logger);
  ok('非字符串值 → finalApiKey = ""', result === '');
  ok('非字符串值 → warn 仍被调用', logger.calls.length === 1);
  ok('非字符串值 → rawPreview 标记为 <non-string>', logger.calls[0].ctx.rawPreview === '<non-string>');
}

// === Case 6: 边界 — existing=null（没找到配置） ===
console.log('\n=== Case 6: existing=null 不进 try ===');
{
  const logger = makeMockLogger();
  const result = parseApiKeyWithLogging(null, logger);
  ok('existing=null → finalApiKey = ""', result === '');
  ok('existing=null → logger.warn 不被调用', logger.calls.length === 0);
}

// === Case 7: 边界 — existing=undefined ===
console.log('\n=== Case 7: existing=undefined ===');
{
  const logger = makeMockLogger();
  const result = parseApiKeyWithLogging(undefined, logger);
  ok('existing=undefined → finalApiKey = ""', result === '');
  ok('existing=undefined → logger.warn 不被调用', logger.calls.length === 0);
}

// === Case 8: 防御性 — logger 调用时 ctx 是对象（不是 null/undefined） ===
console.log('\n=== Case 8: logger ctx 是纯对象 ===');
{
  const logger = makeMockLogger();
  const existing = { value: 'garbage' };
  parseApiKeyWithLogging(existing, logger);
  ok('ctx 是对象', typeof logger.calls[0].ctx === 'object' && logger.calls[0].ctx !== null);
  ok('ctx.key 字段存在', 'key' in logger.calls[0].ctx);
  ok('ctx.error 字段存在', 'error' in logger.calls[0].ctx);
  ok('ctx.rawPreview 字段存在', 'rawPreview' in logger.calls[0].ctx);
}

console.log(`\n=== Result: ${passed} pass, ${failed} fail ===`);
process.exit(failed > 0 ? 1 : 0);

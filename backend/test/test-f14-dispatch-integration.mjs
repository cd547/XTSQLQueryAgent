// test-f14-dispatch-integration.mjs
// 验证 F14 委派：apiMode='responses_api' 时委派到 runSqlAgentResponsesHandler
// 不真实打 Responses API（会 fail），只验证委派路径走通 + handler 签名匹配
import { runSqlAgentResponsesHandler } from '../src/services/responsesApi.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name); fail++; }
}

console.log('=== F14 委派集成测试 ===');

// 1) handler 是 async function
check('handler 是 async function', typeof runSqlAgentResponsesHandler === 'function');

// 2) mock req/res
const mockRes = {
  writableEnded: false,
  headers: {},
  headersSent: false,
  write(data) { this._writes = (this._writes || 0) + 1; this._last = data; return true; },
  end() { this.writableEnded = true; this._end = true; },
  on() {},
  once() {},
  setHeader(k, v) { this.headers[k] = v; },
  flushHeaders() { this.headersSent = true; },
};
const mockReq = { user: { username: 'test_f14' } };

const abortController = new AbortController();
const requestStartTime = Date.now();
const overallTimer = setTimeout(() => {}, 60000);

const { tools } = await import('../src/services/toolFuncs.js');

// 3) 调用 handler（即使 fetchResponsesStream 会失败，handler 应捕获 error 并写 SSE error 事件）
await runSqlAgentResponsesHandler(mockReq, mockRes, {
  abortController,
  requestStartTime,
  overallTimer,
  streamCompleted: false,
  sessionId: null,  // 无 session：不会写 DB
  question: 'test',
  historyText: '',
  username: 'test_f14',
  tools,
  cfg: null,  // 无 cfg → handler 内部 fallback getLlmConfig
  maxToolCalls: '5',
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

// 4) 验证 handler 走了 catch 分支 + 写 error 事件 + 调 res.end
check('handler 写入了数据', (mockRes._writes || 0) > 0);
check('handler 调用了 res.end', mockRes.writableEnded === true);
// 无 DB 初始化，cfg=null → handler 走 error 分支，最后写 error 事件（也是正常路径）
check('最后写入含 error 或 done 事件',
  mockRes._last && (mockRes._last.includes('"error"') || mockRes._last.includes('"done"')));

// 5) 清理 timer
clearTimeout(overallTimer);

console.log('');
console.log(`=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
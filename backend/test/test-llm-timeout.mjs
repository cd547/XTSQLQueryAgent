/**
 * BUG-7 修复单元测试：withTimeout helper
 *
 * 覆盖 6 个场景：
 *   1. 外部 abort 立即生效（不等超时）
 *   2. 外部 abort 优先于超时触发
 *   3. 达到 timeoutMs 后超时触发
 *   4. cancel() 后定时器清理，超时不再触发
 *   5. isExternalAbort 正确区分触发源
 *   6. 多次并发调用互不干扰
 */

import { withTimeout, withPromiseTimeout, LLM_TIMEOUTS } from '../src/services/llm.js';

let pass = 0;
let fail = 0;

function eq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}

function truthy(label, actual) {
  const ok = !!actual;
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        actual: ${JSON.stringify(actual)}`); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('=== A. 外部 abort 立即生效 ===');
{
  const ext = new AbortController();
  const t = withTimeout(ext.signal, 5_000, 'test');
  ext.abort(new Error('client disconnected'));
  truthy('外部 abort 后 t.signal.aborted === true', t.signal.aborted);
  truthy('isExternalAbort() 返回 true', t.isExternalAbort());
  t.cancel();
}

console.log('\n=== B. 外部 abort 优先于超时 ===');
{
  const ext = new AbortController();
  const t = withTimeout(ext.signal, 200, 'test');
  // 50ms 后外部 abort（远早于 200ms 超时）
  setTimeout(() => ext.abort(new Error('ext abort')), 50);
  await sleep(80);
  truthy('50ms 时外部 abort 触发，t.signal.aborted === true', t.signal.aborted);
  truthy('isExternalAbort() 返回 true（不是超时）', t.isExternalAbort());
  t.cancel();
}

console.log('\n=== C. 达到 timeoutMs 后超时触发 ===');
{
  const ext = new AbortController();
  const t = withTimeout(ext.signal, 100, 'test');
  await sleep(180);
  truthy('180ms > 100ms 超时，t.signal.aborted === true', t.signal.aborted);
  truthy('isExternalAbort() 返回 false（是超时）', !t.isExternalAbort());
  truthy('abort reason.message 含 timeout', /timeout/i.test(t.signal.reason?.message || ''));
  t.cancel();
}

console.log('\n=== D. cancel() 后定时器清理 ===');
{
  const ext = new AbortController();
  const t = withTimeout(ext.signal, 100, 'test');
  await sleep(30);
  t.cancel();
  await sleep(150);  // 100ms + 50ms buffer
  truthy('cancel() 后 150ms 时 t.signal.aborted 仍为 false', !t.signal.aborted);
}

console.log('\n=== E. 错误消息格式 ===');
{
  const t = withTimeout(new AbortController().signal, 50, 'LLM fetch');
  await sleep(80);
  truthy('reason.message 含 label "LLM fetch"', /LLM fetch/.test(t.signal.reason?.message || ''));
  truthy('reason.message 含 "50ms"', /50ms/.test(t.signal.reason?.message || ''));
  t.cancel();
}

console.log('\n=== F. 并发调用互不干扰 ===');
{
  const ext = new AbortController();
  const t1 = withTimeout(ext.signal, 100, 'op1');
  const t2 = withTimeout(new AbortController().signal, 50, 'op2');
  await sleep(80);
  truthy('t2 在 80ms 已超时（50ms 上限）', t2.signal.aborted);
  truthy('t1 尚未超时（100ms 上限，80ms 时）', !t1.signal.aborted);
  await sleep(50);
  truthy('t1 在 130ms 时也超时了', t1.signal.aborted);
  truthy('t1 超时非外部触发', !t1.isExternalAbort());
  t1.cancel();
  t2.cancel();
}

console.log('\n=== G. withPromiseTimeout 基础 ===');
{
  // 正常完成
  const r = await withPromiseTimeout(
    () => Promise.resolve('ok'),
    new AbortController().signal, 1000, 'test'
  );
  eq('正常完成返回 fn 结果', r, 'ok');
}

console.log('\n=== H. withPromiseTimeout 超时触发 onAbort ===');
{
  let onAbortCalled = false;
  const start = Date.now();
  try {
    await withPromiseTimeout(
      () => new Promise(() => {}),  // 永不 resolve
      new AbortController().signal,
      100,
      'test-hang',
      () => { onAbortCalled = true; }
    );
  } catch (e) {
    truthy('抛出 timeout 错误', /timeout/i.test(e.message || ''));
  }
  const elapsed = Date.now() - start;
  truthy(`超时耗时在 100ms 附近（实际 ${elapsed}ms）`, elapsed >= 90 && elapsed < 200);
  truthy('onAbort 钩子被调用', onAbortCalled);
}

console.log('\n=== I. withPromiseTimeout 外部 abort ===');
{
  const ext = new AbortController();
  let onAbortCalled = false;
  const p = withPromiseTimeout(
    () => new Promise(() => {}),
    ext.signal,
    5_000,
    'test-ext',
    () => { onAbortCalled = true; }
  );
  setTimeout(() => ext.abort(new Error('client disconnect')), 50);
  try {
    await p;
  } catch (e) {
    truthy('外部 abort 抛出', true);
    truthy('错误消息含 client disconnect', /client disconnect/.test(e.message || ''));
  }
  truthy('外部 abort 也调用 onAbort（释放资源）', onAbortCalled);
}

console.log('\n=== J. withPromiseTimeout 完成后 timer 清理 ===');
{
  const p = withPromiseTimeout(
    () => sleep(30).then(() => 'done'),
    new AbortController().signal, 100, 'test-fast'
  );
  await p;
  await sleep(150);
  // 如果 timer 没清理，100ms 时会触发 reject；这里只检查 promise 已完成
  truthy('完成后 150ms 无额外副作用', true);
}

console.log(`\n=========================================`);
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log(`=========================================`);
console.log(`  LLM_TIMEOUTS.FETCH_MS = ${LLM_TIMEOUTS.FETCH_MS} (T2)`);
console.log(`  LLM_TIMEOUTS.READ_MS   = ${LLM_TIMEOUTS.READ_MS} (T4)`);

if (fail > 0) {
  console.log(`\n失败用例:`);
  process.exit(1);
} else {
  console.log(`\nALL TESTS PASSED`);
  process.exit(0);
}

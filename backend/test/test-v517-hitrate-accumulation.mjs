// test-v517-hitrate-accumulation.mjs
// 验证 v5.17 累积命中率算法：0..R 累积 sum_cached / sum_prompt

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + msg); }
};

// 复制 App.jsx v5.17 的累积公式（确保前后端一致）
function computeAccumulatedUsage(roundUsages, mRound) {
  let sumCached = 0, sumPrompt = 0, sumCompletion = 0, sumTotal = 0;
  let hasAny = false;
  for (let r = 0; r <= mRound; r++) {
    const u = roundUsages[r];
    if (u) {
      sumCached += u.cached_tokens || 0;
      sumPrompt += u.prompt_tokens || 0;
      sumCompletion += u.completion_tokens || 0;
      sumTotal += u.total_tokens || 0;
      hasAny = true;
    }
  }
  if (!hasAny) return undefined;
  return {
    prompt_tokens: sumPrompt,
    completion_tokens: sumCompletion,
    total_tokens: sumTotal,
    cached_tokens: sumCached,
  };
}

// === Test 1: 单 round（mRound=0）===
console.log('Test 1: 单 round (roundUsages={0: {cached: 80, prompt: 100, completion: 50, total: 150}})');
{
  const roundUsages = { 0: { cached_tokens: 80, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
  const result = computeAccumulatedUsage(roundUsages, 0);
  assert(result.cached_tokens === 80, 'cached=80');
  assert(result.prompt_tokens === 100, 'prompt=100');
  assert(result.completion_tokens === 50, 'completion=50');
  assert(result.total_tokens === 150, 'total=150');
}

// === Test 2: 多 round 累积（mRound=2）===
console.log('Test 2: 多 round 累积 (round 0/1/2)');
{
  const roundUsages = {
    0: { cached_tokens: 80, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    1: { cached_tokens: 50, prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
    2: { cached_tokens: 30, prompt_tokens: 150, completion_tokens: 20, total_tokens: 170 },
  };
  const result = computeAccumulatedUsage(roundUsages, 2);
  assert(result.cached_tokens === 80 + 50 + 30, 'sum cached=160');
  assert(result.prompt_tokens === 100 + 200 + 150, 'sum prompt=450');
  assert(result.completion_tokens === 50 + 30 + 20, 'sum completion=100');
  assert(result.total_tokens === 150 + 230 + 170, 'sum total=550');
}

// === Test 3: mRound 中间（mRound=1，round 2 不在）===
console.log('Test 3: mRound=1, round 2 缺失');
{
  const roundUsages = {
    0: { cached_tokens: 80, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    1: { cached_tokens: 50, prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
  };
  const result = computeAccumulatedUsage(roundUsages, 1);
  assert(result.cached_tokens === 130, '只累加 0+1 cached=130');
  assert(result.prompt_tokens === 300, '只累加 0+1 prompt=300');
}

// === Test 4: round 0 缺失（mRound=1）===
console.log('Test 4: mRound=1, round 0 缺失 (跳号)');
{
  const roundUsages = {
    1: { cached_tokens: 50, prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
  };
  const result = computeAccumulatedUsage(roundUsages, 1);
  assert(result.cached_tokens === 50, '只有 round 1 cached=50');
  assert(result.prompt_tokens === 200, '只有 round 1 prompt=200');
}

// === Test 5: 空数据（mRound=0, roundUsages={}）===
console.log('Test 5: 空数据');
{
  const result = computeAccumulatedUsage({}, 0);
  assert(result === undefined, '返回 undefined');
}

// === Test 6: 命中率计算（cached/prompt）===
console.log('Test 6: 命中率公式: sum_cached / sum_prompt');
{
  const roundUsages = {
    0: { cached_tokens: 80, prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
    1: { cached_tokens: 50, prompt_tokens: 200, completion_tokens: 0, total_tokens: 200 },
  };
  const result = computeAccumulatedUsage(roundUsages, 1);
  const hitRate = (result.cached_tokens / (result.cached_tokens + (result.prompt_tokens - result.cached_tokens)) * 100).toFixed(1);
  assert(hitRate === '43.3', '命中率 = 130/300 = 43.3% (实际: ' + hitRate + '%)');
}

// === Test 7: 100% 命中率（完全缓存）===
console.log('Test 7: 100% 命中率');
{
  const roundUsages = {
    0: { cached_tokens: 100, prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    1: { cached_tokens: 200, prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 },
  };
  const result = computeAccumulatedUsage(roundUsages, 1);
  const hitRate = (result.cached_tokens / result.prompt_tokens * 100).toFixed(1);
  assert(hitRate === '100.0', '100% 命中率');
}

// === Test 8: 0% 命中率（无缓存）===
console.log('Test 8: 0% 命中率');
{
  const roundUsages = {
    0: { cached_tokens: 0, prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    1: { cached_tokens: 0, prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 },
  };
  const result = computeAccumulatedUsage(roundUsages, 1);
  const hitRate = (result.cached_tokens / result.prompt_tokens * 100).toFixed(1);
  assert(hitRate === '0.0', '0% 命中率');
}

// === Test 9: mRound 大于实际 round 数（无数据不报错）===
console.log('Test 9: mRound=5 但 roundUsages 只有 0/1/2');
{
  const roundUsages = {
    0: { cached_tokens: 80, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    1: { cached_tokens: 50, prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
    2: { cached_tokens: 30, prompt_tokens: 150, completion_tokens: 20, total_tokens: 170 },
  };
  const result = computeAccumulatedUsage(roundUsages, 5);
  assert(result.cached_tokens === 160, '累加到 round 2 后停');
  assert(result.prompt_tokens === 450, '累加到 round 2 后停');
}

// === Test 10: 缺字段 fallback ===
console.log('Test 10: 缺 cached_tokens 字段（fallback 到 0）');
{
  const roundUsages = {
    0: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },  // 缺 cached
  };
  const result = computeAccumulatedUsage(roundUsages, 0);
  assert(result.cached_tokens === 0, 'cached fallback 0');
  assert(result.prompt_tokens === 100, 'prompt 正常');
}

console.log('\n=== Result: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail > 0 ? 1 : 0);

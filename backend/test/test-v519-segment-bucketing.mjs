// test-v519-segment-bucketing.mjs
// 验证 v5.19b 两遍扫描：先按 user 切分 segments + 段内累积 usage，再算每条 assistant 的 0..mRound 累积
// DB 消息顺序：user → assistant → usage（assistant 在 usage 之前）

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + msg); }
};

// 复制 App.jsx v5.19b segment-bucket 算法
function computeAssistantUsages(dataMessages) {
  // 第一遍：按 user 切分 segments + 段内累积 usage
  const segments = [];
  let currentSeg = { start: 0, end: 0, usages: {} };
  for (let i = 0; i < dataMessages.length; i++) {
    const m = dataMessages[i];
    if (m.role === 'user' && i > 0) {
      segments.push(currentSeg);
      currentSeg = { start: i, end: i, usages: {} };
    } else if (m.role === 'usage') {
      const r = typeof m.round === 'number' ? m.round : 0;
      if (!currentSeg.usages[r]) {
        currentSeg.usages[r] = { cached: 0, prompt: 0, completion: 0, total: 0 };
      }
      currentSeg.usages[r].cached += m.cached_tokens || 0;
      currentSeg.usages[r].prompt += m.prompt_tokens || 0;
      currentSeg.usages[r].completion += m.completion_tokens || 0;
      currentSeg.usages[r].total += m.total_tokens || 0;
    }
    currentSeg.end = i;
  }
  segments.push(currentSeg);

  // 第二遍：每条 assistant 用本段 segmentUsages 算累积
  const assistantUsages = {};
  for (const seg of segments) {
    for (let i = seg.start; i <= seg.end; i++) {
      const m = dataMessages[i];
      if (m.role === 'assistant') {
        const mRound = typeof m.round === 'number' ? m.round : 0;
        let sumCached = 0, sumPrompt = 0, sumCompletion = 0, sumTotal = 0;
        let hasAny = false;
        for (let r = 0; r <= mRound; r++) {
          const u = seg.usages[r];
          if (u) {
            sumCached += u.cached;
            sumPrompt += u.prompt;
            sumCompletion += u.completion;
            sumTotal += u.total;
            hasAny = true;
          }
        }
        if (hasAny) {
          assistantUsages[m.id] = {
            prompt_tokens: sumPrompt,
            completion_tokens: sumCompletion,
            total_tokens: sumTotal,
            cached_tokens: sumCached,
          };
        }
      }
    }
  }
  return assistantUsages;
}

// === Test 1: 3 个问题都 round 0（用户报告场景）===
console.log('Test 1: 3 个问题都 round 0（Q1 99%, Q2 50%, Q3 30%）, DB 顺序 user→assistant→usage');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 0 },
    { id: 3, role: 'usage', round: 0, prompt_tokens: 1000, cached_tokens: 990, completion_tokens: 100, total_tokens: 1100 },
    { id: 4, role: 'user' },
    { id: 5, role: 'assistant', round: 0 },
    { id: 6, role: 'usage', round: 0, prompt_tokens: 800, cached_tokens: 400, completion_tokens: 80, total_tokens: 880 },
    { id: 7, role: 'user' },
    { id: 8, role: 'assistant', round: 0 },
    { id: 9, role: 'usage', round: 0, prompt_tokens: 600, cached_tokens: 180, completion_tokens: 60, total_tokens: 660 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2]?.cached_tokens === 990, 'asst1 cached=990 (Q1 自己的 99%)');
  assert(result[2]?.prompt_tokens === 1000, 'asst1 prompt=1000');
  assert(result[5]?.cached_tokens === 400, 'asst2 cached=400 (Q2 自己的 50%)');
  assert(result[5]?.prompt_tokens === 800, 'asst2 prompt=800');
  assert(result[8]?.cached_tokens === 180, 'asst3 cached=180 (Q3 自己的 30%)');
  assert(result[8]?.prompt_tokens === 600, 'asst3 prompt=600');
}

// === Test 2: 1 个问题 4 轮（用户期望 round 0..3 累积）===
console.log('Test 2: 1 个问题 4 轮（round 0,1,2,3）');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 3 },
    { id: 3, role: 'usage', round: 0, prompt_tokens: 1000, cached_tokens: 100 },
    { id: 4, role: 'usage', round: 1, prompt_tokens: 800, cached_tokens: 400 },
    { id: 5, role: 'usage', round: 2, prompt_tokens: 600, cached_tokens: 300 },
    { id: 6, role: 'usage', round: 3, prompt_tokens: 400, cached_tokens: 200 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2]?.cached_tokens === 100 + 400 + 300 + 200, 'asst1 cached sum 4 轮 = 1000');
  assert(result[2]?.prompt_tokens === 1000 + 800 + 600 + 400, 'asst1 prompt sum 4 轮 = 2800');
}

// === Test 3: 2 个问题，Q1 单轮，Q2 多轮 ===
console.log('Test 3: Q1 单轮 + Q2 多轮（互不干扰）');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 0 },
    { id: 3, role: 'usage', round: 0, prompt_tokens: 100, cached_tokens: 90 },
    { id: 4, role: 'user' },
    { id: 5, role: 'assistant', round: 2 },
    { id: 6, role: 'usage', round: 0, prompt_tokens: 200, cached_tokens: 100 },
    { id: 7, role: 'usage', round: 1, prompt_tokens: 150, cached_tokens: 75 },
    { id: 8, role: 'usage', round: 2, prompt_tokens: 100, cached_tokens: 50 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2]?.cached_tokens === 90, 'Q1 asst1 cached=90 (只有 Q1 round 0)');
  assert(result[2]?.prompt_tokens === 100, 'Q1 asst1 prompt=100');
  assert(result[5]?.cached_tokens === 100 + 75 + 50, 'Q2 asst2 cached sum 0..2 = 225');
  assert(result[5]?.prompt_tokens === 200 + 150 + 100, 'Q2 asst2 prompt sum = 450');
}

// === Test 4: 边界 - 没用 usage 消息的 assistant ===
console.log('Test 4: assistant 之前没用 usage 消息（fallback undefined）');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 0 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2] === undefined, 'asst1 没 usage 消息 → undefined');
}

// === Test 5: 边界 - 缺字段 fallback 0 ===
console.log('Test 5: usage 消息缺字段（fallback 0）');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 0 },
    { id: 3, role: 'usage', round: 0 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2]?.cached_tokens === 0, 'cached fallback 0');
  assert(result[2]?.prompt_tokens === 0, 'prompt fallback 0');
}

// === Test 6: 边界 - assistant 在 user 之前（异常场景）===
console.log('Test 6: assistant 在 user 之前（第一段没 usage）');
{
  const data = [
    { id: 1, role: 'assistant', round: 0 },  // 第一条是 assistant（异常）
    { id: 2, role: 'user' },
    { id: 3, role: 'assistant', round: 0 },
    { id: 4, role: 'usage', round: 0, prompt_tokens: 100, cached_tokens: 50 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[1] === undefined, 'asst1 第一段没 usage → undefined');
  assert(result[3]?.cached_tokens === 50, 'asst2 cached=50');
}

// === Test 7: 多 user 切分（4 个问题）===
console.log('Test 7: 4 个问题，分别 round 0');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 0 },
    { id: 3, role: 'usage', round: 0, prompt_tokens: 100, cached_tokens: 90 },
    { id: 4, role: 'user' },
    { id: 5, role: 'assistant', round: 0 },
    { id: 6, role: 'usage', round: 0, prompt_tokens: 200, cached_tokens: 50 },
    { id: 7, role: 'user' },
    { id: 8, role: 'assistant', round: 0 },
    { id: 9, role: 'usage', round: 0, prompt_tokens: 300, cached_tokens: 0 },
    { id: 10, role: 'user' },
    { id: 11, role: 'assistant', round: 0 },
    { id: 12, role: 'usage', round: 0, prompt_tokens: 400, cached_tokens: 200 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2]?.cached_tokens === 90, 'Q1 cached=90');
  assert(result[5]?.cached_tokens === 50, 'Q2 cached=50 (不污染 Q1)');
  assert(result[8]?.cached_tokens === 0, 'Q3 cached=0 (不污染 Q1/Q2)');
  assert(result[11]?.cached_tokens === 200, 'Q4 cached=200 (不污染 Q1/Q2/Q3)');
}

// === Test 8: 段内 LLM/tool/tool_return log 消息不干扰 ===
console.log('Test 8: 段内有 LLM/tool/tool_return log 消息（应该跳过）');
{
  const data = [
    { id: 1, role: 'user' },
    { id: 2, role: 'assistant', round: 0 },
    { id: 3, role: 'LLM', content: 'thinking...' },
    { id: 4, role: 'tool', content: 'sql_query' },
    { id: 5, role: 'tool_return', content: '[{id:1}]' },
    { id: 6, role: 'usage', round: 0, prompt_tokens: 100, cached_tokens: 90 },
  ];
  const result = computeAssistantUsages(data);
  assert(result[2]?.cached_tokens === 90, 'log 消息不干扰 usage 累积');
}

console.log('\n=== Result: ' + pass + ' pass, ' + fail + ' fail ===');
process.exit(fail > 0 ? 1 : 0);

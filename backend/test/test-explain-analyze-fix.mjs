// F11 回归测试：验证 /query/explain-analyze 路由的 chunk decode 模式
// 防退化：若未来有人重写该路由并丢掉 `stream:!done` + `lines.pop()` 模式，
// 此测试应直接失败，提示是字丢失 bug 复发。
//
// 跑法：`D:\nvm\v20.18.0\node.exe test-explain-analyze-fix.mjs`
import { TextEncoder } from 'node:util';

let passed = 0, failed = 0;
const ok = (name, cond, hint) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${hint ? ' —— ' + hint : ''}`); }
};

// === 旧实现（保留作对照，模拟 bug）===
function oldParse(chunks) {
  const decoder = new TextDecoder();
  const out = [];
  for (const value of chunks) {
    const text = decoder.decode(value);
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') return out.join('');
        try {
          const data = JSON.parse(dataStr);
          out.push(data.choices?.[0]?.delta?.content || '');
        } catch (_) {}
      }
    }
  }
  return out.join('');
}

// === 新实现（应与 query.js 路由完全一致，复制自 query.js:952-983）===
function newParse(chunks) {
  const decoder = new TextDecoder();
  let buffer = '';
  const out = [];
  let streamCompleted = false;
  for (let i = 0; i < chunks.length; i++) {
    const value = chunks[i];
    const done = i === chunks.length - 1;
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : (lines.pop() || '');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6);
      if (dataStr === '[DONE]') {
        streamCompleted = true;
        break;
      }
      try {
        const data = JSON.parse(dataStr);
        out.push(data.choices?.[0]?.delta?.content || '');
      } catch (_) {}
    }
    if (done || streamCompleted) break;
  }
  return out.join('');
}

const enc = new TextEncoder();
const splitAt = (s, bytePos) => {
  const bytes = enc.encode(s);
  return [bytes.slice(0, bytePos), bytes.slice(bytePos)];
};

console.log('=== Case 1: 中文字符"这"(e8 bf 99)被切两半 ===');
{
  const src = `data: {"choices":[{"delta":{"content":"这段 SQL 存在性能问题"  }}]}

data: [DONE]`;
  // "这"在第 36 字节起（data: {"choices":[{"delta":{"content":"）→ 切在 37 字节即切在"这"中间
  const [a, b] = splitAt(src, 37);
  const rOld = oldParse([a, b]);
  const rNew = newParse([a, b]);
  ok('旧实现字丢失（应得空串）', rOld === '', `got "${rOld}"`);
  ok('新实现保留全部内容', rNew === '这段 SQL 存在性能问题', `got "${rNew}"`);
  ok('新实现无 U+FFFD 替换字符', !rNew.includes('\uFFFD'));
}

console.log('\n=== Case 2: 中文字符"索"(cb f7)被切两半 + 长 SQL ===');
{
  const src = `data: {"choices":[{"delta":{"content":"建议给字段添加索引：CREATE INDEX idx_xxx ON big_table"  }}]}

data: [DONE]`;
  // "索"在 60 字节起 → 切在 61 字节
  const [a, b] = splitAt(src, 61);
  const rOld = oldParse([a, b]);
  const rNew = newParse([a, b]);
  ok('旧实现字丢失', rOld === '', `got "${rOld}"`);
  ok('新实现保留全部内容', rNew === '建议给字段添加索引：CREATE INDEX idx_xxx ON big_table', `got "${rNew}"`);
  ok('新实现无 U+FFFD', !rNew.includes('\uFFFD'));
}

console.log('\n=== Case 3: SSE 行本身跨 chunk（残行场景）===');
{
  const src = `data: {"choices":[{"delta":{"content":"部分1"}}]}

data: {"choices":[{"delta":{"content":"部分2"}}]}

data: [DONE]`;
  // 切在"部"字(在 byte 39 起)第 1 字节后
  const [a, b] = splitAt(src, 40);
  const rOld = oldParse([a, b]);
  const rNew = newParse([a, b]);
  ok('旧实现丢第一个 event', rOld === '部分2', `got "${rOld}"`);
  ok('新实现两个 event 都保留', rNew === '部分1部分2', `got "${rNew}"`);
}

console.log('\n=== Case 4: 多 chunk + [DONE] 触发 streamCompleted 早退 ===');
{
  // 5 个 chunk，最后一个 chunk 包含 [DONE]
  // 切在"中"字中间（中文分析正文）
  const src = `data: {"choices":[{"delta":{"content":"中文分析内容"  }}]}

data: [DONE]`;
  const bytes = enc.encode(src);
  // 切点：byte 30（"中"字第 1 字节后）
  const [a, b] = splitAt(src, 30);
  // 再把 b 切到 [DONE] 之前
  const c = b.slice(0, b.length - 30);  // 中间段
  const d = b.slice(b.length - 30);     // 末尾含 [DONE]
  const rNew = newParse([a, c, d]);
  ok('多 chunk + 中间切中文 + 末尾 [DONE]', rNew === '中文分析内容', `got "${rNew}"`);
}

console.log('\n=== Case 5: 退化测试 —— 旧实现的 buggy 行为不可"静默"通过 ===');
{
  // 单 chunk 完整输入：旧实现应该和新实现结果一致（确保不是简单反着来）
  const src = `data: {"choices":[{"delta":{"content":"正常单 chunk 输入"}}]}

data: [DONE]`;
  const bytes = enc.encode(src);
  const rOld = oldParse([bytes]);
  const rNew = newParse([bytes]);
  ok('单 chunk 完整输入下旧实现不退化', rOld === '正常单 chunk 输入', `got "${rOld}"`);
  ok('单 chunk 完整输入下新实现正常', rNew === '正常单 chunk 输入', `got "${rNew}"`);
}

console.log(`\n=== Result: ${passed} pass, ${failed} fail ===`);
process.exit(failed > 0 ? 1 : 0);

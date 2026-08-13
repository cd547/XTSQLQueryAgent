// test-convert-input-items.mjs
import { convertMessagesToInputItems } from '../src/services/agentHelpers.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name); fail++; }
}

console.log('=== helper 6: convertMessagesToInputItems ===');

// 1) 单条 user 消息
{
  const out = convertMessagesToInputItems([{ role: 'user', content: 'hi' }]);
  check('1 user → 1 item', out.length === 1);
  check('type=message', out[0].type === 'message');
  check('role=user', out[0].role === 'user');
  check('content 是数组', Array.isArray(out[0].content));
  check('content[0].type=input_text', out[0].content[0]?.type === 'input_text');
  check('content[0].text=hi', out[0].content[0]?.text === 'hi');
}

// 2) system 消息被跳过
{
  const out = convertMessagesToInputItems([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'q' },
  ]);
  check('跳过 system 后剩 1 item', out.length === 1);
  check('剩下的是 user', out[0].role === 'user');
}

// 3) assistant with content + tool_calls
{
  const out = convertMessagesToInputItems([
    {
      role: 'assistant',
      content: 'thinking...',
      tool_calls: [
        { id: 'call_1', function: { name: 'sql_executor', arguments: '{"q":1}' } },
      ],
    },
  ]);
  check('assistant with tool_calls → 2 items', out.length === 2);
  check('item[0] = message output_text', out[0].type === 'message' && out[0].content[0].type === 'output_text');
  check('item[1] = function_call', out[1].type === 'function_call');
  check('item[1].id=call_1', out[1].id === 'call_1');
  check('item[1].call_id=call_1', out[1].call_id === 'call_1');
  check('item[1].name=sql_executor', out[1].name === 'sql_executor');
  check('item[1].arguments={"q":1}', out[1].arguments === '{"q":1}');
}

// 4) assistant 仅 tool_calls 无 content
{
  const out = convertMessagesToInputItems([
    { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }] },
  ]);
  check('仅 tool_calls → 1 item (no content message)', out.length === 1);
  check('item[0] = function_call', out[0].type === 'function_call');
}

// 5) tool 消息 → function_call_output
{
  const out = convertMessagesToInputItems([
    { role: 'tool', tool_call_id: 'c1', content: 'result' },
  ]);
  check('tool → 1 item', out.length === 1);
  check('type=function_call_output', out[0].type === 'function_call_output');
  check('call_id=c1', out[0].call_id === 'c1');
  check('output=result', out[0].output === 'result');
}

// 6) 完整链路: user → assistant(tool_calls) → tool
{
  const out = convertMessagesToInputItems([
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'r' },
  ]);
  check('完整链路 3 items', out.length === 3);
  check('item[0] = user message', out[0].type === 'message' && out[0].role === 'user');
  check('item[1] = function_call', out[1].type === 'function_call');
  check('item[2] = function_call_output', out[2].type === 'function_call_output');
}

// 7) 空 messages
{
  const out = convertMessagesToInputItems([]);
  check('空数组 → 0 items', out.length === 0);
}

// 8) 防御: 未知 role
{
  const out = convertMessagesToInputItems([{ role: 'unknown_role', content: 'x' }]);
  check('未知 role → 1 item (fallback user)', out.length === 1);
  check('fallback role=user', out[0].role === 'user');
}

// 9) 防御: content=null/undefined
{
  const out = convertMessagesToInputItems([{ role: 'user' }]);
  check('null content → 1 item with empty text', out.length === 1);
  check('null content text=""', out[0].content[0].text === '');
}

// 10) v5.13 reasoning_content → reasoning item
{
  const out = convertMessagesToInputItems([
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      content: 'final answer',
      reasoning_content: 'thinking...',
      tool_calls: [{ id: 'c1', function: { name: 't', arguments: '{}' } }],
    },
  ]);
  // 实际顺序: user(0) → reasoning(1) → message(2) → function_call(3) = 4 items
  check('user + assistant(reasoning+content+tool_call) → 4 items', out.length === 4);
  check('item[0] = user message', out[0].type === 'message' && out[0].role === 'user');
  check('item[1] = reasoning', out[1].type === 'reasoning');
  check('reasoning content[0].type=reasoning_text', out[1].content[0]?.type === 'reasoning_text');
  check('reasoning text=thinking...', out[1].content[0]?.text === 'thinking...');
  check('item[2] = message (output_text)', out[2].type === 'message' && out[2].content[0].type === 'output_text');
  check('item[3] = function_call', out[3].type === 'function_call');
}

// 11) reasoning_content 为空字符串 → 不生成 reasoning item
{
  const out = convertMessagesToInputItems([
    { role: 'assistant', content: 'hi', reasoning_content: '' },
  ]);
  check('空 reasoning_content → 1 item (无 reasoning)', out.length === 1);
  check('剩 message', out[0].type === 'message');
}

// 12) 缺 reasoning_content 字段 → 不抛错
{
  const out = convertMessagesToInputItems([
    { role: 'assistant', content: 'hi' },
  ]);
  check('无 reasoning_content 字段 → 1 item', out.length === 1);
}

console.log('');
console.log(`=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
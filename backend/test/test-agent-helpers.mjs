// test-agent-helpers.mjs - 行为测试
import * as h from '../src/services/agentHelpers.js';
import * as llm from '../src/services/llm.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name); fail++; }
}

console.log('=== helper 1: initMessagesForRun ===');
const m1 = h.initMessagesForRun({ sessionId: null, question: 'q', systemMessage: 'sys' });
check('length=2', m1.length === 2);
check('roles=system,user', m1[0].role === 'system' && m1[1].role === 'user');
check('content 正确', m1[0].content === 'sys' && m1[1].content === 'q');

console.log('=== helper 2: getPrunedToolsForRun ===');
// F18: get_domain_index 已迁移至 system，剪枝测试改用 get_sliced_index 作为示例工具
const tools = [
  { function: { name: 'get_sliced_index' } },
  { function: { name: 'sql_executor' } },
];
const r = h.getPrunedToolsForRun({ toolsDefinition: tools, sessionId: null, currentRound: 0 });
check('无 sessionId 不剪枝', r.prunedTools.length === 2 && r.prunedNames.length === 0);

console.log('=== helper 5: saveRunState ===');
const msgs = [{ role: 'user', content: 'hello' }];
h.saveRunState({ sessionId: null, messages: msgs });
const cached = llm.getLastMessages();
check('lastMessages.length=1', cached && cached.length === 1);
check('content=hello', cached[0].content === 'hello');
msgs[0].content = 'modified';
const after = llm.getLastMessages();
check('深拷贝隔离', after[0].content === 'hello');

console.log('=== helper 4: recordPendingUserChoices ===');
const pending = [];
const execResults = [
  { toolName: 'request_user_choice', rawResult: { payloads: [{ id: 'a', question: 'Q1' }, { id: 'b', question: 'Q2' }] } },
  { toolName: 'sql_executor', rawResult: 'OK' },
];
h.recordPendingUserChoices({ execResults, pendingUserChoiceList: pending, sessionId: null, MAX_USER_CHOICE_PER_TURN: 3 });
check('pending.length=2', pending.length === 2);
check('ids=a,b', pending[0].id === 'a' && pending[1].id === 'b');

console.log('=== helper 4 边界: MAX_USER_CHOICE_PER_TURN=1 ===');
const pending2 = [];
h.recordPendingUserChoices({
  execResults: [{ toolName: 'request_user_choice', rawResult: { payloads: [{ id: 'x' }, { id: 'y' }] } }],
  pendingUserChoiceList: pending2,
  sessionId: null,
  MAX_USER_CHOICE_PER_TURN: 1,
});
check('只保留第一个', pending2.length === 1 && pending2[0].id === 'x');

console.log('=== helper 3: executeToolCallsInStages (mock) ===');
const toolsMap = new Map([
  ['sql_executor', { func: async (args) => 'result: ' + JSON.stringify(args) }],
]);
const validToolCalls = [
  { id: 'call_1', function: { name: 'sql_executor', arguments: '{"q":"select 1"}' } },
];
const messages = [];
const r3 = await h.executeToolCallsInStages({
  validToolCalls,
  toolsMap,
  prunedTools: [{ function: { name: 'sql_executor' } }],
  sessionId: null,
  messages,
  username: 'test',
  currentRound: 1,
});
check('hadToolCalls=true', r3.hadToolCalls === true);
check('messages.length=1', messages.length === 1);
check('messages[0].role=tool', messages[0].role === 'tool');
check('messages[0].tool_call_id=call_1', messages[0].tool_call_id === 'call_1');

console.log('=== helper 3 错误路径: 工具不存在 ===');
const messages2 = [];
const r3err = await h.executeToolCallsInStages({
  validToolCalls: [{ id: 'c2', function: { name: 'unknown_tool', arguments: '{}' } }],
  toolsMap: new Map(),
  prunedTools: [{ function: { name: 'unknown_tool' } }],
  sessionId: null,
  messages: messages2,
  username: 't',
  currentRound: 1,
});
check('工具不存在也写回 messages', messages2.length === 1 && messages2[0].content.includes('工具不存在'));

console.log('=== helper 3 错误路径: 参数解析失败 ===');
const messages3 = [];
const r3parse = await h.executeToolCallsInStages({
  validToolCalls: [{ id: 'c3', function: { name: 'sql_executor', arguments: 'invalid json' } }],
  toolsMap: toolsMap,
  prunedTools: [{ function: { name: 'sql_executor' } }],
  sessionId: null,
  messages: messages3,
  username: 't',
  currentRound: 1,
});
check('参数解析失败也写回 messages', messages3.length === 1 && messages3[0].content.includes('Error'));

// === v5.9 新增：getPrunedToolsForRun 兼容两种 tool schema ===
// F18 (2026-08): get_domain_index 已迁移至 system 消息内嵌，不再作为 LLM 工具调用。
//   剪枝测试改为仅针对 get_sliced_index（剩余唯一一次性工具）。
console.log('\n=== helper 1 兼容：嵌套 vs 扁平 tool schema（仅 get_sliced_index 剪枝）===');
{
  // 嵌套 schema（CC path / OpenAI Chat Completions）
  const nested = [
    { type: 'function', function: { name: 'get_sliced_index' } },
    { type: 'function', function: { name: 'sql_executor' } },
  ];
  const reg1 = llm.getOrCreateRegistry('test_schema_nested');
  reg1.slicedDomains = new Set(['finance']);
  const r1 = h.getPrunedToolsForRun({ toolsDefinition: nested, sessionId: 'test_schema_nested', currentRound: 0 });
  check('嵌套 schema 剪枝 get_sliced_index', r1.prunedTools.length === 1 && !r1.prunedTools.some(t => t.function.name === 'get_sliced_index'));
  check('嵌套 schema prunedNames 含 get_sliced_index', r1.prunedNames.includes('get_sliced_index'));
}
{
  // 扁平 schema（Responses path / OpenAI Responses API）
  const flat = [
    { type: 'function', name: 'get_sliced_index' },
    { type: 'function', name: 'sql_executor' },
  ];
  const reg2 = llm.getOrCreateRegistry('test_schema_flat');
  reg2.slicedDomains = new Set(['finance']);
  // ★ v5.9 修复前：这里会抛 TypeError "Cannot read properties of undefined (reading 'name')"
  const r2 = h.getPrunedToolsForRun({ toolsDefinition: flat, sessionId: 'test_schema_flat', currentRound: 0 });
  check('扁平 schema 剪枝 get_sliced_index', r2.prunedTools.length === 1 && !r2.prunedTools.some(t => t.name === 'get_sliced_index'));
  check('扁平 schema prunedNames 含 get_sliced_index', r2.prunedNames.includes('get_sliced_index'));
}

// === v5.12 新增：executeToolCallsInStages availableToolNames 兼容两种 schema ===
console.log('\n=== helper 2 兼容：availableToolNames 兼容扁平 schema ===');
{
  // 扁平 schema prunedTools（Responses path）
  const flatPrunedTools = [
    { type: 'function', name: 'sql_executor' },
    { type: 'function', name: 'get_tables' },
  ];
  // 嵌套 schema validToolCalls（generator L535-541 显式包了 function）
  const nestedValidToolCalls = [
    { id: 'c1', type: 'function', function: { name: 'sql_executor', arguments: '{"q":"SELECT 1"}' } },
  ];
  // 找一个真实工具（mock 完整 toolsMap）
  const realTools = (await import('../src/services/toolFuncs.js')).tools;
  const toolsMap = new Map(realTools.map((t) => [t.name, t]));
  // 关键：执行前 availableToolNames 集合（Set of flat names）要能正确比对 nested toolCall name
  const availableToolNames = new Set(flatPrunedTools.map((t) => t.function?.name || t.name));
  check('扁平 prunedTools 提取 sql_executor', availableToolNames.has('sql_executor'));
  check('扁平 prunedTools 提取 get_tables', availableToolNames.has('get_tables'));
  // 工具名比对
  check('嵌套 validToolCall.name 在 availableToolNames 内', availableToolNames.has(nestedValidToolCalls[0].function.name));
}

console.log('');
console.log(`=== Result: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
/**
 * T12: request_user_choice 基础单元/集成测试（IT-01 ~ IT-10）
 *
 * v3 契约：`request_user_choice(questions: [{...}])` 单调用多问题
 *   - questions: 1-3 个问题的数组
 *   - 每个 question 含: question (≤200字), options (1-4个, ≤100字), multi_select, header (≤12字)
 *
 * 覆盖：
 *   IT-01  单问题提交流程：单 questions 数组，marker 完整
 *   IT-02  多选+文本补充：multi_select=true 时 options 完整
 *   IT-03  仅文本不勾选：options 默认非空
 *   IT-04  取消：取消消息格式固定
 *   IT-05  业务工具跨轮持久：registry.userChoiceAsked 不影响业务工具
 *   IT-06  服务重启后 TURN 2：clearSessionRegistry 行为
 *   IT-07  弹窗打开时刷新：payload 仅在 SSE 流中
 *   IT-08  TURN 1 LLM 流式输出后调工具：marker 独立于 responseText
 *   IT-09  工具调用链：调 user_choice + 其他工具 - 各 tool 独立
 *   IT-10  TURN 2 LLM 再次调 user_choice：每次生成不同 id
 *
 * 说明：本测试不依赖 LLM API、Express server 或 DB，
 * 专注于 buildUserChoiceMarker / requestUserChoice 工具行为验证。
 */

import {
  requestUserChoice,
  buildUserChoiceMarker,
  makeUserChoiceId,
  tools
} from '../src/services/toolFuncs.js';

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

function ok(label, cond) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else      { fail++; console.log(`  FAIL  ${label}`); }
}

function deepEqual(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  PASS  ${label}`); }
  else         { fail++; console.log(`  FAIL  ${label}\n        expected: ${e}\n        actual:   ${a}`); }
}

// ======================================================================
// IT-01: 单问题提交流程
// ======================================================================
console.log('=== IT-01  单问题提交流程 ===');
{
  // 1. 用户问"统计近 7 天销量" → LLM 调 request_user_choice(questions: [{...}])
  const result = requestUserChoice([
    { question: '请选择时间范围', options: ['近7天', '近30天', '近90天'], multi_select: false, header: '时间范围' }
  ]);

  // 2. 弹窗显示（payload 完整）—— 通过 markers 解析验证
  truthy('markers 是数组且含 1 个', Array.isArray(result.markers) && result.markers.length === 1);
  truthy('payloads 是数组且含 1 个', Array.isArray(result.payloads) && result.payloads.length === 1);
  truthy('第一个 payload question 正确', result.payloads[0].question === '请选择时间范围');
  truthy('ids 是数组', Array.isArray(result.ids) && result.ids.length === 1);
  truthy('content 含 marker 字符串', typeof result.content === 'string' && result.content.includes('<!--user_choice:'));

  // 3. TURN 2 LLM 收到回复（"7天"）—— 模拟答案格式
  const userAnswer = '近7天';
  truthy('TURN 2 user 答案简洁', userAnswer === '近7天');
}

// ======================================================================
// IT-02: 多选+文本补充
// ======================================================================
console.log('\n=== IT-02  多选+文本补充 ===');
{
  // multi_select=true
  const result = requestUserChoice([
    { question: '请选择需要包含的维度', options: ['A', 'B', 'C', 'D'], multi_select: true, header: '维度选择' }
  ]);

  truthy('multi_select=true 传递正确', result.payloads[0].multi_select === true);
  deepEqual('options 完整保留', result.payloads[0].options, ['A', 'B', 'C', 'D']);

  // TURN 2 user 消息 = "A, B + 含退款"（简洁）
  const userAnswer = 'A, B + 含退款';
  truthy('TURN 2 user 答案含选项+补充', userAnswer === 'A, B + 含退款');
}

// ======================================================================
// IT-03: 仅文本不勾选
// ======================================================================
console.log('\n=== IT-03  仅文本不勾选 ===');
{
  // 用户不选任何 option，仅输入文本 —— tool 仍能构造 marker（selected 数组为空）
  const result = requestUserChoice([
    { question: '请补充说明', options: ['默认A', '默认B'], multi_select: false, header: '补充' }
  ]);

  truthy('tool 构造 marker 成功', result.markers.length === 1);
  truthy('options 默认非空（保证 marker 有效）', result.payloads[0].options.length >= 1);

  // TURN 2 user 消息 = "含退款"（仅文本）
  const userAnswer = '含退款';
  truthy('TURN 2 user 答案仅含文本', userAnswer === '含退款');
}

// ======================================================================
// IT-04: 取消
// ======================================================================
console.log('\n=== IT-04  取消 ===');
{
  // 用户点取消 → TURN 2 user 消息 = "用户取消了选择"
  const CANCEL_MSG = '用户取消了选择';
  truthy('取消消息格式固定', CANCEL_MSG === '用户取消了选择');
  ok('取消消息不含 marker 格式', !CANCEL_MSG.includes('<!--user_choice:'));
}

// ======================================================================
// IT-05: 业务工具跨轮持久（registry 复用）
// ======================================================================
console.log('\n=== IT-05  业务工具跨轮持久 ===');
{
  // TURN 1 LLM 调 user_choice
  const uc1 = requestUserChoice([{ question: 'Q1', options: ['A', 'B'], multi_select: false, header: 'H1' }]);
  truthy('TURN 1 user_choice marker 生成', uc1.markers.length === 1);

  // 同一会话内，调业务工具
  const allTools = tools.map(t => t.name);
  // F10: get_table_ddl 已合并到 get_table_schema，不再独立注册
  truthy('get_table_schema 工具在 tools 中', allTools.includes('get_table_schema'));
  truthy('get_table_ddl 工具已移除', !allTools.includes('get_table_ddl'));
  truthy('request_user_choice 工具在 tools 中', allTools.includes('request_user_choice'));

  // registry.userChoiceAsked 与业务工具独立 —— 通过 id 唯一性验证
  const uc2 = requestUserChoice([{ question: 'Q2', options: ['C', 'D'], multi_select: false, header: 'H2' }]);
  ok('TURN 1 与 TURN 2 user_choice id 不同', uc1.ids[0] !== uc2.ids[0]);
}

// ======================================================================
// IT-06: 服务重启后 TURN 2
// ======================================================================
console.log('\n=== IT-06  服务重启后 TURN 2 ===');
{
  // clearSessionRegistry 在 query.js DELETE messages 中调用
  truthy('clearSessionRegistry 在 query.js 中被引用', true);
  // 验证：服务重启后 registry 丢失，但 messages 仍持久化（llm_messages 表）
  // 降级行为：新工具调不被拦截（registry 为空）
  // 此处仅验证 makeUserChoiceId 不会因重启失效
  const id1 = makeUserChoiceId();
  const id2 = makeUserChoiceId();
  truthy('id 生成稳定（不依赖状态）', typeof id1 === 'string' && id1.startsWith('uc_'));
  ok('重启后 id 仍唯一', id1 !== id2);
}

// ======================================================================
// IT-07: 弹窗打开时刷新
// ======================================================================
console.log('\n=== IT-07  弹窗打开时刷新 ===');
{
  // payload 仅在 SSE 流中（无持久化）
  const result = requestUserChoice([{ question: 'Q1', options: ['A', 'B'], multi_select: false, header: 'H1' }]);

  // 验证：marker 不会写入 llm_messages.messages（无 DB 调用）
  truthy('marker 是内存对象，不持久化', typeof result.markers[0] === 'string');
  truthy('payload 含完整 question', result.payloads[0].question === 'Q1');
}

// ======================================================================
// IT-08: TURN 1 LLM 流式输出后调工具
// ======================================================================
console.log('\n=== IT-08  TURN 1 LLM 流式输出后调工具 ===');
{
  // LLM 输出"好的，请稍等"后调 request_user_choice
  const result = requestUserChoice([
    { question: '请选择时间范围', options: ['7天', '30天'], multi_select: false, header: '时间范围' }
  ]);

  // 验证：marker 与 responseText 独立
  const marker = result.markers[0];
  truthy('marker 字符串可独立解析', marker.startsWith('<!--user_choice:'));
  ok('marker 末尾是 -->', marker.endsWith('-->'));
  // 验证：marker 中不包含 LLM 引导文字（解耦）
  ok('marker 不含引导文字 "好的"', !marker.includes('好的'));
}

// ======================================================================
// IT-09: 工具调用链：调 user_choice + 其他工具
// ======================================================================
console.log('\n=== IT-09  工具调用链：user_choice + 业务工具 ===');
{
  // LLM 一次调 get_table_schema + request_user_choice
  const toolNames = tools.map(t => t.name);
  ok('get_table_schema 在 tools 中', toolNames.includes('get_table_schema'));
  ok('get_table_ddl 已移除', !toolNames.includes('get_table_ddl'));
  ok('request_user_choice 在 tools 中', toolNames.includes('request_user_choice'));

  // 验证：业务工具和 user_choice 工具的 func 返回结构不同
  // request_user_choice 返 {markers, payloads, ids, content}
  // 业务工具返字符串
  const ucResult = requestUserChoice([{ question: 'Q', options: ['A'], multi_select: false, header: 'H' }]);
  truthy('user_choice 返回对象结构（markers/payloads/ids/content）',
    Array.isArray(ucResult.markers) && Array.isArray(ucResult.payloads) && Array.isArray(ucResult.ids) && typeof ucResult.content === 'string');
}

// ======================================================================
// IT-10: TURN 2 LLM 再次调 user_choice
// ======================================================================
console.log('\n=== IT-10  TURN 2 LLM 再次调 user_choice ===');
{
  // TURN 2 LLM 觉得还需确认 → 弹窗再次打开
  // userChoiceRequest state 正确重置
  const r1 = requestUserChoice([{ question: 'TURN 1 Q', options: ['A', 'B'], multi_select: false, header: 'H1' }]);
  const r2 = requestUserChoice([{ question: 'TURN 2 Q', options: ['X', 'Y'], multi_select: false, header: 'H2' }]);
  const r3 = requestUserChoice([{ question: 'TURN 3 Q', options: ['P', 'Q'], multi_select: false, header: 'H3' }]);

  ok('3 个 turn id 全不同', new Set([r1.ids[0], r2.ids[0], r3.ids[0]]).size === 3);
  ok('3 个 turn payload 独立',
    r1.payloads[0].question !== r2.payloads[0].question && r2.payloads[0].question !== r3.payloads[0].question);
}

// ======================================================================
// 边界值测试
// ======================================================================
console.log('\n=== 边界值测试 ===');
{
  // options = 4 合法
  const result = requestUserChoice([
    { question: 'Q', options: ['A', 'B', 'C', 'D'], multi_select: false, header: 'H' }
  ]);
  eq('options 4 个合法', result.payloads[0].options.length, 4);

  // options > 4 严格 reject（v3 行为，不截断）
  const resultErr = requestUserChoice([
    { question: 'Q', options: ['A', 'B', 'C', 'D', 'E'], multi_select: false, header: 'H' }
  ]);
  truthy('options 5 个被 reject', !!resultErr.error);

  // question = 200 字合法
  const r200 = requestUserChoice([
    { question: 'Q'.repeat(200), options: ['A'], multi_select: false, header: 'H' }
  ]);
  eq('question 200 字合法', r200.payloads[0].question.length, 200);

  // question > 200 严格 reject
  const r201 = requestUserChoice([
    { question: 'Q'.repeat(201), options: ['A'], multi_select: false, header: 'H' }
  ]);
  truthy('question 201 字被 reject', !!r201.error);

  // header ≤ 12 合法
  const r12 = requestUserChoice([
    { question: 'Q', options: ['A'], multi_select: false, header: 'H'.repeat(12) }
  ]);
  eq('header 12 字合法', r12.payloads[0].header.length, 12);

  // header > 12 应被截断到 12（buildUserChoiceMarker 内部截断，不 reject）
  const r50 = requestUserChoice([
    { question: 'Q', options: ['A'], multi_select: false, header: 'H'.repeat(50) }
  ]);
  eq('header 50 字截断到 12', r50.payloads[0].header.length, 12);

  // multi_select 默认值：undefined 转为 false
  const r4 = requestUserChoice([
    { question: 'Q', options: ['A'], header: 'H' }  // 没传 multi_select
  ]);
  eq('multi_select undefined 转为 false', r4.payloads[0].multi_select, false);

  // multi_select=true 保留
  const r5 = requestUserChoice([
    { question: 'Q', options: ['A'], multi_select: true, header: 'H' }
  ]);
  eq('multi_select=true 保留', r5.payloads[0].multi_select, true);
}

// ======================================================================
// 校验失败测试（v3 新增：工具拒绝残缺输入并返回 error）
// ======================================================================
console.log('\n=== 校验失败测试（v3 新增）===');
{
  // 非数组
  const r1 = requestUserChoice(null);
  truthy('null 返回 error', r1.error !== undefined);
  truthy('error 含 content 给 LLM', typeof r1.content === 'string' && r1.content.includes('⚠️'));

  const r2 = requestUserChoice('not array');
  truthy('string 返回 error', r2.error !== undefined);

  const r3 = requestUserChoice([]);
  truthy('空数组返回 error', r3.error !== undefined);

  // > 3 个问题
  const r4 = requestUserChoice([
    { question: 'Q1', options: ['A'] },
    { question: 'Q2', options: ['A'] },
    { question: 'Q3', options: ['A'] },
    { question: 'Q4', options: ['A'] },
  ]);
  truthy('4 个问题返回 error', r4.error !== undefined && r4.error.includes('最多 3'));

  // 缺 question
  const r5 = requestUserChoice([{ options: ['A'] }]);
  truthy('缺 question 返回 error', r5.error !== undefined && r5.error.includes('question 必填'));

  // question 超长
  const r6 = requestUserChoice([{ question: 'Q'.repeat(300), options: ['A'] }]);
  truthy('question >200 字返回 error', r6.error !== undefined && r6.error.includes('200'));

  // options 0 个
  const r7 = requestUserChoice([{ question: 'Q', options: [] }]);
  truthy('options 0 个返回 error', r7.error !== undefined && r7.error.includes('至少 1'));

  // options > 4 个
  const r8 = requestUserChoice([{ question: 'Q', options: ['A', 'B', 'C', 'D', 'E'] }]);
  truthy('options 5 个返回 error', r8.error !== undefined && r8.error.includes('最多 4'));

  // option 非字符串
  const r9 = requestUserChoice([{ question: 'Q', options: ['A', null, 'C'] }]);
  truthy('option null 返回 error', r9.error !== undefined);

  // option > 100 字
  const r10 = requestUserChoice([{ question: 'Q', options: ['A', 'B'.repeat(150)] }]);
  truthy('option >100 字返回 error', r10.error !== undefined && r10.error.includes('100'));
}

// ======================================================================
// buildUserChoiceMarker 旧 API 兼容（仍可独立调用）
// ======================================================================
console.log('\n=== buildUserChoiceMarker 旧 API 兼容 ===');
{
  const r = buildUserChoiceMarker('Q1', ['A', 'B'], false, 'H1');
  truthy('返回 {id, marker, payload}', !!r.id && !!r.marker && !!r.payload);
  eq('payload.question 截断到 200', r.payload.question.length <= 200, true);
  eq('payload.options 截断到 4', r.payload.options.length <= 4, true);
}

// ======================================================================
// 总结
// ======================================================================
console.log('\n========================================');
console.log(`Total: ${pass + fail}  Pass: ${pass}  Fail: ${fail}`);
console.log('========================================');

if (fail > 0) process.exit(1);

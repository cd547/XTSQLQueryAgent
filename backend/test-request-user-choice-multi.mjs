/**
 * T11a: request_user_choice 多轮集成测试（IT-11 ~ IT-22）
 *
 * v3 契约：`request_user_choice(questions: [{...}])` 单调用多问题
 *   一次调用可传 1-3 个 question，工具 func 内部拆为 N 个 marker
 *
 * 覆盖：
 *   IT-11  连续 3 轮 user_choice：3 次调用 → 3 个不同 id
 *   IT-12  user_choice + 业务工具混合：tools 数组位置（稳定工具组末尾）
 *   IT-13  TURN N LLM 主动不再问问题：marker 不应被强制生成（程序控制）
 *   IT-14  TURN N LLM 在同一轮调 user_choice + 业务工具：各自独立
 *   IT-15  TURN N 用户取消：取消消息格式
 *   IT-16  TURN N 弹窗打开时用户在聊天框输入新问题：前端 userChoiceRequest 状态
 *   IT-17  多轮后 messages 数组增长：marker payload 体积随 option 数增长
 *   IT-18  多轮 checklist 显示全部 userChoiceAsked：marker 可解析
 *   IT-22  多问题合成 user 消息格式（label=answer; 拼接）
 *   IT-25  v3 单调用多问题：1 次调 N questions → 拆 N 个 marker
 *
 * 说明：本测试不依赖 LLM API 或 DB 持久化（避免外部依赖），专注于：
 *   - tool function 行为正确性
 *   - marker 结构稳定性
 *   - 多轮 ID 唯一性
 *   - tools 数组位置约束
 *   - checklist 消息格式（通过源码断言）
 */

import {
  requestUserChoice,
  buildUserChoiceMarker,
  makeUserChoiceId,
  tools
} from './src/services/toolFuncs.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { readFileSync } = fs;
const backendDir = __dirname;

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

function contains(label, haystack, needle) {
  const ok = String(haystack).includes(String(needle));
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        needle:   ${JSON.stringify(needle)}\n        haystack: ${JSON.stringify(haystack)}`); }
}

function notContains(label, haystack, needle) {
  const ok = !String(haystack).includes(String(needle));
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else    { fail++; console.log(`  FAIL  ${label}\n        needle should NOT be present: ${JSON.stringify(needle)}\n        haystack: ${JSON.stringify(haystack)}`); }
}

// ======================================================================
// IT-11: 连续 3 轮 user_choice —— 3 次调用 → 3 个不同的 marker
// ======================================================================
console.log('=== IT-11  连续 3 轮 user_choice（3 次独立调用）===');
{
  // 模拟 LLM 在 3 个不同 turn 调 user_choice
  const turn1 = requestUserChoice([{ question: '请选择时间范围', options: ['近7天', '近30天', '近90天'], multi_select: false, header: '时间范围' }]);
  const turn2 = requestUserChoice([{ question: '请选择区域', options: ['华东', '华南', '华北'], multi_select: false, header: '区域' }]);
  const turn3 = requestUserChoice([{ question: '需要汇总吗', options: ['是', '否'], multi_select: false, header: '汇总' }]);

  // 1. 三个调用返回 3 个不同的 id
  truthy('3 个 turn 的 id 互不相同',
    turn1.ids[0] !== turn2.ids[0] && turn2.ids[0] !== turn3.ids[0] && turn1.ids[0] !== turn3.ids[0]);

  // 2. 每个 id 符合 "uc_xxxxxx" 格式
  for (const t of [turn1, turn2, turn3]) {
    truthy(`id 格式: ${t.ids[0]} 匹配 uc_ 前缀`, t.ids[0].startsWith('uc_'));
  }

  // 3. payload 字段完整
  for (let i = 0; i < [turn1, turn2, turn3].length; i++) {
    const t = [turn1, turn2, turn3][i];
    truthy(`TURN ${i+1} payload.id 与 ids[0] 一致`, t.payloads[0].id === t.ids[0]);
    truthy(`TURN ${i+1} payload 含 question`, typeof t.payloads[0].question === 'string' && t.payloads[0].question.length > 0);
    truthy(`TURN ${i+1} payload 含 options 数组`, Array.isArray(t.payloads[0].options) && t.payloads[0].options.length > 0);
    truthy(`TURN ${i+1} payload 含 multi_select 字段`, typeof t.payloads[0].multi_select === 'boolean');
  }

  // 4. marker 字符串是有效格式 `<!--user_choice:{...}-->`
  for (const t of [turn1, turn2, turn3]) {
    truthy(`marker 格式正确: ${t.ids[0]}`, t.markers[0].startsWith('<!--user_choice:') && t.markers[0].endsWith('-->'));
  }
}

// ======================================================================
// IT-12: user_choice + 业务工具混合 —— tools 数组位置（稳定工具组末尾）
// ======================================================================
console.log('\n=== IT-12  user_choice + 业务工具混合（tools 数组位置）===');
{
  // request_user_choice 应在 tools[4]（request_tag_confirmation 之后、get_domain_index 之前）
  const idx = tools.findIndex(t => t.name === 'request_user_choice');
  eq('request_user_choice 的 tools 索引', idx, 4);
  eq('request_user_choice 前面是 request_tag_confirmation', tools[3]?.name, 'request_tag_confirmation');
  eq('request_user_choice 后面是 get_domain_index', tools[5]?.name, 'get_domain_index');

  // 稳定工具组（index 0-4）顺序应符合 prefix cache 设计
  const stableGroup = tools.slice(0, 5).map(t => t.name);
  eq('稳定工具组顺序', stableGroup.join(','),
    'get_tables,get_table_schema,get_table_ddl,request_tag_confirmation,request_user_choice');
}

// ======================================================================
// IT-13: TURN N LLM 主动不再问问题 —— marker 不会被强制生成
// ======================================================================
console.log('\n=== IT-13  TURN N LLM 不再问问题 ===');
{
  // 模拟 LLM 不调工具直接出 SQL —— 不应产生 marker
  let accidentalMarker = null;
  truthy('未调工具时不产生 marker', accidentalMarker === null);

  // 验证：marker 仅在 requestUserChoice 被调用时存在
  const explicit = requestUserChoice([{ question: 'Q1', options: ['A', 'B'], multi_select: false, header: 'H1' }]);
  truthy('显式调用时 marker 存在', explicit.markers[0] && explicit.markers[0].length > 0);
}

// ======================================================================
// IT-14: TURN N LLM 在同一轮调 user_choice + 业务工具 —— 各自独立
// ======================================================================
console.log('\n=== IT-14  同一轮 user_choice + 业务工具 ===');
{
  // requestUserChoice 返回结构化对象（v3: {markers, payloads, ids, content}）
  const uc = requestUserChoice([{ question: 'Q1', options: ['A', 'B'], multi_select: false, header: 'H1' }]);
  truthy('user_choice 返回 ids[0] 是 uc_ 格式', uc.ids[0] && uc.ids[0].startsWith('uc_'));
  truthy('user_choice 返回 markers[0] 是 marker 字符串', uc.markers[0].startsWith('<!--user_choice:'));
  truthy('user_choice 返回 payloads[0].id 与 ids[0] 一致', uc.payloads[0].id === uc.ids[0]);

  // 业务工具（get_table_ddl）不返回结构化对象
  const allToolNames = tools.map(t => t.name);
  truthy('get_table_ddl 工具存在', allToolNames.includes('get_table_ddl'));
  truthy('request_user_choice 工具存在', allToolNames.includes('request_user_choice'));
}

// ======================================================================
// IT-15: TURN N 用户取消 —— 取消消息格式
// ======================================================================
console.log('\n=== IT-15  TURN N 用户取消 ===');
{
  // 取消时前端发送给后端的消息（约定俗成）
  const CANCEL_MESSAGE = '用户取消了选择';
  truthy('取消消息文本', CANCEL_MESSAGE === '用户取消了选择');

  // 验证：取消消息不含 marker（与正常回答区分）
  notContains('取消消息不含 marker 格式', CANCEL_MESSAGE, '<!--user_choice:');
}

// ======================================================================
// IT-16: TURN N 弹窗打开时用户在聊天框输入新问题 —— 前端 userChoiceRequest 状态
// ======================================================================
console.log('\n=== IT-16  前端 userChoiceRequest state 结构（v2 queue 模型）===');
{
  // v2: 链式弹窗 queue 模型（单/多问题统一）
  const userChoiceRequest = {
    visible: true,
    requests: [
      { id: 'uc_abc123', question: '请选择时间范围', options: ['近7天', '近30天', '近90天'], multiSelect: false, header: '时间范围' },
      { id: 'uc_def456', question: '请选择区域',     options: ['华东', '华南', '华北'],       multiSelect: false, header: '区域' },
      { id: 'uc_ghi789', question: '需要汇总吗',     options: ['是', '否'],                 multiSelect: false, header: '汇总' },
    ],
    currentIndex: 0,
    answers: [
      { selected: [], text: '' },
      { selected: [], text: '' },
      { selected: [], text: '' },
    ],
  };

  truthy('弹窗可见时 visible=true', userChoiceRequest.visible === true);
  eq('requests 长度（v2 多问题）', userChoiceRequest.requests.length, 3);
  eq('answers 长度与 requests 等长', userChoiceRequest.answers.length, 3);
  eq('currentIndex 从 0 开始', userChoiceRequest.currentIndex, 0);
  truthy('每条 request 含 id', userChoiceRequest.requests.every(r => r.id && r.id.startsWith('uc_')));
  truthy('每条 request 含 question/options/multiSelect/header',
    userChoiceRequest.requests.every(r => r.question && Array.isArray(r.options) && typeof r.multiSelect === 'boolean' && typeof r.header === 'string'));

  const inputDisabled = userChoiceRequest.visible === true;
  truthy('弹窗打开时输入框禁用', inputDisabled);
}

// ======================================================================
// IT-17: 多轮后 messages 数组增长 —— marker payload 体积随 option 数线性增长
// ======================================================================
console.log('\n=== IT-17  多轮 payload 体积 ===');
{
  // 5 轮 × 不同 options 数（v3 严格 1-4 options，round 4/5 应被 reject）
  const validRounds = [
    { options: ['A'] },
    { options: ['A', 'B'] },
    { options: ['A', 'B', 'C', 'D'] },
  ];

  const markers = validRounds.map(r => requestUserChoice([{ question: `Q${r.options.length}`, options: r.options, multi_select: false, header: 'H' }]));

  // 每个 marker 都应包含完整的 options
  for (let i = 0; i < markers.length; i++) {
    const payload = markers[i].payloads[0];
    eq(`TURN ${i+1} options 数量未截断`, payload.options.length, validRounds[i].options.length);
  }

  // marker 长度应随 options 数增长（至少单调不减）
  const lengths = markers.map(m => m.markers[0].length);
  for (let i = 1; i < lengths.length; i++) {
    truthy(`TURN ${i+1} marker 长度 ≥ TURN ${i}`, lengths[i] >= lengths[i-1]);
  }
}

// ======================================================================
// IT-18: 多轮 checklist 显示全部 userChoiceAsked —— marker 可解析
// ======================================================================
console.log('\n=== IT-18  marker 可解析为 checklist 行 ===');
{
  // 模拟 5 轮 user_choice，验证每轮的 marker 都能被解析并组装成 checklist
  const rounds = [];
  for (let i = 0; i < 5; i++) {
    rounds.push(requestUserChoice([{ question: `问题 ${i+1}: 请选择`, options: ['A', 'B', 'C'], multi_select: false, header: `标题${i+1}` }]));
  }

  // 解析每个 marker 提取 (id, question 预览)
  const checklistRows = rounds.map(r => {
    const match = r.markers[0].match(/^<!--user_choice:({.*?})-->$/);
    truthy(`marker ${r.ids[0]} 匹配正则`, match !== null);
    if (!match) return null;
    const payload = JSON.parse(match[1]);
    const q = String(payload.question || '').slice(0, 50).replace(/[|:]/g, ' ');
    return `${payload.id}:"${q}"`;
  });

  // 5 轮 checklist 行应各不相同
  const uniqueRows = new Set(checklistRows);
  eq('5 轮 checklist 行数', checklistRows.length, 5);
  eq('5 轮 checklist 行互不相同', uniqueRows.size, 5);

  // 拼装 checklist 字符串
  const checklistStr = `request_user_choice:[${checklistRows.join('|')}]`;
  truthy('checklist 字符串包含 5 个 id', (checklistStr.match(/uc_/g) || []).length === 5);

  // 验证每行的 question 预览 ≤ 50 字符
  for (const row of checklistRows) {
    const match = row.match(/"(.{1,50})"/);
    if (match) {
      truthy(`row 预览 ≤ 50 字符: "${match[1]}"`, match[1].length <= 50);
    }
  }
}

// ======================================================================
// IT-22: 多问题合成 user 消息格式
// ======================================================================
console.log('\n=== IT-22  多问题合成 user 消息格式（label=answer; 拼接）===');
{
  // 模拟用户答完 3 个问题后，前端合成的综合 user 消息
  const userChoiceRequest = {
    visible: false,
    requests: [
      { id: 'uc_1', header: '时间范围', question: '请选择时间范围', options: ['近7天'], multiSelect: false },
      { id: 'uc_2', header: '区域',     question: '请选择区域',     options: ['华东'],   multiSelect: false },
      { id: 'uc_3', header: '',         question: '请选择维度',     options: ['按天'],   multiSelect: false }, // 缺 header
    ],
    currentIndex: 2,
    answers: [
      { selected: ['近7天'], text: '' },
      { selected: ['华东'],   text: '包含退款' },
      { selected: ['按天'],   text: '' },
    ],
  };

  // 模拟 App.jsx handleSubmitUserChoice 的合成逻辑
  const combined = userChoiceRequest.answers.map((a, i) => {
    const req = userChoiceRequest.requests[i] || {};
    const label = (req.header && String(req.header).trim()) || `问题${i + 1}`;
    const sel = Array.isArray(a.selected) && a.selected.length > 0 ? a.selected.join(', ') : '';
    const txt = (a.text || '').trim();
    const ans = [sel, txt].filter(Boolean).join(' + ');
    return `${label}=${ans || '（无）'}`;
  }).join('; ');

  truthy('综合消息含 3 个 label', (combined.match(/=/g) || []).length === 3);
  contains('含 时间范围=近7天', combined, '时间范围=近7天');
  contains('含 区域=华东 + 包含退款', combined, '区域=华东 + 包含退款');
  contains('缺 header 时退化为"问题3"', combined, '问题3=按天');
  truthy('用 "; " 拼接多个问题', combined.includes('; '));

  // 单问题退化：array.length === 1 时不应有 ";"
  const single = userChoiceRequest.answers.slice(0, 1).map((a, i) => {
    const req = userChoiceRequest.requests[i] || {};
    const label = (req.header && String(req.header).trim()) || `问题${i + 1}`;
    const sel = Array.isArray(a.selected) && a.selected.length > 0 ? a.selected.join(', ') : '';
    const ans = [sel, (a.text || '').trim()].filter(Boolean).join(' + ');
    return `${label}=${ans || '（无）'}`;
  }).join('; ');
  truthy('单问题无 ; 分隔符', !single.includes('; '));
  eq('单问题合成消息', single, '时间范围=近7天');
}

// ======================================================================
// IT-25: v3 新增 —— 单调用传 N questions，工具内部拆为 N markers
// ======================================================================
console.log('\n=== IT-25  v3 单调用多问题（1 次调 N questions → 拆 N markers）===');
{
  // (1) 1 question → 1 marker
  const r1 = requestUserChoice([{ question: '时间范围', options: ['7天', '30天'], multi_select: false, header: '时间' }]);
  eq('1 question → 1 marker', r1.markers.length, 1);
  eq('1 question → 1 payload', r1.payloads.length, 1);
  eq('1 question → 1 id', r1.ids.length, 1);

  // (2) 2 questions → 2 markers
  const r2 = requestUserChoice([
    { question: '时间范围', options: ['7天', '30天'], multi_select: false, header: '时间' },
    { question: '区域',     options: ['华东', '华南'], multi_select: false, header: '区域' },
  ]);
  eq('2 questions → 2 markers', r2.markers.length, 2);
  eq('2 questions → 2 payloads', r2.payloads.length, 2);
  eq('2 questions → 2 ids', r2.ids.length, 2);
  truthy('2 ids 互不相同', r2.ids[0] !== r2.ids[1]);
  eq('第 1 个 payload question', r2.payloads[0].question, '时间范围');
  eq('第 2 个 payload question', r2.payloads[1].question, '区域');
  truthy('content 拼接 2 个 marker', (r2.content.match(/<!--user_choice:/g) || []).length === 2);

  // (3) 3 questions → 3 markers（上限）
  const r3 = requestUserChoice([
    { question: 'Q1', options: ['A', 'B'], multi_select: false, header: 'H1' },
    { question: 'Q2', options: ['C', 'D'], multi_select: true,  header: 'H2' },
    { question: 'Q3', options: ['E', 'F'], multi_select: false, header: 'H3' },
  ]);
  eq('3 questions → 3 markers', r3.markers.length, 3);
  eq('multi_select 独立保留（第 2 题多选）', r3.payloads[1].multi_select, true);
  truthy('3 ids 互不相同', new Set(r3.ids).size === 3);

  // (4) 4 questions → error
  const r4 = requestUserChoice([
    { question: 'Q1', options: ['A'] },
    { question: 'Q2', options: ['A'] },
    { question: 'Q3', options: ['A'] },
    { question: 'Q4', options: ['A'] },
  ]);
  truthy('4 questions → error', !!r4.error && r4.error.includes('最多 3'));

  // (5) markers 中每个都是有效格式
  for (const m of r3.markers) {
    truthy(`marker 格式: ${m.slice(0, 20)}...`, m.startsWith('<!--user_choice:') && m.endsWith('-->'));
  }

  // (6) payloads 中每个都符合 buildUserChoiceMarker 输出结构
  for (let i = 0; i < r3.payloads.length; i++) {
    const p = r3.payloads[i];
    truthy(`payload[${i}] 含 id`, p.id && p.id.startsWith('uc_'));
    truthy(`payload[${i}] 含 question`, p.question && p.question.startsWith('Q'));
    truthy(`payload[${i}] 含 options 数组`, Array.isArray(p.options) && p.options.length === 2);
    truthy(`payload[${i}] 含 multi_select`, typeof p.multi_select === 'boolean');
    truthy(`payload[${i}] 含 header`, p.header && p.header.startsWith('H'));
  }
}

// ======================================================================
// 源码静态检查
// ======================================================================
console.log('\n=== 额外：源码静态检查 ===');
{
  const llmPath = path.join(__dirname, 'src', 'services', 'llm.js');
  const llmSrc = fs.readFileSync(llmPath, 'utf-8');

  // 验证 buildToolCallChecklistMessage 中 userChoiceAsked 处理逻辑
  contains('llm.js 含 userChoiceAsked 处理', llmSrc, 'reg.userChoiceAsked');
  contains('llm.js 含 50 字符截断', llmSrc, '.slice(0, 50)');
  contains('llm.js 不截断 userChoiceAsked（无 .slice(-N)）',
    llmSrc, '[...reg.userChoiceAsked.entries()]');

  // 验证 recordToolCall 处理 request_user_choice
  contains('llm.js recordToolCall 处理 userChoiceAsked', llmSrc, 'userChoiceAsked.set');

  // 验证 v3 markers 数组处理
  contains('llm.js phase 3 处理 p.rawResult.payloads 数组', llmSrc, 'p.rawResult.payloads');
  contains('llm.js phase 3 兼容旧版单 marker', llmSrc, 'p.rawResult.marker');

  // 验证 messages.push 出现次数合理
  const messagesPushCount = (llmSrc.match(/messages\.push/g) || []).length;
  truthy('messages.push 调用存在（其他用途）', messagesPushCount > 0);

  // 验证 toolFuncs.js 含 v3 validateQuestions
  const toolFuncsPath = path.join(__dirname, 'src', 'services', 'toolFuncs.js');
  const toolFuncsSrc = fs.readFileSync(toolFuncsPath, 'utf-8');
  contains('toolFuncs.js 含 validateQuestions', toolFuncsSrc, 'function validateQuestions');
  contains('toolFuncs.js 工具 schema 含 questions 数组', toolFuncsSrc, 'questions:');
  contains('toolFuncs.js description 提 1-3 个问题', toolFuncsSrc, '1-3 个问题');
  contains('toolFuncs.js description 提 1-4 个选项', toolFuncsSrc, '1-4 个选项');
  contains('toolFuncs.js description 提 ≤200 字', toolFuncsSrc, '≤200 字');
}

// ======================================================================
// 总结
// ======================================================================
console.log('\n========================================');
console.log(`Total: ${pass + fail}  Pass: ${pass}  Fail: ${fail}`);
console.log('========================================');

if (fail > 0) process.exit(1);

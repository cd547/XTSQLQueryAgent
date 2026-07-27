// 模拟新合并逻辑
function buildCombined(requests, answers) {
  const answeredParts = [];
  const skippedLabels = [];
  answers.forEach((a, i) => {
    const req = requests[i] || {};
    const label = (req.header && String(req.header).trim()) || `问题${i + 1}`;
    const sel = Array.isArray(a.selected) && a.selected.length > 0 ? a.selected.join(', ') : '';
    const txt = (a.text || '').trim();
    const isAnswered = sel !== '' || txt !== '';
    if (isAnswered) {
      const ans = [sel, txt].filter(Boolean).join(' + ');
      answeredParts.push(`${label}=${ans}`);
    } else {
      skippedLabels.push(label);
    }
  });
  let combined = answeredParts.join('; ');
  if (skippedLabels.length > 0) {
    const skipNote = `（用户跳过了 ${skippedLabels.length} 个问题：${skippedLabels.join('、')}）`;
    combined = combined ? `${combined}\n${skipNote}` : skipNote;
  }
  return combined || '用户未回答';
}

const requests = [
  { header: '有效创建时间' },
  { header: '最新创建时间' },
  { header: '负责人所属校区' }
];

console.log('=== 场景1: Q1+Q3 已答, Q2 跳过（用户报的场景）===');
console.log(buildCombined(requests, [
  { selected: ['customer_clue_info.create_time'], text: '' },
  { selected: [], text: '' },
  { selected: ['线索归属校区'], text: '' }
]));
console.log();

console.log('=== 场景2: 全部已答 ===');
console.log(buildCombined(requests, [
  { selected: ['A1'], text: '' },
  { selected: ['A2'], text: '' },
  { selected: ['A3'], text: '' }
]));
console.log();

console.log('=== 场景3: 全部跳过 ===');
console.log(buildCombined(requests, [
  { selected: [], text: '' },
  { selected: [], text: '' },
  { selected: [], text: '' }
]));
console.log();

console.log('=== 场景4: Q2 用文本框回答 ===');
console.log(buildCombined(requests, [
  { selected: ['A1'], text: '' },
  { selected: [], text: '看具体业务' },
  { selected: ['A3'], text: '' }
]));
console.log();

console.log('=== 场景5: header 缺失退化 ===');
console.log(buildCombined(
  [{ header: 'A' }, {}, { header: 'C' }],
  [
    { selected: ['x'], text: '' },
    { selected: [], text: '' },
    { selected: ['z'], text: '' }
  ]
));
console.log();

console.log('=== 场景6: 多选项 + 文本混合 ===');
console.log(buildCombined(requests, [
  { selected: ['A1', 'A2'], text: '补充说明' },
  { selected: [], text: '' },
  { selected: ['A3'], text: '' }
]));

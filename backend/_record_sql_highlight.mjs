const fs = require('fs');
const p = 'docs/superpowers/changelog/CHANGELOG.md';
const before = fs.readFileSync(p, 'utf-8');
const eol = before.includes('\r\n') ? '\r\n' : '\n';
let body = before.replace(/\r\n/g, '\n');

const newEntry = `### Bugfix：SQL 代码块高亮失效排查（未复现，疑似缓存）

#### 现象
用户报告 LLM 输出的 SQL 代码块（markdown \`\`\`sql 围栏）没有语法高亮，全部字符同色。

#### 排查过程
1. **初始修复（已落地）**：[markdownRenderers.jsx](../../frontend/src/components/markdownRenderers.jsx) Code 组件
   - 原来只在 \`className\` 含 \`language-xxx\` 时才走 SyntaxHighlighter
   - 加 LLM 启发式兜底：块级 code + 无 language- + 内容以 SQL 关键字开头 → 用 SQL 高亮
   - 加 children 安全转换（防 React 元素数组被 \`String()\` 错误转成 \`"SELECT ,id"\`）
2. **CSS 检查**：[App.css](../../frontend/src/App.css) L758 \`.xtsql-msg-bubble pre code { color: inherit }\`
   - 经分析不影响 token span 颜色（inline style 优先级最高）
   - 保留不动
3. **库自测**：用 refractor + react-syntax-highlighter 模拟渲染 SQL
   - 实际输出包含 \`<span class="token" style="color:#569CD6">SELECT</span>\`
   - **理论一定会高亮**

#### 结论
代码逻辑正确。最可能根因：**Electron/vite 模块缓存**导致用户加载了旧 bundle，重启后未复现。

#### 修复
- [markdownRenderers.jsx](../../frontend/src/components/markdownRenderers.jsx) — Code 组件增强（已生效）
- 用户操作：**重启 Electron 后正常**

#### 状态
⚠️ **未复现 / 观察中**。若再次复现，需用户反馈具体现象：
- A：SQL 块无框、无 monospace 字体 → 根本没进 SyntaxHighlighter
- B：有框 + monospace，但字符同色 → 进 SyntaxHighlighter 但 token 颜色未应用

A/B 修复方向完全不同。

---

`;

if (body.includes('### 新增功能：我的查询（收藏常用 SQL）')) {
  body = body.replace('### 新增功能：我的查询（收藏常用 SQL）', newEntry + '### 新增功能：我的查询（收藏常用 SQL）');
} else if (body.includes('## 2026-07-01')) {
  // fallback: insert after the date header
  body = body.replace('## 2026-07-01\n\n', '## 2026-07-01\n\n' + newEntry);
}

if (eol === '\r\n') body = body.replace(/\n/g, '\r\n');
fs.writeFileSync(p, body, 'utf-8');
const after = fs.readFileSync(p, 'utf-8');
console.log('CHANGED:', after !== before);
console.log('has new entry:', after.includes('### Bugfix：SQL 代码块高亮失效排查（未复现，疑似缓存）'));
console.log('total lines:', after.split('\n').length);

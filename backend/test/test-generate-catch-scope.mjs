// 回归测试：/generate 流式累积变量必须声明在 try 块之外（2026-08-25 Bug 修复）
//
// 背景：原代码把 fullContent/sql/message/totalTokens/messageSaved/lastRound 等
//   声明在 try 块内，而下方 catch 块引用它们 → 一进 catch 就抛
//   ReferenceError: messageSaved is not defined → 真实错误被吞 +
//   中断 partial 落库成为死代码。
// 本测试做静态结构断言：
//   1. 声明位置必须早于包裹 runSqlAgent 调用的那个 try {
//   2. 声明与 catch 之间不允许再出现同名 let 重新声明（防"改回去"）
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'src', 'routes', 'query.js'), 'utf8');

function expect(name, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${name}: 实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`);
  if (!ok) process.exitCode = 1;
}

// 定位 /generate 的 CC 分支：以 "const generator = runSqlAgent(" 为锚点
const anchor = src.indexOf('const generator = runSqlAgent(');
expect('找到 runSqlAgent 调用锚点', anchor > 0, true);

// 锚点之前、最近的声明块：let fullContent 必须出现在锚点之前（即 try 之外）
const declIdx = src.lastIndexOf("let fullContent = ''", anchor);
expect('fullContent 声明位于 runSqlAgent 调用之前（try 外）', declIdx > -1 && declIdx < anchor, true);

// 从锚点向后找第一个 "} catch (error)" —— 声明与 catch 之间不得再有 let fullContent/messageSaved 重声明
const catchIdx = src.indexOf('} catch (error) {', anchor);
expect('找到对应 catch 块', catchIdx > anchor, true);

const between = src.slice(anchor, catchIdx);
expect('锚点与 catch 之间无 fullContent 重声明（未改回 try 内）', !between.includes("let fullContent"), true);
expect('锚点与 catch 之间无 messageSaved 重声明（未改回 try 内）', !between.includes('let messageSaved'), true);

// catch 内确实还引用这些变量（保证 partial 落库逻辑仍在）
const catchBody = src.slice(catchIdx, catchIdx + 4000);
expect('catch 内仍引用 messageSaved（partial 落库守卫健在）', catchBody.includes('messageSaved'), true);
expect('catch 内仍引用 fullContent（partial 内容来源健在）', catchBody.includes('fullContent'), true);

console.log('\n全部通过');

/**
 * CODE-3 修复单元测试：ensureDir helper
 *
 * 覆盖 3 个场景：
 *   A. 目录不存在 → 成功创建
 *   B. 目录已存在（EEXIST）→ 不抛错，静默
 *   C. 真实错误（权限不足等）→ log + rethrow
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureDir } from './src/utils/fs.js';

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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-dir-test-'));
console.log(`Test root: ${root}\n`);

console.log('=== A. 目录不存在 → 成功创建 ===');
{
  const target = path.join(root, 'fresh', 'nested', 'deeper');
  ensureDir(target, 'test');
  truthy('目录已创建', fs.existsSync(target));
  truthy('是目录', fs.statSync(target).isDirectory());
}

console.log('\n=== B. 目录已存在（EEXIST）→ 不抛错 ===');
{
  const target = path.join(root, 'exists');
  fs.mkdirSync(target, { recursive: true });
  let threw = false;
  try { ensureDir(target, 'test'); } catch (_) { threw = true; }
  eq('目录已存在时 ensureDir 不抛错', threw, false);
  truthy('目录仍在', fs.existsSync(target));
}

console.log('\n=== C. 真实错误（路径冲突：当成文件路径的子目录）→ rethrow ===');
{
  // 构造：把 target 设为已存在的文件路径，mkdirSync 应当抛 EEXIST（文件形式）
  // 这种情况 ensureDir 会静默（EEXIST 分支），所以不测
  // 改测：尝试在只读文件系统上创建
  // Windows 上无简单方式触发 EACCES（无 chmod 概念），改测不可写路径
  // 用一个非字符串参数触发 TypeError
  let threw = false;
  let err = null;
  try { ensureDir(null, 'test'); } catch (e) { threw = true; err = e; }
  truthy('传入 null 抛错', threw);
  truthy('错误被抛出', err !== null);
}

console.log('\n=== D. 边界：传入非路径对象（数字、数组）应抛错 ===');
{
  for (const bad of [123, [], {}, true]) {
    let threw = false;
    try { ensureDir(bad, 'test'); } catch (_) { threw = true; }
    truthy(`传入 ${JSON.stringify(bad)} 时抛错`, threw);
  }
}

console.log('\n=== E. 验证不再静默吞错（关键修复点） ===');
{
  // 模拟一个能产生非 EEXIST 错误的场景：
  // 在 Windows 下，路径里包含非法字符（如 \0）会抛 EINVAL
  // 验证 ensureDir 把这种错误抛出而不是吞掉
  const target = path.join(root, 'sub');
  fs.mkdirSync(target);
  // 在已存在的路径上"覆盖"一个同名文件，mkdirSync 应当抛 EEXIST（被吞，预期）
  // 但如果 target 是文件而不是目录，mkdirSync({ recursive: true }) 在已存在情况下也不报错
  // 真正能验证的是：把 target 设为不可写的子路径
  // 这里用 root 目录里的一个文件，再尝试 mkdir 它的"子目录"
  const file = path.join(target, 'file');
  fs.writeFileSync(file, 'x');
  // 尝试创建 file/sub —— file 不是目录，应当抛 ENOTDIR
  const blocked = path.join(file, 'sub');
  let threw = false;
  let err = null;
  try { ensureDir(blocked, 'test'); } catch (e) { threw = true; err = e; }
  truthy('在文件路径下创建子目录抛错（非 EEXIST 的真错误）', threw);
  truthy('错误码不是 EEXIST', err && err.code !== 'EEXIST');
  truthy('错误有 code 字段', err && typeof err.code === 'string');
}

fs.rmSync(root, { recursive: true, force: true });

console.log(`\n=========================================`);
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log(`=========================================`);

if (fail > 0) {
  console.log(`\n有 ${fail} 条失败`);
  process.exit(1);
} else {
  console.log(`\nALL TESTS PASSED`);
  process.exit(0);
}

/**
 * PERF-5 修复单元测试：Skill 树缓存
 *
 * 覆盖 6 个场景：
 *   A. 首次调用 build tree，第二次调用命中缓存
 *   B. 新增文件 → 300ms 内 fs.watch 触发失效 → 下次调用 rebuild
 *   C. 修改文件 → fs.watch 触发失效 → 下次调用 rebuild
 *   D. 删除文件 → fs.watch 触发失效 → 下次调用 rebuild
 *   E. invalidateAfterWrite() 显式失效
 *   F. mtime 兜底：直接修改文件后 fs.watch 漏事件，下次调用也 rebuild
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createSkillTreeCache } from './src/services/skillCache.js';

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

function deepCount(nodes) {
  let n = 0;
  for (const node of nodes) {
    n++;
    if (node.children) n += deepCount(node.children);
  }
  return n;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBuildTree() {
  let calls = 0;
  const buildTree = (dir) => {
    calls++;
    const items = [];
    if (!fs.existsSync(dir)) return items;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'skill_back') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        items.push({ key: entry.name, title: entry.name, isFolder: true, children: buildTree(fullPath) });
      } else {
        items.push({ key: entry.name, title: entry.name, isFolder: false, isLeaf: true });
      }
    }
    return items;
  };
  return { buildTree, getCalls: () => calls };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cache-test-'));
  console.log(`Test dir: ${tmpDir}\n`);

  // 初始化测试目录：2 个文件 + 1 个子目录（含 1 文件）
  fs.writeFileSync(path.join(tmpDir, 'a.md'), 'aaa');
  fs.writeFileSync(path.join(tmpDir, 'b.md'), 'bbb');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'c.md'), 'ccc');

  const { buildTree, getCalls } = makeBuildTree();
  const cache = createSkillTreeCache(tmpDir, buildTree);

  // warmup：让 fs.watch 初始事件 settle
  await sleep(500);
  cache.get();  // 第一次 get 初始化缓存
  await sleep(500);  // 让 debounce settle
  // 重置计数器，从干净状态开始测
  const baseCalls = getCalls();

  console.log('=== A. 命中缓存 ===');
  const t1 = cache.get();
  const t2 = cache.get();
  const t3 = cache.get();
  eq('连续 3 次 get 返回同一对象（命中缓存，未触发 rebuild）', t1 === t2 && t2 === t3, true);

  console.log('\n=== B. 新增文件 → fs.watch 触发失效 ===');
  sleep(500);
  fs.writeFileSync(path.join(tmpDir, 'new.md'), 'new');
  await sleep(600);  // 300ms 防抖 + buffer
  const beforeB = getCalls();
  const tB = cache.get();
  truthy('新增文件后 buildTree 被重新调用', getCalls() > beforeB);
  truthy('新树包含 new.md（节点数 +1）', deepCount(tB.tree) === deepCount(t1.tree) + 1);

  console.log('\n=== C. 修改文件 → fs.watch 触发失效 ===');
  sleep(500);
  fs.writeFileSync(path.join(tmpDir, 'a.md'), 'aaa-modified');
  await sleep(600);
  const beforeC = getCalls();
  const tC = cache.get();
  truthy('修改后 buildTree 被重新调用', getCalls() > beforeC);
  truthy('缓存对象已更新（mtime 变化）', tC !== t1);

  console.log('\n=== D. 删除文件 → fs.watch 触发失效 ===');
  sleep(500);
  fs.unlinkSync(path.join(tmpDir, 'b.md'));
  await sleep(600);
  const beforeD = getCalls();
  const tD = cache.get();
  truthy('删除后 buildTree 被重新调用', getCalls() > beforeD);
  truthy('新树节点数 = 旧节点数 - 1（删了 b.md）', deepCount(tD.tree) === deepCount(t1.tree));

  console.log('\n=== E. invalidateAfterWrite 显式失效 ===');
  const beforeE = getCalls();
  cache.invalidateAfterWrite();
  cache.get();
  truthy('显式失效后 buildTree 被重新调用', getCalls() > beforeE);

  console.log('\n=== F. mtime 兜底：直接修改后 fs.watch 漏事件 ===');
  // 模拟 watcher 漏事件场景：缓存有内容，直接改 mtime 跳过 watcher
  const beforeF = getCalls();
  const cached1 = cache.get();
  // 改 mtime 但不动 watcher（直接 stat + utimes）
  const future = new Date(Date.now() + 10_000);
  fs.utimesSync(tmpDir, future, future);
  // 不等 watcher（立即调用）
  const cached2 = cache.get();
  truthy('mtime 变化后下次调用强制 rebuild', getCalls() > beforeF);
  truthy('返回新对象', cached1 !== cached2);

  cache.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

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
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});

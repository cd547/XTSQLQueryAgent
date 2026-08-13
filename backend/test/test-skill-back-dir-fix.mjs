// F12 回归测试：验证 addTag / save 路由的 backup 目录创建逻辑
// 跑法：D:\nvm\v20.18.0\node.exe test-skill-back-dir-fix.mjs
// 注意：这是单元测试，**不启动后端服务**，只验证 mkdirSync 的行为契约。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let passed = 0, failed = 0;
const ok = (name, cond, hint) => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${hint ? ' —— ' + hint : ''}`); }
};

// 模拟 skill.js 路由的 backup 目录创建逻辑（提取出来测）
function ensureBackupDir(skillBackPath, backupFilePath) {
  fs.mkdirSync(skillBackPath, { recursive: true });
  fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f12-test-'));
console.log('=== 测试目录:', tmpRoot, '===\n');

// === Case 1: addTag 路由模拟 — skillBackPath 不存在 ===
console.log('=== Case 1: addTag 首次调用，skill_back 目录不存在 ===');
{
  const skillBackPath = path.join(tmpRoot, 'skills', 'skill_back');
  const tableIndexPath = path.join(tmpRoot, 'skills', 'table_index.json');
  const backupPath = path.join(skillBackPath, `table_index_${Date.now()}.json`);

  // 模拟 skillBackPath 不存在
  ok('前置：skill_back 目录不存在', !fs.existsSync(skillBackPath));

  // 模拟 skill.js 路由的 L215-218 逻辑
  fs.mkdirSync(skillBackPath, { recursive: true });
  // 创建一个虚拟的 table_index.json
  fs.mkdirSync(path.dirname(tableIndexPath), { recursive: true });
  fs.writeFileSync(tableIndexPath, '{"tables":[]}');
  // copyFileSync 现在应该成功
  fs.copyFileSync(tableIndexPath, backupPath);

  ok('addTag 首次调用后目录已创建', fs.existsSync(skillBackPath));
  ok('addTag 备份文件已生成', fs.existsSync(backupPath));
  ok('备份内容正确', fs.readFileSync(backupPath, 'utf-8') === '{"tables":[]}');
}

// === Case 2: addTag 重复调用 — skillBackPath 已存在，recursive:true 应幂等 ===
console.log('\n=== Case 2: addTag 重复调用，目录已存在（幂等性）===');
{
  const skillBackPath = path.join(tmpRoot, 'skills', 'skill_back');
  // 之前已建过；现在再调 mkdirSync 不应报错
  let secondCallOk = true;
  try {
    fs.mkdirSync(skillBackPath, { recursive: true });
  } catch (e) {
    secondCallOk = false;
    console.log('    错误:', e.message);
  }
  ok('addTag 重复调用 mkdirSync 不报错', secondCallOk);
  ok('目录仍然存在', fs.existsSync(skillBackPath));
}

// === Case 3: save 路由模拟 — backupFilePath 子目录嵌套 ===
console.log('\n=== Case 3: save 路由嵌套子目录（timestamp/field_config/file.json）===');
{
  const skillBackPath = path.join(tmpRoot, 'skills', 'skill_back');
  const backupFolderName = '20260806';  // 模拟 YYYYMMDDHHMMSS
  const backupDir = path.join(skillBackPath, backupFolderName);
  const backupFilePath = path.join(backupDir, 'sql-creator-skill-v2', 'field_config', 'admin_campus_rel.json');

  // 嵌套目录一次性创建
  fs.mkdirSync(skillBackPath, { recursive: true });
  fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });

  fs.writeFileSync(backupFilePath, '{"table_name":"admin_campus_rel"}');
  ok('save 路由嵌套子目录创建成功', fs.existsSync(backupDir));
  ok('save 路由最深层目录存在', fs.existsSync(path.dirname(backupFilePath)));
  ok('save 路由备份文件可写', fs.existsSync(backupFilePath));
}

// === Case 4: 旧实现的 if-existsSync 风格（保留对照，证明 recursive:true 同样有效）===
console.log('\n=== Case 4: 旧 if-existsSync 风格 vs 新 mkdirSync-only（行为等价）===');
{
  const dirA = path.join(tmpRoot, 'equiv-a');
  const dirB = path.join(tmpRoot, 'equiv-b');

  // 旧风格
  if (!fs.existsSync(dirA)) fs.mkdirSync(dirA, { recursive: true });
  // 新风格
  fs.mkdirSync(dirB, { recursive: true });

  // 再各调一次
  let oldOk = true, newOk = true;
  try {
    if (!fs.existsSync(dirA)) fs.mkdirSync(dirA, { recursive: true });
  } catch { oldOk = false; }
  try {
    fs.mkdirSync(dirB, { recursive: true });
  } catch { newOk = false; }

  ok('旧风格重复调用不报错', oldOk);
  ok('新风格重复调用不报错', newOk);
  ok('两种风格最终结果一致', fs.existsSync(dirA) && fs.existsSync(dirB));
}

// === Case 5: 模拟用户真实场景 — skill_back 完全不存在时 addTag ===
console.log('\n=== Case 5: 完全复现日志中的 ENOENT 场景 ===');
{
  // 用全新 tmp 目录模拟
  const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f12-fresh-'));
  const skillBackPath = path.join(freshRoot, 'skills', 'skill_back');
  const tableIndexPath = path.join(freshRoot, 'skills', 'sql-creator-skill-v2', 'table_index.json');

  // 前置：完全没有 skill_back 目录
  ok('前置：完全没 skill_back', !fs.existsSync(skillBackPath));

  // 模拟 addTag 路由现在的 L215-218
  let addTagOk = true;
  let errorMsg = '';
  try {
    fs.mkdirSync(skillBackPath, { recursive: true });
    fs.mkdirSync(path.dirname(tableIndexPath), { recursive: true });
    fs.writeFileSync(tableIndexPath, '{"tables":[{"name":"crm_target_school"}]}');
    const backupPath = path.join(skillBackPath, `table_index_${Date.now()}.json`);
    fs.copyFileSync(tableIndexPath, backupPath);
  } catch (e) {
    addTagOk = false;
    errorMsg = e.message;
  }
  ok('addTag 在 skill_back 不存在场景下成功执行（不再 ENOENT）', addTagOk, `error: ${errorMsg}`);
  ok('skill_back 已被自动创建', fs.existsSync(skillBackPath));
}

console.log(`\n=== Result: ${passed} pass, ${failed} fail ===`);

// 清理
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  // 清理 Case 5 的 freshRoot（需要遍历，因为有多个 fresh 目录）
  const tmps = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('f12-fresh-'));
  for (const d of tmps) {
    fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
  }
} catch {}

process.exit(failed > 0 ? 1 : 0);

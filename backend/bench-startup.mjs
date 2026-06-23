// 测量冷启动：node src/index.js 启动到 "Server running on port" 输出
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const start = Date.now();

// 自动找 nvm-windows 下的 v24 node
function findNvm24() {
  const nvmHome = process.env['NVM_HOME'] || path.join(process.env['LOCALAPPDATA'] || '', 'nvm');
  if (!fs.existsSync(nvmHome)) return null;
  const entries = fs.readdirSync(nvmHome, { withFileTypes: true });
  const v24 = entries
    .filter(e => e.isDirectory() && /^v24\.\d+\.\d+/.test(e.name))
    .map(e => e.name)
    .sort();
  return v24[0] ? path.join(nvmHome, v24[0], 'node.exe') : null;
}

const nodeBin = process.argv[2] || 'node';
const useLargeEnv = process.argv[3] === 'big-env';

console.log(`[setup] node binary: ${nodeBin}`);
console.log(`[setup] use large env: ${useLargeEnv}`);
console.log(`[setup] nvm24 candidate: ${findNvm24() || '(none)'}`);

let env = { ...process.env };
if (useLargeEnv) {
  // 模拟 Electron 的超大 env（添加 200 个 fake 变量）
  for (let i = 0; i < 200; i++) {
    env[`ELECTRON_FAKE_VAR_${i}`] = 'x'.repeat(100);
  }
  console.log(`[setup] env vars: ${Object.keys(env).length}`);
}

const proc = spawn(nodeBin, ['src/index.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: env
});

console.log(`[T+${Date.now() - start}ms] spawned, pid=${proc.pid}`);

let resolved = false;
const finish = (label) => {
  if (resolved) return;
  resolved = true;
  console.log(`[T+${Date.now() - start}ms] ${label}`);
  proc.kill();
  setTimeout(() => process.exit(0), 100);
};

proc.stdout.on('data', (data) => {
  const elapsed = Date.now() - start;
  const text = data.toString();
  console.log(`[T+${elapsed}ms] stdout: ${text.trim()}`);
  if (/Server running on port/i.test(text)) {
    finish('Server running detected');
  }
});

proc.stderr.on('data', (data) => {
  console.log(`[T+${Date.now() - start}ms] stderr: ${data.toString().trim()}`);
});

proc.on('exit', (code) => {
  console.log(`[T+${Date.now() - start}ms] process exit code=${code}`);
  if (!resolved) process.exit(0);
});

setTimeout(() => {
  finish('TIMEOUT after 60s');
}, 60000);

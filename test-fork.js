const { fork } = require('child_process');
const path = require('path');

const backendPath = path.join(__dirname, 'dist/win-unpacked/resources/app.asar.unpacked/backend/src/index.js');
const backendCwd = path.join(__dirname, 'dist/win-unpacked/resources/app.asar.unpacked/backend');

console.log('Testing fork with backend...');
console.log('Backend path:', backendPath);
console.log('Backend cwd:', backendCwd);

const child = fork(backendPath, [], {
  cwd: backendCwd,
  env: {
    ...process.env,
    DB_PATH: path.join(__dirname, 'test-db-fork.db')
  },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc']
});

child.stdout.on('data', (data) => {
  console.log('Backend stdout:', data.toString());
});

child.stderr.on('data', (data) => {
  console.error('Backend stderr:', data.toString());
});

child.on('close', (code) => {
  console.log('Backend process exited with code:', code);
});

child.on('error', (error) => {
  console.error('Error forking backend:', error);
});

console.log('Forked successfully, waiting for output...');

setTimeout(() => {
  console.log('Timeout reached');
  console.log('Is child still alive?', child.connected);
}, 10000);

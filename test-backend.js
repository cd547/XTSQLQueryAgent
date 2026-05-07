const { spawn } = require('child_process');
const path = require('path');

const backendPath = path.join(__dirname, 'dist/win-unpacked/resources/app.asar.unpacked/backend/src/index.js');
const backendCwd = path.join(__dirname, 'dist/win-unpacked/resources/app.asar.unpacked/backend');

console.log('Testing backend startup...');
console.log('Backend path:', backendPath);
console.log('Backend cwd:', backendCwd);
console.log('Node execPath:', process.execPath);

const child = spawn(process.execPath, [backendPath], {
  cwd: backendCwd,
  env: {
    ...process.env,
    DB_PATH: path.join(__dirname, 'test-db.db'),
    ELECTRON_RUN_AS_NODE: '1'
  },
  stdio: ['pipe', 'pipe', 'pipe']
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
  console.error('Error spawning backend:', error);
});

console.log('Backend spawned, waiting for output...');

setTimeout(() => {
  console.log('Timeout reached, checking if backend is running...');
}, 5000);

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const appPath = path.join(__dirname, 'dist/win-unpacked/XTSQLQueryAgent.exe');

console.log('Starting packaged app...');
console.log('App path:', appPath);

const appProcess = spawn(appPath, [], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
});

appProcess.stdout.on('data', (data) => {
  console.log('App stdout:', data.toString());
});

appProcess.stderr.on('data', (data) => {
  console.log('App stderr:', data.toString());
});

appProcess.on('close', (code) => {
  console.log('App process exited with code:', code);
});

let checkCount = 0;
const maxChecks = 20;

function checkBackend() {
  const tester = net.createServer()
    .once('error', () => {
      console.log('Port 5002 is in use - backend is running!');
      console.log('SUCCESS: Backend started successfully!');
      
      setTimeout(() => {
        console.log('Killing app process...');
        try {
          process.kill(-appProcess.pid, 'SIGTERM');
        } catch (e) {
          console.log('Process already exited');
        }
      }, 2000);
    })
    .once('listening', () => {
      tester.once('close', () => {
        checkCount++;
        if (checkCount < maxChecks) {
          console.log(`Backend not ready yet (${checkCount}/${maxChecks}), retrying...`);
          setTimeout(checkBackend, 1000);
        } else {
          console.log('FAILED: Backend did not start within timeout');
          try {
            process.kill(-appProcess.pid, 'SIGTERM');
          } catch (e) {
            console.log('Process already exited');
          }
        }
      }).close();
    })
    .listen(5002, '127.0.0.1');
}

setTimeout(checkBackend, 3000);

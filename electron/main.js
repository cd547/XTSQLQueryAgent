const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');

let mainWindow;
let backendProcess;

// 检测端口以防冲突
function checkPort(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => {
        tester.once('close', () => resolve(false)).close();
      })
      .listen(port, host);
  });
}

async function startBackend() {
  const isPortUsed = await checkPort(5002, '127.0.0.1');
  if (isPortUsed) {
    console.log('Backend already running on port 5002');
    return;
  }
  
  backendProcess = spawn('node', [path.join(__dirname, '../backend/src/index.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { 
      ...process.env, 
      DB_PATH: path.join(app.getPath('userData'), 'app.db') 
    }
  });
  
  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 生产环境加载打包后的前端，开发环境加载 Vite
  const startUrl = app.isPackaged 
    ? `file://${path.join(__dirname, '../frontend/dist/index.html')}`
    : 'http://localhost:5173';
    
  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => (mainWindow = null));
}

app.on('ready', async () => {
  await startBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

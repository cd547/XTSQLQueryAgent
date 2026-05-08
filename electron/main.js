const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

let mainWindow;
let backendProcess;

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

function getSystemNodePath() {
  if (process.platform === 'win32') {
    const possiblePaths = [
      process.env['ProgramFiles'] + '\\nodejs\\node.exe',
      process.env['ProgramFiles(x86)'] + '\\nodejs\\node.exe',
      process.env['USERPROFILE'] + '\\AppData\\Roaming\\npm\\node.exe',
      'node.exe'
    ];
    for (const nodePath of possiblePaths) {
      if (fs.existsSync(nodePath)) {
        console.log('Found node at:', nodePath);
        return nodePath;
      }
    }
    console.log('Using system PATH to find node');
    return 'node.exe';
  } else {
    return '/usr/bin/node';
  }
}

async function startBackend() {
  const isPortUsed = await checkPort(5002, '127.0.0.1');
  if (isPortUsed) {
    console.log('Backend already running on port 5002');
    return true;
  }
  
  let projectRoot;
  if (app.isPackaged) {
    projectRoot = path.dirname(path.dirname(path.dirname(app.getPath('exe'))));
  } else {
    projectRoot = path.join(__dirname, '..');
  }
  const dataPath = path.join(projectRoot, 'data');
  const dbPath = path.join(dataPath, 'app.db');
  
  try {
    fs.mkdirSync(dataPath, { recursive: true });
    console.log(`Created database directory: ${dataPath}`);
  } catch (e) {
    console.error('Failed to create database directory:', e);
    return false;
  }
  
  console.log(`Database path: ${dbPath}`);
  
  try {
    fs.accessSync(dataPath, fs.constants.W_OK);
    console.log('Database directory is writable');
  } catch (e) {
    console.error('Database directory is not writable:', e);
    return false;
  }
  
  let backendPath;
  let backendCwd;
  let nodePath;
  
  if (app.isPackaged) {
    const resourcesPath = path.dirname(app.getAppPath());
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');
    const packagedBackendPath = path.join(unpackedPath, 'backend', 'src', 'index.js');
    const projectBackendPath = path.join(projectRoot, 'backend', 'src', 'index.js');
    
    // 优先使用项目根目录下的后端（便携版设计）
    if (fs.existsSync(projectBackendPath)) {
      backendPath = projectBackendPath;
      backendCwd = path.join(projectRoot, 'backend');
      console.log('Using backend from project root (portable mode)');
    } else if (fs.existsSync(packagedBackendPath)) {
      // 备用：使用打包时的后端
      backendPath = packagedBackendPath;
      backendCwd = path.join(unpackedPath, 'backend');
      console.log('Using backend from packaged files');
    } else {
      console.error('Backend file not found in both locations:', projectBackendPath, packagedBackendPath);
      return false;
    }
    
    nodePath = getSystemNodePath();
    
    console.log(`=== Production Mode ===`);
    console.log(`App path: ${app.getAppPath()}`);
    console.log(`Project root: ${projectRoot}`);
    console.log(`Backend path: ${backendPath}`);
    console.log(`Backend cwd: ${backendCwd}`);
    console.log(`Node path: ${nodePath}`);
  } else {
    backendPath = path.join(__dirname, '../backend/src/index.js');
    backendCwd = path.join(__dirname, '..');
    nodePath = 'node';
    
    console.log(`=== Development Mode ===`);
    console.log(`Backend path: ${backendPath}`);
    console.log(`Backend cwd: ${backendCwd}`);
    console.log(`Node path: ${nodePath}`);
  }
  
  console.log('Backend file exists');
  
  return new Promise((resolve) => {
    const env = { 
      ...process.env, 
      DB_PATH: dbPath 
    };
    
    console.log('Starting backend with spawn...');
    console.log('Environment variables:', JSON.stringify({ DB_PATH: env.DB_PATH }));
    
    env.PROJECT_ROOT = projectRoot;
    env.SKILL_PATH = path.join(projectRoot, 'skills');
    env.LOG_PATH = path.join(projectRoot, 'logs');
    
    backendProcess = spawn(nodePath, [backendPath], {
      cwd: backendCwd,
      env: env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    
    backendProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`);
      if (code !== 0) {
        console.error('Backend process failed with code:', code);
      }
    });
    
    backendProcess.on('error', (error) => {
      console.error('Failed to spawn backend process:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      resolve(false);
    });
    
    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`Backend stdout: ${output}`);
      
      if (output.includes('Server running on port')) {
        console.log('Backend started successfully!');
        resolve(true);
      }
    });
    
    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend stderr: ${data.toString()}`);
    });
    
    console.log('Waiting for backend to start...');
    
    setTimeout(() => {
      console.log('Backend startup timeout');
      resolve(false);
    }, 15000);
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

  const startUrl = app.isPackaged 
    ? `file://${path.join(__dirname, '../frontend/dist/index.html')}`
    : 'http://localhost:5173';
    
  console.log('Loading URL:', startUrl);
  mainWindow.loadURL(startUrl);
  
  if (app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => (mainWindow = null));
}

app.on('ready', async () => {
  console.log('App is ready');
  console.log('isPackaged:', app.isPackaged);
  console.log('__dirname:', __dirname);
  
  const backendStarted = await startBackend();
  
  if (backendStarted) {
    console.log('Creating window...');
    createWindow();
  } else {
    console.error('Failed to start backend, exiting...');
    setTimeout(() => {
      app.quit();
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
      console.log('Backend process killed');
    } catch (e) {
      console.error('Failed to kill backend process:', e);
    }
  }
  if (process.platform !== 'darwin') app.quit();
});

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');

let mainWindow;
let splashWindow;
let backendProcess;
let startupLogFile = null;  // 启动日志文件路径，错误时给前端打开用

// 启动期日志双写：原有 console.log / console.error 仍走终端 / DevTools，
// 同时落盘到 logs/electron-startup-<时间戳>.log，下次启动失败可直接打开复盘。
// 用 appendFileSync 同步落盘：electron 异常退出 / kill -9 时不会丢日志。
function setupStartupLogging() {
  try {
    const projectRoot = app.isPackaged
      ? path.dirname(path.dirname(path.dirname(app.getPath('exe'))))
      : path.join(__dirname, '..');
    const logsDir = path.join(projectRoot, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    startupLogFile = path.join(logsDir, `electron-startup-${ts}.log`);

    const writeLine = (level, args) => {
      const text = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ');
      try {
        fs.appendFileSync(startupLogFile, `[${new Date().toISOString()}] [${level}] ${text}\n`);
      } catch {}
    };

    const origLog = console.log.bind(console);
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.log = (...args) => { writeLine('LOG', args); origLog(...args); };
    console.error = (...args) => { writeLine('ERR', args); origError(...args); };
    console.warn = (...args) => { writeLine('WRN', args); origWarn(...args); };

    origLog('=== Electron startup log initialized ===');
    origLog('Log file:', startupLogFile);
  } catch (e) {
    // 日志初始化失败不能让主进程起不来
    process.stderr.write(`[startup-log] failed to init: ${e.message}\n`);
  }
}
setupStartupLogging();

// IPC: splash 错误界面点击"打开日志"时调用，用系统默认应用打开日志文件
ipcMain.handle('splash:openLog', async () => {
  if (!startupLogFile) return { ok: false, reason: '日志文件路径未初始化' };
  if (!fs.existsSync(startupLogFile)) {
    return { ok: false, reason: `日志文件不存在: ${startupLogFile}` };
  }
  try {
    // shell.showItemInFolder 在资源管理器中高亮该文件
    shell.showItemInFolder(startupLogFile);
    return { ok: true, path: startupLogFile };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle('splash:readLog', async () => {
  if (!startupLogFile) return { ok: false, reason: '日志文件路径未初始化' };
  try {
    if (!fs.existsSync(startupLogFile)) return { ok: false, reason: '日志文件不存在' };
    const content = fs.readFileSync(startupLogFile, 'utf-8');
    // 只返回最后 4KB，避免主进程卡死
    return { ok: true, content: content.length > 4096 ? '...' + content.slice(-4096) : content, path: startupLogFile };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

function checkPort(port, host) {
  return new Promise((resolve) => {
    // 创建一个连接来测试端口是否被占用
    const socket = new net.Socket();
    socket.on('connect', () => {
      // 连接成功，说明端口被占用
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      // 连接失败，说明端口未被占用
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1000);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

// 找出 nvm-windows 中实际安装的最高 24.x.x 版本
function findNvmNode24Dir(nvmHome) {
  try {
    const entries = fs.readdirSync(nvmHome, { withFileTypes: true });
    const v24 = entries
      .filter(e => e.isDirectory() && /^v24\.\d+\.\d+/.test(e.name))
      .map(e => e.name)
      .sort((a, b) => {
        const pa = a.slice(1).split('.').map(Number);
        const pb = b.slice(1).split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        }
        return 0;
      });
    return v24[0] || null;
  } catch (e) {
    return null;
  }
}

function getSystemNodePath() {
  if (process.platform === 'win32') {
    // 1) 优先：nvm-windows 里的 24.x.x（保证后端用 Node 24，不受全局 default 12 影响）
    const nvmHome = process.env['NVM_HOME'] || path.join(process.env['LOCALAPPDATA'] || '', 'nvm');
    const v24Dir = findNvmNode24Dir(nvmHome);
    if (v24Dir) {
      const p = path.join(nvmHome, v24Dir, 'node.exe');
      if (fs.existsSync(p)) {
        console.log('Found node (nvm 24) at:', p);
        return p;
      }
    }
    // 2) nvm 当前 default 的 symlink
    if (process.env['NVM_SYMLINK']) {
      const p = path.join(process.env['NVM_SYMLINK'], 'node.exe');
      if (fs.existsSync(p)) {
        console.log('Found node (nvm default) at:', p);
        return p;
      }
    }
    // 3) 兜底：原作者的固定路径（保留兼容）
    const possiblePaths = [
      process.env['ProgramFiles'] + '\\nodejs\\node.exe',
      process.env['ProgramFiles(x86)'] + '\\nodejs\\node.exe',
      process.env['USERPROFILE'] + '\\AppData\\Roaming\\npm\\node.exe',
    ];
    for (const nodePath of possiblePaths) {
      if (nodePath && fs.existsSync(nodePath)) {
        console.log('Found node at:', nodePath);
        return nodePath;
      }
    }
    console.log('Using system PATH to find node (no nvm 24 found)');
    return 'node.exe';
  } else {
    return '/usr/bin/node';
  }
}

async function killProcessOnPort(port) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows: 使用 cmd /c 执行命令
      const { exec } = require('child_process');
      const command = `netstat -ano | findstr ":${port}"`;
      console.log(`Executing command: ${command}`);
      
      exec(`cmd /c "${command}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('Failed to find process:', error.message);
          console.error('stderr:', stderr);
          resolve(false);
          return;
        }
        
        console.log('netstat output:', stdout);
        const lines = stdout.trim().split('\n');
        let killed = false;
        let pendingKills = 0;
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          
          if (pid && !isNaN(pid) && parseInt(pid) > 0) {
            pendingKills++;
            const killCommand = `taskkill /F /PID ${pid}`;
            console.log(`Killing process ${pid} with command: ${killCommand}`);
            
            exec(`cmd /c "${killCommand}"`, (killError, killStdout, killStderr) => {
              pendingKills--;
              if (!killError) {
                console.log(`Successfully killed process ${pid}`);
                console.log('taskkill output:', killStdout);
                killed = true;
              } else {
                console.error(`Failed to kill process ${pid}:`, killError.message);
                console.error('taskkill stderr:', killStderr);
              }
              
              if (pendingKills === 0) {
                setTimeout(() => resolve(killed), 500);
              }
            });
          }
        }
        
        if (pendingKills === 0) {
          setTimeout(() => resolve(killed), 500);
        }
      });
    } else {
      // Linux/macOS: 使用 lsof 和 kill
      const { exec } = require('child_process');
      exec(`lsof -ti:${port} | xargs -r kill -9`, (error) => {
        if (!error) {
          console.log(`Killed process on port ${port}`);
          resolve(true);
        } else {
          console.error('Failed to kill process:', error.message);
          resolve(false);
        }
      });
    }
  });
}

async function startBackend() {
  const isPortUsed = await checkPort(5002, '0.0.0.0');
  if (isPortUsed) {
    console.log('Port 5002 is already in use, trying to release...');
    const killed = await killProcessOnPort(5002);
    if (killed) {
      console.log('Port released successfully, waiting for cleanup...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      console.log('Failed to release port, continuing anyway...');
    }
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

    let backendProcess;
    try {
      backendProcess = spawn(nodePath, [backendPath], {
        cwd: backendCwd,
        env: env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      resolve({ ok: false, reason: `spawn 抛出异常: ${e.message}`, stderr: '', nodePath });
      return;
    }
    console.log(`Backend spawned, pid=${backendProcess.pid}`);

    let resolved = false;
    const stderrChunks = [];
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const tailStderr = () => {
      const s = stderrChunks.join('').trim();
      // 只保留最后 ~2KB，避免传输/渲染过慢
      return s.length > 2048 ? '...' + s.slice(-2048) : s;
    };

    backendProcess.on('close', (code, signal) => {
      console.log(`Backend process exited with code ${code}`);
      if (code !== 0) {
        const reason = signal
          ? `后端进程被信号终止: ${signal}（退出码 ${code}）`
          : `后端进程退出，退出码 ${code}`;
        finish({ ok: false, reason, stderr: tailStderr(), nodePath, backendPath });
      }
    });

    backendProcess.on('error', (error) => {
      console.error('Failed to spawn backend process:', error);
      let reason;
      if (error.code === 'ENOENT') {
        reason = `找不到 Node 可执行文件\n\n路径: ${error.path || nodePath}\n\n建议:\n1) 在终端执行 nvm root / nvm ls 24 确认 24.x.x 已安装\n2) 确认系统环境变量 NVM_HOME 指向 nvm 安装根目录\n3) 全局 default 是什么版本不影响本项目（本项目已硬编码 v24）`;
      } else if (error.code === 'EACCES') {
        reason = `权限不足，无法执行 Node: ${error.path || nodePath}\n\n请以管理员身份启动，或检查文件是否被占用`;
      } else {
        reason = `启动后端失败 (${error.code || 'UNKNOWN'}): ${error.message}`;
      }
      finish({ ok: false, reason, stderr: tailStderr(), nodePath, backendPath });
    });

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`Backend stdout: ${output}`);

      // 阶段性提示，让用户知道在干啥
      // 注意：必须用两个独立 if（不是 else if）。
      // 后端连续 console.log 写出的多行在 Windows pipe 上可能被合并到同一 chunk，
      // 此时 "SQLite initialized" 和 "Server running on port 5002" 都在 output 里；
      // 若用 else if，SQLite 分支命中后 Server running 分支被跳过，finish({ok:true}) 永远不调用。
      if (/Server running on port/i.test(output)) {
        console.log('Backend started successfully!');
        updateSplash('后端就绪，正在打开主界面...');
        finish({ ok: true });
      }
      if (/SQLite initialized/i.test(output)) {
        updateSplash('数据库就绪，正在加载路由...');
      }
    });

    backendProcess.stderr.on('data', (data) => {
      const text = data.toString();
      console.error(`Backend stderr: ${text}`);
      stderrChunks.push(text);
    });

    console.log('Waiting for backend to start...');

    // 阶段提示时间：5s / 20s / 40s / 50s（对应 60s 总超时，给冷启动杀软扫描留时间）
    setTimeout(() => {
      if (!resolved) updateSplash('正在启动后端服务...（首次较慢，杀软扫描可能耗时）');
    }, 5000);
    setTimeout(() => {
      if (!resolved) updateSplash('仍在等待后端响应（数据库或原生模块可能还在加载）');
    }, 20000);
    setTimeout(() => {
      if (!resolved) updateSplash('即将超时...（如持续等待请打开日志查看详情）');
    }, 40000);
    setTimeout(() => {
      if (!resolved) updateSplash('最后 10 秒...（如长期未响应请打开日志）');
    }, 50000);

    setTimeout(() => {
      finish({
        ok: false,
        reason: '60 秒内未检测到 "Server running on port" 标志，后端可能卡在初始化阶段（数据库连接、依赖加载、杀软扫描、或 Node 版本不匹配）',
        stderr: tailStderr(),
        nodePath,
        backendPath
      });
    }, 60000);
  });
}

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 360,
    frame: false,
    backgroundColor: '#1e293b',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js')
    }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
  splashWindow.on('closed', () => { splashWindow = null; });
}

function updateSplash(text, isError = false, detail) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    const payload = JSON.stringify({
      text: text || '',
      isError: !!isError,
      detail: detail || null
    });
    splashWindow.webContents.executeJavaScript(
      `void window.splashUpdate(${payload});`,
      true
    ).catch((err) => {
      console.error('[splash] executeJavaScript 失败:', err);
    });
  }
}

function installAuthCookieCompat() {
  // 解决 file:// 页面 + httpOnly cookie 跨站被拦截的问题：
  //   - 打包后的 Electron 页面在 file://，请求发到 http://localhost:5002，cookie 同源策略下被当成"跨站"；
  //   - 后端默认 Set-Cookie: SameSite=Lax，对 file:// 的子请求会被 Chromium 拒发。
  //   - 在这里把 Set-Cookie 改写为 SameSite=None; Secure（localhost 是 secure context，可接受 Secure）。
  //   - 同时给所有发往后端 localhost:5002 的请求补上 Cookie（兜底，防止 SameSite 仍被某些版本拦）。
  const ses = mainWindow.webContents.session;
  ses.webRequest.onHeadersReceived((details, cb) => {
    const respHeaders = { ...details.responseHeaders };
    const lower = {};
    for (const k of Object.keys(respHeaders)) lower[k.toLowerCase()] = k;
    const ckKey = lower['set-cookie'];
    if (ckKey && Array.isArray(respHeaders[ckKey])) {
      respHeaders[ckKey] = respHeaders[ckKey].map((line) => {
        let out = line;
        // 把 SameSite=Lax 改成 None
        if (/SameSite=Lax/i.test(out)) {
          out = out.replace(/SameSite=Lax/i, 'SameSite=None');
        } else if (!/SameSite=/i.test(out)) {
          out += '; SameSite=None';
        }
        // 补 Secure（Chromium 对 localhost 视作 secure context，http 也接受）
        if (!/;\s*Secure/i.test(out)) {
          out += '; Secure';
        }
        return out;
      });
    }
    cb({ responseHeaders: respHeaders });
  });
  // 请求侧：把所有发到 5002 的请求标成 credentials include；并显式带上已存在的 xtsql_auth 兜底
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const reqHeaders = { ...details.requestHeaders };
    const url = details.url || '';
    if (url.includes('localhost:5002')) {
      reqHeaders['credentials'] = 'include';
    }
    cb({ requestHeaders: reqHeaders });
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

  installAuthCookieCompat();

  const startUrl = app.isPackaged
    ? `file://${path.join(__dirname, '../frontend/dist/index.html')}`
    : 'http://localhost:5173';
    
  console.log('Loading URL:', startUrl);
  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => (mainWindow = null));
}

app.on('ready', async () => {
  console.log('App is ready');
  console.log('isPackaged:', app.isPackaged);
  console.log('__dirname:', __dirname);

  // 立即显示启动页，避免用户看到黑屏重复点击
  createSplash();
  // 等 splash 页加载完再调 startBackend，否则极端情况下（端口被占 / Node 缺失
  // → spawn 几乎同步失败 → updateSplash 立即触发）splashUpdate 还没挂上，
  // executeJavaScript 抛错被 .catch 吞掉，B11 的"复制日志/退出"按钮永远不显示。
  await new Promise((resolve) => {
    if (splashWindow.webContents.isLoadingMainFrame()) {
      splashWindow.webContents.once('did-finish-load', resolve);
    } else {
      resolve();
    }
  });
  updateSplash('正在启动后端服务...');

  const result = await startBackend();

  if (result.ok) {
    updateSplash('后端就绪，正在打开主界面...');
    createWindow();
    // 主窗口首屏渲染完成后才关 splash，避免白屏闪烁
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
        }
      }, 200);
    });
  } else {
    // 错误时把窗口放大一些，避免错误信息被裁切
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.setSize(620, 640);
      splashWindow.center();
      splashWindow.setResizable(true);
      splashWindow.setMinimumSize(520, 520);
    }
    updateSplash(result.reason, true, {
      reason: result.reason,
      stderr: result.stderr,
      nodePath: result.nodePath,
      backendPath: result.backendPath,
      logFile: startupLogFile
    });
    // 给用户看清错误信息、复制日志的时间，再退出
    setTimeout(() => {
      app.quit();
    }, 20000);
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

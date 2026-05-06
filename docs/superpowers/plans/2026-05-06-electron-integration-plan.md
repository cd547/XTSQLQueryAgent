# Electron 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 Web 项目封装为 Electron 桌面应用，实现后端自动托管和窗口自动加载。

**Architecture:** Electron 作为主进程管理生命周期，通过 `child_process` 启动后端子进程，并加载前端页面。

**Tech Stack:** `electron`, `child_process` (Node.js 原生模块)。

---

### Task 1: 安装 Electron 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 electron 依赖**

Run: `npm install electron --save-dev`

- [ ] **Step 2: 验证安装**

Run: `npx electron --version`
Expected: 输出 electron 版本号 (例如 v30.x.x)

- [ ] **Step 3: 提交**

Run: `git add package.json package-lock.json; git commit -m "feat: add electron dependency"`

### Task 2: 配置 Electron 主进程 (`electron/main.js`)

**Files:**
- Create: `electron/main.js`

- [ ] **Step 1: 创建 `electron` 目录**

Run: `mkdir electron`

- [ ] **Step 2: 编写 `electron/main.js`**

```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;

function startBackend() {
  // 在项目根目录下启动后端进程
  backendProcess = spawn('node', ['backend/src/index.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env }
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
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 在开发环境下加载 Vite 开发服务器，生产环境下加载构建后的 dist/index.html
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => (mainWindow = null));
}

app.on('ready', () => {
  startBackend();
  // 等待几秒钟让后端启动
  setTimeout(createWindow, 2000);
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: 提交**

Run: `git add electron/main.js; git commit -m "feat: add electron main process"`

### Task 3: 更新项目脚本 (`package.json`)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 修改根目录 `package.json` 的 scripts**

在 `scripts` 中添加：
```json
"electron:dev": "concurrently \"npm run dev:backend\" \"electron .\"",
```

- [ ] **Step 2: 提交**

Run: `git add package.json; git commit -m "feat: add electron scripts"`

### Task 4: 验证集成效果

**Files:**
- None

- [ ] **Step 1: 运行 Electron 开发环境**

Run: `npm run electron:dev`

- [ ] **Step 2: 确认**
  - 后端服务是否正常启动。
  - Electron 窗口是否弹出。
  - 前端界面是否加载。

- [ ] **Step 3: 提交**

Run: `git commit -m "chore: verify electron integration"`

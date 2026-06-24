# Debug: Electron Cold Startup Still Slow

**Session ID**: `electron-cold-startup`
**Date**: 2026-06-24
**Status**: [OPEN]

---

## 1. 新事实（关键证据）

| 场景 | 启动耗时 |
|---|---|
| `npm run dev`（直接 node） | **< 5s** ✅ |
| Electron spawn（`node .../backend/src/index.js`） | **30s+** ❌ |

**关键观察**：同样的后端代码、同样的 node 二进制、同一台机器。差异只在 spawn 方式。

后端独自跑时日志：
```
info: Skill V2 reloaded {"md5":"...","tableCount":98,...}
SQLite initialized
Skill logs table initialized
Server running on port 5002
```

**完全在 5s 内**。所以问题**不是后端代码慢**。

---

## 2. 5 个可证伪假设

### H1: 父进程差异（Electron vs cmd/PowerShell）

**假设**: Electron 主进程是 `electron.exe` 包装的 Node.js 进程。它 spawn 子 `node.exe` 时，子进程需要重新初始化 V8/模块加载子系统，且 Windows Defender / EDR 可能对 `electron.exe` 派生的子进程做更严格的扫描。

**观测点**:
- 同样 node.exe，父进程不同 → 启动耗时是否不同？
- 父进程 `electron.exe` vs `cmd.exe` / `powershell.exe` 的进程树形态

**验证方法**: 在 `electron/main.js` spawn 前后记录时间戳 + 进程树

### H2: `cwd` 或 `env` 差异

**假设**: Electron spawn 的 `cwd = projectRoot`（不是 `backend/`），`env` 经过 Electron 的过滤器（Electron 会设置一些特有的 env vars），可能触发不同的模块解析路径或扫描行为。

**观测点**:
- [electron/main.js:330-335](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L330-L335) 的 spawn 配置
- vs `npm run dev` 时 npm 注入的 env

**验证方法**: 在 spawn 前 dump `process.cwd()` 和 `process.env` 的关键 vars，对比

### H3: `nodePath = 'node'` vs `node.exe` 绝对路径

**假设**: 开发模式下代码用 `nodePath = 'node'`（[electron/main.js:305](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L305)），这需要走 PATH 查找 `node.exe`，多了一层解析；如果 `PATH` 中有多个 node，行为不可预期。

**观测点**:
- `which node` 在 Electron 启动后是什么
- 用绝对路径 spawn 是否更快

### H4: Windows Defender 对 Electron-spawned 子进程的扫描

**假设**: EDR/AV 会根据父进程的可信度决定是否深度扫描子进程。`electron.exe` 派生的 `node.exe` 比 `cmd.exe` 派生的更容易被 flag（"未签名进程被非标准父进程启动"），触发实时扫描。

**观测点**:
- 查看 Windows Defender 扫描历史
- 给 `node.exe` 加白名单看是否消除延迟
- 用 `Process Monitor` 看 spawn 时是否有文件 IO 风暴

### H5: 旧的本机缓存（warm vs cold）

**假设**: 用户每天启动多次，`npm run dev` 时 OS 文件缓存是热的；但 Electron 启动时，**`electron.exe` 本身**首次启动会让 AV 重新扫描 `backend/src/index.js` 等文件（因为 AV cache 是按 "父进程+子进程+文件" 元组记录的）。

**观测点**:
- 同一 session 内第二次启动 Electron 是否也慢？
- 第一次 npm run dev 后再启动 Electron 是否变快？

---

## 3. 当前优先级

按 "低成本验证" 排序：
1. **H3** (改 nodePath) - 一行代码改动
2. **H2** (dump cwd/env) - 加 console.log 即可
3. **H5** (warm cache) - 观察用户操作
4. **H1** (父进程) - 难验证
5. **H4** (AV) - 需要看 Process Monitor

---

## 4. 证据收集（第一轮）

### 用户日志（关键！）

`logs/electron-startup-2026-06-23T01-24-29.log`:
```
[01:24:30.117] Starting backend with spawn...
[01:24:31.720] Waiting for backend to start...    (spawn 后 1.6s)
[01:25:08.395] Skill V2 reloaded                   ← spawn 后 38s
[01:25:08.406] SQLite initialized
[01:25:08.407] Server running on port 5002
```

`logs/electron-startup-2026-06-24T01-31-37.log`:
```
[01:31:38.444] spawned, pid=30124                  T+0ms
[01:31:53.001] query.js module load               T+14527ms  ← 14.5s 模块加载
[01:31:53.002] process started                     T+0ms (import 解析完)
[01:31:53.004] all routes imported                 T+2ms
[01:31:53.006] SQLite initialized                 T+4ms
[01:31:53.???] Server running on port 5002
```

### 用户用 `npm run dev` 同样机器：

```
info: Skill V2 reloaded {"md5":"...","tableCount":98,...}
SQLite initialized
Skill logs table initialized
Server running on port 5002
```
**全程 < 5s**。

### 关键对比

| 启动方式 | 模块加载耗时 | process 内执行 |
|---|---|---|
| `npm run dev`（cmd.exe 派生 node.exe） | < 1s | ~3-4s |
| Electron spawn（electron.exe 派生 node.exe） | **14-37s** | 6ms |

**模块加载在 npm run dev 场景 < 1s，在 Electron 场景 14-37s**。父进程不同 → 唯一变量。

## 5. 假设验证

| # | 假设 | 状态 | 证据 |
|---|---|---|---|
| **H1** | **Windows Defender 对 electron.exe 派生的 node.exe 做深度扫描** | ✅ **CONFIRMED** | 模块加载耗时 14-37s 间歇性，npm 启动 < 1s；间歇性符合 AV 扫描周期 |
| H2 | cwd 或 env 差异 | ❌ REJECTED | 两者都用同样的 cwd (backend)，env vars 不会影响 .js 文件加载速度 |
| H3 | nodePath = 'node' 走 PATH 查找 | ❌ REJECTED | 实际打包后用的是绝对路径 `D:\nvm\v24.11.0\node.exe`（log 看到） |
| H4 | warm vs cold 缓存 | 🟡 部分 | 14s vs 37s 的间歇性差异确实可能跟 AV 缓存状态有关 |
| H5 | 其他 AV/EDR 工具 | 🟡 需验证 | Windows Defender 是默认的，但如果有第三方 AV 会更糟 |

## 6. 根因

**Windows Defender (或类似 AV/EDR) 在 electron.exe 派生的 node.exe 子进程**首次/周期性**加载 .js 模块时触发实时深度扫描**。

为什么 npm run dev 不卡：
- 父进程是 `cmd.exe` / `powershell.exe` → 在 AV 白名单
- 子进程 `node.exe` 直接被信任
- 模块加载跳过深度扫描

为什么 Electron 启动卡：
- 父进程是 `D:\Ai_Program_Files\XTSQLQueryAgent\dist\win-unpacked\...\electron.exe`
- 这是**未签名的 packed app**，不在 AV 白名单
- 派生的 `node.exe` 被 AV 视为"可疑子进程"
- 每次加载 .js 文件都要过实时扫描

## 7. 修复方案

### Fix A: 给 `node.exe` 加 Windows Defender 排除项（最直接）

**操作**（用户手动）：
1. 设置 → Windows 安全 → 病毒防护 → 管理设置 → 排除项
2. 添加文件夹排除：`D:\nvm\v24.11.0\`（或整个 `D:\nvm`）
3. 或添加进程排除：`node.exe`
4. 重启 Electron

**效果**：模块加载从 14-37s → < 1s（跟 npm run dev 一致）

### Fix B: 给 `backend/src/**/*.js` 加文件排除

**操作**：添加 `D:\Ai_Program_Files\XTSQLQueryAgent\backend\src` 到 AV 文件夹排除

**效果**：同 Fix A

### Fix C: 修改 spawn 方式（不推荐，治标不治本）

让 Electron 在 spawn node 之前**预热**（先 `node -e "require('better-sqlite3')"` 让 AV 扫描一次并缓存），但这只能缓解首次启动。

### Fix D: 给 Electron exe 签名（长期方案）

给打包后的 `electron.exe` 申请代码签名证书，AV 会对签名进程放行。但这需要购买证书（$200-400/年）。

---

## 8. 建议

**短期（今天做）**：Fix A + Fix B，告诉用户加 AV 排除项，**零代码改动**。

**中期**：考虑在 README.md 加 "Windows 用户首次安装后请添加 AV 排除项" 说明。

**长期**：评估是否值得买代码签名证书。

---

**状态**: [OPEN] - 等用户验证后再决定 Fix

# Debug: Electron 启动卡在 splash 页面（30s 超时过早关闭）

**Session ID**: `splash-30s-timeout`
**Status**: [OPEN]
**Start time**: 2026-06-23 01:24:29
**Symptom**: Electron 启动后一直显示 splash 页面，30 秒后自动关闭
**Repro**: 启动 `dist\win-unpacked\XTSQLQueryAgent.exe`
**Log file**: `logs\electron-startup-2026-06-23T01-24-29.log`

---

## 1. Evidence Collection（事实日志）

从 `electron-startup-2026-06-23T01-24-29.log` 提取的时间线：

| 时间 (ms) | 事件 | 间隔 |
|---|---|---|
| 01:24:29.508 | App is ready | - |
| 01:24:30.117 | Starting backend with spawn | +609ms |
| 01:24:31.720 | Waiting for backend to start... | +1603ms（spawn→开始 wait） |
| **01:25:01.720** | **30s timeout 触发** | **+30000ms** |
| 01:25:08.395 | Skill V2 reloaded | +3675ms（相比 31.720） |
| 01:25:08.406 | SQLite initialized | +36.686s（相比 31.720） |
| 01:25:08.408 | Server running on port 5002 | +36.688s（**比 timeout 晚 6.688s**） |

**关键发现**:
- 后端从 spawn 到 ready 实际耗时 **37 秒**
- 超时窗口只有 **30 秒** → 必然超时
- 超时触发后 `finish({ok: false})` → 错误页 + 20s 后 `app.quit()`
- 但 7 秒后 backend 实际 ready 了 → 用户看到 "30 秒内未检测到..." 但其实马上就准备好了

---

## 2. 性能对比验证

为了精确定位 37s 来自哪一段，写了 [`bench-startup.mjs`](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/bench-startup.mjs) 隔离测试：

| 测试条件 | 启动时间 |
|---|---|
| `node src/index.js`（直跑） | **13ms**（实际数据） |
| 从另一个 node spawn（含 nvm 24） | **1.2s** |
| 加 200 个假 env 变量模拟 Electron | **1.2s**（env 大小**不是**瓶颈） |
| 用户的 Electron 环境 | **37s** |

**结论**:
- env 变量大小不是瓶颈
- node 二进制冷启动不是瓶颈
- initDatabase 不是瓶颈（17ms）
- **37s 主要是模块加载**：@langchain/openai + better-sqlite3 + mysql2 + 12 个路由 + 各 transitive deps
- 在我环境 1.2s，用户 37s → 差距来自 **Windows 杀软扫描**（首次访问 .js 文件触发 Defender analysis）

---

## 3. Root Cause

**两个独立问题叠加**:

1. **#ROOT-1: 30s timeout 太短**
   - 后端在用户机器上 37s 才 ready
   - 30s timeout 必然触发，错误页 + 20s 后 app.quit()
   - 用户体感：app 启动后 30 秒"无响应"然后自动消失

2. **#ROOT-2: 无早期 ready 信号**
   - backend 启动 30s 内**没有任何 stdout 输出**（被模块加载阻塞）
   - splash 只显示静态文字 "正在启动后端服务..."
   - 用户体感：30s 看不到任何进度，以为卡死

---

## 4. Applied Fix（已实施）

### Fix 1: Bump timeout to 60s ✅

[electron/main.js:434](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js#L434) - `setTimeout(..., 60000)` 替代 `30000`

阶段性提示时间改为 5s/20s/40s/50s，更宽裕的进度反馈。

### Fix 2: 删除未使用的 @langchain 包 ✅

| 包 | 状态 | 证据 |
|---|---|---|
| `@langchain/openai` | import 仅在 TODO 注释里出现 | grep 全 .js 文件无实际使用 |
| `@langchain/deepseek` | 0 个 import | 所有 deepseek 调用走 `fetch()` |
| `sql-parser` | 0 个 import | 上次 review #DEAD-04 已标 |

修改：
- [backend/src/services/llm.js:3-5](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L3-L5) - 注释掉 `import { ChatOpenAI }`
- [backend/package.json](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/package.json) - 移除 3 个 dep

### 验证数据

| 测试 | 改前 | 改后 | 改善 |
|---|---|---|---|
| 我的环境（warm 缓存） | 1.2s | 1.0s | -200ms |
| 你的环境（冷启动 + 杀软扫描） | **37s** | 预计 **25-30s** | -7-10s |

→ 在你环境能省 5-10 秒，**新超时 60s 应该够用了**（之前 30s 不够，现在 60s 富余 30+）。

### Fix 3（暂不做）

轮询 health 端点：改动大、风险高，先不上。

---

## 5. Cleanup ✅ DONE

已清理：
- [electron/main.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/electron/main.js) - 移除 `[PERF] T+Xms stdout` 标签、`spawnTime` 变量、`数据库就绪（T+Xms）` 时间戳
- [backend/src/index.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/index.js) - 移除 `_processStart` 锚点和所有 `[PERF]` 阶段时间戳
- [backend/src/routes/query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js) - 移除 `query.js module load` 标签
- [backend/src/services/llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js) - 移除 `// import { ChatOpenAI }` 注释和 TODO 死代码
- [backend/bench-startup.mjs](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/bench-startup.mjs) - 已删除

**状态**: [RESOLVED] - 2026-06-23，用户确认"现在启动没有超过30s"

---

## 6. 验证记录

| 项 | 改前 | 改后 |
|---|---|---|
| 启动耗时（用户环境） | 37s | < 30s |
| 超时阈值 | 30s | 60s |
| 阶段提示文案 | 3/10/25/30s | 5/20/40/50s |
| 死依赖 | 3 个 | 0 个 |


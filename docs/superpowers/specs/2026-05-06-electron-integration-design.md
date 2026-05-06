# Electron 集成方案设计文档

## 概述
本设计旨在为现有项目（React 前端 + Express 后端）增加 Electron 桌面封装，实现桌面版和 Web 版的双模支持，且不对现有开发流程产生破坏。

## 架构设计
Electron 的主进程（Main Process）将作为项目的“宿主”和“生命周期管理器”。

### 关键组件
1. **Electron 主进程 (`electron/main.js`)**:
   - 负责启动 Express 后端子进程。
   - 负责创建 Electron 窗口 (`BrowserWindow`)。
   - 负责将窗口指向 Vite 开发服务器（开发环境）或构建后的静态资源（生产环境）。
   - 负责在窗口关闭时自动清理后端子进程。

2. **目录结构**:
   ```text
   D:\Ai Program Files\XTSQLQueryAgent
   ├── electron/        # 新增
   │   └── main.js      # 主进程逻辑
   ├── backend/         # 原有，无修改
   ├── frontend/        # 原有，无修改
   ├── package.json     # 修改：添加 Electron 依赖及启动脚本
   ```

## 关键技术考量
- **工作目录 (CWD)**: Electron 启动后端时，显式设定后端子进程的 `cwd` 为项目根目录，确保后端读取 `data/`, `logs/` 等路径时行为与原 Web 模式一致。
- **双模兼容性**: 
  - 维持 `npm run dev` 作为 Web 开发入口。
  - 新增 `npm run electron:dev` 作为 Electron 开发入口。
  - 新增 `npm run electron:build` 负责打包桌面应用。

## 实施计划预览
1. 安装 Electron 依赖。
2. 创建 `electron/main.js` 实现进程管理。
3. 更新 `package.json` 脚本。
4. 测试双模环境下的路径访问和交互。

# Electron 打包与路径优化实施计划

**Goal:** 使用 electron-builder 打包项目，并使应用能够将数据库存放在用户的 UserData 目录中。

---

### Task 1: 安装打包工具

- [ ] **Step 1: 安装 electron-builder**
Run: `npm install electron-builder --save-dev`

### Task 2: 配置 package.json 打包选项

- [ ] **Step 1: 在 package.json 中配置 build 选项**

```json
  "build": {
    "appId": "com.xt.sqlqueryagent",
    "productName": "XTSQLQueryAgent",
    "directories": {
      "output": "dist"
    },
    "files": [
      "**/*",
      "!node_modules/*",
      "node_modules/better-sqlite3/**/*"
    ]
  }
```

### Task 3: 后端数据库路径动态化

- [ ] **Step 1: 修改 backend/src/db/sqlite.js**

将 `dbPath` 修改为支持环境变量 `DB_PATH`。

### Task 4: Electron 主进程传递路径

- [ ] **Step 1: 修改 electron/main.js**

在启动后端子进程的环境变量中添加 `DB_PATH`:
```javascript
  backendProcess = spawn('node', ['backend/src/index.js'], {
    env: { ...process.env, DB_PATH: path.join(app.getPath('userData'), 'app.db') }
  });
```

# Skill 表格添加 - 业务域选择功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **设计文档**: [2026-06-30-skill-add-table-domain-selection.md](../specs/2026-06-30-skill-add-table-domain-selection.md)

**Goal:** 在「添加表格」流程的 step 3 中增加业务域多选控件（必填），提交时后端把表名写入对应业务域文件 `domains/{id}.json` 的 `tables` 数组。新建 / 覆盖 DDL 两个分支统一行为。

**Architecture:** 在现有 `/skills/create-table-files` 端点上扩展 `domains: string[]` 字段；新增 `GET /skills/domains` 读取域索引；前端用 Ant Design `Select mode="multiple"` + `Tooltip` 渲染，hover 展示 description。

**Tech Stack:** Express, React 18, Ant Design 5, better-sqlite3, Node 24.11

---

## 文件结构

```
backend/src/routes/skill.js                   # 修改：新增 GET /domains、helper、新字段接入
frontend/src/api/index.js                     # 修改：新增 getDomains、改 createTableFiles 签名
frontend/src/App.jsx                          # 修改：state、useEffect、UI、按钮 disabled
backend/test-skill-domains.mjs                # 新建：后端测试
frontend/src/components/__tests__/domain-selector.test.jsx  # 可选：前端 e2e（本期不做）
docs/superpowers/changelog/CHANGELOG.md       # 更新
```

---

## Task 1: 后端 - 抽取域写入公共 helper

**Files:**
- Modify: `backend/src/routes/skill.js:405`（create-table-files 之前）

- [ ] **Step 1: 读取当前 skill.js L1-L50，确认 imports 和常量**

确认 `fs`、`path`、`isPathSafe`、`SKILL_V2_PATH` 都已就位。

- [ ] **Step 2: 在 create-table-files 路由之前添加 helper 函数**

在 `router.post('/create-table-files', ...)` 之前插入：

```javascript
function addTableToDomains(tableName, domainIds) {
  const domainIndexPath = path.join(SKILL_V2_PATH, 'domain_router_index.json');
  if (!fs.existsSync(domainIndexPath)) {
    const err = new Error('domain_router_index.json 不存在');
    err.code = 'DOMAIN_INDEX_MISSING';
    throw err;
  }
  const index = JSON.parse(fs.readFileSync(domainIndexPath, 'utf-8'));
  const validIds = new Set((index.domains || []).map(d => d.id));
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO skill_logs (operation, file_path, backup_path, old_content, new_content, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const id of domainIds) {
    if (!validIds.has(id)) {
      const err = new Error(`业务域 ${id} 未在 domain_router_index.json 注册`);
      err.code = 'DOMAIN_NOT_FOUND';
      throw err;
    }
    const domainFile = path.join(SKILL_V2_PATH, 'domains', `${id}.json`);
    if (!isPathSafe(SKILL_V2_PATH, domainFile)) {
      const err = new Error(`Invalid domain id: ${id}`);
      err.code = 'INVALID_DOMAIN_ID';
      throw err;
    }
    if (!fs.existsSync(domainFile)) {
      const err = new Error(`业务域文件缺失: domains/${id}.json`);
      err.code = 'DOMAIN_FILE_MISSING';
      throw err;
    }
    const data = JSON.parse(fs.readFileSync(domainFile, 'utf-8'));
    data.tables = data.tables || [];
    if (!data.tables.includes(tableName)) {
      data.tables.push(tableName);
      fs.writeFileSync(domainFile, JSON.stringify(data, null, 2), 'utf-8');
    }
    stmt.run(
      'add_to_domain',
      `domains/${id}.json`,
      null, '',
      JSON.stringify({ tableName, domainId: id }),
      'success', null
    );
  }
}
```

- [ ] **Step 3: 验证语法**

```bash
cd backend && node --check src/routes/skill.js
```

---

## Task 2: 后端 - 新增 GET /skills/domains

**Files:**
- Modify: `backend/src/routes/skill.js`（在 `/list` 附近）

- [ ] **Step 1: 在 `/list` 路由之后插入新路由**

```javascript
router.get('/domains', (req, res) => {
  try {
    const indexPath = path.join(SKILL_V2_PATH, 'domain_router_index.json');
    if (!fs.existsSync(indexPath)) {
      return res.json({ success: true, domains: [] });
    }
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    res.json({ success: true, domains: data.domains || [] });
  } catch (e) {
    logger.error('Fetch domains failed', { error: e.message });
    res.status(500).json({ success: false, message: '获取业务域失败', code: 'DOMAIN_INDEX_READ_ERROR' });
  }
});
```

- [ ] **Step 2: 验证语法**

```bash
node --check src/routes/skill.js
```

---

## Task 3: 后端 - 改造 POST /create-table-files

**Files:**
- Modify: `backend/src/routes/skill.js:405-504`

- [ ] **Step 1: 修改路由函数签名和 body 解析**

将：
```javascript
router.post('/create-table-files', (req, res) => {
  const { tableName, ddl, description } = req.body;
  if (!tableName || !ddl) {
    return res.status(400).json({ success: false, message: 'Missing tableName or ddl' });
  }
```

改为：
```javascript
router.post('/create-table-files', (req, res) => {
  const { tableName, ddl, description, domains } = req.body;
  if (!tableName || !ddl) {
    return res.status(400).json({ success: false, message: 'Missing tableName or ddl' });
  }
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({
      success: false,
      message: '请至少选择一个业务域',
      code: 'DOMAINS_REQUIRED'
    });
  }
  try {
    addTableToDomains(tableName, domains);
  } catch (e) {
    logger.warn('Add table to domains failed', { tableName, domains, code: e.code, error: e.message });
    return res.status(e.code === 'DOMAIN_INDEX_MISSING' ? 500 : 400).json({
      success: false,
      message: e.message,
      code: e.code
    });
  }
```

- [ ] **Step 2: 验证成功响应包含 domains 字段**

在 `res.json({ success: true, files: [...] })` 两处都加上：
```javascript
res.json({
  success: true,
  files: ['table_index.json', `ddl/${tableName}.sql`, `field_config/${tableName}.json`],
  domains
});
```

- [ ] **Step 3: 验证语法**

```bash
node --check src/routes/skill.js
```

---

## Task 4: 后端测试

**Files:**
- Create: `backend/test-skill-domains.mjs`

- [ ] **Step 1: 编写测试用例（10 条）**

```javascript
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { app, setupApp } from './src/app.js';  // 视实际启动方式调整
```

> 注：如果项目没有现成的测试启动器，本期可改用直接读 helper 函数的方式（不通过 HTTP）。这需要把 `addTableToDomains` 导出，或单独抽到 `services/skillDomains.js` 模块。

- [ ] **Step 2: 覆盖 10 条用例**

- A. 正常：3 个域都存在 → 全部写入
- B. domains 为空 → 抛 DOMAINS_REQUIRED
- C. id 不在 index → 抛 DOMAIN_NOT_FOUND
- D. domains/{id}.json 缺失 → 抛 DOMAIN_FILE_MISSING
- E. idempotent：已存在的表不再 push
- F. domain_router_index.json 缺失 → 抛 DOMAIN_INDEX_MISSING
- G. 恶意 id（`../../etc/passwd`）→ 抛 INVALID_DOMAIN_ID
- H. 多域同时写入：每个域都新增
- I. 域文件无 tables 字段：自动初始化为 `[]`
- J. 部分失败回滚：第一个域成功，第二个失败时第一个域不写

> **重要**：J 用例当前实现是 "不自动回滚"，所以实际期望是"部分写入不回滚"。测试用 `assert: 已写文件保持已写状态`。

- [ ] **Step 3: 跑测试，全部通过**

```bash
cd backend && node test-skill-domains.mjs
```

---

## Task 5: 前端 - 新增 getDomains API

**Files:**
- Modify: `frontend/src/api/index.js:187`

- [ ] **Step 1: 在 createTableFiles 之前新增**

```javascript
export function getDomains() {
  return api.get('/skills/domains').then(r => r.data);
}
```

- [ ] **Step 2: 修改 createTableFiles 签名**

```javascript
export function createTableFiles(tableName, ddl, description, domains) {
  return api.post('/skills/create-table-files', { tableName, ddl, description, domains }).then(r => r.data);
}
```

---

## Task 6: 前端 - state 和 effect

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 添加 3 个 useState**

在现有 `addTableDescription` state 附近：
```javascript
const [addTableDomains, setAddTableDomains] = useState([]);
const [addTableSelectedDomains, setAddTableSelectedDomains] = useState([]);
const [addTableDomainsLoading, setAddTableDomainsLoading] = useState(false);
```

- [ ] **Step 2: 添加 useEffect**

在 `handleAddTableStep3` 之前：
```javascript
useEffect(() => {
  if (addTableStep === 3 && addTableDomains.length === 0 && !addTableDomainsLoading) {
    setAddTableDomainsLoading(true);
    getDomains()
      .then(d => {
        if (d.success) setAddTableDomains(d.domains || []);
        else message.error(d.message || '加载业务域失败');
      })
      .catch(e => message.error('加载业务域失败: ' + e.message))
      .finally(() => setAddTableDomainsLoading(false));
  }
}, [addTableStep]);
```

- [ ] **Step 3: 修改 handleAddTableStep3 调用**

把：
```javascript
const data = await createTableFiles(addTableName.trim(), addTableDDL, addTableDescription);
```

改为：
```javascript
const data = await createTableFiles(
  addTableName.trim(),
  addTableDDL,
  addTableDescription,
  addTableSelectedDomains
);
```

---

## Task 7: 前端 UI - 多选控件

**Files:**
- Modify: `frontend/src/App.jsx:1836-1858`（step 3 渲染块）

- [ ] **Step 1: 在 step 3 描述输入之后插入多选控件**

在 `{!addTableExists && ...}` 块之后、`<pre>{addTableDDL}</pre>` 之前插入：

```jsx
<div style={{ marginBottom: 8 }}>
  <div style={{ marginBottom: 4, fontSize: 12 }}>
    业务域 <span style={{ color: '#ff4d4f' }}>*</span>
    <span style={{ color: '#999', marginLeft: 8, fontSize: 11 }}>
      悬停查看说明，至少选 1 个
    </span>
  </div>
  <Select
    mode="multiple"
    placeholder="请选择业务域"
    value={addTableSelectedDomains}
    onChange={setAddTableSelectedDomains}
    loading={addTableDomainsLoading}
    style={{ width: '100%' }}
    optionLabelProp="label"
    size="small"
  >
    {addTableDomains.map(d => (
      <Select.Option key={d.id} value={d.id} label={d.name}>
        <Tooltip title={d.description} placement="right">
          <span style={{ cursor: 'help' }}>{d.name}</span>
        </Tooltip>
      </Select.Option>
    ))}
  </Select>
</div>
```

- [ ] **Step 2: 按钮 disabled**

把：
```jsx
<Button type="primary" onClick={handleAddTableStep3} loading={addTableCreating}>
  {addTableExists ? '覆盖DDL' : '生成文件'}
</Button>
```

改为：
```jsx
<Button
  type="primary"
  onClick={handleAddTableStep3}
  loading={addTableCreating}
  disabled={addTableSelectedDomains.length === 0}
>
  {addTableExists ? '覆盖DDL' : '生成文件'}
</Button>
```

- [ ] **Step 3: 确认 import 包含 Tooltip**

```bash
grep "Tooltip" frontend/src/App.jsx | head -5
```

如有 `from 'antd'` 已含 Tooltip，跳过；否则补充：
```javascript
import { ..., Tooltip } from 'antd';
```

---

## Task 8: 前端 - 重置表单

**Files:**
- Modify: `frontend/src/App.jsx:937-944`

- [ ] **Step 1: 在 resetAddTableForm 中添加**

```javascript
setAddTableSelectedDomains([]);
```

---

## Task 9: 端到端验证

- [ ] **Step 1: 启动后端**

```bash
cd backend && node src/index.js
```

- [ ] **Step 2: 启动前端**

```bash
cd frontend && npm run dev
```

- [ ] **Step 3: 浏览器手测流程**

1. 点击「添加表格」→ 输入新表名 → 「下一步」→ 「获取DDL」→ 进入 step 3
2. 看到多选控件，列出现有 11 个域
3. hover 任意一个 → 弹气泡显示 description
4. 不选任何 → 按钮 disabled
5. 选 1 个 → 按钮 enabled → 点击 → 成功 + 域名出现在 success message
6. 验证 `domains/{id}.json` 包含新表名：
   ```bash
   cat skills/sql-creator-skill-v2/domains/finance.json
   ```
7. 关闭弹窗 → 重新打开 → 选项已重置
8. 测试覆盖分支：选已存在表 → 进入 step 3 → 选域 → 点击「覆盖DDL」→ 验证 DDL 覆盖 + 域文件更新

---

## Task 10: 更新文档

- [ ] **Step 1: 更新 CHANGELOG.md**

在 `## [Unreleased]` 或最新版本段下追加：

```markdown
### Added
- 业务域选择功能：添加表格时强制选择业务域，后端将表名追加到对应 `domains/{id}.json` 的 `tables` 数组（[设计](../specs/2026-06-30-skill-add-table-domain-selection.md)）
```

- [ ] **Step 2: 更新 README.md「添加表格」章节**

补充「选择业务域（必填）」步骤。

---

## 验证清单

完成后检查：

- [ ] `node --check backend/src/routes/skill.js` 通过
- [ ] `node test-skill-domains.mjs` 10 条全过
- [ ] 后端测试套件（timeout / sqlValidator / skillCache / fs-utils）无回归
- [ ] 前端 build 通过
- [ ] 端到端手测 8 步全过
- [ ] CHANGELOG / README 更新

---

## 工作量估算

| 任务 | 时间 |
|------|------|
| Task 1-3 后端 | 30 min |
| Task 4 后端测试 | 20 min |
| Task 5-8 前端 | 40 min |
| Task 9 端到端 | 15 min |
| Task 10 文档 | 10 min |
| **合计** | **~2h** |

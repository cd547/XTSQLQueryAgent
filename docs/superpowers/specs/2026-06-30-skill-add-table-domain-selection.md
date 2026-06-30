# Skill 表格添加 - 业务域选择功能设计

> **设计日期**: 2026-06-30
> **关联 spec**: [2026-04-12-skill-add-table-design.md](2026-04-12-skill-add-table-design.md)（基础添加表格流程）
> **关联 plan**: [2026-06-30-skill-add-table-domain-selection.md](../plans/2026-06-30-skill-add-table-domain-selection.md)

## 概述

在「添加表格」流程的「生成文件」步骤中新增业务域多选控件。用户在创建或覆盖 DDL 时**必须**为该表选择一个或多个业务域，提交时后端将该表名追加到对应业务域文件（`domains/{id}.json`）的 `tables` 数组中。

## 背景

业务域（business domain）用于把业务表按业务归属分类管理，例如：
- `finance`（财务）：`order_student`、`order_contract` ...
- `course`（课程）：`edu_course`、`edu_class` ...
- `people`（人员）：`admin_user`、`edu_student` ...

域的定义集中维护在 `skills/sql-creator-skill-v2/domain_router_index.json`（含 `id` / `name` / `description`），每个域的表清单存放在 `domains/{id}.json` 的 `tables` 数组中。当前添加表格流程不会自动把新表注册到任何业务域，导致新建的表游离在域体系外，无法被域级路由 / 域级 prompt 检索到。

## 流程

```
[点击添加] → 输入表名 → 检查存在性 → 获取DDL → 选择业务域 → 生成文件 → 完成
                                              ↑ 新增
```

### 步骤 3 改造：在「生成文件」前插入「选择业务域」

1. 用户进入步骤 3 时，前端异步拉取业务域列表
2. 前端展示多选控件（Select mode="multiple"）
3. 用户**必须**至少选择 1 个业务域，否则"生成文件 / 覆盖DDL"按钮 disabled
4. 鼠标悬停某个业务域时，弹出小气泡显示该域的 `description`
5. 用户点击按钮提交，后端将该表名写入所选域文件
6. 失败（域不存在 / 域文件缺失）时给出明确错误并阻止创建

### 不改动的部分

- 步骤 1（输入表名）、步骤 2（获取 DDL）保持不变
- 「覆盖 DDL」分支（表已存在）**也必须**选择业务域，行为与新建保持一致
- table_index.json、ddl/、field_config/ 的写入逻辑保持不变

## 后端 API

### 新增 GET /api/skill/domains

读取 `domain_router_index.json` 中的 `domains` 数组，返回给前端展示。

**Response**:
```json
{
  "success": true,
  "domains": [
    { "id": "finance", "name": "财务", "description": "订单、合同、回款、退款、佣金结算" },
    { "id": "course", "name": "课程", "description": "课程层级、科目、知识点、试卷、排课、班级" }
  ]
}
```

### 修改 POST /api/skill/create-table-files

**Request**（新增 `domains` 字段，必填）：
```json
{
  "tableName": "xxx",
  "ddl": "CREATE TABLE ...",
  "description": "表描述",
  "domains": ["finance", "course"]
}
```

**校验顺序**（任一失败立即返回 400）：
1. `domains` 必须是非空数组
2. 每个 `id` 必须存在于 `domain_router_index.json`
3. `domains/{id}.json` 文件必须存在（**不**自动创建）

**写域流程**（对每个选中的 id）：
- 读 `domains/{id}.json`
- `tables.push(tableName)`（去重：已存在则跳过）
- 写回文件
- 在 `skill_logs` 记录 `add_to_domain` 操作

**覆盖分支**（L419-447）的 DDL 覆盖逻辑保持不变，但**同样**执行上述域写入（确保表存在于用户指定的业务域中）。

**新增错误码**：
| code | 触发 | HTTP |
|------|------|------|
| `DOMAINS_REQUIRED` | domains 数组为空 | 400 |
| `DOMAIN_NOT_FOUND` | id 不在 index | 400 |
| `DOMAIN_FILE_MISSING` | `domains/{id}.json` 不存在 | 400 |
| `DOMAIN_INDEX_MISSING` | `domain_router_index.json` 不存在 | 500 |
| `INVALID_DOMAIN_ID` | path safety 失败 | 400 |

**Response**（成功）：
```json
{
  "success": true,
  "files": ["table_index.json", "ddl/xxx.sql", "field_config/xxx.json"],
  "domains": ["finance", "course"]
}
```

## 文件格式

### 1. domain_router_index.json（仅读，不修改）

```json
{
  "version": "1.0",
  "description": "业务域路由索引",
  "updated_at": "2026-06-11T10:00:00Z",
  "domains": [
    { "id": "finance", "name": "财务", "description": "订单、合同、回款、退款、佣金结算" }
  ]
}
```

### 2. domains/{id}.json（追加 tables 元素）

```json
{
  "id": "finance",
  "name": "财务",
  "tables": [
    "order_student",
    "new_table"  ← 新增元素
  ]
}
```

### 3. 域文件不存在处理

**不**自动创建。若用户希望添加表到新域，必须先：
1. 在 `domain_router_index.json` 注册域
2. 手动创建 `domains/{id}.json`（最少 `{id, name, tables: []}`）

## 前端组件

### AddTableModal step3 改造

**新增 state**：
```javascript
const [addTableDomains, setAddTableDomains] = useState([]);            // 全量域列表
const [addTableSelectedDomains, setAddTableSelectedDomains] = useState([]);  // 选中 ids
const [addTableDomainsLoading, setAddTableDomainsLoading] = useState(false);
```

**加载域列表**（useEffect 监听 addTableStep === 3）：
```javascript
useEffect(() => {
  if (addTableStep === 3 && addTableDomains.length === 0) {
    setAddTableDomainsLoading(true);
    getDomains().then(d => {
      if (d.success) setAddTableDomains(d.domains);
    }).catch(e => message.error('加载业务域失败: ' + e.message))
      .finally(() => setAddTableDomainsLoading(false));
  }
}, [addTableStep, addTableDomains.length]);
```

**多选控件**（step3 顶部，描述输入之后）：
```jsx
<Form.Item
  label="业务域"
  required
  validateStatus={addTableSelectedDomains.length === 0 ? 'warning' : 'success'}
  help={addTableSelectedDomains.length === 0 ? '请至少选择一个业务域' : ' '}
>
  <Select
    mode="multiple"
    placeholder="请选择业务域（必填）"
    value={addTableSelectedDomains}
    onChange={setAddTableSelectedDomains}
    loading={addTableDomainsLoading}
    style={{ width: '100%' }}
    optionLabelProp="label"
  >
    {addTableDomains.map(d => (
      <Select.Option key={d.id} value={d.id} label={d.name}>
        <Tooltip title={d.description} placement="right">
          <span>{d.name}</span>
        </Tooltip>
      </Select.Option>
    ))}
  </Select>
</Form.Item>
```

**按钮 disabled**：
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

**重置表单**（resetAddTableForm）：
```javascript
setAddTableSelectedDomains([]);
```

**handleAddTableStep3 调用**：
```javascript
const data = await createTableFiles(
  addTableName.trim(),
  addTableDDL,
  addTableDescription,
  addTableSelectedDomains   // 新增
);
```

## 行为矩阵

| 场景 | addTableExists | domains 选择 | 按钮 | 后端行为 |
|------|----------------|--------------|------|----------|
| 新建 - 未选域 | false | [] | disabled | 不调用 |
| 新建 - 已选域 | false | ['finance'] | enabled | 创建 ddl/field_config/table_index，写入 finance 表单 |
| 覆盖 - 未选域 | true | [] | disabled | 不调用 |
| 覆盖 - 已选域 | true | ['finance','course'] | enabled | 覆盖 ddl/，table_index 不变，写入 finance + course 表单 |
| 域 id 非法 | 任意 | ['invalid'] | enabled | 400 DOMAIN_NOT_FOUND |
| 域文件缺失 | 任意 | ['new_domain'] | enabled | 400 DOMAIN_FILE_MISSING |
| 域文件无对应 | 任意 | [] | - | 400 DOMAINS_REQUIRED |

## 错误处理

| 场景 | 后端 code | 前端 axios 拦截器（NEW-5 修复已支持）|
|------|-----------|--------------------------------|
| `DOMAINS_REQUIRED` | "请至少选择一个业务域" | message.error |
| `DOMAIN_NOT_FOUND` | "业务域 finance 未在 domain_router_index.json 注册" | message.error |
| `DOMAIN_FILE_MISSING` | "业务域文件缺失: domains/finance.json" | message.error |
| `DOMAIN_INDEX_MISSING` | "domain_router_index.json 不存在"（500）| message.error |

**部分写入不回滚**：与现有 `/create-table-files` 风格一致。失败时已写入的 ddl/field_config/table_index 不会回滚，由用户手动清理。

## 注意事项

1. **域文件必须预存在**：上线前需为 11 个域全部创建 `domains/{id}.json`（已存在则跳过）
2. **域 id 一致性**：domains/ 目录下的文件名必须与 `domain_router_index.json` 中的 `id` 字段完全一致
3. **并发安全**：不同域文件独立写，并发无冲突；同一文件并发写时 last-write-wins（push 同一表名是幂等操作，安全）
4. **缓存**：domain_router_index.json 不缓存（极少变更）；domains/*.json 不缓存（每次写后 fs.watch 触发的 mtime 兜底会重建缓存）
5. **日志**：每个域写入都会在 `skill_logs` 表新增一条 `add_to_domain` 记录

## 测试矩阵

### 后端

| # | 用例 | 预期 |
|---|------|------|
| 1 | GET /skills/domains，index 存在 11 个域 | 返回 11 条 |
| 2 | GET /skills/domains，index 不存在 | 返回空数组 |
| 3 | POST /create-table-files，domains 为空 | 400 DOMAINS_REQUIRED |
| 4 | POST /create-table-files，id 在 index 不存在 | 400 DOMAIN_NOT_FOUND |
| 5 | POST /create-table-files，domains/{id}.json 缺失 | 400 DOMAIN_FILE_MISSING |
| 6 | POST /create-table-files（新建），合法域 | 创建 + 域文件含新表 |
| 7 | POST /create-table-files（覆盖），合法域 | 覆盖 ddl + 域文件含新表 |
| 8 | POST /create-table-files，重复添加同一表 | 域文件 tables 数组不重复 |
| 9 | POST /create-table-files，domain_router_index.json 缺失 | 500 DOMAIN_INDEX_MISSING |
| 10 | POST /create-table-files，恶意 id 触发 path safety | 400 INVALID_DOMAIN_ID |

### 前端（手动 / e2e）

| # | 用例 | 预期 |
|---|------|------|
| 1 | 进入 step 3 看到多选控件 | 控件可见、显示所有域 |
| 2 | 鼠标悬停某个域 | 弹气泡显示 description |
| 3 | 未选域时按钮 | disabled |
| 4 | 选择域后按钮 | enabled |
| 5 | 取消选择 | 按钮恢复 disabled |
| 6 | 提交时后端返回 400 DOMAIN_FILE_MISSING | message.error 提示 |
| 7 | 关闭 Modal 再打开 | 选中和域列表都重置 |

## 文件变更总览

| 文件 | 类型 | 改动 |
|------|------|------|
| `backend/src/routes/skill.js` | 修改 | + ~80 行：GET /skills/domains、helper `addTableToDomains`、`/create-table-files` 接入 |
| `frontend/src/api/index.js` | 修改 | + `getDomains` 函数、改 `createTableFiles` 签名 |
| `frontend/src/App.jsx` | 修改 | + 3 useState + useEffect + UI + 按钮 disabled + reset |
| `backend/test-skill-domains.mjs` | 新建 | 后端 10 条测试 |

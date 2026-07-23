# `validate_sql_fields` 工具 — SQL 质量最后一道关

**日期**：2026-07-23
**状态**：🟡 设计阶段（待评审后实施）
**关联文档**：[2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md)（上一阶段精简方案）
**关联文件**：
- `backend/src/services/toolFuncs.js`（新增工具实现）
- `backend/src/services/sqlParser.js`（新增，封装 `node-sql-parser`）
- `backend/src/services/sqlValidator.js`（路由层兑底集成）
- `backend/src/services/llm.js`（工具注册 + checklist）
- `backend/src/routes/query.js`（执行前再校验）
- `skills/sql-creator-skill-v2/SKILL.md`（同步精简 5-6 条规则）
- `backend/package.json`（新增 `node-sql-parser` 依赖）

---

## 1. 背景与目标

### 1.1 上一阶段的成果（2026-07-23）

[2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 已完成：
- ✅ `request_user_choice` 入参自动 escape
- ✅ SKILL.md L91-95 删除（5 行）
- ✅ SKILL.md L20-25、L36、L50-52、L51-54 4 处同步精简
- ✅ dev watch 范围限制（`--watch-path=src`）

**但 SKILL.md 仍有 ~96 行**，含 5-6 条"可由工具强制"的格式规则。每次新增 SQL 规则都要先评估"代码层 vs 提示词"（[方案文档 §0 调研结论](file:///d:/Ai_Program_Files/XTSQLQueryAgent/docs/superpowers/plans/2026-07-20-skill-md-simplification.md#L9)）。

### 1.2 本次目标

**新增 `validate_sql_fields` 工具**，集中覆盖 6 类 SQL 质量校验，让 LLM 自由输出 SQL，工具层兜底：

| 目标 | 度量 |
|---|---|
| 防止字段幻觉（`et.mobile` 类错误）| 单元测试覆盖 ≥ 5 case |
| 替代 SKILL.md 5-6 条格式规则 | 删后 SKILL.md 从 96 行 → ~60 行 |
| 减少 LLM 认知负担 | 删"字段别名反引号" "MySQL 5.7 限制"等机械规则 |
| 多层防御 | LLM 主动调 + 路由兑底 |

### 1.3 范围外

- 不修改 `request_user_choice` / `request_tag_confirmation` 的实现
- 不改数据库 schema
- 不改 SSE 事件流协议
- 不改速率限制策略

---

## 2. 核心设计原则

### 2.1 工具定位

**不是**"防止幻觉的自检工具"，而是 **"SQL 质量最后一道关（multi-rule validator）"**——一次调用完成 6 类校验。

### 2.2 6 类校验规则

| # | 规则 | 来源 SKILL.md | 替代该规则后 SKILL.md 减少 | 复杂度 |
|---|---|---|---|---|
| R1 | **字段-表归属校验** | 铁律 5a 字段-表归属校验 ✓ | 不删（核心铁律保留为过程约束）| 中 |
| R2 | **字段别名反引号** | 第 6 条：别名含特殊字符（括号、空格、中文括号等）必须用反引号 | -1 行 | 低 |
| R3 | **MySQL 5.7 限制检测** | 第 7 条：禁窗口函数/CTE/JSON_TABLE | 🟡 **暂保留**（用户决策：改动太大，SKILL.md 仅 1 行）| 中 |
| R4 | **del 字段过滤规则** | 第 4.2 条 + 系统约定 2 | -3 行 | 中 |
| R5 | **LIMIT 子句检测** | 系统约定 5：查询必须包含 LIMIT，默认 1000 | -1 行 | 低 |
| R6 | **关联字段有效性** | 第 4 条：关联表 JOIN 字段必须存在 | 不删（语义判断）| 中 |

**用户决策（2026-07-23 AskUserQuestion）**：
- R3（MySQL 5.7 限制）**暂保留**——SKILL.md 仅 1 行，工具改造工作量不划算
- 实际可替代：**R2 / R4 / R5 共 3 条规则**

### 2.3 SQL 解析方案

**用户决策（2026-07-23 AskUserQuestion）**：选 B. **`node-sql-parser`**

| 维度 | A. 自实现词法 | **B. node-sql-parser** | C. 全 regex |
|---|---|---|---|
| MySQL 5.7 覆盖 | 子集 | **完整** | 子集 |
| 嵌套子查询 | 需手动处理 | **支持** | 漏报 |
| CASE WHEN | 复杂 | **支持** | 易漏 |
| 工作量 | 2-3h（调试边界 case）| **0.5h（安装 + 试调）** | 1h |
| 依赖 | 无 | **+1 依赖（~500KB）** | 无 |
| 漏报率 | 中 | **极低** | 高 |

**结论**：选 B，引入 `node-sql-parser`（已在 npm 生态成熟维护）。

### 2.4 调用时机

**用户决策（2026-07-23 AskUserQuestion）**：LLM 主动调 + 路由兑底

| 时机 | 触发位置 | 作用 |
|---|---|---|
| **T0：LLM 准备输出 SQL 前** | LLM 主动调 `validate_sql_fields` | 拿到错误信息 → 可改 SQL |
| **T1：路由层执行 SQL 前** | `/api/query/execute` 强制再调 | 防止 LLM 跳过 T0 调用 |

---

## 3. 工具签名与返回结构

### 3.1 工具签名

```javascript
{
  name: "validate_sql_fields",
  description: "校验 SQL 中的字段-表归属、字段别名反引号、del 过滤规则、LIMIT 子句。返回 {valid, errors[], warnings[]}。建议在最终 SQL 输出前调用。",
  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "待校验的 SQL 语句"
      },
      tables: {
        type: "array",
        items: { type: "string" },
        description: "SQL 中涉及的表名列表（用于加载 DDL）"
      }
    },
    required: ["sql", "tables"]
  }
}
```

### 3.2 返回结构

```javascript
{
  valid: true,            // errors 是否为空
  errors: [               // 阻塞性错误（LLM 必须修改）
    {
      rule: "R1_FIELD_OWNERSHIP",
      message: "字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）。mobile 字段在 admin_user 中。",
      sqlSnippet: "et.mobile",
      suggestion: "改为 au.mobile"
    }
  ],
  warnings: [             // 提示性警告（LLM 建议修改但不强制）
    {
      rule: "R2_BACKTICK_ALIAS",
      message: "字段别名「金额(元)」未用反引号包裹",
      sqlSnippet: "AS 金额(元)",
      suggestion: "改为 AS `金额(元)`"
    }
  ],
  summary: "1 error, 1 warning"  // 便于 LLM 快速判断
}
```

### 3.3 错误信息格式

**原则**：错误信息要 **可操作**（LLM 拿到就知道怎么改），不只说"错了"。

格式模板：
```
[{rule_code}] {具体问题}。{建议改法}。
```

示例：
- ✅ `[R1_FIELD_OWNERSHIP] 字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）。mobile 字段在 admin_user 中，建议改为 au.mobile。`
- ❌ `[R1] 字段不存在`（太简略）

---

## 4. 6 类校验规则详解

### R1：字段-表归属校验（防幻觉核心）

**触发条件**：解析 SQL 提取所有 `table_alias.field` 引用，对每张表 DDL 校验该字段是否在该表中。

**实现**：
```javascript
// 1. node-sql-parser 解析 SQL
const ast = parser.astify(sql, { database: 'mysql' });

// 2. 遍历 AST 提取所有 column ref
const columnRefs = extractColumnRefs(ast);
// → [{table: 'et', column: 'mobile'}, {table: 'au', column: 'id'}, ...]

// 3. 加载 tables 的 DDL
const ddlMap = await loadDDLs(tables);

// 4. 提取每个表的 columns
const columnsMap = {};
for (const table of tables) {
  columnsMap[table] = extractColumnsFromDDL(ddlMap[table]);
}

// 5. 校验
for (const ref of columnRefs) {
  const table = aliasToTableMap[ref.table];
  if (!table) {
    errors.push({
      rule: 'R1_FIELD_OWNERSHIP',
      message: `未知别名: ${ref.table}`,
      sqlSnippet: `${ref.table}.${ref.column}`,
    });
    continue;
  }
  if (!columnsMap[table].includes(ref.column)) {
    errors.push({
      rule: 'R1_FIELD_OWNERSHIP',
      message: `字段 ${ref.table}.${ref.column} 不在表 ${table} 的 DDL 中（疑似幻觉）`,
      sqlSnippet: `${ref.table}.${ref.column}`,
      suggestion: `查 ${table} 的 DDL 找正确字段名`,
    });
  }
}
```

**关键依赖**：
- SQL 解析（`node-sql-parser`）
- DDL 缓存（避免每次重新读盘）

### R2：字段别名反引号

**触发条件**：检测 `AS <别名>` 中别名含特殊字符（括号、空格、中文括号等）但未用反引号包裹。

**实现**：
```javascript
// 1. 提取所有 SELECT 别名
const aliases = extractAliases(ast);
// → [{name: '金额(元)', hasBacktick: false}, ...]

// 2. 检测特殊字符
const SPECIAL_CHARS = /[\(\)\s\u4e00-\u9fff]/;
for (const alias of aliases) {
  if (SPECIAL_CHARS.test(alias.name) && !alias.hasBacktick) {
    warnings.push({
      rule: 'R2_BACKTICK_ALIAS',
      message: `字段别名「${alias.name}」含特殊字符但未用反引号包裹`,
      sqlSnippet: `AS ${alias.name}`,
      suggestion: `改为 AS \`${alias.name}\``,
    });
  }
}
```

### R4：del 字段过滤规则

**触发条件**：检测 `LEFT JOIN ... ON ... AND t_b.del = 0` 模式（违反 4.2 默认不过滤规则）。

**实现**：
```javascript
// 1. 提取所有 JOIN ON 条件
const joinConditions = extractJoinConditions(ast);
// → [{type: 'LEFT', table: 'edu_teacher', alias: 'et', onExpr: '... AND et.del = 0'}]

// 2. 检测末尾追加 del/deleted 过滤
for (const join of joinConditions) {
  if (join.type === 'LEFT' && /\bAND\s+\w+\.(del|deleted)\s*=\s*0\s*$/i.test(join.onExpr)) {
    // 检查 join_condition 是否在 field_config 中显式包含
    if (!joinConditionExplicitlyHasDel(join)) {
      warnings.push({
        rule: 'R4_DEL_IN_JOIN',
        message: `LEFT JOIN ${join.table} ON 子句末尾追加了 ${join.alias}.del = 0，违反 4.2 规则`,
        sqlSnippet: join.onExpr,
        suggestion: `删除 ON 末尾的 AND ${join.alias}.del = 0；如需过滤已删除的关联行，改为 WHERE ${join.alias}.id IS NULL OR ${join.alias}.del = 0`,
      });
    }
  }
}
```

### R5：LIMIT 子句检测

**触发条件**：检测 SELECT 语句无 LIMIT 子句（应用层会截断但体验降级）。

**实现**：
```javascript
// 1. 检测是否 SELECT
if (ast.type !== 'select') return;

// 2. 检测是否有 LIMIT
if (!ast.limit) {
  warnings.push({
    rule: 'R5_MISSING_LIMIT',
    message: 'SELECT 语句无 LIMIT 子句，应用层会截断到 1000 行（建议显式 LIMIT 1000）',
    sqlSnippet: '末尾',
    suggestion: '追加 LIMIT 1000',
  });
}
```

---

## 5. LLM 主动调用流程

### 5.1 工具注册

在 `llm.js` 的 tools 列表中注册 `validate_sql_fields`：

```javascript
// backend/src/services/toolFuncs.js
export const tools = [
  // ... 现有工具
  {
    name: "validate_sql_fields",
    description: "...",
    func: validateSqlFields,
  }
];
```

### 5.2 调用流程变化

**之前（6 轮）**：
```
TURN 1: Round 0-3（domain_index, sliced_index, schema+ddl, request_user_choice）
TURN 2: Round 0-1（user_choice 注入 → 生成 SQL）
```

**之后（7 轮）**：
```
TURN 1: Round 0-3（同上）
TURN 2: Round 0-2（user_choice 注入 → 调 validate_sql_fields → 拿到错误重写 → 生成 SQL）
```

**关键差异**：
- Round 0（user_choice 注入）后，LLM 不是直接生成 SQL，而是**先调** `validate_sql_fields`
- 拿到 errors 后 LLM 重写 SQL → 再调 `validate_sql_fields` 确认 → 输出最终 SQL
- 如果一次通过（无 errors），流程是 Round 0 → Round 1（validate_sql_fields）→ Round 2（最终 SQL），共 +1 轮
- 如果重写 1 次，流程是 Round 0 → Round 1（validate_sql_fields 失败）→ Round 2（重写）→ Round 3（最终 SQL），共 +2 轮

### 5.3 SKILL.md 调用约束

在 SKILL.md 铁律部分新增：

```markdown
5. **【新】输出 SQL 前必调 `validate_sql_fields`**：
   - LLM 准备输出 SQL 时，必须先调 `validate_sql_fields` 校验。
   - 拿到 `errors` → 必须重写 SQL → 再调一次确认。
   - 拿到 `warnings` → 建议修改；不修改也可输出（仅警告）。
   - 跳过调用 = 程序会在路由层强制再校验并报错，浪费时间。
```

### 5.4 工具注册表更新

在 `llm.js:347` 的 `sessionToolRegistries` Map 中新增字段：

```javascript
{
  // ... 现有字段
  validateSqlFieldsCalled: false,  // 是否调过 validate_sql_fields
  validateSqlFieldsPassed: false,  // 上次是否通过
}
```

并在 `buildToolCallChecklistMessage` 中追加：

```
- validate_sql_fields: {called|called-passed|called-failed}
```

让 LLM 知道当前是否已校验。

---

## 6. 路由层兑底

### 6.1 集成点

`/api/query/execute` 和 `/api/query/explain` 路由在 `validateReadOnlySql` 之后、实际执行之前，**强制再调** `validateSqlFields`：

```javascript
// backend/src/routes/query.js
const sqlCheck = validateReadOnlySql(sql, EXECUTE_SQL_OPTIONS);
if (!sqlCheck.valid) {
  return res.status(400).json({ error: sqlCheck.message, ... });
}

// ★ 新增：路由层兑底
//   提取 SQL 中涉及的表（从 FROM/JOIN 子句）
const tables = extractTablesFromSql(sql);
const fieldCheck = await validateSqlFields({ sql, tables });
if (!fieldCheck.valid) {
  return res.status(400).json({
    error: 'SQL 字段校验失败',
    code: 'FIELD_VALIDATION_FAILED',
    details: fieldCheck.errors,
  });
}
```

### 6.2 提取表名

复用 `node-sql-parser`：

```javascript
function extractTablesFromSql(sql) {
  const ast = parser.astify(sql, { database: 'mysql' });
  return parser.tableList(sql, { database: 'mysql' });
  // → ['edu_study', 'admin_user', 'edu_teacher']
}
```

### 6.3 错误信息传递

路由层错误要包含具体哪个字段错了，便于用户排查：

```json
{
  "error": "SQL 字段校验失败",
  "code": "FIELD_VALIDATION_FAILED",
  "details": [
    {
      "rule": "R1_FIELD_OWNERSHIP",
      "message": "字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）。mobile 字段在 admin_user 中。",
      "sqlSnippet": "et.mobile",
      "suggestion": "改为 au.mobile"
    }
  ]
}
```

前端可展示为友好的错误提示。

---

## 7. SKILL.md 同步精简方案

### 7.1 待删规则

| # | SKILL.md 当前行 | 内容 | 工具替代 |
|---|---|---|---|
| 1 | 第 35 行 | **字段别名**：别名含特殊字符（括号、空格、中文括号等）时必须用反引号 | R2 |
| 2 | 第 50-52 行 | `del` / `deleted`：0=未删除... WHERE 子句默认过滤 `= 0`... | R4 部分 |
| 3 | 第 56 行 | 查询必须包含 `LIMIT`，默认 1000 | R5 |
| 4 | 第 71-75 行 | 【硬性要求】`**SQL**:` 后面必须是 ```sql ... ``` 代码块 | **保留**（与字段校验无关）|
| 5 | 第 7 条 | MySQL 5.7 限制 | 🟡 保留（用户决策）|

**预计减少**：~3-4 行（含空白行和说明）

### 7.2 待改规则

| # | SKILL.md 当前行 | 改法 |
|---|---|---|
| 1 | 铁律部分（5a 字段-表归属）| 改写为"必调 validate_sql_fields，拿到 errors 必须重写" |
| 2 | 核心规则 4.2 del 过滤 | 精简表述，细节由 R4 兜底 |
| 3 | 系统约定 2 del 字段语义 | 简化为"见 4.2" |

### 7.3 精简后预估

| 段 | 现在 | 精简后 | 变化 |
|---|---|---|---|
| 核心规则 | ~50 行 | ~40 行 | -20% |
| 系统约定 | ~10 行 | ~5 行 | -50% |
| 输出格式 | ~17 行 | ~17 行 | 不变 |
| 标签纠正 | ~9 行 | ~9 行 | 不变 |
| 用户交互 | ~10 行 | ~10 行 | 不变 |
| **合计** | **~96 行** | **~81 行** | **-16%** |

---

## 8. 实施分步

### 8.1 第 1 步：基础设施（~3h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 安装 `node-sql-parser` | `backend/package.json` | 0.1h |
| 封装 `parser.js`（AST 解析 + 表名提取 + 列引用提取）| `backend/src/services/sqlParser.js` | 2h |
| 写 5-10 个 parser 单元测试 | `backend/test-parser.mjs` | 0.5h |
| 写 `extractColumnsFromDDL()` 工具 | `backend/src/services/ddlUtils.js` | 0.3h |
| **小计** | | **~3h** |

### 8.2 第 2 步：工具实现（~4h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 实现 `validateSqlFields()` 主函数 | `backend/src/services/toolFuncs.js` | 2h |
| 实现 R1 字段-表归属校验 | 同上 | 1h |
| 实现 R2 / R4 / R5 规则 | 同上 | 1h |
| **小计** | | **~4h** |

### 8.3 第 3 步：注册 + SKILL.md（~1.5h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 工具注册到 `tools` 列表 | `backend/src/services/llm.js` | 0.5h |
| `sessionToolRegistries` 加字段 | 同上 | 0.2h |
| `buildToolCallChecklistMessage` 追加 | 同上 | 0.2h |
| SKILL.md 精简 3 条规则 | `skills/sql-creator-skill-v2/SKILL.md` | 0.5h |
| SKILL.md 铁律加"必调 validate_sql_fields" | 同上 | 0.3h |
| **小计** | | **~1.7h** |

### 8.4 第 4 步：路由兑底（~1.5h）

| 任务 | 文件 | 估时 |
|---|---|---|
| query.js 集成 `validateSqlFields` | `backend/src/routes/query.js` | 0.5h |
| 前端错误信息展示 | `frontend/src/components/...` | 0.5h |
| 错误信息字段传递（errors, warnings, summary）| `backend/src/routes/query.js` | 0.3h |
| **小计** | | **~1.3h** |

### 8.5 第 5 步：测试（~2h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 工具单元测试（6 类规则各 5 case）| `backend/test-validate-sql-fields.mjs` | 1.5h |
| 端到端：清空日志，问"查询今天上课的老师" | `logs/2026-07-23/admin_llm.log` | 0.5h |
| 验证 `au.mobile`（不是 `et.mobile`）| 同上 | （含在端到端中）|
| **小计** | | **~2h** |

### 8.6 总计

| 阶段 | 估时 |
|---|---|
| 1. 基础设施 | 3h |
| 2. 工具实现 | 4h |
| 3. 注册 + SKILL.md | 1.7h |
| 4. 路由兑底 | 1.3h |
| 5. 测试 | 2h |
| **合计** | **~12h** |

---

## 9. 验证方案

### 9.1 单元测试

#### Parser 单元测试（5+ case）

| # | SQL | 期望 |
|---|---|---|
| 1 | `SELECT id FROM edu_study` | tables: ['edu_study'], columns: [{table: null, col: 'id'}] |
| 2 | `SELECT t1.id, t2.name FROM a t1 JOIN b t2 ON t1.id = t2.a_id` | tables: ['a', 'b'], columns: [...] |
| 3 | `SELECT CASE WHEN del=0 THEN 'active' END FROM t` | 不崩，AST 正确 |
| 4 | `SELECT id FROM t1 WHERE id IN (SELECT id FROM t2)` | 嵌套子查询正确解析 |
| 5 | `SELECT et.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id` | 提取 ['et', 'mobile'] 等 |

#### 工具单元测试（6 类规则各 5 case = 30 case）

| 规则 | case 数 | 覆盖点 |
|---|---|---|
| R1 字段-表归属 | 5 | 字段不存在、别名未注册、嵌套子查询、CASE WHEN、JOIN 字段 |
| R2 字段别名反引号 | 5 | 中文括号、英文括号、空格、纯中文（无需反引号）、已加反引号 |
| R4 del 过滤规则 | 5 | LEFT JOIN ON 末尾追加 del=0、INNER JOIN 不报、field_config 声明例外、WHERE 子句 del=0（不报）|
| R5 LIMIT 子句 | 5 | 无 LIMIT、有限制、UNION 子句、含子查询的 LIMIT |
| 错误信息格式 | 5 | message 含 sqlSnippet、suggestion 可操作、rule code 正确 |
| 边界 case | 5 | 空 SQL、单表、UNION、CROSS JOIN、复杂表达式 |

### 9.2 端到端

清空 `logs/2026-07-23/admin_llm.log`，提问"查询今天上课的老师"。

**期望**：
- ✅ LLM 在最终 SQL 输出前调 `validate_sql_fields`
- ✅ 工具返回 `valid: true`（因为 SQL 已正确）
- ✅ 路由层兑底也通过
- ✅ 工具调用次数 ≤ 7 轮
- ✅ 最终 SQL 仍是 `au.mobile`（不是 `et.mobile`）

### 9.3 负向 case

故意构造错误 SQL：
```sql
SELECT et.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id
```

**期望**：
- ✅ LLM 调 `validate_sql_fields` → 工具返回 errors: [{rule: 'R1', message: 'et.mobile 不在 edu_teacher DDL 中...'}]
- ✅ LLM 重写为 `au.mobile`
- ✅ 再调 `validate_sql_fields` → 通过
- ✅ 输出最终 SQL

---

## 10. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-1 | `node-sql-parser` 不支持 MySQL 5.7 某些语法 | 中 | 实施前先跑 5-10 个真实 SQL 测试 |
| R-2 | LLM 跳过调用 `validate_sql_fields` | 中 | 路由兑底强制再校验；SKILL.md 强调"必调" |
| R-3 | 工具增加 +1 轮延迟（3-5s）| 中 | 接受；长期可优化为 LLM 一次输出即带校验 |
| R-4 | 错误信息不可操作（LLM 不知道怎么改）| 中 | 单元测试覆盖错误信息；LLM 重试时给具体改法 |
| R-5 | DDL 文件读取慢（每张表 50ms × 多表 = 200ms）| 中 | 加内存缓存（按 mtime 失效）|
| R-6 | 工具返回结构不兼容现有 LLM 调用 | 低 | 复用现有 `DynamicTool` 框架；返回 JSON 字符串 |
| R-7 | SKILL.md 精简过度，LLM 反而表现下降 | 中 | 保留铁律和核心规则；只删 3 条机械规则 |
| R-8 | 路由兑底报错信息不友好 | 低 | 前端做错误提示格式化 |
| R-9 | `validate_sql_fields` 工具被剪枝后 LLM 无法调用 | 中 | 工具不属于一次性调用（多次可调），不剪枝 |

---

## 11. 关键决策记录

| # | 决策 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| D-1 | SQL 解析方式 | A 自实现 / B node-sql-parser / C 全 regex | **B** | 用户决策（2026-07-23 AskUserQuestion）|
| D-2 | 调用时机 | 仅 LLM / 仅路由 / 两者 | **两者** | 用户决策（2026-07-23 AskUserQuestion）|
| D-3 | SKILL.md 精简范围 | 同步精简 / 不动 | **同步精简** | 用户决策（2026-07-23 AskUserQuestion）|
| D-4 | MySQL 5.7 限制是否替代 | 替代 / 保留 | **保留** | 用户附加决策：SKILL.md 仅 1 行，工具改造工作量不划算 |
| D-5 | 工具命名 | validate_sql_fields / check_sql / sql_quality_check | **validate_sql_fields** | 与现有 `request_*` / `get_*` 命名风格一致 |
| D-6 | 错误信息格式 | JSON / markdown 列表 | **JSON 结构化** | LLM 易解析；前端可展示 |
| D-7 | 工具注册 | 一次性 / 每次会话 | **每次会话** | 不剪枝（多次可调）|

---

## 12. 备注

- `validate_sql_fields` 与 `request_user_choice` 是**互补**关系：前者是 SQL 质量关，后者是用户交互关
- 工具返回值会进入 LLM context（作为 tool result），所以**返回结构要紧凑**——避免 LLM 上下文过载
- DDL 缓存按 mtime 失效，避免每次重新读盘
- 本文档不重复 [2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 中已写的上下文，重点在新增工具的设计
- 实施后应在 [2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 第 4 节"改造工作量"中追加"第 3 步"指向本文档

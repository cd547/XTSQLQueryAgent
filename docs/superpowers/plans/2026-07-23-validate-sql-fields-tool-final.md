# `validate_sql_fields` 工具 — SQL 质量最后一道关

**日期**：2026-07-23
**状态**：✅ 设计定稿（v5：SKILL.md 引导 + 工具兜底 协同）
**关联文档**：[2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md)（上一阶段精简方案）
**关联文件**：
- `backend/src/services/toolFuncs.js`（新增 export validateSqlFields）
- `backend/src/services/validators.js`（新增，4 个验证器 + 主入口，单文件）
- `backend/src/services/sqlParser.js`（新增，封装 `node-sql-parser`）
- `backend/src/services/ddlUtils.js`（新增，`loadColumnsMap` 复用 `getTableDDL`）
- `backend/src/services/fieldConfigUtils.js`（新增，`loadFieldAliases`）
- `backend/src/services/llm.js`（工具注册 + sessionToolRegistries + checklist 追加）
- `skills/sql-creator-skill-v2/SKILL.md`（精简 3 条机械规则文字；改写 1 条铁律）
- `backend/package.json`（新增 `node-sql-parser` 依赖）
- `skills/sql-creator-skill-v2/field_config/{table}.json`（R1 联合加载 `field_aliases`）

**v5 关键变更**（相比 v4）：
- ❌ **删除路由层兑底**（§6 整段移除）
- ❌ **删除 T1 调用时机**：只剩 T0（LLM 主动调）
- ✅ **SKILL.md 改为"文字精简"**（不删行）：3 条机械规则保留但变简洁，工具同步兜底
- ✅ **新增 §7.0 核心原则**："SKILL.md 引导 + 工具兜底" 协同理念
- ✅ **总工作量**：10h → **9h**（少 1h 路由集成）

---

## 1. 背景与目标

### 1.1 问题

LLM 生成 SQL 存在两类质量问题：
- **字段幻觉**：`SELECT et.mobile FROM edu_teacher et JOIN admin_user au ...` —— `mobile` 字段在 `admin_user` 不在 `edu_teacher`，LLM 写错表
- **机械规则违反**：别名缺反引号、用到 CTE/窗口函数、漏 LIMIT 等

[2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 已完成 LLM 流式输出、escape、watch 范围等改造。本次聚焦：**把机械规则下沉到工具层**，让 SKILL.md 只剩"LLM 必须用脑子判断的事"。

### 1.2 目标

| 目标 | 度量 |
|---|---|
| 防止字段幻觉（`et.mobile` 类错误）| 单元测试覆盖 ≥ 5 case |
| SKILL.md 3 条机械规则文字精简 | 删 L29 例子 / 删 L31 "替代方案" / 改 L57 措辞（行数不变）|
| SKILL.md 引导 + 工具兜底 | LLM 首次写对，工具确认（避免 试探-失败-重写 循环）|
| 工具只服务于 LLM | 路由层不参与（不在执行前再校验）|

### 1.3 范围外

- **不修改 `/api/query/execute` 路由**（不参与 SQL 执行前的兜底校验）
- **不修改 `/api/query/explain` 路由**（同上）
- 不修改 `request_user_choice` / `request_tag_confirmation` 的实现
- 不改数据库 schema
- 不改 SSE 事件流协议
- 不改速率限制策略
- 不改 sqlValidator（已覆盖危险 SQL 拦截，工具不重复）

**核心原则**：工具只服务于 LLM 流。**路由层的事**（执行前校验、危险 SQL 拦截、性能截断）由 `sqlValidator`、`/api/query/execute` 现有逻辑负责，**工具不接管**。详见 §6.1。

---

## 2. 核心设计原则

### 2.1 工具定位

**LLM 输出 SQL 前的自检工具**——一次调用完成 4 类校验，**只服务于 LLM**，路由层不参与。

### 2.2 4 类校验规则

| # | 规则 | 来源 SKILL.md | SKILL.md 改动 | 复杂度 |
|---|---|---|---|---|
| R1 | 字段-表归属校验 | 铁律 5a 字段-表归属校验 ✓ | 改写为"必调 `validate_sql_fields`" | 中 |
| R2 | 字段别名反引号 | 第 6 条 L29 | 删例子 `amount AS \`金额(元)\`` | 低 |
| R3 | MySQL 5.7 限制检测 | 第 7 条 L31 | 删"替代方案：子查询、临时表、JSON_EXTRACT" | 低（parser 顺带）|
| R5 | LIMIT 子句检测 | 系统约定 5 L57 | 改"必须"为"工具 R5 强制检测" | 低 |

**不纳入工具的规则**（保留在 SKILL.md）：
- **R4 del 过滤规则** → SKILL.md L20-25 保留（业务规则由 LLM 决策）
- **R6 关联字段有效性** → 合并到 R1（字段-表归属已覆盖 JOIN 字段）

### 2.3 SQL 解析方案

**选定 `node-sql-parser`**（npm 成熟维护，~500KB）：

| 维度 | 自实现词法 | **node-sql-parser** | 全 regex |
|---|---|---|---|
| MySQL 5.7 覆盖 | 子集 | **完整** | 子集 |
| 嵌套子查询 | 需手动处理 | **支持** | 漏报 |
| CASE WHEN | 复杂 | **支持** | 易漏 |
| 工作量 | 2-3h | **0.5h（安装 + 试调）** | 1h |
| 漏报率 | 中 | **极低** | 高 |

### 2.4 调用时机

**仅 LLM 主动调**（T0）：

| 时机 | 触发位置 | 作用 |
|---|---|---|
| **T0：LLM 准备输出 SQL 前** | LLM 主动调 `validate_sql_fields` | 拿到 errors → 必须重写 SQL → 再调一次确认 |

不参与的环节：
- ❌ 路由层 `/api/query/execute`（sqlValidator 已负责安全检查）
- ❌ 路由层 `/api/query/explain`（仅执行 EXPLAIN 不影响数据）
- ❌ 前端错误展示（错误已在 LLM 流中消化）

---

## 3. 工具签名与返回结构

### 3.1 工具签名

```javascript
{
  name: "validate_sql_fields",
  description: "校验 SQL 中的字段-表归属、字段别名反引号、MySQL 5.7 限制（CTE/窗口函数/JSON_TABLE）、LIMIT 子句。返回 {valid, errors, summary}。建议在最终 SQL 输出前调用。",
  parameters: {
    type: "object",
    properties: {
      sql: { type: "string", description: "待校验的 SQL 语句" }
      // tables 参数去掉：工具内部用 parser.tableList(sql) 自动提取
    },
    required: ["sql"]
  }
}
```

### 3.2 返回结构

**设计原则**：工具只负责"报错"，不负责"开方"——所有校验不通过项统一为 `errors`，**不设 warnings**。**不提供 suggestion 字段**。

```javascript
{
  valid: true,            // errors 是否为空
  errors: [               // 所有校验不通过项（4 类规则都进 errors）
    {
      rule: "R1_FIELD_OWNERSHIP",
      message: "字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）",
      sqlSnippet: "et.mobile"
    }
  ],
  summary: "1 error"
}
```

### 3.3 错误信息格式

**原则**：错误信息要 **具体**（告诉 LLM 错在哪），不 **开方**（不给改法）。

格式：`[{rule_code}] {具体问题描述}。`

示例：
- ✅ `[R1_FIELD_OWNERSHIP] 字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）`
- ✅ `[R2_BACKTICK_ALIAS] 字段别名「金额(元)」含特殊字符但未用反引号包裹`
- ✅ `[R3_MYSQL57_LIMIT] MySQL 5.7 不支持 CTE（WITH ... AS）`
- ✅ `[R5_MISSING_LIMIT] SELECT 语句无 LIMIT 子句`
- ❌ `[R1] 字段不存在`（太简略）
- ❌ `[R1] ... 建议改为 au.mobile`（越权，工具不应给建议）

---

## 4. 4 类校验规则（单文件实现）

**设计**：4 个验证器放在一个文件 `backend/src/services/validators.js`，每个 export 独立函数。**未来如某个验证器变得复杂（>200 行），可单独拆出。**

### R1：字段-表归属校验（防幻觉核心）

**触发条件**：解析 SQL 提取所有 `table_alias.field` 引用，对每张表 DDL 校验字段是否存在。

**实现**：
```javascript
// backend/src/services/validators.js

/**
 * R1 字段-表归属校验
 * @param {object} ctx - {sql, ast, tables, columnsMap}
 * @returns {Array<{rule, message, sqlSnippet}>}
 */
export function validateR1FieldOwnership(ctx) {
  const errors = [];
  const { ast, columnsMap } = ctx;

  // 1. 提取所有 column ref
  const columnRefs = extractColumnRefs(ast);
  // → [{table: 'et', column: 'mobile'}, {table: 'au', column: 'id'}, ...]

  // 2. 解析别名 → 真实表
  const aliasMap = buildAliasToTableMap(ast, ctx.tables);

  // 3. 逐个校验
  for (const ref of columnRefs) {
    const table = aliasMap[ref.table];
    if (!table) {
      errors.push({
        rule: 'R1_FIELD_OWNERSHIP',
        message: `未知别名: ${ref.table}`,
        sqlSnippet: `${ref.table}.${ref.column}`,
      });
      continue;
    }
    if (!columnsMap.get(table)?.has(ref.column)) {
      errors.push({
        rule: 'R1_FIELD_OWNERSHIP',
        message: `字段 ${ref.table}.${ref.column} 不在表 ${table} 的 DDL 中（疑似幻觉）`,
        sqlSnippet: `${ref.table}.${ref.column}`,
      });
    }
  }
  return errors;
}
```

**依赖**：
- `extractColumnRefs(ast)` — 递归遍历 AST 提取所有 column 引用
- `buildAliasToTableMap(ast, tables)` — 把 `et` 映射到 `edu_teacher`
- `columnsMap: Map<table, Set<column>>` — 共享上下文（外部传入）

### R2：字段别名反引号（纯 regex）

**触发条件**：检测 `AS <别名>` 中别名含特殊字符（括号、空格、中文括号等）但未用反引号包裹。

```javascript
/**
 * R2 字段别名反引号
 * @param {object} ctx - {sql}
 * @returns {Array<{rule, message, sqlSnippet}>}
 */
export function validateR2BacktickAlias(ctx) {
  const errors = [];
  const SPECIAL_CHARS = /[\(\)\s\u4e00-\u9fff]/;
  const aliasPattern = /\bAS\s+(`[^`]+`|'[^']+'|"[^"]+"|[\u4e00-\u9fff\w]+)/gi;

  for (const match of ctx.sql.matchAll(aliasPattern)) {
    const raw = match[1];
    if (/^[`'"]/.test(raw)) continue;  // 跳过已包裹
    if (SPECIAL_CHARS.test(raw)) {
      errors.push({
        rule: 'R2_BACKTICK_ALIAS',
        message: `字段别名「${raw}」含特殊字符但未用反引号包裹`,
        sqlSnippet: `AS ${raw}`,
      });
    }
  }
  return errors;
}
```

### R3：MySQL 5.7 限制检测（parser 顺带）

**触发条件**：检测 CTE（WITH）、窗口函数（OVER）、JSON_TABLE 等 MySQL 5.7 不支持的语法。

```javascript
/**
 * R3 MySQL 5.7 限制检测
 * @param {object} ctx - {ast}
 * @returns {Array<{rule, message, sqlSnippet, type?}>}
 */
export function validateR3Mysql57Limits(ctx) {
  const errors = [];
  const { ast } = ctx;

  // 1. CTE 检测
  const cteList = ast.cte || ast.with;
  if (cteList && cteList.length > 0) {
    errors.push({
      rule: 'R3_MYSQL57_LIMIT', type: 'CTE',
      sqlSnippet: 'WITH ... AS (...)',
      message: 'MySQL 5.7 不支持 CTE（WITH ... AS）',
    });
  }

  // 2. 窗口函数检测：递归 AST 检查 function call 的 over 属性
  const windowFuncs = findWindowFunctions(ast);
  for (const fn of windowFuncs) {
    errors.push({
      rule: 'R3_MYSQL57_LIMIT', type: 'WINDOW_FUNCTION',
      sqlSnippet: `${fn.name.toUpperCase()}(...) OVER (...)`,
      message: `MySQL 5.7 不支持窗口函数 ${fn.name.toUpperCase()}() OVER (...)`,
    });
  }

  // 3. JSON_TABLE 检测
  if (hasFunctionCall(ast, 'json_table')) {
    errors.push({
      rule: 'R3_MYSQL57_LIMIT', type: 'JSON_TABLE',
      sqlSnippet: 'JSON_TABLE(...)',
      message: 'MySQL 5.7 不支持 JSON_TABLE()',
    });
  }

  return errors;
}
```

### R5：LIMIT 子句检测（纯 regex）

**触发条件**：检测 SELECT 语句无 LIMIT 子句（应用层会截断但体验降级）。

```javascript
/**
 * R5 LIMIT 子句检测
 * @param {object} ctx - {ast}
 * @returns {Array<{rule, message, sqlSnippet}>}
 */
export function validateR5LimitClause(ctx) {
  const errors = [];
  const { ast } = ctx;
  if (ast.type !== 'select') return errors;
  if (!ast.limit) {
    errors.push({
      rule: 'R5_MISSING_LIMIT',
      message: 'SELECT 语句无 LIMIT 子句',
      sqlSnippet: '(末尾)',
    });
  }
  return errors;
}
```

### 共享工具函数

```javascript
// validators.js 同文件底部

/**
 * 递归遍历 AST 提取所有 column ref（处理嵌套子查询、CASE WHEN、函数参数）
 */
function extractColumnRefs(ast) { /* ... */ }

/**
 * 构建别名 → 真实表 的映射
 */
function buildAliasToTableMap(ast, tables) { /* ... */ }

/**
 * 递归 AST 找所有有 over 属性的函数（窗口函数）
 */
function findWindowFunctions(ast) { /* ... */ }

/**
 * 递归 AST 找指定函数名
 */
function hasFunctionCall(ast, fnName) { /* ... */ }
```

### 主入口（编排）

```javascript
// validators.js 同文件
import { loadColumnsMap } from './ddlUtils.js';  // 复用现有 getTableDDL + 解析

/**
 * 主入口（在 toolFuncs.js 中导出为 validate_sql_fields 工具）
 */
export async function validateSqlFields({ sql }) {
  // 1. 共享上下文
  const ast = parser.astify(sql, { database: 'mysql' });
  const tables = parser.tableList(sql, { database: 'mysql' });
  const columnsMap = await loadColumnsMap(tables);

  const ctx = { sql, ast, tables, columnsMap };

  // 2. 跑所有验证器
  const errors = [
    ...validateR1FieldOwnership(ctx),
    ...validateR2BacktickAlias(ctx),
    ...validateR3Mysql57Limits(ctx),
    ...validateR5LimitClause(ctx),
  ];

  return {
    valid: errors.length === 0,
    errors,
    summary: `${errors.length} error${errors.length === 1 ? '' : 's'}`,
  };
}
```

### 复用性体现

| 场景 | 方式 |
|---|---|
| **单独测试某个验证器** | `import { validateR2BacktickAlias }` 直接调，传入 mock ctx |
| **未来加 R6** | 同文件加 `validateR6Xxx` + 在主函数加一行 |
| **未来拆文件** | 某验证器 > 200 行时，单独拆出到 `validators/r1.js` 等 |

---

## 5. LLM 主动调用流程

### 5.1 工具注册

```javascript
// backend/src/services/toolFuncs.js
export const tools = [
  // ... 现有工具
  {
    name: "validate_sql_fields",
    description: "校验 SQL 字段-表归属、字段别名反引号、MySQL 5.7 限制、LIMIT 子句。返回 {valid, errors, summary}。",
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

**之后（7-8 轮）**：
```
TURN 1: Round 0-3（同上）
TURN 2: Round 0-2（user_choice 注入 → 调 validate_sql_fields → 拿到错误重写 → 生成 SQL）
```

- 一次通过：Round 0 → Round 1（validate）→ Round 2（最终 SQL），共 +1 轮
- 重写 1 次：Round 0 → Round 1（fail）→ Round 2（重写）→ Round 3（pass → 输出），共 +2 轮

### 5.3 SKILL.md 调用约束

在 SKILL.md 铁律部分新增：

```markdown
5. **【新】输出 SQL 前必调 `validate_sql_fields`**：
   - LLM 准备输出 SQL 时，必须先调 `validate_sql_fields` 校验。
   - 工具只返回 `errors`（无 warnings）—— 拿到任何 error 都必须重写 SQL。
   - 工具不提供建议改法（无 suggestion 字段）—— LLM 自己根据 errors 信息决定如何改。
   - 跳过调用的代价：幻觉 SQL 会到达 MySQL，触发 `Unknown column` 错误，浪费 LLM 一次输出机会。
```

### 5.4 LLM 状态显示器（工具注册表）

**定位**：给 LLM 自己看的"工具状态清单"，**不是兑底机制**——不强制拦截，纯粹是 LLM 上下文里的一条 system message，提醒 LLM 当前状态。

**调用机制**（参考现有 [llm.js:400-428 buildToolCallChecklistMessage](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L400-L428)）：
- **每轮** LLM 请求都调一次
- 但只有 `reg` 有已调用记录时才返回 message
- 没调过任何工具 → 返回 `null` → LLM context 不追加

#### 实施

在 `llm.js:347` 的 `sessionToolRegistries` Map 中新增字段：

```javascript
{
  // ... 现有字段
  validateSqlFieldsCalled: false,
  validateSqlFieldsPassed: false,
  validateSqlFieldsErrorCount: 0,
}
```

在 `toolFuncs.js` 的 `validateSqlFields` 工具执行后，**调用方**（在 `llm.js` 处理 tool_call 时）写入 registry：

```javascript
// llm.js 处理 tool_call 结果时
if (toolName === 'validate_sql_fields') {
  const reg = getOrCreateRegistry(sessionId);
  if (reg) {
    reg.validateSqlFieldsCalled = true;
    reg.validateSqlFieldsPassed = result.valid;
    reg.validateSqlFieldsErrorCount = result.errors.length;
  }
}
```

在 `buildToolCallChecklistMessage` 中追加（[llm.js:428](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L428) 附近）：

```javascript
// 在 buildChecklist parts.push 段
if (reg.validateSqlFieldsCalled) {
  const status = reg.validateSqlFieldsPassed
    ? '✓passed'
    : `✗failed(${reg.validateSqlFieldsErrorCount} errors)`;
  parts.push(`validate_sql_fields:${status}`);
}
```

#### LLM 看到的效果

| 场景 | LLM 上下文里的 checklist | LLM 决策 |
|---|---|---|
| LLM 没调过 | (没有这一行) | LLM 不知道需不需要调——靠 SKILL.md 铁律提醒 |
| LLM 调过且通过 | `validate_sql_fields:✓passed` | LLM 知道已通过 → 可输出 SQL |
| LLM 调过但失败 | `validate_sql_fields:✗failed(3 errors)` | LLM 知道有错 → 改 SQL → 再调 |
| LLM 调失败再调通过 | `validate_sql_fields:✓passed` | LLM 知道已修正 → 可输出 SQL |

#### 与"兑底"的区别

| 维度 | 兑底（路由层） | LLM 状态显示器（本方案） |
|---|---|---|
| 触发位置 | `/api/query/execute` | `buildToolCallChecklistMessage` |
| 行为 | 强制拦截，未通过则返回 400 | 仅在 LLM context 显示状态 |
| LLM 跳过的后果 | 阻断 SQL 执行 | LLM 可能跳过，MySQL `Unknown column` 报错 |
| 适合场景 | 必须保证安全 | 提升 LLM 决策质量 |
| 本方案 | ❌ 不做 | ✅ 做 |

**核心价值**：让 LLM 在长上下文中"看到"自己已调/未调/通过/失败，避免因注意力衰减导致重复调或漏调。

---

## 6. 不做的事

### 6.1 不做路由层兑底

**明确不参与**：
- ❌ 不修改 `/api/query/execute`（[query.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js)）
- ❌ 不修改 `/api/query/explain`（同上）
- ❌ 不修改 `sqlValidator`（[sqlValidator.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js)）—— 危险 SQL 拦截已由其负责

**本工具只服务于 LLM 流**（[llm.js](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js)）：
- 工具注册 → `tools` 列表
- 工具状态追踪 → `sessionToolRegistries.validateSqlFields*`
- 工具结果展示 → `buildToolCallChecklistMessage` 状态显示器

**理由**：

| 兜底场景 | 实际后果 | 工具能否阻止？ |
|---|---|---|
| 字段幻觉（`et.mobile` 不存在）| MySQL 直接返回 `Unknown column` | ❌ 路由调也救不了 |
| 危险 SQL（DELETE/UPDATE 无 WHERE）| sqlValidator 已拦截 | ❌ sqlValidator 覆盖 |
| LLM 跳过 T0 直接输出 | SQL 已输出，事后无意义 | ❌ 既成事实 |

**核心结论**：
- 工具的**唯一价值**是给 LLM 一个"重写机会"——必须在 LLM 输出 SQL **之前**调用
- 一旦 SQL 已被 LLM 输出，路由层做任何校验都是"事后诸葛亮"
- 用户拿不到数据 ≠ 路由层能补救

**未来触发条件**：当出现 ≥ 3 次 LLM 跳过 T0 仍输出幻觉 SQL 的真实案例时，重新评估（实现成本 ~0.5h）。

### 6.2 不做的规则

| 规则 | 为什么不纳入 | 保留位置 |
|---|---|---|
| R4 del 过滤规则 | 业务规则由 LLM 决策（field_config.join_condition 显式 / business_rules 声明）| SKILL.md L20-25 |
| R6 关联字段有效性 | 已被 R1 覆盖（JOIN 字段已在 DDL 中）| — |

---

## 7. SKILL.md 同步精简方案

### 7.0 核心原则：SKILL.md 引导 + 工具兜底

**两者协同**（不是互斥）：
- **SKILL.md = 引导**：告诉 LLM 怎么写对，减少"试探-失败-重写"循环
- **工具 = 兜底**：抓 LLM 写错的，保证最终结果正确
- **完全删 SKILL.md 规则 = 每次 LLM 写错 → 工具报 → 重写 → 工具再报 → 终于过**（低效）
- **精简 SKILL.md 保留引导 + 工具兜底 = LLM 一次写对**（高效）

### 7.1 待精简规则（共 3 行，仅文字精简，0 行删除）

| # | 当前行 | 改前内容 | 改后内容 | 减负 | 工具兜底 |
|---|---|---|---|---|---|
| 1 | **L29** | `6. **字段别名**：别名含特殊字符（括号、空格、中文括号等）时必须用反引号：\`amount AS \\\`金额(元)\\\`\`。` | `6. **字段别名**：别名含特殊字符（括号、空格、中文括号等）时必须用反引号。` | 删例子 | R2 |
| 2 | **L31** | `7. **MySQL 5.7 限制**：禁止窗口函数、CTE(WITH)、JSON_TABLE。替代方案：子查询、临时表、JSON_EXTRACT。` | `7. **MySQL 5.7 限制**：禁止窗口函数、CTE(WITH)、JSON_TABLE。` | 删"替代方案" | R3 |
| 3 | **L57** | `- 查询必须包含 \\\`LIMIT\\\`，默认 1000。` | `- 默认 \\\`LIMIT 1000\\\`（工具 R5 强制检测）。` | 改"必须"为"工具强制" | R5 |

**注**：规则**保留**，仅文字精简。LLM 仍能读到引导，工具仍兜底。

### 7.2 待改规则（共 1 行）

| # | 当前行 | 改前内容 | 改后内容 |
|---|---|---|---|
| 1 | **L41**（铁律第 5 项）| `     - **字段-表归属校验 ✓**（每个 SELECT 字段已在对应表 DDL 中确认存在）` | `     - **【新】必调 \`validate_sql_fields\`**：输出 SQL 前必须调用此工具，拿到 errors 必须重写 SQL 后再次校验，valid 才可输出` |

**改写说明**：
- 原"字段-表归属校验"是 LLM 自己的自检过程，**无工具支撑**
- 改后变成"必调工具"，**有程序保障**
- 加粗显示让 LLM 重点注意

### 7.3 精简后预估

| 段 | 改前 | 改后 | 变化 |
|---|---|---|---|
| 核心规则 | 50 行 | 50 行 | 0（仅文字精简）|
| 系统约定 | 12 行 | 12 行 | 0（仅文字精简）|
| 输出格式 | 17 行 | 17 行 | 不变 |
| 标签纠正 | 9 行 | 9 行 | 不变 |
| 用户交互 | 11 行 | 11 行 | 不变 |
| **合计** | **99 行** | **99 行** | **0（仅文字）** |

**核心结论**：SKILL.md **不减行数**，但**机械规则变简洁** + **工具兜底**。

### 7.4 改前/改后完整对照

#### 改动 1：精简 L29（规则 6 字段别名反引号）

**改前**（[SKILL.md L29](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L29)）：
```markdown
6. **字段别名**：别名含特殊字符（括号、空格、中文括号等）时必须用反引号：`amount AS \`金额(元)\``。
```

**改后**：
```markdown
6. **字段别名**：别名含特殊字符（括号、空格、中文括号等）时必须用反引号。
```

**改动说明**：删例子 `amount AS \`金额(元)\``，LLM 已有 DDL 看真实字段名，例子是冗余。

#### 改动 2：精简 L31（规则 7 MySQL 5.7 限制）

**改前**（[SKILL.md L31](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L31)）：
```markdown
7. **MySQL 5.7 限制**：禁止窗口函数、CTE(WITH)、JSON_TABLE。替代方案：子查询、临时表、JSON_EXTRACT。
```

**改后**：
```markdown
7. **MySQL 5.7 限制**：禁止窗口函数、CTE(WITH)、JSON_TABLE。
```

**改动说明**：删"替代方案：子查询、临时表、JSON_EXTRACT"——LLM 没必要记忆替代方案，工具会拦截。

#### 改动 3：精简 L57（系统约定 LIMIT 子句）

**改前**（[SKILL.md L57](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L57)）：
```markdown
- 查询必须包含 `LIMIT`，默认 1000。
```

**改后**：
```markdown
- 默认 `LIMIT 1000`（工具 R5 强制检测）。
```

**改动说明**：
- "必须包含 LIMIT" 是约束 → 工具 R5 强制
- "默认 1000" 是默认值 → 保留，告诉 LLM 用什么
- 括号里加 "工具 R5 强制检测" 让 LLM 知道有程序保障

#### 改动 4：改 L41（铁律第 5 项 字段-表归属校验）

**改前**（[SKILL.md L35-44](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L35-L44)）：
```markdown
9. **【铁律】最终输出前冻结**：
   - **只调用本轮 tools 列表中的工具（程序会自动拦截列表外调用）**。
   - "信息已全"判定（满足以下条件后立即生成 SQL，禁止再调用任何工具）：
     - 目标表 DDL ✓
     - 字段别名/枚举 ✓
     - 业务规则 ✓
     - **字段-表归属校验 ✓**（每个 SELECT 字段已在对应表 DDL 中确认存在）
     - 涉及 JOIN 时还需 virtual_associations ✓（单表查询无需此项）
   - 调用 get_table_schema / get_table_ddl 时必须一次性传入所有需要的表名，禁止分批
   - 输出 SQL 后不允许补充工具调用或修正
```

**改后**（替换第 5 项）：
```markdown
9. **【铁律】最终输出前冻结**：
   - **只调用本轮 tools 列表中的工具（程序会自动拦截列表外调用）**。
   - "信息已全"判定（满足以下条件后立即生成 SQL，禁止再调用任何工具）：
     - 目标表 DDL ✓
     - 字段别名/枚举 ✓
     - 业务规则 ✓
     - **【新】必调 `validate_sql_fields`**：输出 SQL 前必须调用此工具，拿到 errors 必须重写 SQL 后再次校验，valid 才可输出
     - 涉及 JOIN 时还需 virtual_associations ✓（单表查询无需此项）
   - 调用 get_table_schema / get_table_ddl 时必须一次性传入所有需要的表名，禁止分批
   - 输出 SQL 后不允许补充工具调用或修正
```

#### 改动 3：删 L57（系统约定 LIMIT 子句）

**改前**（[SKILL.md L46-57](file:///d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/SKILL.md#L46-L57)）：
```markdown
## 系统约定
以下为系统字段语义，生成 SQL 时必须遵循。如 field_config 有特殊定义则以 field_config 为准：
- **当前日期**： 时间过滤必须使用 MySQL 日期函数（`CURDATE()` 等），禁止硬编码年份。
- `del` / `deleted`：0=未删除，1=已删除。
     WHERE 子句默认过滤 `= 0`（如 `WHERE t_main.del = 0`）。
     连表 JOIN 子句默认不过滤——见核心规则 4.2。 
- 时间字段（字段名含时间含义）：
  - `timestamp`/`datetime` → `DATE_FORMAT(字段, '%Y-%m-%d %H:%i:%s')`
  - BIGINT 毫秒 (`BIGINT(11/13)`) → `FROM_UNIXTIME(字段/1000, '%Y-%m-%d %H:%i:%s')`
  - BIGINT 秒 (`BIGINT(10)`) → `FROM_UNIXTIME(字段, '%Y-%m-%d %H:%i:%s')`
- 金额字段：单位均为分。
- 查询必须包含 `LIMIT`，默认 1000。
```

**改后**（删"查询必须包含 LIMIT..."那行）：
```markdown
## 系统约定
以下为系统字段语义，生成 SQL 时必须遵循。如 field_config 有特殊定义则以 field_config 为准：
- **当前日期**： 时间过滤必须使用 MySQL 日期函数（`CURDATE()` 等），禁止硬编码年份。
- `del` / `deleted`：0=未删除，1=已删除。
     WHERE 子句默认过滤 `= 0`（如 `WHERE t_main.del = 0`）。
     连表 JOIN 子句默认不过滤——见核心规则 4.2。 
- 时间字段（字段名含时间含义）：
  - `timestamp`/`datetime` → `DATE_FORMAT(字段, '%Y-%m-%d %H:%i:%s')`
  - BIGINT 毫秒 (`BIGINT(11/13)`) → `FROM_UNIXTIME(字段/1000, '%Y-%m-%d %H:%i:%s')`
  - BIGINT 秒 (`BIGINT(10)`) → `FROM_UNIXTIME(字段, '%Y-%m-%d %H:%i:%s')`
- 金额字段：单位均为分。
```

### 7.5 实施检查清单

实施时按这个顺序，确保不漏：

- [ ] 打开 `skills/sql-creator-skill-v2/SKILL.md`
- [ ] 精简 L29：删例子 `amount AS \`金额(元)\``
- [ ] 精简 L31：删"替代方案：子查询、临时表、JSON_EXTRACT"
- [ ] 改 L41：铁律第 5 项改为"必调 `validate_sql_fields`"
- [ ] 改 L57：改为 `默认 \`LIMIT 1000\`（工具 R5 强制检测）`
- [ ] 校对全文：99 行（无变化），3 条机械规则变简洁
- [ ] 提交并关联到本方案文档

### 7.6 价值重新定位

**新方案 v5 价值主张**（从"删 SKILL.md"转向"协同"）：

| 维度 | 原 v4 价值 | 新 v5 价值 |
|---|---|---|
| SKILL.md 行数 | 99 → 95（-4 行）| 99 → 99（不变）|
| SKILL.md 文字 | 不变 | 3 条机械规则变简洁 |
| 防字段幻觉 | ✅ R1 工具 | ✅ R1 工具 |
| 首次正确率 | LLM 写 → 工具拦 → 重写 | **LLM 看 SKILL.md → 写对 → 工具确认** |
| 工具调用次数 | 1-2 次 | **1 次（首次正确）** |
| LLM 注意力 | 仍要记 3 条规则 | 仍要记 3 条规则（**不变**）|

**核心**：SKILL.md 文字精简让 LLM 读取更快，工具兜底保证正确性。**两者 1+1>2**。

---

## 8. 实施分步

### 8.1 第 1 步：基础设施（~3h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 安装 `node-sql-parser` | `backend/package.json` | 0.1h |
| 封装 `sqlParser.js`（AST 解析 + 表名提取 + 列引用提取）| `backend/src/services/sqlParser.js` | 2h |
| 写 5-10 个 parser 单元测试 | `backend/test-parser.mjs` | 0.5h |
| 写 `loadColumnsMap()` 工具（读 DDL + 提列 + 联合 field_aliases + mtime 缓存）| `backend/src/services/ddlUtils.js` | 0.3h |
| 写 `loadFieldAliases()` 从 `field_config/{table}.json` 读 aliases | `backend/src/services/fieldConfigUtils.js` | 0.1h |
| **小计** | | **~3h** |

#### 8.1.1 `loadColumnsMap` 实现（Q1 答复 + 关键约束）

**位置**：`backend/src/services/ddlUtils.js`（新增）

**职责**：从 `skills/sql-creator-skill-v2/ddl/{table}.sql` 读 DDL，提取列名集合，**联合 `field_config/{table}.json` 的 `field_aliases`**。

**关键约束**：**不同表的相同字段名天然隔离**——通过 `Map<table, Set<column>>` 结构实现。**不能把所有表的列拍平成一个 Set**（否则 R1 会把 `admin_user.mobile` 误判为 `et.mobile` 合法）。

**反例**（**禁止**的写法）：
```javascript
// ❌ 错误：扁平 Set，admin_user.mobile 会被认为 et.mobile 合法
const allColumns = new Set();
for (const table of tables) {
  for (const col of extractColumnsFromDDL(...)) allColumns.add(col);
}
```

**正例**（per-table Set）：
```javascript
// ✅ 正确：每张表独立的 Set
const columnsMap = new Map(); // Map<table, Set<column>>
for (const table of tables) {
  columnsMap.set(table, new Set([...columns, ...aliases]));
}
```

```javascript
// backend/src/services/ddlUtils.js
import { getTableDDL } from './toolFuncs.js';
import { loadFieldAliases } from './fieldConfigUtils.js';

const COLUMNS_CACHE = new Map(); // {tableName: {mtime, columnsSet}}

/**
 * 加载 SQL 中涉及的表的列名集合（含 field_aliases 联合）
 *
 * **重要：返回 Map<table, Set<column>>，不是扁平的 Set**
 *   不同表的同名字段天然隔离（`admin_user.mobile` ≠ `et.mobile`）
 *
 * @param {string[]} tables - 表名列表
 * @returns {Promise<Map<string, Set<string>>>} - {tableName -> Set<columnName>}
 */
export async function loadColumnsMap(tables) {
  const result = new Map();
  // 并行读所有表的 DDL（getTableDDL 内部已经 Promise.all）
  const ddlBlocks = await getTableDDL(tables, { short: true });

  for (const table of tables) {
    // 1. 从 DDL 块中**只**提取该表的列名（按 -- @@TABLE 标记分段）
    const columns = extractColumnsFromDDL(ddlBlocks, table);

    // 2. 联合 field_aliases（**仅本表的** aliases，不跨表合并）
    const aliases = await loadFieldAliases(table);

    // 3. 装入 per-table Set（隔离！）
    result.set(table, new Set([...columns, ...aliases]));
  }
  return result;
}

/**
 * 从 DDL 字符串中**仅**提取指定表的列名（按 -- @@TABLE 标记分段）
 *
 * 输入示例（getTableDDL 返回格式）：
 * ```
 * -- @@TABLE admin_user
 * id INT
 * del INT
 * mobile VARCHAR
 *
 * -- @@TABLE edu_teacher
 * id INT
 * del INT
 * mobile VARCHAR
 * teacher_no VARCHAR
 * ```
 *
 * 调用 `extractColumnsFromDDL(ddlBlocks, 'edu_teacher')` 返回：
 *   ['id', 'del', 'mobile', 'teacher_no']
 * （**不会**包含 admin_user 的 mobile）
 */
function extractColumnsFromDDL(ddlBlocks, tableName) {
  const lines = ddlBlocks.split('\n');
  const columns = [];
  let inTargetTable = false;

  for (const line of lines) {
    // 1. 进入目标表段
    if (line.startsWith(`-- @@TABLE ${tableName}`)) {
      inTargetTable = true;
      continue;
    }
    // 2. 离开目标表段（遇到其他表标记）
    if (line.startsWith('-- @@TABLE ') || line.startsWith('-- 表 ')) {
      inTargetTable = false;
      continue;
    }
    // 3. 仅在目标表段内提取列名
    if (inTargetTable) {
      // simplifyDDL 后的每行是 "`字段名` 类型" 格式
      const match = line.match(/^`?(\w+)`?\s+/);
      if (match) columns.push(match[1]);
    }
  }
  return columns;
}
```

**关键点**：
- **无需数据库连接**——所有数据从 `skills/` 目录读
- **复用现有 `getTableDDL`** ([toolFuncs.js:219-233](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L219-L233)) 和 **`simplifyDDL`** ([toolFuncs.js:194-217](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L194-L217))
- **mtime 缓存**（`COLUMNS_CACHE`）避免每次重新读盘
- **field_aliases 联合**——`admin_user.sql` 里有 `real_name` 列，LLM 用 `user_name_real`（field_aliases 声明），不算幻觉
- **per-table Set 隔离**——防止跨表误判（`admin_user.mobile` ≠ `et.mobile`）

#### 8.1.2 同名字段单元测试（防 R1 误判）

**测试文件**：`backend/test-load-columns-map.mjs`

**关键 case**（覆盖同名字段场景）：

```javascript
// 测试 1：admin_user 和 edu_teacher 都有 mobile 字段
//   期望：columnsMap.get('admin_user').has('mobile') === true
//         columnsMap.get('edu_teacher').has('mobile') === true
//         **两者是独立 Set，不会互相干扰**

// 测试 2：admin_user 有 user_name，edu_teacher 有 teacher_name
//   期望：columnsMap.get('admin_user').has('teacher_name') === false
//         columnsMap.get('edu_teacher').has('user_name') === false

// 测试 3：admin_user.field_aliases 有 `mobile` 别名（指向 mobile 列）
//   期望：columnsMap.get('admin_user').has('mobile') === true
//         （**不会**泄露到其他表）

// 测试 4：R1 集成测试
//   SQL: SELECT et.mobile FROM edu_teacher et
//   期望：columnsMap.get('edu_teacher').has('mobile') === false → R1 报错
//   SQL: SELECT au.mobile FROM admin_user au
//   期望：columnsMap.get('admin_user').has('mobile') === true → R1 通过
```

**为什么这些测试重要**：
- R1 是防幻觉核心，**误报**会让 LLM 反复重写无错的 SQL
- **漏报**会让幻觉 SQL 通过，违背工具价值
- 同名字段场景是**最容易写错**的地方——必须显式测试

### 8.2 第 2 步：工具实现（~3h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 写 4 个验证器（单文件 `validators.js`，R1/R2/R3/R5）| `backend/src/services/validators.js` | 1.5h |
| 实现 `validateSqlFields()` 主入口（编排 + 共享 ctx）| 同上 | 0.5h |
| 写 `extractColumnRefs` / `buildAliasToTableMap` / `findWindowFunctions` / `hasFunctionCall` 共享工具 | 同上 | 1h |
| **小计** | | **~3h** |

**注意**：验证器全部放在 `validators.js` 单文件中。**未来如某个验证器 > 200 行**再单独拆出到 `validators/r1.js` 等子文件。

**实施顺序说明**（v5 协同）：
1. 写完工具（含测试）→ 工具就绪
2. 注册到 llm.js → LLM 能调用
3. **再改** SKILL.md → LLM 接受"必须调"铁律
4. **顺序很重要**：先有工具再改 SKILL.md，避免 LLM 被告知"必须调"却调不到

### 8.3 第 3 步：注册 + SKILL.md 协同（~1.4h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 工具注册到 `tools` 列表 | `backend/src/services/llm.js` | 0.5h |
| `sessionToolRegistries` 加字段（validateSqlFieldsCalled / Passed / ErrorCount）| 同上 | 0.2h |
| `buildToolCallChecklistMessage` 追加"validate_sql_fields:✓/✗" | 同上 | 0.2h |
| SKILL.md 精简 L29（删例子 `amount AS \`金额(元)\``）| `skills/sql-creator-skill-v2/SKILL.md` | 0.1h |
| SKILL.md 精简 L31（删"替代方案：子查询、临时表、JSON_EXTRACT"）| 同上 | 0.1h |
| SKILL.md 改 L57（措辞改"必须"→"工具 R5 强制检测"）| 同上 | 0.1h |
| SKILL.md 改 L41（铁律第 5 项 → "必调 `validate_sql_fields`"）| 同上 | 0.2h |
| **小计** | | **~1.4h** |

**v5 协同理念**（非互斥）：
- SKILL.md 保留 3 条机械规则（精简文字）→ **引导 LLM 写对**
- 工具 `validate_sql_fields` 同步上线 → **兜底 LLM 写错的**
- 实施顺序：先实现工具，**再改 SKILL.md**（避免 LLM 在没有工具兜底时频繁失败）

**注意**：SKILL.md 行数 99 → 99 不变，**仅文字精简**。详见 §7.4 完整改前/改后。

### 8.4 第 4 步：测试（~1.5h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 工具单元测试（4 类规则各 5 case = 20 case）| `backend/test-validate-sql-fields.mjs` | 1h |
| 端到端：清空日志，问"查询今天上课的老师" | `logs/2026-07-23/admin_llm.log` | 0.5h |
| 验证 `au.mobile`（不是 `et.mobile`）| 同上 | （含在端到端中）|
| **小计** | | **~1.5h** |

### 8.5 总计

| 阶段 | 估时 |
|---|---|
| 1. 基础设施 | 3h |
| 2. 工具实现 | 3h |
| 3. 注册 + SKILL.md | 1.4h |
| 4. 测试 | 1.5h |
| **合计** | **~8.9h ≈ 9h** |

---

## 9. 验证方案

### 9.1 Parser 单元测试（5+ case）

| # | SQL | 期望 |
|---|---|---|
| 1 | `SELECT id FROM edu_study` | tables: ['edu_study'], columns: [{table: null, col: 'id'}] |
| 2 | `SELECT t1.id, t2.name FROM a t1 JOIN b t2 ON t1.id = t2.a_id` | tables: ['a', 'b'], columns: [...] |
| 3 | `SELECT CASE WHEN del=0 THEN 'active' END FROM t` | 不崩，AST 正确 |
| 4 | `SELECT id FROM t1 WHERE id IN (SELECT id FROM t2)` | 嵌套子查询正确解析 |
| 5 | `SELECT et.mobile FROM edu_teacher et JOIN admin_user au ON et.admin_user_id = au.id` | 提取 ['et', 'mobile'] 等 |

### 9.2 工具单元测试（4 类规则各 5 case = 20 case）

| 规则 | case 数 | 覆盖点 |
|---|---|---|
| R1 字段-表归属 | 5 | 字段不存在、别名未注册、嵌套子查询、CASE WHEN 字段、`field_aliases` 联合加载 |
| R2 字段别名反引号 | 5 | 中文括号、英文括号、空格、纯中文（无需反引号）、已加反引号 |
| R3 MySQL 5.7 限制 | 5 | WITH/CTE、ROW_NUMBER() OVER、JSON_TABLE、不带这些（pass）、注释里出现（不报）|
| R5 LIMIT 子句 | 5 | 无 LIMIT、有 LIMIT、UNION 子句、含子查询的 LIMIT、LIMIT 0 |

### 9.3 端到端

清空 `logs/2026-07-23/admin_llm.log`，提问"查询今天上课的老师"。

**期望**：
- ✅ LLM 在最终 SQL 输出前调 `validate_sql_fields`
- ✅ 工具返回 `valid: true`（因为 SQL 已正确）
- ✅ 工具调用次数 ≤ 7 轮
- ✅ 最终 SQL 仍是 `au.mobile`（不是 `et.mobile`）

### 9.4 负向 case

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
| R-2 | LLM 跳过调用 `validate_sql_fields` | 中 | SKILL.md 强调"必调"；失败代价 = MySQL `Unknown column`（可接受）|
| R-3 | 工具增加 +1 轮延迟（3-5s）| 中 | 接受；长期可优化为 LLM 一次输出即带校验 |
| R-4 | 错误信息不可操作 | 中 | 单元测试覆盖错误信息；LLM 自己读 message + sqlSnippet 决策 |
| R-5 | DDL 文件读取慢（每张表 50ms × 多表 = 200ms）| 中 | 加内存缓存（按 mtime 失效）|
| R-6 | 工具返回结构不兼容现有 LLM 调用 | 低 | 复用现有 `DynamicTool` 框架；返回 JSON 字符串 |
| R-7 | SKILL.md 精简过度，LLM 反而表现下降 | 中 | 保留铁律和核心规则；只删 3 条机械规则 |
| R-8 | 工具被剪枝后 LLM 无法调用 | 中 | 工具不属于一次性调用（多次可调），不剪枝 |

---

## 11. 关键决策记录

| # | 决策 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| D-1 | SQL 解析方式 | A 自实现 / B node-sql-parser / C 全 regex | **B** | 完整覆盖 R1/R3，0.5h 集成 |
| D-2 | 调用时机 | 仅 LLM / 仅路由 / 两者 | **仅 LLM** | 工具价值 = 给 LLM "重写机会"；事后兜底无意义 |
| D-3 | SKILL.md 精简范围 | 同步精简 / 不动 | **同步精简** | 删 3 条机械规则 |
| D-4 | MySQL 5.7 限制 | 替代 / 保留 | **替代（纳入工具 R3）** | 引入 parser 后 R3 实现成本仅 0.5h |
| D-5 | 工具命名 | validate_sql_fields / check_sql / sql_quality_check | **validate_sql_fields** | 与现有 `request_*` / `get_*` 命名风格一致 |
| D-6 | 错误信息格式 | JSON / markdown 列表 | **JSON 结构化** | LLM 易解析 |
| D-7 | 工具注册 | 一次性 / 每次会话 | **每次会话** | 不剪枝（多次可调）|
| D-8 | R4 del 过滤规则 | 做 / 不做 | **不做** | 用户聚焦字段幻觉，R4 保留 SKILL.md L20-25 |
| D-9 | R6 关联字段有效性 | 做 / 不做 | **不做** | 合并到 R1（字段-表归属已覆盖 JOIN 字段）|
| D-10 | 工具参数 | 要求 LLM 传 tables / 工具自动提取 | **工具自动提取** | 避免 LLM 漏传表 |
| D-11 | 错误分级 | errors + warnings + suggestion / 仅 errors 无 suggestion | **仅 errors 无 suggestion** | 工具职责 = 报错；不"开方"避免启发式建议误导 LLM |
| D-12 | 路由兑底 | 路由兑底 / 仅 LLM 自检 | **仅 LLM 自检** | 工具价值是给 LLM 改的机会，不是给后端兜底；省 1h |

---

## 12. 备注

- `validate_sql_fields` 与 `request_user_choice` 是**互补**关系：前者是 SQL 质量关，后者是用户交互关
- 工具返回值会进入 LLM context（作为 tool result），所以**返回结构要紧凑**——避免 LLM 上下文过载
- DDL 缓存按 mtime 失效，避免每次重新读盘
- **职责分离**：工具只"报错"（errors[]），不"开方"（无 suggestion 字段）。LLM 是决策者，工具是质检员
- **无 warnings 数组**：所有校验不通过都归为 errors——避免 LLM 误判严重性而忽略
- **工具边界**：只服务于 LLM 流，**不在路由层兜底**。路由层错误由 sqlValidator + MySQL 自身报错负责
- 本文档不重复 [2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 中已写的上下文，重点在新增工具的设计
- 实施后应在 [2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 第 4 节"改造工作量"中追加"第 3 步"指向本文档

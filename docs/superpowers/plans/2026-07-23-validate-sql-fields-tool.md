# `validate_sql_fields` 工具 — SQL 质量最后一道关

**日期**：2026-07-23
**状态**：🟡 设计阶段（v3 修订完成 — 删除路由兑底，工具只服务于 LLM）
**关联文档**：[2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md)（上一阶段精简方案）
**关联文件**：
- `backend/src/services/toolFuncs.js`（新增工具实现）
- `backend/src/services/sqlParser.js`（新增，封装 `node-sql-parser`）
- `backend/src/services/llm.js`（工具注册 + checklist）
- `skills/sql-creator-skill-v2/SKILL.md`（同步精简 3 条规则：L29 / L31 / L57；改写 L41）
- `backend/package.json`（新增 `node-sql-parser` 依赖）
- `skills/sql-creator-skill-v2/field_config/{table}.json`（R1 联合加载 `field_aliases`）

**v3 关键变更**：
- ❌ **删除路由层兑底**（§6 整段移除）：工具只服务于 LLM 的"输出前自检"，不参与最终 SQL 执行
- ❌ **删除 T1 调用时机**：只剩 T0（LLM 主动调）
- ❌ **删除 `query.js` / `sqlValidator.js` 集成**（不在路由层用）
- ✅ **工作总量**：10h → **9h**（少 1h 路由集成 + 测试）

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

**新增 `validate_sql_fields` 工具**，集中覆盖 4 类 SQL 质量校验，让 LLM 自由输出 SQL，工具层兜底：

| 目标 | 度量 |
|---|---|
| 防止字段幻觉（`et.mobile` 类错误）| 单元测试覆盖 ≥ 5 case |
| 替代 SKILL.md 3 条格式规则 | 删后 SKILL.md 从 96 行 → ~94 行（-2%）|
| 减少 LLM 认知负担 | 删"字段别名反引号" "MySQL 5.7 限制" "LIMIT" 等机械规则 |
| 工具只服务于 LLM | 路由层不参与（不在执行前再校验）|

### 1.3 范围外

- 不修改 `request_user_choice` / `request_tag_confirmation` 的实现
- 不改数据库 schema
- 不改 SSE 事件流协议
- 不改速率限制策略
- **不在 `/api/query/execute` 路由层兑底**（v3 决策）—— 工具只服务于 LLM 的 SQL 输出前自检

---

## 2. 核心设计原则

### 2.1 工具定位

**LLM 输出 SQL 前的自检工具**——一次调用完成 4 类校验，**只服务于 LLM**，路由层不参与。

### 2.2 4 类校验规则

| # | 规则 | 来源 SKILL.md | 替代该规则后 SKILL.md 减少 | 复杂度 |
|---|---|---|---|---|
| R1 | **字段-表归属校验** | 铁律 5a 字段-表归属校验 ✓ | 不删（核心铁律保留为过程约束）| 中 |
| R2 | **字段别名反引号** | 第 6 条：别名含特殊字符（括号、空格、中文括号等）必须用反引号 | -1 行 | 低 |
| R3 | **MySQL 5.7 限制检测** | 第 7 条：禁窗口函数/CTE/JSON_TABLE | -1 行 | 低（parser 顺带实现）|
| R5 | **LIMIT 子句检测** | 系统约定 5：查询必须包含 LIMIT，默认 1000 | -1 行 | 低 |

**用户决策（2026-07-23 多次 AskUserQuestion）**：
- R3（MySQL 5.7 限制）**纳入工具**（2026-07-23 追加决策）——引入 `node-sql-parser` 后 R3 实现成本从 2-3h 降至 0.5h
- ~~R4（del 字段过滤规则）~~ **不做**（2026-07-23 追加决策）——保留 SKILL.md L20-25
- ~~R6（关联字段有效性）~~ **不做**（2026-07-23 追加决策）——合并到 R1
- 实际可替代：**R2 / R3 / R5 共 3 条规则**（各 1 行）

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

**用户决策（2026-07-23 AskUserQuestion + v3 追加）**：**仅 LLM 主动调**（v3 删除路由兑底）

| 时机 | 触发位置 | 作用 |
|---|---|---|
| **T0：LLM 准备输出 SQL 前** | LLM 主动调 `validate_sql_fields` | 拿到 errors → 必须重写 SQL → 再调一次确认 |

**不参与的环节**：
- ❌ 路由层 `/api/query/execute` 不再调此工具（sqlValidator 已负责安全检查）
- ❌ 路由层 `/api/query/explain` 不再调此工具（仅执行 EXPLAIN 不影响数据）
- ❌ 前端不展示校验错误（错误已在 LLM 流中被消化）

**理由**：路由层兜底对最终执行结果无实质影响（即使 LLM 跳过 T0，sqlValidator 仍会拒绝危险 SQL；字段幻觉的 SQL 会被 MySQL 直接报"Unknown column"错误）。工具的核心价值是**给 LLM 一个"再想想"的机会**，不是给后端一个"再查一次"的机会。

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
      sql: {
        type: "string",
        description: "待校验的 SQL 语句"
      }
      // tables 参数去掉：工具内部用 parser.tableList(sql) 自动提取
    },
    required: ["sql"]
  }
}
```

### 3.2 返回结构

**设计原则**：工具只负责"报错"，不负责"开方"——所有校验不通过项统一为 `errors`，**不设 warnings**（避免 LLM 误判严重性）。**不提供 suggestion 字段**（工具没有 LLM 的语义能力，给的建议是启发式猜测，可能误导）。

```javascript
{
  valid: true,            // errors 是否为空
  errors: [               // 所有校验不通过项（LLM 必须修改）
    {
      rule: "R1_FIELD_OWNERSHIP",
      message: "字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）",
      sqlSnippet: "et.mobile"
    }
  ],
  summary: "1 error"  // 便于 LLM 快速判断
}
```

**4 类规则全部归入 errors**：
- R1 字段-表归属 → 字段不存在
- R2 别名反引号 → 特殊字符别名未用反引号
- R3 MySQL 5.7 限制 → 用到 CTE/窗口函数/JSON_TABLE
- R5 LIMIT 子句 → 缺少 LIMIT

**无 warnings 数组**：避免 LLM 把规则当"可选项"忽略。所有错误必须修改。

### 3.3 错误信息格式

**原则**：错误信息要 **具体**（告诉 LLM 错在哪），不 **开方**（不给改法——LLM 自己决定）。

格式模板：
```
[{rule_code}] {具体问题描述}。
```

示例：
- ✅ `[R1_FIELD_OWNERSHIP] 字段 et.mobile 不在表 edu_teacher 的 DDL 中（疑似幻觉）`
- ✅ `[R2_BACKTICK_ALIAS] 字段别名「金额(元)」含特殊字符但未用反引号包裹`
- ✅ `[R3_MYSQL57_LIMIT] MySQL 5.7 不支持 CTE（WITH ... AS）`
- ✅ `[R5_MISSING_LIMIT] SELECT 语句无 LIMIT 子句`
- ❌ `[R1] 字段不存在`（太简略）
- ❌ `[R1] ... 建议改为 au.mobile`（越权，工具不应给建议）

---

## 4. 4 类校验规则详解

### R1：字段-表归属校验（防幻觉核心）

**触发条件**：解析 SQL 提取所有 `table_alias.field` 引用，对每张表 DDL 校验该字段是否在该表中。

**实现**：
```javascript
// 1. node-sql-parser 解析 SQL
const ast = parser.astify(sql, { database: 'mysql' });

// 2. 自动提取 SQL 中所有涉及的表名（不依赖 LLM 传 tables）
const tables = parser.tableList(sql, { database: 'mysql' });
// → ['edu_teacher', 'admin_user']

// 3. 遍历 AST 提取所有 column ref
const columnRefs = extractColumnRefs(ast);
// → [{table: 'et', column: 'mobile'}, {table: 'au', column: 'id'}, ...]

// 4. 加载 tables 的 DDL（含 mtime 缓存）
const ddlMap = await loadDDLs(tables);

// 5. 提取每个表的 columns（含 field_config.field_aliases 联合）
const columnsMap = {};
for (const table of tables) {
  columnsMap[table] = extractColumnsFromDDL(ddlMap[table]);
  // 关键：把 field_config/{table}.json 的 field_aliases 联合加载，
  // 防止"虚拟字段"被 R1 误报
  const aliases = await loadFieldAliases(table);
  columnsMap[table] = [...columnsMap[table], ...aliases];
}

// 6. 校验
for (const ref of columnRefs) {
  const table = aliasToTableMap[ref.table];
  if (!table) {
    errors.push({
      rule: 'R1_FIELD_OWNERSHIP',
      message: `未知别名: ${ref.table}`,
      sqlSnippet: `${ref.table}.${ref.column}`,
      // 注意：不提供 suggestion —— 工具没有 LLM 的语义能力，无法判断应改为哪个字段
    });
    continue;
  }
  if (!columnsMap[table].includes(ref.column)) {
    errors.push({
      rule: 'R1_FIELD_OWNERSHIP',
      message: `字段 ${ref.table}.${ref.column} 不在表 ${table} 的 DDL 中（疑似幻觉）`,
      sqlSnippet: `${ref.table}.${ref.column}`,
      // 不给 suggestion —— 工具不能判断 LLM 真正想要的字段是什么
    });
  }
}
```

**关键依赖**：
- SQL 解析（`node-sql-parser`）
- DDL 缓存（mtime 失效，避免每次重新读盘）
- `field_config/{table}.json` 的 `field_aliases` 联合（防虚拟字段误报）

### R2：字段别名反引号

**触发条件**：检测 `AS <别名>` 中别名含特殊字符（括号、空格、中文括号等）但未用反引号包裹。

**实现**（纯 regex，无需 parser）：
```javascript
// 1. 用 regex 提取所有 SELECT 别名
// 匹配模式：AS 后跟的非关键字标识符
const aliasPattern = /\bAS\s+(`[^`]+`|'[^']+'|"[^"]+"|[\u4e00-\u9fff\w]+)/gi;
const aliases = [...sql.matchAll(aliasPattern)];

// 2. 检测特殊字符
const SPECIAL_CHARS = /[\(\)\s\u4e00-\u9fff]/;
for (const match of aliases) {
  const raw = match[1];
  // 跳过已有反引号/单引号/双引号包裹的
  if (/^[`'"]/.test(raw)) continue;
  if (SPECIAL_CHARS.test(raw)) {
    errors.push({  // 注意：errors，不是 warnings
      rule: 'R2_BACKTICK_ALIAS',
      message: `字段别名「${raw}」含特殊字符但未用反引号包裹`,
      sqlSnippet: `AS ${raw}`,
      // 不给 suggestion —— 改法显而易见（加反引号），LLM 自行处理
    });
  }
}
```

### R3：MySQL 5.7 限制检测

**触发条件**：检测 CTE（WITH）、窗口函数（OVER）、JSON_TABLE 等 MySQL 5.7 不支持的语法。

**实现**（用 parser 顺带实现）：
```javascript
// 1. CTE 检测：ast.cte 或 ast.with 存在
const cteList = ast.cte || ast.with;
if (cteList && cteList.length > 0) {
  errors.push({
    rule: 'R3_MYSQL57_LIMIT',
    type: 'CTE',
    sqlSnippet: 'WITH ... AS (...)',
    message: 'MySQL 5.7 不支持 CTE（WITH ... AS）',
    // 不给 suggestion —— 改写子查询的具体形式 LLM 自己决定
  });
}

// 2. 窗口函数检测：递归 AST 检查所有 function call 是否有 over 属性
const windowFuncs = findWindowFunctions(ast);
for (const fn of windowFuncs) {
  errors.push({
    rule: 'R3_MYSQL57_LIMIT',
    type: 'WINDOW_FUNCTION',
    sqlSnippet: `${fn.name.toUpperCase()}(...) OVER (...)`,
    message: `MySQL 5.7 不支持窗口函数 ${fn.name.toUpperCase()}() OVER (...)`,
    // 不给 suggestion —— 改写方式多种，LLM 自己选择
  });
}

// 3. JSON_TABLE 检测：扫所有 function call
if (hasFunctionCall(ast, 'json_table')) {
  errors.push({
    rule: 'R3_MYSQL57_LIMIT',
    type: 'JSON_TABLE',
    sqlSnippet: 'JSON_TABLE(...)',
    message: 'MySQL 5.7 不支持 JSON_TABLE()',
    // 不给 suggestion —— LLM 自己选择替代函数
  });
}
```

### R5：LIMIT 子句检测

**触发条件**：检测 SELECT 语句无 LIMIT 子句（应用层会截断但体验降级）。

**实现**（纯 regex，无需 parser）：
```javascript
// 1. 检测是否 SELECT
if (ast.type !== 'select') return;

// 2. 检测是否有 LIMIT
if (!ast.limit) {
  errors.push({  // 注意：errors，不是 warnings
    rule: 'R5_MISSING_LIMIT',
    message: 'SELECT 语句无 LIMIT 子句',
    sqlSnippet: '(末尾)',
    // 不给 suggestion —— LLM 自己选择 LIMIT 数值
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
    description: "校验 SQL 字段-表归属、字段别名反引号、MySQL 5.7 限制、LIMIT 子句。返回 {valid, errors, summary}。",
    func: validateSqlFields,  // 仅传 sql 参数
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
   - 工具只返回 `errors`（无 warnings）—— 拿到任何 error 都必须重写 SQL。
   - 工具不提供建议改法（无 suggestion 字段）—— LLM 自己根据 errors 信息决定如何改。
   - 跳过调用的代价：幻觉 SQL 会到达 MySQL，触发 `Unknown column` 错误，浪费 LLM 一次输出机会。
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

## 6. ~~路由层兑底~~（v3 删除）

**v3 决策（2026-07-23）**：删除整个路由兑底层。**工具只服务于 LLM，不在 `/api/query/execute` 路由层兜底**。

### 6.1 为什么不做了

| 兜底场景 | 实际后果 | 工具能否阻止？ |
|---|---|---|
| 字段幻觉（`et.mobile` 不存在）| MySQL 直接返回 `Unknown column 'mobile'` | ❌ 路由层调也救不了——用户拿不到数据 |
| 危险 SQL（DELETE/UPDATE 无 WHERE）| [sqlValidator](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js) 已拦截 | ❌ sqlValidator 已覆盖 |
| LLM 跳过 T0 直接输出 | LLM 已输出，路由层再查也改变不了 | ❌ 已"既成事实"，无意义 |

**核心结论**：
- 工具的**唯一价值**是给 LLM 一个"重写机会"——必须在 LLM 输出 SQL **之前**调用
- 一旦 SQL 已被 LLM 输出，路由层做任何校验都是"事后诸葛亮"
- 用户拿不到数据 ≠ 路由层能补救；最多返回错误信息，**用户体验更差**（不知 LLM 已尝试过）

### 6.2 不做路由兑底的副作用

| 副作用 | 评估 |
|---|---|
| LLM 跳过 T0，幻觉 SQL 到达 MySQL | MySQL 返回 `Unknown column`，用户看到错误。**可接受**——本来就是 LLM 责任 |
| 路由层不再做"二次防御" | sqlValidator 仍负责安全 SQL 检查；字段层面交给 LLM 自治 |
| 前端不展示校验错误 | ✅ 不需要——错误只在 LLM 流中循环，**用户根本看不到校验错误** |

### 6.3 未来如果要做路由兑底

**触发条件**：当出现 ≥ 3 次 LLM 跳过 T0 仍输出幻觉 SQL 的真实案例时，重新评估。

**实现成本**：~0.5h（参考原 §6 设计即可恢复）。

---

## 7. SKILL.md 同步精简方案

### 7.1 待删规则

| # | SKILL.md 当前行 | 内容 | 工具替代 |
|---|---|---|---|
| 1 | 第 29 行 | **字段别名**：别名含特殊字符（括号、空格、中文括号等）时必须用反引号 | R2 |
| 2 | 第 31 行 | MySQL 5.7 限制：禁止窗口函数、CTE(WITH)、JSON_TABLE | R3 |
| 3 | 第 57 行 | 查询必须包含 `LIMIT`，默认 1000 | R5 |
| 4 | 第 71-75 行 | 【硬性要求】`**SQL**:` 后面必须是 ```sql ... ``` 代码块 | **保留**（与字段校验无关）|
| 5 | 第 20-25 行 | del 过滤规则（4.2） | **保留**（2026-07-23 决策：R4 不做，保留 SKILL.md）|

**预计减少**：~3 行（R2/R3/R5 各 1 行）

### 7.2 待改规则

| # | SKILL.md 当前行 | 改法 |
|---|---|---|
| 1 | 铁律部分（5a 字段-表归属 L41）| 改写为"必调 validate_sql_fields，拿到 errors 必须重写" |

### 7.3 精简后预估

| 段 | 现在 | 精简后 | 变化 |
|---|---|---|---|
| 核心规则 | ~50 行 | ~49 行（删 L29 字段别名 + L31 MySQL 5.7）| -2% |
| 系统约定 | ~10 行 | ~9 行（删 L57 LIMIT）| -10% |
| 输出格式 | ~17 行 | ~17 行 | 不变 |
| 标签纠正 | ~9 行 | ~9 行 | 不变 |
| 用户交互 | ~10 行 | ~10 行 | 不变 |
| **合计** | **~96 行** | **~94 行** | **-2%** |

**注**：精简量减少是因 R4 / R6 不做（原计划 R4 占 -3 行）。工具主要价值从"减 SKILL.md"转向"防字段幻觉"。

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

### 8.2 第 2 步：工具实现（~3h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 实现 `validateSqlFields()` 主函数 | `backend/src/services/toolFuncs.js` | 1h |
| 实现 R1 字段-表归属校验（含 `field_aliases` 联合加载）| 同上 | 1h |
| 实现 R2 / R3 / R5 规则 | 同上 | 1h |
| **小计** | | **~3h** |

### 8.3 第 3 步：注册 + SKILL.md（~1.4h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 工具注册到 `tools` 列表 | `backend/src/services/llm.js` | 0.5h |
| `sessionToolRegistries` 加字段 | 同上 | 0.2h |
| `buildToolCallChecklistMessage` 追加 | 同上 | 0.2h |
| SKILL.md 精简 3 条规则（L29 / L31 / L57）| `skills/sql-creator-skill-v2/SKILL.md` | 0.3h |
| SKILL.md 铁律改写"必调 validate_sql_fields"（L41）| 同上 | 0.2h |
| **小计** | | **~1.4h** |

### 8.4 ~~第 4 步：路由兑底~~（v3 删除）

~~原计划：query.js 集成 + 前端错误展示 + 错误信息传递。~~

**v3 决策**：不做路由兑底，本步骤整体删除，节省 ~1h。详见 §6。

### 8.5 第 4 步：测试（~1.5h）

| 任务 | 文件 | 估时 |
|---|---|---|
| 工具单元测试（4 类规则各 5 case = 20 case）| `backend/test-validate-sql-fields.mjs` | 1h |
| 端到端：清空日志，问"查询今天上课的老师" | `logs/2026-07-23/admin_llm.log` | 0.5h |
| 验证 `au.mobile`（不是 `et.mobile`）| 同上 | （含在端到端中）|
| **小计** | | **~1.5h** |

### 8.6 总计

| 阶段 | 估时 |
|---|---|
| 1. 基础设施 | 3h |
| 2. 工具实现 | 3h |
| 3. 注册 + SKILL.md | 1.4h |
| 4. ~~路由兑底~~（v3 删除）| ~~1h~~ → 0h |
| 5. 测试 | 1.5h |
| **合计** | **~8.9h ≈ 9h** |

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

#### 工具单元测试（4 类规则各 5 case = 20 case）

| 规则 | case 数 | 覆盖点 |
|---|---|---|
| R1 字段-表归属 | 5 | 字段不存在、别名未注册、嵌套子查询、CASE WHEN 字段、`field_aliases` 联合加载 |
| R2 字段别名反引号 | 5 | 中文括号、英文括号、空格、纯中文（无需反引号）、已加反引号 |
| R3 MySQL 5.7 限制 | 5 | WITH/CTE、ROW_NUMBER() OVER、JSON_TABLE、不带这些（pass）、注释里出现（不报）|
| R5 LIMIT 子句 | 5 | 无 LIMIT、有 LIMIT、UNION 子句、含子查询的 LIMIT、LIMIT 0 |

### 9.2 端到端

清空 `logs/2026-07-23/admin_llm.log`，提问"查询今天上课的老师"。

**期望**：
- ✅ LLM 在最终 SQL 输出前调 `validate_sql_fields`
- ✅ 工具返回 `valid: true`（因为 SQL 已正确）
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
| R-2 | LLM 跳过调用 `validate_sql_fields` | 中 | SKILL.md 强调"必调"；失败代价 = MySQL `Unknown column`（可接受）|
| R-3 | 工具增加 +1 轮延迟（3-5s）| 中 | 接受；长期可优化为 LLM 一次输出即带校验 |
| R-4 | 错误信息不可操作（LLM 不知道怎么改）| 中 | 单元测试覆盖错误信息；LLM 自己读 message + sqlSnippet 决策 |
| R-5 | DDL 文件读取慢（每张表 50ms × 多表 = 200ms）| 中 | 加内存缓存（按 mtime 失效）|
| R-6 | 工具返回结构不兼容现有 LLM 调用 | 低 | 复用现有 `DynamicTool` 框架；返回 JSON 字符串 |
| R-7 | SKILL.md 精简过度，LLM 反而表现下降 | 中 | 保留铁律和核心规则；只删 3 条机械规则 |
| ~~R-8~~ | ~~路由兑底报错信息不友好~~ | ~~低~~ | ❌ **v3 删除**：不做路由兑底，无此风险 |
| R-9 | `validate_sql_fields` 工具被剪枝后 LLM 无法调用 | 中 | 工具不属于一次性调用（多次可调），不剪枝 |

---

## 11. 关键决策记录

| # | 决策 | 选项 | 选定 | 理由 |
|---|---|---|---|---|
| D-1 | SQL 解析方式 | A 自实现 / B node-sql-parser / C 全 regex | **B** | 用户决策（2026-07-23 AskUserQuestion）|
| D-2 | 调用时机 | 仅 LLM / 仅路由 / 两者 | **仅 LLM** | 用户决策（2026-07-23 AskUserQuestion）；v3 再次确认删除路由兑底 |
| D-3 | SKILL.md 精简范围 | 同步精简 / 不动 | **同步精简** | 用户决策（2026-07-23 AskUserQuestion）|
| D-4 | MySQL 5.7 限制是否替代 | 替代 / 保留 | **替代（纳入工具 R3）** | 2026-07-23 追加决策：引入 `node-sql-parser` 后 R3 实现成本从 2-3h 降至 0.5h，纳入工具 |
| D-5 | 工具命名 | validate_sql_fields / check_sql / sql_quality_check | **validate_sql_fields** | 与现有 `request_*` / `get_*` 命名风格一致 |
| D-6 | 错误信息格式 | JSON / markdown 列表 | **JSON 结构化** | LLM 易解析；前端可展示 |
| D-7 | 工具注册 | 一次性 / 每次会话 | **每次会话** | 不剪枝（多次可调）|
| **D-8** | **R4 del 过滤规则** | **做 / 不做** | **不做** | 2026-07-23 追加决策：用户聚焦字段幻觉，R4 保留 SKILL.md L20-25 |
| **D-9** | **R6 关联字段有效性** | **做 / 不做** | **不做** | 2026-07-23 追加决策：合并到 R1（字段-表归属已覆盖 JOIN 字段）|
| **D-10** | **工具参数** | **要求 LLM 传 tables / 工具自动提取** | **工具自动提取** | 2026-07-23 追加决策：避免 LLM 漏传表，减少出错 |
| **D-11** | **错误分级** | **errors + warnings + suggestion** / **仅 errors 无 suggestion** | **仅 errors 无 suggestion** | 2026-07-23 追加决策：工具职责 = 报错；不"开方"避免启发式建议误导 LLM；无 warnings 避免 LLM 误判严重性 |
| **D-12** | **路由兑底** | **路由兑底** / **仅 LLM 自检** | **仅 LLM 自检（v3 删除路由兑底）** | 2026-07-23 v3 决策：工具价值 = 给 LLM "重写机会"；事后兜底无意义；sqlValidator 已覆盖安全；省 1h |

---

## 12. 备注

- `validate_sql_fields` 与 `request_user_choice` 是**互补**关系：前者是 SQL 质量关，后者是用户交互关
- 工具返回值会进入 LLM context（作为 tool result），所以**返回结构要紧凑**——避免 LLM 上下文过载
- DDL 缓存按 mtime 失效，避免每次重新读盘
- **职责分离**：工具只"报错"（errors[]），不"开方"（无 suggestion 字段）。LLM 是决策者，工具是质检员
- **无 warnings 数组**：所有校验不通过都归为 errors——避免 LLM 误判严重性而忽略
- **工具边界**：只服务于 LLM 流，**不在路由层兜底**。路由层错误由 [sqlValidator](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlValidator.js) + MySQL 自身报错负责
- 本文档不重复 [2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 中已写的上下文，重点在新增工具的设计
- 实施后应在 [2026-07-20-skill-md-simplification.md](./2026-07-20-skill-md-simplification.md) 第 4 节"改造工作量"中追加"第 3 步"指向本文档

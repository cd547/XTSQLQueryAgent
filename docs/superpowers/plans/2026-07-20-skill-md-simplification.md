# SKILL.md 精简 + 代码化改造方案

**日期**：2026-07-20
**目标文件**：`skills/sql-creator-skill-v2/SKILL.md`
**目标**：将 104 行 / ~3.7K 字符的 SKILL.md 压到 ~50 行，同时把可由代码强制的规则下沉到工具/校验层。

---

## 0. 调研结论速览（2026-07-22 更新）

调研时发现 3 个"看似能做"的代码化改造，**实际代码已实现或被故意弃用**，对应 SKILL.md 行**不能删**：

| 改造 | 状态 | 原因 |
|---|---|---|
| 工具层 duplicate 检测 | ❌ 作废 | `checkAndFilterDuplicateCall`（llm.js:390-498）已实现 |
| sqlValidator 自动注入 LIMIT | ❌ 作废 | [query.js:653-654](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L653-L654) 显式注释"不再静默追加"——会破坏复杂查询；改用应用层截断 |
| ~~get_join_condition 剥离 del~~ | 🟡 仍待评估 | 第一步调研未做 |

调研时犯过的错误（已纠正）：
1. **误以为 sqlValidator 注入 LIMIT** —— 实际从未实现，且被故意弃用
2. **误以为可以加 toolResultCache 兜底** —— `checkAndFilterDuplicateCall` 已在 func 之前 block，加 cache 是死代码
3. **误以为 registry "返回缓存"** —— 实际是 block with error / auto-filter args

---

## 1. 背景

LLM 长期使用 `sql-creator-skill-v2`，SKILL.md 经过多次修订后已经膨胀到 104 行，规则之间存在重复（如"del 过滤"在核心规则 4.2 和系统约定中各讲一遍），且很多规则本质是**流程约束**而非"LLM 必须知道的知识"——这些约束由代码强制更可靠（LLM 偶尔会漏规则，代码不会）。

本次方案以"**LLM 只需要记住它必须用脑子判断的事**"为原则，将流程性 / 重复性 / 机械性规则下放到代码层。

---

## 2. 现状分段分析

| 段 | 行号 | 长度 | 评价 |
|---|---|---|---|
| 核心规则 | 5-45 | 41 行 | 大头，含工作流、字段、JOIN、铁律等 |
| 系统约定 | 47-58 | 12 行 | 部分与核心规则重复 |
| 输出格式 | 60-76 | 17 行 | 含正反例，结构可代码化 |
| 标签纠正 | 78-86 | 9 行 | 防误触核心规则，必须保留 |
| 用户交互 | 88-104 | 17 行 | 部分可代码化 |

---

## 3. 逐条改造方案

### 3.1 核心规则

| # | 现有规则 | 行号 | 处理 | 代码层替代方案 |
|---|---|---|---|---|
| 1 | 仅回答 SQL 相关 | 6 | ✅ 保留 1 行 | —— |
| 2 | UPDATE/DELETE 必须 WHERE | 7 | ✅ 保留 1 行 | sqlValidator 已强制，LLM 仍需知道（决策时） |
| 3a | 工作流：先调 get_domain_index | 9-10 | ⚠️ 删 | **工具层前置校验**：`get_sliced_index` / `get_table_schema` / `get_table_ddl` 接收时检查 registry 标记，若未先调 `get_domain_index` 则报 `🚫 错误：必须先调用 get_domain_index` |
| 3b | 工作流：分析涉及哪些域 | 11 | ✅ 保留 1 行 | —— |
| 3c | 工作流：再调 get_sliced_index | 12 | ⚠️ 删 | 跟随 3a 校验（同一 registry 检查） |
| 3d | 工作流：再调 get_table_schema/ddl | 13 | ✅ 保留 1 行 | —— |
| 4 | 用 virtual_associations | 15 | ✅ 保留 1 行 | —— |
| 4.1 | conditional_many_to_one 规则 | 16-19 | ✅ 保留 4 行 | LLM 必须知道的 CASE WHEN 模式 |
| 4.2 | del 过滤规则 | 20-25 | ⚠️ 删 | **工具层剥离**：`get_join_condition` 返回时自动移除 `AND t_b.del = 0` 末尾条件；**sqlValidator 后处理**：在 LEFT JOIN 结尾的 ON 条件中如有 `AND t_b.del = 0` 自动移除（防 LLM 误写） |
| 5 | 字段名来自 DDL | 27 | ⚠️ 简化 1 行 | sqlValidator 校验未知字段名 + 错误信息喂回 LLM（已实现） |
| 6 | 字段别名反引号 | 29 | ⚠️ 删 | **get_table_schema 返回时 alias 已加反引号**；sqlValidator 输出时 regex 兜底 |
| 7 | MySQL 5.7 限制 | 31 | ✅ 保留 1 行 | —— |
| 8 | 歧义处理 | 33 | ✅ 保留 1 行 | —— |
| 9 | 铁律：只调用当前会话给定的工具 | 36-37 | ⚠️ 删 | **已实现**：`availableToolNames` 校验，调用列表外工具直接 execError |
| 10 | 铁律：已查过的表不再查 | 44 | ⚠️ 删 | **工具层 duplicate 检测**：registry `recordToolCall` 已记录，重复调用直接返回缓存（"已查过，禁止重复" 错误信息） |
| 11 | 铁律：一次性传入所有表 | 43 | ⚠️ 删 | **工具层合并检测**：检测同一 batch 内是否分批调用同工具 |
| 12 | 铁律：输出 SQL 后不许补工具 | 45 | ✅ 保留 1 行 | LLM 行为约束 |

### 3.2 系统约定

| # | 现有规则 | 行号 | 处理 | 代码层替代方案 |
|---|---|---|---|---|
| 1 | CURDATE 不硬编码 | 49 | ✅ 保留 1 行 | —— |
| 2 | del 字段语义 | 50-52 | ⚠️ 删 | 与核心规则 4.2 重复；代码化后由 sqlValidator 统一处理 |
| 3 | 时间字段格式 | 53-56 | ✅ 精简 2 行 | 合并表达 |
| 4 | 金额单位为分 | 57 | ✅ 保留 1 行 | —— |
| 5 | LIMIT 1000 | 58 | ❌ **不能删** | sqlValidator **不**自动注入 LIMIT（[query.js:653-654](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L653-L654) 显式注释"不再静默追加"——会破坏含 LIMIT 的复杂查询和 UNION）。实际机制是**应用层截断**：query 路由执行原 SQL，结果 > 1000 行时 slice + 设 `truncated: true`（[query.js:658-668](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L658-L668)）。无 LIMIT 的 SQL 不会报错，但前端会显示"结果已截断"，体验降级——LLM 仍应主动带 LIMIT。 |

### 3.3 输出格式

| # | 现有规则 | 行号 | 处理 | 代码层替代方案 |
|---|---|---|---|---|
| 1 | markdown 格式 | 60-71 | ✅ 保留模板（删正反例） | —— |
| 2 | 必须 ```sql 围栏 | 73-76 | ⚠️ 删 | **后端后处理**：检测 LLM 输出文本，若含 SQL 关键字但无 ```sql 围栏，自动包裹（regex: 匹配 `**SQL**:\s*(SELECT|...)` 替换为带围栏） |

### 3.4 标签纠正

| # | 现有规则 | 行号 | 处理 | 说明 |
|---|---|---|---|---|
| 1 | 正常用法 | 79-81 | ✅ 保留 | —— |
| 2 | 反例：不要把 user_choice 答案当术语映射 | 83-86 | ✅ **保留**（防误触核心） | LLM 语义判断，代码无法替代 |

### 3.5 用户交互

| # | 现有规则 | 行号 | 处理 | 代码层替代方案 |
|---|---|---|---|---|
| 1 | 何时调 request_user_choice | 89-91 | ✅ 保留 2 行 | —— |
| 2 | question/options 禁用 ASCII 双引号 | 93-97 | ⚠️ 删 | **request_user_choice 入参自动 escape**：检测 question/options 中的裸 `"`，替换为中文引号 `""` |
| 3 | multi_select 决策 | 99-102 | ✅ 保留 2 行 | LLM 语义判断 |
| 4 | 用户答案格式 | 104 | ✅ 保留 1 行 | —— |

---

## 4. 改造工作量

### 4.1 第一步（高优先级 / 低风险）

| 改造 | 文件 | 行数 | 状态 |
|---|---|---|---|
| 工具层 duplicate 检测 | `backend/src/services/toolFuncs.js` | ~15 | ❌ **作废**：`checkAndFilterDuplicateCall`（llm.js:390-498）已实现，全重复硬 block / 部分重复自动改 args，registry 在工具执行成功后立即写入。再加 cache 是死代码（永远走不到 func）。 |
| request_user_choice 入参 escape | `backend/src/services/toolFuncs.js` | ~10 | 🟡 待定（见下） |
| sqlValidator 自动注入 LIMIT | `backend/src/services/sqlValidator.js` | ~20 | ❌ **作废**：[query.js:653-654](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L653-L654) 显式注释"不再静默追加 LIMIT 1000"——会破坏含 LIMIT 的复杂查询和 UNION。改用应用层截断（[query.js:658-668](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L658-L668)），无 LIMIT 的 SQL 不会报错但会被截断。SKILL.md 这条**不能删**。 |
| SKILL.md 删除对应行 | `skills/sql-creator-skill-v2/SKILL.md` | -15 | 🟡 部分待定 |

### 4.2 第二步（中优先级 / 需测试）

| 改造 | 文件 | 行数 |
|---|---|---|
| get_table_schema 返回 alias 加反引号 | `backend/src/services/toolFuncs.js` | ~5 |
| sqlValidator 检测 `**SQL**:` 裸文本自动包裹 | `backend/src/services/sqlValidator.js` | ~15 |
| get_join_condition 剥离末尾 `AND t_b.del = 0` | `backend/src/services/toolFuncs.js` | ~10 |
| 工作流前置校验（必须先调 get_domain_index） | `backend/src/services/toolFuncs.js` | ~15 |
| SKILL.md 删除对应行 | `skills/sql-creator-skill-v2/SKILL.md` | -25 |

### 4.3 不动

- 标签纠正整段（语义判断必须 LLM）
- multi_select 决策（语义判断）
- 字段必须 DDL / WHERE 子句 / 业务规则必须显式体现（LLM 核心职责）
- MySQL 5.7 限制（CASE WHEN / LEFT JOIN 模板，LLM 必须知道）

---

## 5. 精简后预估

| 段 | 现在 | 精简后 | 变化 |
|---|---|---|---|
| 核心规则 | 41 行 | ~20 行 | -50% |
| 系统约定 | 12 行 | ~5 行 | -60% |
| 输出格式 | 17 行 | ~8 行 | -50% |
| 标签纠正 | 9 行 | 9 行 | 不变 |
| 用户交互 | 17 行 | ~5 行 | -70% |
| **合计** | **104 行** | **~47 行** | **-55%** |

---

## 6. 风险评估

| 风险 | 等级 | 应对 |
|---|---|---|
| 工具层 escape 改了用户原文 | 中 | request_user_choice 弹框显示应与原 prompt 一致；测试覆盖多 case |
| ~~sqlValidator 自动注入 LIMIT 影响大查询~~ | ~~低~~ | ❌ **作废**——已确认不做此改造，注释 [query.js:653-654](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L653-L654) 说明会被故意弃用 |
| get_join_condition 剥离 del 改变语义 | 中 | 必须保留剥离前的原始字符串日志，便于回滚；测试覆盖 5+ JOIN case |
| 工作流前置校验让 LLM 第一次就报"必须先调" | 低 | 错误信息明确，LLM 第一次自然按顺序调 |
| 代码化后 SKILL.md 仍含重复规则 | 低 | 分两步实施时同步删除对应行 |

---

## 7. 验证方案

### 7.1 第一步验证

1. `node --check backend/src/services/toolFuncs.js`
2. `node --check backend/src/services/sqlValidator.js`
3. 单元测试：
   - ~~duplicate 检测：连续调 2 次 `get_table_ddl(['edu_student'])` → 第二次报 `🚫 已查过：edu_student`~~ ❌ **作废**——已由 `checkAndFilterDuplicateCall` 实现
   - escape：传入 `question: '您说的"内部用的"是指？'` → 实际存储为中文引号
   - ~~LIMIT 注入：SQL 无 `LIMIT` → 自动追加 `LIMIT 1000`~~ ❌ **作废**——sqlValidator 不注入，应用层截断
4. 端到端：清空日志后问"查询今天上课的学生"，确认 LLM 不再被规则干扰（admin_llm.log）

### 7.2 第二步验证

1. alias 反引号：`get_table_schema` 返回字段别名已含 `` ` ``
2. SQL 围栏：故意让 LLM 输出裸 SQL `**SQL**: SELECT ...`，后端自动改为 `**SQL**:\n ```sql\nSELECT ...\n````
3. del 剥离：构造 JOIN 含 `AND t_b.del = 0`，剥离后等价
4. 工作流校验：跳过 `get_domain_index` 直接调 `get_table_ddl` → 报 `🚫 必须先调 get_domain_index`

---

## 8. 执行顺序

1. **第 1 步**（用户已确认先动）：仅 `request_user_choice` 入参 escape 1 个改造 + SKILL.md 对应行删除
2. **第 2 步**（待定）：3 个中优先级改造 + SKILL.md 对应行删除
3. 每次提交独立 PR，便于回滚
4. 第 1 步完成后，跑 admin_llm.log 回归测试（用既有 case 问"查询今天上课的老师"），确认无副作用

---

## 9. 备注

- `SKILL.md` 是 LLM 唯一的事实源（不进 system prompt，只在 tool 返回时按需加载）
- 代码化后，SKILL.md 的修改频率会大幅下降（从 1-2 周一次降到 1-2 月一次）
- 后续如需新增 SQL 规则，优先评估代码层强制，再考虑 SKILL.md

# 08-Token 优化与问题分析

> 分析日期：2026-09-07
> 范围：token 消耗链路、严重 bug、SKILL.md 提示词、domains / field_config / table_index.json 文件结构
> 数据来源：对 backend/src 全量代码走查 + 对 skills/sql-creator-skill-v2 全量数据统计（脚本实测）

---

## 一、Token 消耗链路分析（核心问题）

### 1.1 一次提问的 token 流向

```
用户提问 /generate
  └─ Round 0: system(SKILL.md+域清单 ~3.5KB) + 全量历史 messages + tools(5个)  → LLM
  └─ Round 1: system + 全量历史 + Round0新增(assistant+tool结果)              → LLM
  └─ Round N: ...每轮全量重发累积上下文                                        → LLM
```

关键代码位置：
- 历史加载：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1154-L1182) `loadMessagesFromDb` 全量取出 `llm_messages.messages` JSON blob
- 每轮重放：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1249-L1312) `requestMessages = messages.map(...)` 仅剥离无工具调用的 reasoning_content，其余全发
- 历史落库：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L875-L911) `saveMessagesToDb` 全量覆盖写

### 1.2 Token 消耗大户 TOP 排序（按严重程度）

| # | 消耗点 | 机制 | 量级估计 | 证据 |
|---|--------|------|---------|------|
| 1 | **会话历史无窗口，全量重放** | 每次新问题 + 问题内每轮循环，都把本会话所有历史（含全部 tool 结果）重发。token 随会话轮次线性增长、随轮内循环二次增长 | 10 轮问答后单次请求轻松破万 tokens | llm.js L1155/L1249 |
| 2 | **带 tool_calls 的 assistant `reasoning_content` 跨问题永久保留** | ✎ 修订：官方契约要求工具调用轮的 reasoning_content 在**后续所有轮次**必须完整回传（否则 400），不可单独剥离；只能随 P0 整段压缩一起移除 | 每条 500-3000 tokens，累积 | llm.js L1233-L1255 |
| 3 | **`get_call_history` synthetic 消息每轮注入且永久落库** | 每轮在 assistant.tool_calls 头部插 1 条 synthetic tool_call + 1 条 tool 结果（含累积 called_tools 列表），存入 DB 历史；新问题后旧消息仍在上下文重放 | 每轮 +2 条消息，内容单调增长 | llm.js L1560-L1590、agentHelpers.js L371-L387 |
| 4 | **system prompt（SKILL.md + 域清单）** | 每轮都发。prefix cache 命中时计费低，但未命中轮全价 | ~3.5KB ≈ 1500-2000 tokens/轮 | toolFuncs.js L992-L1011 |
| 5 | **`get_table_schema` 返回中 field_config 键名冗长** | `virtual_associations` 每条目重复 `name/target_table/join_condition/type/description/business_rule` 六个长键名；`join_condition` 重复完整表名 | VA 全库 75.8KB（紧凑 JSON），短键化可省 ~40% | 实测统计（见 3.2） |
| 6 | **R6 EXPLAIN 等工具结果** | validate_sql_fields 返回 explain plan + errors，失败时 LLM 重写再调，同一 SQL 多版本进历史 | 每次数百 tokens | validators.js L303-L347 |
| 7 | **`common_sqls` 未审计直传 LLM** | 3 个 field_config 含 `common_sqls`（共 ~6KB SQL 模板），`getTableSchema` 原样透传，SKILL.md 未声明该字段 | 单表最多 ~3KB | toolFuncs.js L399-L404（removeEmptyProperties 保留非空字段） |

### 1.3 已有的优化（不应回退）

- `get_table_schema` 紧凑 JSON 输出 + 字段精简为 t/c/fk（toolFuncs.js L365-L371、L749-L752）
- tools 数组不剪枝、get_call_history 稳定注入 → 保 DeepSeek prefix cache（llm.js L1270-L1276）
- message_tokens 用 API 权威 usage 替代本地 BPE 全量重算（llm.js L868-L874）
- `get_sliced_index` 文本卡片已跳过空字段、related_tables 行已开关关闭（toolFuncs.js L628-L668）
- field_config serve 时 `removeEmptyProperties` 剥空字段（toolFuncs.js L195-L217）

### 1.4 优化方案（按 ROI 排序）

#### P0：历史窗口 / 旧工具结果压缩（预计省 50-80% 长会话 token）

现状：唯一被考虑的压缩方案（compactConsumedToolResults）已于 2026-08-25 移除（原因：折叠中段破坏 prefix cache + related_tables 不可见，见 llm.js L1210-L1215 注释）。

建议方案（不破坏 prefix cache 的"尾部截断"而非"中段折叠"）：
1. **跨问题边界压缩**：新问题到来时，把"上一个完整问题"的 tool 消息体替换为短占位（如 `[get_table_schema×5 已完成，表: a,b,c]`），保留 assistant 最终 SQL 输出与 user 消息原文。折叠点固定在历史中段、且每次新问题只折叠最旧的一段 → 前缀不稳定仅发生一次，后续轮 cache 仍命中。
2. **只保留最近 K 个问题的完整交互**：K 可配置（建议 2-3），超出部分按 1 处理。DeepSeek 上下文 64K/128K，K=3 通常 <20K tokens。
3. **会话级 token 硬上限告警**：`message_tokens` 已有权威值，超过阈值（如 40K）时前端提示"建议新开会话"，后端自动启用更激进压缩。

注意：压缩必须同步处理 `reasoning_content`（被压缩段的 tool_calls assistant 需一并剥离 reasoning_content，且保证 tool_call_id 契约完整，复用 sanitizeMessagesForLLM 思路）。

#### P1：get_call_history 历史瘦身（预计每问题省数百~数千 tokens）

- **只保留最新一条 get_call_history tool 结果**：注入新一轮时，把历史中所有旧的 get_call_history tool 消息内容替换为 `{"called_count":N,"_note":"已被最新快照取代"}`。语义无损（最新快照是全集），旧消息字节变化位置固定在中段。
- 或更简单：**新问题边界统一清理**——resetRegistryForNewQuestion 清空 callHistory 时，同步把 messages 里上一问题的 get_call_history tool 消息内容置为短占位。
- 旧消息中 `called_tools` 含每次调用的 sig 参数，内容长且无后续价值。

#### ~~P1：剥离旧问题的 reasoning_content~~ ✎ 修订：方案作废（官方文档已证伪）

llm.js L1233-L1239 注释称"带 tool_calls 的 assistant 必须回传 reasoning_content，否则 400"。**经官方 thinking_mode 文档确认：此约束覆盖"后续所有 user 交互轮次"**（"进行了工具调用的轮次，在后续所有请求中，必须完整回传 reasoning_content 给 API，否则返回 400"），官方多轮样例 Turn 2 仍携带 Turn 1 的 reasoning_content。因此**跨问题剥离不可行**，原方案作废。

旧问题 reasoning 的唯一省 token 途径是 P0 的"整段替换"：把旧问题的整个工具调用段（assistant reasoning + tool_calls + tool 结果）一并替换为摘要占位——不能只留 tool_calls 而删 reasoning。

#### P2：field_config 结构瘦身（serve 层短键化，见 3.2）

`getTableSchema` 输出前对 VA / enums 做键名映射（如 `n/t/j/y/d/r`），SKILL.md 同步图例。VA 部分省 ~40% tokens。字段别名/枚举映射保留长键（LLM 语义可读性优先）。

#### P2：common_sqls 审计

确认 `common_sqls`（order_student / customer_clue_info 等 3 个文件）是否应进 LLM 上下文：
- 若要保留 → SKILL.md 补充该字段说明，并将其移出 field_config（单独 common_sqls/ 目录按需加载）；
- 若不要 → `getTableSchema` 显式 `delete result.common_sqls`（当前无此删除，只删了 table_name）。

#### P3：SKILL.md 精简（见第二节）

#### P3：会话级 token 观测

日志中已有每轮 usage（llm.js L1421 附近），建议聚合输出"每问题 prompt_tokens 增量"，便于持续观测优化效果。

---

## 二、SKILL.md 提示词优化

当前 3488 字符（LF），每轮随 system 发送。逐段问题：

### 2.1 重复表述（可直接合并，省 ~15-20%）

| 位置 | 问题 |
|------|------|
| 规则 4.2 与「系统约定」逻辑删除段 | `del/deleted` 规则说了两遍（"JOIN ON 默认不过滤" vs "WHERE 默认追加 = 0；JOIN ON 中默认不过滤（详见核心规则 4.2）"）。保留一处，另一处一行引用 |
| 规则 4 与规则 4.1 | 关联表发现机制与 conditional_many_to_one 处理可合并为一个"关联表"小节 |
| 「标签纠正」节 | 正反示例+禁止场景+误判提醒共 9 行，可压缩为 3 行（触发条件 1 行 + 禁止 1 行 + request_user_choice 区分 1 行） |
| 「用户交互」节 multi_select 决策 | 3 条规则可用 1 行表达："互斥单选/可叠加多选/不确定单选" |

### 2.2 结构性问题

1. **规则编号有两个"4"**（4 关联表、4.1、4.2 之后又接 5 字段）——编号 4/4.1/4.2/5 混排，LLM 引用规则时易混淆。建议统一为 1-9 顺序编号。
2. **「输出格式」模板中嵌套 markdown 代码块**（```` ```markdown ```` 内含 ```` ```sql ````），占用 token 且 LLM 只需知道输出骨架。可精简为 5 行纯文本模板说明。
3. **规则 9「铁律」信息密度低**：checklist 形式（✓ 列表）可压缩为 2 行命令式语句，"禁止分批"等约束保留。
4. **工具契约与工具 description 重复**：规则 5「返回结构（短键名约定）」与 `get_table_schema` 工具 description 中的 JSON 结构说明重复。~~建议：工具 description 已每轮发送，SKILL.md 中只保留行为规则，删掉返回结构描述~~（✅ 2026-09-07 已实施：SKILL.md 规则 5 删除返回结构段、保留行为规则；同时修正工具 description 的键名错误——`aliases?/enums?` → 与实际返回一致的 `field_aliases?/field_enums?`）。

### 2.3 建议精简目标

3488 → ~2600 字符（-25%），不损失任何规则语义。重点：删重复、并编号、化模板为指令。

---

## 三、数据文件结构分析

### 3.1 实测统计（2026-09-07 脚本跑数）

| 文件 | 规模 | 关键数据 |
|------|------|---------|
| table_index.json | 174 表，49.8KB | 空 related_tables 40 表；空 business_constraints 166 表；空 business_rules 154 表；空 tags 112 表；空数组字面量 `[]` 336 处 |
| field_config/*.json | 174 文件，181.1KB | 2 空格 pretty-print，minify 后 134.5KB（**25.7% 是缩进空白**） |
| ddl/*.sql | 174 文件，235.2KB | serve 时 parseDDLFields 解析，不直接进 LLM |
| domains/*.json | 12 域，210 条域-表引用 | `report` 域 0 表（死域）；**`abroad_standard_field` 不在任何域 → 路由不可达（孤儿表）** |

一致性校验：**0 缺失**（index↔field_config↔ddl 三者 174 表完全互有，domains 引用的表都在 index 中）——数据完整性很好。

### 3.2 冗余清单（按是否进 LLM 上下文分级）

**A 类：真实进 LLM 上下文的冗余（省 token）**

1. **VA 键名冗长**：全库 398 条 VA，紧凑 JSON 75.8KB；短键化（`{t:目标表,j:join条件,y:类型,n:名称,d:描述,r:规则}`，省略默认值 many_to_one）后 45.0KB，**省 40.6%**。这是 get_table_schema 多表调用时的主要 token。
2. **field_enums 与 DDL 注释、 business_rules 三重重复**：如 `del: {0:正常,1:作废}`（enums）↔ DDL 注释"是否作废 0正常 1作废" ↔ business_rules "del 是作废位"条目。同一语义存三份、进两次上下文（DDL 解析的 c 注释 + field_config）。建议：enums 存在的字段，DDL 注释中的枚举部分裁剪（serve 层做，不动源文件）。
3. **join_condition 重复表名**：`edu_student.id = edu_achievement.edu_student_id` 中两表名各出现一次；可用 `{t:edu_student, c:id, fc:edu_student_id}` 结构化表达，serve 层拼字符串。省 token 但增加 LLM 理解成本，**谨慎做**（优先级低）。

**B 类：不进 LLM 上下文的冗余（省磁盘/维护成本，可选）**

1. **table_index.json 可省 58%**：minify 省 37%；进一步短键+去空字段省 58%（49.8KB → 21KB）。注意：serve 时 formatTableInfo 已跳过空字段，**此项不影响 LLM token**，仅磁盘/维护收益。优先级低。
2. **field_config pretty-print 缩进**：25.7% 空白。serve 时重新紧凑序列化，同样**不影响 LLM token**。若字段配置由人手工维护，pretty-print 反而有利，**建议不改**。
3. **`related_tables` 与 `virtual_associations` 双份存储且不一致**：49 张表的 related_tables 与 VA 目标表不一致；11 张表 related_tables 为空但 VA 非空。当前 SHOW_RELATED_TABLES_IN_CARDS=false（不展示），related_tables 已成死数据。建议：中期把 related_tables 从 table_index.json 移除，以 VA 为唯一来源（与项目记忆"VA 为 JOIN 唯一来源"约束一致）；若未来要恢复卡片展示，从 VA 自动生成。

**C 类：结构性问题**

1. **孤儿表 `abroad_standard_field`**：在 index/field_config/ddl 中存在但无域归属 → get_sliced_index 路由永远到不了它。修复：加入 `study_abroad` 域或删除。
2. **死域 `report`**：0 表。建议删除或补齐。
3. **domains/*.json 仅存 id/name/tables**，与 domain_router_index.json 的描述分离合理，无冗余。
4. **ddl/ 与 field_config 拆分合理**（物理结构 vs 业务语义），serve 层合并，无重复存储（field_config 不存 fields 列）。唯一交叉点是注释中的枚举（见 A2）。

---

## 四、严重 Bug 清单（按严重程度排序）

### B1【高】会话历史无上限，长会话 token 成本持续膨胀

- 位置：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1154-L1182)、[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L875-L911)
- 问题：`llm_messages` 每会话一行，messages 数组无限追加（含全部 tool 结果、每轮 get_call_history 注入、reasoning_content）；无窗口、无摘要、无上限。
- 触发：同一会话连续提问 10+ 轮，单请求 prompt_tokens 破万。✎ 修订（1M 上下文）：v4 模型上下文已达 1M，"撑爆上下文导致会话报废"的紧迫性下降；主要危害转为**成本**——缓存未命中时输入按 1 元/百万 tokens（v4-flash）计费，长会话每轮都是大输入。另注意 SQLite 单行 messages JSON 无限增大也带来读写与内存压力。
- 修复：见 1.4 P0（跨问题压缩 + 最近 K 问题窗口 + 阈值告警）。

### B2【中】旧问题的 reasoning_content 与 get_call_history 消息永久重放

- 位置：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1233-L1255)、[agentHelpers.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/agentHelpers.js#L371-L387)
- 问题：requestMessages 只剥离"无 tool_calls"的 reasoning；旧问题（最后一条 user 之前）的 tool 调用段 reasoning + synthetic get_call_history 消息（内容单调增长）全部跨问题重放。
- 触发：多轮问答的会话，每轮都为此多花数千 tokens。
- 修复（✎ 修订）：reasoning_content **不能单独剥离**（官方要求工具调用轮后续所有轮次必须回传，否则 400），只能随 1.4 P0 的"整段替换"一起移除；get_call_history 瘦身不受此限，仍按 1.4 P1 独立实施。

### B3【中】R5 LIMIT 校验被子查询绕过（✅ 2026-09-07 已修复）

- 位置：[validators.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/validators.js#L255-L270)、[sqlParser.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/sqlParser.js#L190-L206)
- 问题：`hasLimitClause(sql)` 是全 SQL regex，注释自承"子查询的 LIMIT 也算有 LIMIT"。`SELECT * FROM big_table WHERE id IN (SELECT id FROM t LIMIT 1)` 外层无 LIMIT 也通过校验 → 与 SKILL.md「必须带 LIMIT」铁律冲突，可能产出全表扫描 SQL。
- 触发：LLM 生成带子查询 LIMIT 的 SQL（很常见）。
- 修复（已实施）：regex `hasLimitClause` 替换为 AST 版 `hasOuterLimit(ast)`——只认约束整体结果集的 LIMIT：简单 SELECT 看 `ast.limit`；UNION 链（`_next` 串联）看链尾 limit（MySQL 语义：作用于整个 UNION 结果）或每个分支都自带 limit（各分支有界→整体有界）。顺带修复了旧实现"带分号的 SQL 返回数组 AST 时 R5 被整体跳过"的次生漏洞。错误消息同步改为「最外层无 LIMIT（子查询内的 LIMIT 不计）」。
- 验证：`test-validate-sql-fields.mjs` R5 全部 9 条断言通过（含新增 4 条：derived table 内 LIMIT、WHERE IN 子查询 LIMIT、各分支带 LIMIT 的 UNION、带分号无 LIMIT）；套件 50 断言中唯一失败项 R1.5 为修复前既有失败（stash 验证 HEAD 同样失败），与本次无关。

### B4【中】reasoning effort 模型已过时：low/medium 均被映射为 high，前端三档实为两档

- 位置：[query.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/routes/query.js#L322-L328)、[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L1293-L1302)、前端思考档位选项
- 问题（✎ 整体重写，原"两层回落不一致"已次要化）：官方 thinking_mode 文档确认当前 `reasoning_effort` 仅支持 **`high` / `max`**；出于兼容 **`low`、`medium` 会被服务端映射为 `high`**（`xhigh` → `max`）；普通请求默认 effort 即为 `high`。后果：
  1. 前端"低/中/高"三档选项中，**低和中实际等效于 high**——用户以为选了省 token 的低档，实际思考量并未降低，档位 UI 产生误导；
  2. 项目记忆中的"low/medium/high、medium 为默认"约定已过时（服务端默认 high）；
  3. 原报告的两层回落不一致（路由层→high、llm 层→medium）在服务端映射下殊途同归（都变 high），降级为代码整洁问题。
- 修复：前端档位改为与模型实际能力对齐（如"关闭 / 标准(high) / 深度(max)"）；后端 VALID_EFFORTS 同步改为 `{high, max}`；旧会话存储的 low/medium 无需迁移（服务端自动映射为 high）。

### B5【低】request_user_choice 重复拦截的提示消息在 v3 契约下取不到 question

- 位置：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L694-L701)
- 问题：`computeUserChoiceSignature` 已兼容 v3 questions[] 数组，但拦截提示消息仍用 `args?.question`（v3 下为 undefined）→ LLM 看到 `已被问过: "undefined..."`（实际显示空串）。功能正确，提示误导。
- 修复：消息改从 signature 或 questions[0].question 取。

### B6【低】withTimeout 注册监听前 signal 已 aborted 时漏 abort

- 位置：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L163-L170)
- 问题：`addEventListener('abort', ..., {once:true})` 不会重放已发生的 abort；若 externalSignal 在创建 listener 前已 aborted，仅依赖 timeout 兜底。runSqlAgent 循环入口有 `signal?.aborted` 检查（L1314）覆盖了主要路径，但存在竞态窗口。
- 修复：注册监听前加 `if (externalSignal.aborted) { controller.abort(externalSignal.reason); }`。

### B7【低】sanitizeMessagesForLLM 只修复最后一个 assistant 的 tool_calls

- 位置：[llm.js](file:///D:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L962-L1039)
- 问题：连续两次中断产生的两处破损，只修最后一处；更早的破损 tool_calls 仍会触发 API 400。实际概率低（首次续问后 sanitized 数组会落库修复），但理论上存在。
- 修复：循环处理所有含 tool_calls 的 assistant 消息（从后往前逐个补齐）。

---

## 五、优化实施路线建议

| 优先级 | 项目 | 预计收益 | 风险 |
|--------|------|---------|------|
| P0 | 历史跨问题"整段替换"压缩 + 最近 K 问题窗口（B1/B2） | 长会话 token 省 50-80% | 中：整段替换（reasoning+tool_calls+tool 结果一起），不可只删 reasoning（官方契约 400） |
| P1 | get_call_history 历史瘦身（B2） | 每问题省数百-数千 tokens | 低：语义无损 |
| P1 | R5 LIMIT 校验改 AST（B3） | 质量修复 | 低：有现成测试框架 |
| P1 | effort 档位对齐模型实际能力 high/max（B4） | 消除"选低档没省 token"的误导 | 低：前端选项 + VALID_EFFORTS |
| P2 | field_config VA 短键化 + SKILL.md 图例同步 | schema 工具结果省 ~30-40% | 低：serve 层转换，源文件不动 |
| P2 | common_sqls 审计决策 | 单表最多 ~3KB | 低 |
| P2 | SKILL.md 精简 25% | 每轮省 ~400-500 tokens（cache miss 时） | 低：纯文案 |
| P2 | B5/B6/B7 小修 | 正确性 | 低 |
| P3 | table_index 去 related_tables 死数据、孤儿表/死域修复 | 数据质量 | 低 |

> 原则提醒（✎ 修订）：历史压缩仍应"尽量保持前缀稳定"，但 kv_cache 新规则下不必追求绝对不变——系统会检测多次请求的公共前缀并单独落盘，且按固定 token 间隔截取缓存单元；折叠的代价是 1-2 次请求的 cache 重建，而非永久失效。真正要避免的是**每轮都变**（如旧 checklist 方案那种末尾抖动）。另注意缓存"不再使用后几小时到几天自动清空"，跨天使用的会话 cache 命中率会自然下降。

---

## 附录 A：DeepSeek 官方文档核对结论（2026-09-07）

以下来自官方文档（pricing / thinking_mode / multi_round_chat / tool_calls / kv_cache），用于校准本报告及代码中的过时假设。

### A.1 模型与价格（quick_start/pricing）

| 模型 | 上下文 | 输出上限 | 输入（缓存命中） | 输入（未命中） | 输出 |
|------|--------|---------|----------------|--------------|------|
| deepseek-v4-flash（项目默认） | 1M | 384K | 0.02 元/百万 | 1 元/百万 | 2 元/百万 |
| deepseek-v4-pro | 1M | 384K | 0.025 元/百万 | 3 元/百万 | 6 元/百万 |

- 成本直觉：**cache 命中与未命中价差 50 倍**——保 prefix cache 仍是第一优先级；一次 1 万 tokens 的请求，命中时约 0.0002 元、未命中约 0.01 元，输出（2 元/百万）往往比命中的输入更贵。
- `deepseek-chat` / `deepseek-reasoner` 模型名已于 2026-07-24 弃用，分别映射为 v4-flash 的非思考/思考模式。代码中如出现旧模型名应清理。

### A.2 思考模式（guides/thinking_mode）

- `reasoning_effort` 当前仅 **`high` / `max`** 两档有效；`low`/`medium` 被映射为 `high`，`xhigh` → `max`；普通请求默认 `high`，复杂 Agent 类请求自动 `max`（→ B4）。
- **工具调用轮的 `reasoning_content` 必须在后续所有请求中完整回传，否则 400**；无工具调用轮的 reasoning_content 传了也会被忽略（→ P0 压缩粒度约束、B2 修正）。
- 思考模式下 `temperature`/`top_p`/`presence_penalty`/`frequency_penalty` **不生效**（不报错）。代码中 `temperature: 0`（llm.js L1307）在思考模式下是无效参数，保留无害但不产生确定性效果——输出随机性不可依赖 temperature 控制。

### A.3 多轮对话（guides/multi_round_chat）

- API 无状态，每轮需客户端自行拼接全部历史——确认了本项目"全量重放"是 API 的强制模型，**压缩只能在客户端做**（P0 方案方向正确）。

### A.4 上下文硬盘缓存（guides/kv_cache）

- 缓存单元落盘三机制：① 请求的"用户输入结束位置 + 模型输出结束位置"；② **多次请求公共前缀自动检测落盘**；③ 长输入/输出按固定 token 间隔截取。
- 推论 1：历史中段一次性折叠后，稳定的新前缀经 2-3 次请求即可重建缓存——P0 压缩的 cache 代价是暂时的（修正原"破坏 prefix cache"的绝对化担忧）。
- 推论 2：缓存"尽力而为"，闲置几小时到几天自动清空——跨天会话首轮必然 cache miss。
- `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 已在代码中采集（llm.js L1403 附近），观测基础已具备。

### A.5 Tool Calls strict 模式（Beta，新机会）

- 官方支持 `strict: true` 的 Function 调用严格模式（需 `base_url=https://api.deepseek.com/beta`），服务端校验 JSON Schema，可**减少 LLM 输出非法 tool 参数**的概率。
- 项目价值：当前 `fixBareQuotesInJsonArgs`（llm.js L56-L92）是在 JSON.parse 失败后修补裸引号的事后兜底；strict 模式可从源头降低参数解析失败重试（每次重试都是一整轮 token）。注意限制：object 所有属性须 required、`additionalProperties:false`，array 不支持 minItems/maxItems——现有工具 schema 需调整才能启用。建议列为 P3 探索项。

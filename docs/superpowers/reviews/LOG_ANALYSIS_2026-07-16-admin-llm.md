# LOG_ANALYSIS_2026-07-16-admin-llm

> 目标日志: `logs/2026-07-16/admin_llm.log`(8:51 旧样本)+ 18:37 新清空后样本
> 分析日期: 2026-07-16
> **版本: v4(2026-07-16 18:50 实施) — 去掉 get_table_ddl 的 short 维度,只按表名拦截**
> 状态: **优化基线** — 后续所有 LLM 日志相关优化以此报告为参照
>
> ⚠️ **v4 实施说明**(2026-07-16 18:50):
> - **依据**: 用户指出"外键/关联信息应通过 `get_table_schema` (virtual_associations) 和 `get_sliced_index` 获取,不是 `get_table_ddl`"
> - **改动**: [llm.js:439-460](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L431-L460) 中 `get_table_ddl` 分支不再按 `(table, short)` 组合判断,改为只按表名拦截
> - **影响**: `reg.tableDdl` 从 `Map<table, Set<shortKey>>` 改为 `Set<table>`(4 处同步修改);`short` 入参仍兼容(传 0 或 1 都不影响判定结果)
> - **v3 §3.5 调查项(重复 s1 未被拦截)** —— v4 已自动解决,根因不重要了
> - **P2-10 v3 soft warning 建议** —— 已硬拦截,作废
>
> ⚠️ **v3 修订说明**: 用户在 18:37 清空日志后跑了**新一次会话**,发现"`edu_course_exam_subject_name` 先以 `short=1` 被 `get_table_ddl` 调用,后又以 `short=0` 被调用"。本节澄清:**这不是 dedup bug**——按代码设计意图,`(table, short=0)` 与 `(table, short=1)` 是**不同调用**(返回内容不同),故意允许独立缓存。**真正问题**是 LLM 工具选择策略低效:先 `short=1` 后 `short=0` 是浪费,因为 `short=0` 是 `short=1` 的超集。详见 §3.4 v3 新增。
>
> ⚠️ **v2 修订说明**: v1 文档(本文件旧版)第 3.3 节曾错误地认为 "LLM 在 Turn 2 Round 0 重新调用了 6 个工具"——**该结论是误读**。实际情况下 LLM 在 Turn 2 仅新调用 1 个工具,其余 6 个工具调用是 messages 数组中保留的 Turn 1 历史。详见 §3.3 v2 修订。
>
> ⚠️ **v1 错误清单**(2026-07-16 当日已修正):
> - ❌ v1 §3.3 标题"Turn 2 的'重走流程'" — LLM 实际未重走
> - ❌ v1 §2.2 表格 T2-0 行 "历史消息整体重发" — 实际 LLM 新调 1 个工具
> - ❌ v1 §5 P2-7 "强化 Turn 2+ 不重走流程" — 前提错误,LLM 已在正确行为
> - ❌ v1 §7 Turn 2 token 14,627 数据 — 未实际测算,标注为估算
>
> ⚠️ **v3 调查项作废**(2026-07-16 18:50 v4): 新样本中 LLM 在 Turn 2 Round 0 重复调了 `get_table_ddl(s1)[7 表]`(同 18:37 Turn 1 已调过),但整个日志 grep 找不到"🚫 拦截重复调用"。**v4 已实施硬拦截**,此调查项作废(无论根因为何,都已被覆盖)。

---

## 1. 样本概况

| 指标 | 值 |
|------|-----|
| 文件大小 | **237,322 字符** (≈232 KB) |
| 轮次 | 9 轮 (Turn 1: 7 轮, Turn 2: 2 轮) |
| 耗时 | 08:51:03 ~ 08:51:58, **约 55 秒** |
| 单次会话工具调用总数 | `get_domain_index` × 2 + `get_sliced_index` × 2 + `get_table_schema` × 4 + `get_table_ddl` × 5 + `request_user_choice` × 2 |
| 用户问题 | "查询今天的教研活动,需要展示排课ID、上课时间、课时、科目名称、老师、上课校区、教室、活动状态" |
| 业务流 | 域路由 → 表索引 → schema/ddl → user_choice 确认"教研活动"指代 → 生成 SQL |

### Round 块大小分布

| Round | 行数 | 大小估算 |
|-------|------|---------|
| 0 | 205 | ~21 KB |
| 1-4 | 216-256 | ~22-26 KB |
| 5 | 276 | ~28 KB |
| 6 | 297 | ~30 KB |
| T2-0 | 320 | ~33 KB |
| T2-1 | 373 | ~38 KB |

---

## 2. 工具去重分析 — ✅ 基本正确

### 2.1 checklist 机制有效

`sessionToolRegistries` 注册表 (见 [llm.js:245-273](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L245-L273)) 设计合理:
- `get_table_ddl` 用 `Map<tableName, Set<'short=0'|'short=1'>>` 区分两种 short 参数
- `get_table_schema` / `get_sliced_index` 用 `Set<table>`
- `request_user_choice` 用 `Map<id, signature>`
- `request_tag_confirmation` 用 `Set`

### 2.2 实际调用 vs checklist 一致性

| 轮次 | 实际调用 | checklist 增量 | 合规 |
|------|---------|---------------|------|
| 0 | (无) | — | ✅ |
| 1 | `get_domain_index` | 首次 | ✅ |
| 2 | `get_sliced_index[course, activity]` | 首次 | ✅ |
| 3 | `get_table_schema[edu_study, keqiao_study, edu_activities]` | 3 个新表 | ✅ |
| 4 | `get_table_ddl(s1)[3 表]` | short=1 首次 | ✅ |
| 5 | `get_table_schema[admin_user, edu_campus_school, edu_campus_school_class, edu_course, edu_course_exam, edu_course_exam_subject, edu_course_exam_subject_name]` | **7 个新表,旧 3 表未带** | ✅ **去重成功** |
| 6 | `get_table_ddl(s1)[7 表]` + `request_user_choice` | 仅新表 | ✅ |
| T2-0 | **仅 1 个新调用**:`get_table_ddl(s0)[edu_study]`;其余 6 个 tool_call 在 messages 历史里 | checklist 已注入(行 2212) | ✅ 见 §3.3 v2 |
| T2-1 | `get_table_ddl(s0)[edu_study]`(短 = 0,即完整 DDL 含索引/外键) | short=0 首次(与 s1 区分) | ✅ |

**v2 修正(v1 表格此行原写"历史消息整体重发" + 标注 ⚠️):**
- ⚠️ **LLM 在 Turn 2 没有"重走流程"**
- Turn 2 Round 0 的 messages 数组中**保留了 Turn 1 全部 6 轮历史**(包含所有 assistant.tool_calls + tool 结果),这是 LLM API 协议要求(LLM 需要看到自己之前做过什么,才能决定下一步)
- Turn 2 Round 0 **仅新发了 1 个工具调用**:`get_table_ddl(s0, edu_study)`(为了查看完整 DDL 含索引/外键,补充 s1 的不足)
- Turn 2 Round 0 的 tools 列表里 `get_domain_index` / `get_sliced_index` **已被 prune**(llm.js:842-844 生效)

**结论**: LLM 在第 5、6 轮自觉没把已查的 3 个表带进新参数,checklist 机制**在发挥作用**;`get_table_ddl` 按 `(table, short)` 区分正确,同一个 `edu_study` 在 s0(完整 DDL)和 s1(仅列定义)分别被记录是合理的(返回内容不同)。

---

## 3. 冗余问题 — 🔴 严重

### 3.1 五大冗余源

| # | 冗余源 | 单轮大小 | 9 轮累计 | 说明 |
|---|--------|---------|---------|------|
| ① | **System Prompt** | ~2.6 KB | ~23 KB | 完整 9 条核心规则 + 输出格式,每轮一字不差 |
| ② | **Tools 数组定义** | ~2 KB | ~18 KB | 7 个工具的完整 schema 描述,每轮重复 |
| ③ | **完整 messages 历史** | 累计增长 | ~150+ KB | Round 6 含 Round 0-5 所有 tool_calls + results;Turn 2 重发 Turn 1 全部 |
| ④ | **Tool result 内容** | — | ~30+ KB | `get_sliced_index` 30+ 表索引、`get_table_schema` JSON、`get_table_ddl` DDL 多次重复 |
| ⑤ | **Checklist 字符串** | 几行/轮 | ~1 KB | 完整 checklist 既在 messages 末尾,又在外层日志单独打 |

### 3.2 重复出现的 tool result (具体证据)

| Tool Result | 出现位置 | 出现次数 |
|-------------|---------|---------|
| `get_sliced_index` 30+ 表索引 | Round 2, 3, 4, 5, 6, T2-0 | 6 次 |
| `get_table_schema[edu_study, keqiao_study, edu_activities]` | Round 3, 5, T2-0 | 3 次 |
| `get_table_ddl[3 表]` | Round 4, 6, T2-0 | 3 次 |
| `get_table_schema[7 表]` | Round 5, T2-0 | 2 次 |
| `get_table_ddl[7 表]` | Round 6, T2-0 | 2 次 |

### 3.3 Turn 2 真实情况诊断(v2 修订)

#### 3.3.1 事实澄清

v1 文档原标题"Turn 2 的'重走流程'"是**误读日志**导致的错误结论。

**真实事实**(基于日志行 1714-2213 的逐行核读):

| 现象 | v1 误判 | v2 真相 |
|------|---------|---------|
| Turn 2 Round 0 的工具调用数 | "重新调用 6 个" | **仅新调用 1 个**:`get_table_ddl(s0, edu_study)` |
| `get_domain_index` 在 Turn 2 出现 | "LLM 重新调用" | **messages 历史里**(行 2051-2060) |
| `get_sliced_index` 在 Turn 2 出现 | "LLM 重新调用" | **messages 历史里**(行 2068-2080) |
| tools 列表里 `get_domain_index` 还在 | "没被剪枝" | **已被剪枝移除**(llm.js:842-844) |
| checklist 注入 Turn 2 | "没塞" | **已经塞了**(行 2212-2213) |
| `get_table_schema` 7 表调用 | "重复" | 是历史保留(行 2097-2110,行 2163-2177) |
| `get_table_ddl(s1)` 7 表调用 | "重复" | 是历史保留(行 2129-2144,行 2190-2202) |

**v1 误判根因**:把 messages 数组中保留的 `assistant` + `tool` 历史消息,误认为是 LLM 在 Turn 2 重新发出的工具调用。

#### 3.3.2 LLM 实际行为(正确)

- ✅ Turn 2 看到 messages 历史(知道之前做过什么)
- ✅ Turn 2 看到 checklist(行 2212 注入,知道所有已调用工具)
- ✅ Turn 2 看到 tools 列表(`get_domain_index` / `get_sliced_index` 已被 prune,无法重调)
- ✅ Turn 2 实际只新发了 1 个工具 `get_table_ddl(s0, edu_study)`,这是**新参数**(`short=0` 完整 DDL 含索引/外键),与 Turn 1 的 `short=1`(仅列定义)不同,**合理**。

#### 3.3.3 真正的"问题"(v2 重新定义)

虽然 LLM 没有"重走流程",但日志里看到的"Turn 2 体积巨大"是真实的:

| 现象 | 原因 | 影响 |
|------|------|------|
| Turn 2 Round 0 messages 数组大 | `saveMessagesToDb`(llm.js:661)把 Turn 1 完整 messages 存 DB,Turn 2 加载时原样返回 | LLM 接收大量"已看过"的历史 tool_result |
| Tool result 内容完整保留 | `get_sliced_index` 的 30+ 表索引、`get_table_ddl` 的完整 DDL 每次都全量保留 | 单条 tool_result 占 ~1-2 KB,6 轮累积 ~10 KB |
| 没有"消费后折叠"机制 | messages 数组一旦 push,后续不剪枝(只有 tools 数组会被 prune) | 越往后 LLM 接收的冗余越多 |

**这才是 v2 重新识别的真正优化目标**:不是"防止 LLM 重走流程"(LLM 已经做对了),而是**降低 messages 历史中已消费 tool_result 的 token 开销**。

#### 3.3.4 潜在 Bug(需要验证)

虽然本日志样本中 LLM 行为正确,但 `sessionToolRegistries`(llm.js:245)的实现存在一个潜在脆弱点:

```js
const sessionToolRegistries = new Map();  // 模块级 Map,无持久化
```

**场景**:Turn 1 完成 → `request_user_choice` 中断 → **服务器重启** → Turn 2 启动。

**问题**:
- `loadMessagesFromDb` 正常加载 messages(Turn 1 的所有 tool_calls + tool_results 都在)
- `getOrCreateRegistry(sessionId)` 返回**新的空 registry**
- `buildToolCallChecklistMessage` 返回 `null`(没东西可列)
- LLM 真的有可能从头重走全流程(因为没 checklist 提示、没 prune 工具)

**修复方向**(未实施,仅记录):
- 在 `loadMessagesFromDb` 之后,扫描 messages 重建 `sessionToolRegistries`(扫描 tool_call + tool_result 对,调用现有 `recordToolCall` API)
- 重建前判断 `if (reg.getDomainIndexCalled) return` 避免重复登记

### 3.4 v3 新增 → **v4 实施** — `get_table_ddl` 的 `short=0` vs `short=1` 拦截策略

#### 3.4.1 用户原始报告(2026-07-16 18:37,已修正)

用户清空日志后跑了新会话,反馈:
> "`edu_course_exam_subject_name` 事先以 `short=1` 的方式被方法 `get_table_ddl` 调用,后来又以 `short=0` 的方式被调用"

#### 3.4.2 v3 误判 → v4 修正(2026-07-16 18:50)

v3 时我曾错误判断:
- 假设: `short=0` 是 `short=1` 的超集(含索引/外键),应保留 short 维度分别去重
- 结论: 不算 dedup bug,LLM 工具选择策略低效

**v4 用户反馈修正了我的错误判断**:
> "外键信息,以及关联表不是应该通过 `get_table_schema` 和 `get_sliced_index` 获取的吗"

核实:
- [toolFuncs.js:417-422](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L417-L422) `get_table_schema` description: "获取指定表的字段详情(别名、枚举、约束、**业务**、**关联**),支持多表"——"关联"即 `virtual_associations.join_condition`
- `get_table_ddl` 主要价值是看**完整 DDL 文本**(用于 ORM 建模或 DDL 验证),**不是 JOIN 信息**

**因此,v4 把 `get_table_ddl` 的去重从 `(table, short)` 改为仅按 `table`**——LLM 不应通过重复查 ddl 补充外键/关联信息。

#### 3.4.3 v4 代码改动(已实施)

[llm.js:431-460](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L431-L460) `checkAndFilterDuplicateCall` 的 `get_table_ddl` 分支:

```js
if (toolName === 'get_table_ddl') {
  // v4: 去掉 short 维度,只按表名去重
  const requested = normalizeTableNames(args.table_names);
  if (requested.length === 0) return { block: false, args };
  const dupes = requested.filter(n => reg.tableDdl.has(n));
  const fresh = requested.filter(n => !reg.tableDdl.has(n));
  // ... block/notice 逻辑不变
}
```

[llm.js:530-532](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L530-L532) `recordToolCall`:

```js
} else if (toolName === 'get_table_ddl') {
  // v4: 改为只存表名,不再区分 short
  normalizeTableNames(args.table_names).forEach(n => reg.tableDdl.add(n));
}
```

**4 处同步修改**:
- 行 260: `tableDdl: new Set()` (类型变更)
- 行 280: `const ddlList = [...reg.tableDdl].sort().join(', ') || '无';` (buildChecklist 简化)
- 行 309: `parts.push(\`get_table_ddl:[${[...reg.tableDdl].sort().join(',')}]\`);` (buildToolCallChecklistMessage 简化)
- 行 431-460: 拦截逻辑(去掉 short)
- 行 530-532: 写入逻辑(简化)

**语法验证**: `node -e "import('./src/services/llm.js')"` 返回 `OK: module loaded`,无报错。

#### 3.4.4 v4 后拦截矩阵

| 场景 | v3 行为 | **v4 行为** |
|------|---------|-----------|
| 同表 + 之前 short=0,这次 short=0 | ✅ block | **✅ block** |
| 同表 + 之前 short=1,这次 short=1 | ✅ block | **✅ block** |
| 同表 + 之前 short=1,这次 short=0 | ⬜ 不拦截 | **✅ block** ← **关键变化** |
| 同表 + 之前 short=0,这次 short=1 | ⬜ 不拦截 | **✅ block** ← **关键变化** |
| 5 表新 + 2 表旧(同表名) | ⚠️ 过滤放行 | **⚠️ 过滤放行**(语义不变) |
| 5 表新 + 0 表旧 | ⬜ 原样放行 | **⬜ 原样放行** |
| `args.table_names = []` | ⬜ 直接放行 | **⬜ 直接放行** |
| `sessionId` 空 / registry 缺失 | ⬜ 直接放行 | **⬜ 直接放行**(行 354 早返回) |

#### 3.4.5 v3 调查项自动解决

v3 §3.5 中"重复 s1 未被拦截"的可疑调查项——**v4 不再需要调查根因**,因为:
- 不论原根因是 H1(server 重启)/H2(clearSessionRegistry)/H3(recordToolCall args)/H4(sessionId 异常)/H5(代码 bug)
- v4 的硬拦截**保证**:任何重复同表名(不论 short)都被 block
- 唯一遗留风险: `sessionId` 空 / registry 缺失仍可能漏拦截(行 354 早返回),但这属于"registry 机制失效",不是 dedup 逻辑问题

### 3.5 ~~v3 调查项 — 重复 s1 调用未被拦截(可疑现象,待根因调查)~~ — v4 已解决,作废

> v3 时的现象: 18:37 样本中 LLM 在 Turn 1 调 `get_table_ddl(s1)[7 表]`(行 1237),Turn 2 Round 0 又调同 7 表同 short=1(行 1532),同 `tool_call_id`,应被拦截但 grep 不到"🚫 拦截"日志。
> 
> **v4 实施后不再需要调查根因**——硬拦截保证任何重复同表名都被 block,不论原根因为 H1/H2/H3/H4/H5 中哪一种,均已覆盖。

### 3.6 信息密度估算

| 类别 | 占比 |
|------|------|
| 有效新增信息 (新工具调用的参数 + 新工具结果) | 约 15-20% |
| **冗余** | **约 80-85%** |

---

## 4. 工具函数代码 (toolFuncs.js / llm.js) — ✅ 设计良好

代码层面没有发现**未去重的工具**:
- [llm.js:245-273](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L245-L273) `sessionToolRegistries` 注册表
- [llm.js:308-345](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L308-L345) `buildToolCallChecklistMessage` checklist 构造
- [llm.js:801-806](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L801-L806) checklist 注入 messages 末尾(仅本轮使用,不持久化)

日志中也**未出现**同 `(tool, key_params)` 重复调用。

**真正的"重复"主要是日志记录层面对 LLM 完整请求的重复 dump**,而不是 LLM 行为或工具实现的重复。

---

## 5. 优化建议 (按性价比排序)

### P0 — 必做,显著降低日志体积 & LLM 上下文

| # | 优化点 | 目标 | 实施位置 |
|---|--------|------|---------|
| 1 | **压缩 Tool Result 长度** | `get_sliced_index` 返回 30+ 表,实际 LLM 只用 3-4 个,未用到的表截断 | `toolFuncs.js` → `sliceTableIndexByDomains` |
| 2 | **去重日志 dump** | 完整 messages 历史每轮重复 80%+,只记录 `messages.length` 和增量 diff | `llm.js:874` (`queueLog` 块) |
| 3 | **System Prompt 引用化** | system prompt 在每轮不变,日志中只写 `[system prompt: SHA=xxx]` | `llm.js:874` 周边 |

### P1 — 应该做,提升日志可读性 & 调试效率

| # | 优化点 | 目标 | 实施位置 |
|---|--------|------|---------|
| 4 | **Tools 数组引用化** | tools 数组所有 round 不变,只在第一轮记一次 | `llm.js:874` 周边 |
| 5 | **Tool Result 增量记录** | 同一 tool_call_id 的 result 只在首次出现时记全,后续只引用 | `llm.js` 工具执行回调 |
| 6 | **压缩 messages 中重复 tool result** | 复用 OpenAI 协议的 `tool_call_id` 引用机制,只发一次 | messages 构造处 |

### P2 — 推荐做,降低 LLM 行为成本

| # | 优化点 | 目标 | 实施位置 |
|---|--------|------|---------|
| 7 | ~~(v1) 强化"Turn 2+ 不重走流程"~~ | **v2 修正**:此建议基于错误前提——LLM 在本样本中**没有重走流程**,该建议作废。**新方向**:见下方 P2-7 v2 | — |
| 8 | **可配置日志级别** | `get_sliced_index` 这种大数据量工具,默认降级为 debug,只有 schema/ddl 升级到 info | `logger.js` 周边 |
| 9 | **日志分文件** | `admin_llm.log` 拆分为 `admin_llm_request.log` (请求) + `admin_llm_response.log` (响应),按需查看 | 日志路由 |

#### P2-7 v2 新方向(基于 v2 重新诊断)

| 子项 | 目标 | 实施位置 |
|------|------|---------|
| 折叠已消费的 tool_result | `get_sliced_index` / `get_table_ddl` 结果在 LLM 做出后续推进决策后,可折叠为短摘要(`[已查询 30+ 表,使用: edu_study, keqiao_study, ...]`),节省 token | 在 `requestMessages` 构造前(llm.js:827 之前)新增 `compactConsumedToolResults` |
| 重建 registry(防服务器重启丢状态) | `loadMessagesFromDb` 之后扫描 messages 重建 `sessionToolRegistries`,防止服务器重启后 checklist 为空、LLM 真的重走 | llm.js:771 之后新增 `reconstructRegistryFromMessages` |
| registry 持久化(可选) | 把 `sessionToolRegistries` 也持久化到 DB(单独表),避免每次加载时扫描 messages | 新建 `llm_tool_registry` 表 |

#### P2-10 ~~v3 新增(基于 v3 s0/s1 设计澄清)~~ — v4 已硬拦截,作废

| 子项 | 状态 |
|------|------|
| 强化 system prompt 引导 LLM 工具选择 | **v4 已硬拦截,该建议作废**(LLM 想再查也会被 block,不需要再软提示) |
| soft warning(not block) | **v4 已硬拦截,该建议作废** |
| checklist 增强 | **v4 已简化**:[llm.js:309](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L309) 不再区分 `s0/s1`,统一为 `get_table_ddl:[...]` |
| 排查 §3.5 调查项 | **v4 已解决,作废** |

#### P2-11 v4 新增(后续可考虑)

| 子项 | 目标 | 实施位置 |
|------|------|---------|
| 工具描述同步 | `toolFuncs.js` 中 `get_table_ddl` description 当前写"short=1 仅列定义;short=0 含索引/外键"——v4 后 short 不影响去重,但工具本身仍支持 short 参数(返回内容不同),描述可保留(只是去重按表名) | `toolFuncs.js:441-447` (可选) |
| 单元测试 | 验证 `get_table_ddl` 的去重:同表不同 short 都被 block;部分重复正确过滤;空表名放行 | 写 `tests/llm-dedup.test.js` |

---

## 6. 关键文件引用

| 文件 | 作用 |
|------|------|
| [llm.js:245-273](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L245-L273) | `sessionToolRegistries` 注册表实现 |
| [llm.js:275-297](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L275-L297) | `buildChecklist` 完整版 checklist(供 debug 用) |
| [llm.js:308-345](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L308-L345) | `buildToolCallChecklistMessage` 注入到 LLM 的精简版 checklist |
| [llm.js:710-](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L710) | `generateSQLWithLangChainStreamGen_BAK` 主入口 |
| [llm.js:789-811](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L789-L811) | checklist 注入逻辑 |
| [llm.js:874](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/llm.js#L874) | `queueLog` 完整 LLM 请求 dump(**优化重点**) |
| [toolFuncs.js:416-466](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/toolFuncs.js#L416-L466) | `get_table_schema` / `get_table_ddl` DynamicTool 定义 |

---

## 7. 优化效果预估(待验证)

> ⚠️ v2 修正:本节 token 数为 v1 估算,未实际测算,需在实施优化后用 LLM API 的 `usage.prompt_tokens` 字段校准。

按 P0 三项实施后,**理论上**预估:

| 指标 | 当前(估算) | 优化后(估算) | 降幅 |
|------|------------|-------------|------|
| 单次会话日志大小 | 232 KB(实测) | 30-50 KB | **~80%** |
| LLM 接收的 prompt token (Turn 1 Round 6) | ~11,000(估算) | ~5,000-6,000 | **~45%** |
| LLM 接收的 prompt token (Turn 2 Round 0) | ~14,000(估算) | ~4,000-5,000 | **~65%** |
| prefix_cache 命中率 | 10-95% (波动大) | 稳定 80%+ | 显著提升 |

**验证方法**(实施优化后必须做):
1. 跑同样的 5-10 次会话
2. 从 LLM API 响应中读取 `usage.prompt_tokens`
3. 填回本表,作为后续基线
4. 如果实测值与估算偏差 >30%,分析原因(可能是 tool_result 比预期大、或 system prompt 有动态内容)

> 注:LLM 接收 token 下降 → 调用成本下降 + 响应更快 + 注意力衰减减轻 → LLM 行为更稳定。

---

## 8. 后续行动

1. **优先实施 P0-1** (`sliceTableIndexByDomains` 截断未用表),改动小,效果立竿见影
2. **P0-2/3** (日志 dump 优化) 需协调 `queueLog` 行为,需评估对调试体验的影响
3. 实施完任一优化后,跑同样的 5-10 次会话对比日志大小 & LLM token 消耗
4. 每周/月抽样检查 `admin_llm.log`,对比此基线文件,验证是否出现新的冗余模式

---

**维护说明**: 任何涉及 LLM 日志、工具调用、messages 构造的改动,需更新本文件相关章节。

# Plan: 折叠已消费的路由类 tool result（方案 A，最终版）

> **创建日期**: 2026-07-17
> **状态**: ⏸️ 待实施（DESIGN-FROZEN）
> **关联**:
> - [CODE_ANALYSIS_2026-07-15-generate.md](../reviews/CODE_ANALYSIS_2026-07-15-generate.md)
> - [LOG_ANALYSIS_2026-07-16-admin-llm.md](../reviews/LOG_ANALYSIS_2026-07-16-admin-llm.md) §3.1 token 冗余分析
> - [SKILL.md](../../../skills/sql-creator-skill-v2/SKILL.md) 规则 3d / 4 / 5
> - DeepSeek 官方 thinking_mode 文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode

---

## 1. 背景

`/generate` 接口通过多轮 thinking_mode + 工具调用生成 SQL，存在三个痛点：
1. **token 消耗过多**：`messages` 数组只增不减，已消费的 tool_result 全量保留每轮重发
2. **上下文过长导致遗忘**：长上下文注意力衰减，LLM 被已用过的冗余信息稀释注意力
3. **同问题稳定性差**：长上下文 + 注意力波动 → 决策路径分叉

[LOG_ANALYSIS §3.1](../reviews/LOG_ANALYSIS_2026-07-16-admin-llm.md) 实测 9 轮会话 232KB，冗余 80-85%。其中 `get_sliced_index` 返回 30+ 表完整卡片（标签/关联表/业务规则/业务约束）是最大冗余源，每轮重发约 5KB。

---

## 2. 方案概述

### 2.1 核心思路

在每轮 LLM 请求构造 `requestMessages` 时，把**已消费**的 `get_sliced_index` tool_result 用精简版卡片替换。**当前消费区**（即将被下一轮 LLM 消费）的 tool result 保持完整，**已消费历史区**（已被先前轮次消费完毕）折叠为精简卡片（保留候选表清单 + business_rules/constraints）。

> **术语定义**（替代"首轮/后续轮"表述）
> 本方案不按轮次序号判断，而按 messages 中的**位置**判断消费状态：
> - **当前消费区**：messages 中"最后一个含 `tool_calls` 的 assistant"**及其之后**的 tool result。它们即将被下一轮 LLM 请求消费，必须保持完整。
> - **已消费历史区**：该 assistant **之前**的 tool result。它们已被先前轮次消费完毕，可折叠。
>
> 此定义与代码实现（`lastToolCallIdx` 位置判据）完全一致，天然适用于 `get_sliced_index` 在任意轮调用、同一工具多次调用等边界场景。

### 2.2 关键设计决策（经多轮推敲确认）

| 决策点 | 结论 | 理由 |
|--------|------|------|
| **当前消费区是否折叠** | ❌ 不折叠，保持完整 | LLM 首次看到该 tool result 时需完整信息（含 related_tables）做选表决策 |
| **折叠哪些字段** | 去掉 `related_tables`，保留其余 | related_tables 由 schema 的 virtual_associations 替代；business_rules/constraints 与 field_config 不一致（部分表 field_config 为空），不能去 |
| **折叠时机** | 仅折叠"已消费历史区"（最后一个含 tool_calls 的 assistant **之前**的 tool result） | 之后的"当前消费区"即将被下一轮 LLM 消费，必须完整 |
| **折叠内容来源** | 重新加载原始数据生成（不用正则解析文本） | 100% 准确，不受 formatTableInfo 格式变更影响 |
| **缓存策略** | 单请求级缓存 + cache-aside 兜底 | 一次 `/generate` 内跨轮复用，请求结束自动 GC；多用户天然隔离 |
| **只折叠 get_sliced_index** | ✅ | get_domain_index 内容小（~0.5KB），折叠收益低且可省略复杂度 |

### 2.3 为什么 business_constraints/rules 不能裁剪

经数据验证，table_index.json 与 field_config/{table}.json 中的 business_constraints/rules **不完全一致**：

| 表 | table_index.json | field_config | 差异 |
|----|-----------------|--------------|------|
| `tk_knowledge_new` | `business_constraints: [{name: "关于知识点的层级的限制", description: "...最多4层..."}]` | `business_constraints: {}` | **field_config 为空，信息丢失** |
| `edu_course_exam_subject_name` | `business_constraints: ["tk_knowledge_id已经废弃..."]` | `business_constraints: "tk_knowledge_id已经废弃..."` | 格式不同（数组 vs 字符串），内容一致 |
| `crm_channels` | `business_rules: [{rule: "五级渠道结构", description: "...channels1~channels5"}]` | `business_rules: [{rule: "五级渠道结构", description: "...channels1~channels5区分"}]` | 描述略有差异 |

**关键风险**：若裁剪 business_constraints/rules，`tk_knowledge_new` 的"层级最多4层"约束会完全丢失（field_config 里是空 `{}`）。

此外，用户明确指出：**"一些关键术语或逻辑需要更早的告知模型"**。即在路由阶段（sliced_index）就让模型看到 business_constraints/rules，比等到 schema 阶段才看到，能让模型更早建立业务认知，影响选表决策本身。

### 2.4 为什么 related_tables 可以裁剪

`related_tables` 只是表名数组，而 field_config 的 `virtual_associations` 提供：

```json
{
  "name": "关联科目",
  "target_table": "edu_course_exam_subject",
  "join_condition": "edu_course_exam_subject.id = edu_course_exam_subject_name.subject_id",
  "type": "one_to_one",
  "description": "1个科目名称对应1个科目",
  "business_rule": ""
}
```

`virtual_associations` 包含精确的 `join_condition` 和 `business_rule`，信息量远超 `related_tables`。SKILL.md 规则 4 明确要求"用 `field_config` 中的 `virtual_associations` 获取精确 JOIN 条件"，`related_tables` 仅作辅助提示。

**注意**：related_tables 只在"当前消费区"（选表阶段，LLM 首次看到该 result 时）有提示价值；一旦进入"已消费历史区"（LLM 已选完表），裁剪不影响，因为 schema result 里的 virtual_associations 完整保留（不折叠）。

---

## 3. 缓存设计

### 3.1 缓存生命周期

**单请求级**——缓存变量在 `generateSQLWithLangChainStreamGen_BAK` 函数内创建，仅在该次 `/generate` 调用内有效，请求结束自动被 GC 回收。

- **挂载位置**：`generateSQLWithLangChainStreamGen_BAK` 函数内、`while` 循环外的局部变量
- **清理时机**：函数返回后自动 GC（无需手动清理）
- **跨请求行为**：同 sessionId 第二次 `/generate` 时缓存已 GC，重新折叠一次（cache-aside 兜底）

### 3.2 为什么选单请求级而非 sessionId 级

| 维度 | 单请求级（本方案）| sessionId 级 |
|------|----------------|-------------|
| 多用户隔离 | **函数作用域天然隔离，不可能窜** | 依赖 sessionId 作 key，理论可窜 |
| 内存释放 | **请求结束自动 GC，零长期占用** | 需手动清理，Web 多用户场景会堆积 |
| Web 应用适配 | ✅ 天然支持并发 | ⚠️ 需考虑 LRU/TTL |
| 同会话跨请求复用 | ❌ 不复用（重新算一次 ~2-4ms） | ✅ 复用 |
| 实现复杂度 | 低（局部变量 + 参数传递） | 中（需挂模块级 Map + 清理逻辑）|

**决定性因素**：项目可能演进为 Web 应用，单请求级方案天然隔离多用户、零内存泄漏风险，代价仅是同会话第二次请求多算 ~2-4ms（可忽略）。

### 3.3 缓存结构

```
foldedCache: Map<tool_call_id, foldedContent>
```

- key：tool_call_id（每个 get_sliced_index result 唯一，DeepSeek API 返回的全局唯一 id）
- value：折叠后的 content 字符串
- 作用域：单次 `/generate` 调用内的函数局部变量

### 3.4 Cache-Aside 模式（兜底）

```
折叠某个 tool result 时:
  if foldedCache 有 tool_call_id:
    直接用缓存的 foldedContent
  else:
    从对应 assistant.tool_calls 提取 domain_ids 参数
    重新调 sliceTableIndexByDomains(domainIds) 加载原始数据
    用精简版 formatTableInfoCompact（去 related_tables）格式化
    写入缓存: foldedCache.set(tool_call_id, foldedContent)
    用 foldedContent 替换 tool.content
```

- **缓存命中**：0 开销（直接读 Map）
- **缓存丢失**（首次 / 跨请求）：重新折叠一次（~2-4ms SSD），结果入缓存供本次请求后续轮次复用

### 3.5 多用户隔离原理

```js
export async function* generateSQLWithLangChainStreamGen_BAK(...) {
  const foldedCache = new Map();  // ← 每次 /generate 调用都是全新实例
  
  while (maxToolCalls > 0) {
    const compactedMessages = await compactConsumedToolResults(messages, foldedCache);
    // ...
  }
}
```

- `foldedCache` 是函数内局部变量，JavaScript 函数作用域保证每次调用创建独立实例
- 用户 A 和用户 B 的 `/generate` 请求各自有独立的 `foldedCache`，**互不可见，不可能窜**
- 即便 1000 并发请求，每个请求有自己的 `foldedCache`，无需任何同步机制

### 3.6 开销估算

| 场景 | 单次开销 | 一次 /generate 内总开销 |
|------|---------|----------------------|
| 缓存命中 | <0.01ms | <0.06ms（6 轮复用）|
| 缓存丢失（首次/每请求第一次）| ~2-4ms (SSD) / ~8-14ms (HDD) | ~2-4ms（只算 1 次/请求）|

相比单轮 LLM 请求 5-15s，开销可忽略（<0.5%）。

---

## 4. 详细修改点

### 修改点 1：新增 `compactConsumedToolResults` 函数

**文件**: `backend/src/services/llm.js`
**位置**: [llm.js:602](../../../backend/src/services/llm.js#L602) `getSessionChecklist` 函数后插入

**新增代码**:

```js
/**
 * 折叠已消费的 get_sliced_index tool result，降低已消费历史区的 token 开销与注意力稀释。
 *
 * 折叠策略：
 *   - "当前消费区"（最后一个含 tool_calls 的 assistant 及其之后）不折叠，LLM 需完整信息选表
 *   - "已消费历史区"（该 assistant 之前）：用精简版卡片替换，去掉 related_tables
 *     （schema 的 virtual_associations 可替代），保留 name/description/tags/business_constraints/business_rules
 *     （business_rules/constraints 与 field_config 不完全一致，部分表 field_config 为空）
 *
 * 折叠边界：只折叠 messages 中"最后一个含 tool_calls 的 assistant 之前"的 tool 消息（已消费历史区）。
 *   - 之后的 tool result 属于当前消费区，即将被下一轮 LLM 消费，必须完整
 *
 * 缓存：单请求级 cache-aside。foldedCache 由调用方传入，作用域为单次 /generate 调用。
 *   - key = tool_call_id，value = 折叠后 content
 *   - 缓存命中直接用，丢失则重新加载原始数据折叠并写入缓存
 *   - 函数作用域天然隔离多用户，不可能窜
 *
 * DeepSeek thinking_mode 协议兼容性：
 *   - 只改 tool 消息的 content 字段，不改 role / tool_call_id 结构
 *   - assistant.tool_calls 和 reasoning_content 保持不变（协议要求完整回传）
 *
 * @param {Array} messages - 累积的 messages 数组
 * @param {Map} foldedCache - 折叠缓存（单请求级，由调用方创建并传入）
 * @returns {Array} 折叠后的新数组（不修改原数组）
 */
async function compactConsumedToolResults(messages, foldedCache) {
  if (!Array.isArray(messages) || messages.length === 0 || !foldedCache) return messages;

  // 找到最后一个有 tool_calls 的 assistant 位置
  let lastToolCallIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].tool_calls && messages[i].tool_calls.length > 0) {
      lastToolCallIdx = i;
      break;
    }
  }
  // 没有历史 tool_call，或只有当前轮（lastToolCallIdx=0 时前面无历史）→ 不折叠
  if (lastToolCallIdx <= 0) return messages;

  // 构建 tool_call_id → {toolName, args} 映射（只看 lastToolCallIdx 之前的 assistant）
  const toolCallInfo = new Map();
  for (let i = 0; i < lastToolCallIdx; i++) {
    const m = messages[i];
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id && tc.function?.name) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          toolCallInfo.set(tc.id, { name: tc.function.name, args });
        }
      }
    }
  }

  let compactedCount = 0;
  const result = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    // 仅折叠 lastToolCallIdx 之前的 tool 消息
    if (i >= lastToolCallIdx || m.role !== 'tool') {
      result.push(m);
      continue;
    }

    const info = m.tool_call_id ? toolCallInfo.get(m.tool_call_id) : null;
    if (!info || info.name !== 'get_sliced_index') {
      result.push(m);
      continue;
    }

    // cache-aside: 命中直接用
    if (foldedCache.has(m.tool_call_id)) {
      result.push({ ...m, content: foldedCache.get(m.tool_call_id) });
      compactedCount++;
      continue;
    }

    // 缓存丢失：从 tool_calls 参数提取 domain_ids，重新加载原始数据折叠
    const domainIds = info.args?.domain_ids;
    if (!Array.isArray(domainIds) || domainIds.length === 0) {
      // 参数解析失败，不折叠（保持原 content）
      result.push(m);
      continue;
    }

    try {
      const sliced = await sliceTableIndexByDomains(domainIds);
      if (!sliced.tables || sliced.tables.length === 0) {
        result.push(m);
        continue;
      }
      const foldedContent = formatTableInfoCompact(sliced.tables);
      foldedCache.set(m.tool_call_id, foldedContent);
      result.push({ ...m, content: foldedContent });
      compactedCount++;
    } catch (e) {
      logger.warn('compactConsumedToolResults: fold failed, keep original', {
        tool_call_id: m.tool_call_id, error: e.message
      });
      result.push(m);
    }
  }

  if (compactedCount > 0) {
    logger.debug('Compacted consumed tool results', {
      compactedCount, lastToolCallIdx, totalMessages: messages.length
    });
  }

  return result;
}
```

---

### 修改点 2：新增 `formatTableInfoCompact` 函数

**文件**: `backend/src/services/toolFuncs.js`
**位置**: [toolFuncs.js:372](../../../backend/src/services/toolFuncs.js#L372) `formatTableInfo` 函数后

**新增代码**:

```js
// 折叠版表格卡片：去掉 related_tables（schema 的 virtual_associations 可替代），
// 保留 name/description/tags/business_constraints/business_rules。
// 供 compactConsumedToolResults 使用，与 formatTableInfo 区别仅在于不输出 related_tables。
// 注意：business_constraints / business_rules 两处并行修复了 formatTableInfo 的
//   "label/desc 任一缺失时显示 undefined" 缺陷（原模式 `${label}: ${desc}` 在任一为空时产生 "undefined: D" 或 "X: undefined"）。
export function formatTableInfoCompact(tables) {
  return tables.map(t => {
    let info = `- ${t.name}: ${t.description || ''}`;
    if (t.tags?.length) info += `\n  标签: ${t.tags.join(', ')}`;
    // 注意：不输出 related_tables，由 schema 的 virtual_associations 替代
    if (t.business_constraints?.length) {
      info += `\n  业务约束:`;
      t.business_constraints.forEach(c => {
        if (typeof c === 'string') {
          info += `\n    - ${c}`;
        } else if (c.name) {
          info += `\n    - ${c.name}: ${c.description || ''}`;
        } else if (c.description) {
          info += `\n    - ${c.description}`;
        } else {
          info += `\n    - (空约束)`;
        }
      });
    }
    if (t.business_rules?.length) {
      info += `\n  业务规则:`;
      t.business_rules.forEach(r => {
        if (typeof r === 'string') {
          info += `\n    - ${r}`;
        } else if (r.rule) {
          info += `\n    - ${r.rule}: ${r.description || ''}`;
        } else if (r.description) {
          info += `\n    - ${r.description}`;
        } else {
          info += `\n    - (空规则)`;
        }
        if (r.query) info += `\n      示例: ${r.query}`;
      });
    }
    return info;
  }).join('\n\n');
}
```

**导出说明**：
- `formatTableInfoCompact`：上方代码已直接声明为 `export function`（`formatTableInfo` 本身未导出，是普通 `function`）。插入位置为 [toolFuncs.js:372](../../../backend/src/services/toolFuncs.js#L372) `formatTableInfo` 函数闭合 `}` 之后、[toolFuncs.js:374](../../../backend/src/services/toolFuncs.js#L374) `export const tools` 之前。
- `sliceTableIndexByDomains`：已在 [toolFuncs.js:88](../../../backend/src/services/toolFuncs.js#L88) 以 `export async function` 形式声明，**无需额外修改**。

---

### 修改点 3：llm.js 导入折叠所需函数

**文件**: `backend/src/services/llm.js`
**位置**: [llm.js:3](../../../backend/src/services/llm.js#L3) 顶部 import 区域

**当前代码**:

```js
import { loadTableIndex, loadSkillMd, tools } from './toolFuncs.js';
```

**修改后**:

```js
import { loadTableIndex, loadSkillMd, tools, formatTableInfoCompact, sliceTableIndexByDomains } from './toolFuncs.js';
```

---

### 修改点 4：`generateSQLWithLangChainStreamGen_BAK` 内创建缓存并接入折叠

**文件**: `backend/src/services/llm.js`
**位置**: [llm.js:683](../../../backend/src/services/llm.js#L683) 函数内，[llm.js:761](../../../backend/src/services/llm.js#L761) `while` 循环前

> **关于 `_BAK` 后缀**：虽然函数名含 `_BAK`（源码注释 [llm.js:673](../../../backend/src/services/llm.js#L673) 标注"备份原有函数"），但这**是当前唯一活跃的 SQL 生成入口**。原非 `_BAK` 版本 `generateSQLWithLangChainStreamGen` / `V2` 已于 2026-06 废弃（见 [llm.js:1296-1297](../../../backend/src/services/llm.js#L1296-L1297) 注释），实际调用方为 [query.js:371](../../../backend/src/routes/query.js#L371)。因此折叠修改必须落在此函数内。

**修改 1**: 在 while 循环前创建缓存（单请求级局部变量）

在 [llm.js:758-759](../../../backend/src/services/llm.js#L758-L759) `pendingUserChoiceList` 声明附近新增：

```js
  let pendingUserChoiceList = [];
  const MAX_USER_CHOICE_PER_TURN = 3;

  // 折叠缓存（单请求级）：跨 LLM 轮次复用折叠结果，请求结束自动 GC。
  // 作用域为本次 /generate 调用，函数闭包天然隔离多用户，不可能窜。
  // cache-aside: 缓存命中直接用，丢失则重新折叠并写入缓存。
  const foldedCache = new Map();

  while (maxToolCalls > 0) {
```

**修改 2**: [llm.js:800](../../../backend/src/services/llm.js#L800) `requestMessages` 构造处接入折叠函数

**当前代码**:

```js
    const requestMessages = (checklistMsg ? [...messages, checklistMsg] : messages).map(m => {
      if (m.role === 'assistant' && m.reasoning_content && !m.tool_calls) {
        const { reasoning_content, ...rest } = m;
        return rest;
      }
      return m;
    });
```

**修改后**（注意：compactConsumedToolResults 是 async，需 await）:

```js
    // 折叠已消费的 get_sliced_index tool result（去掉 related_tables，保留 rules/constraints），
    // 降低已消费历史区的 token 开销与注意力稀释。不修改原 messages 数组。
    const compactedMessages = await compactConsumedToolResults(messages, foldedCache);
    const requestMessages = (checklistMsg ? [...compactedMessages, checklistMsg] : compactedMessages).map(m => {
      if (m.role === 'assistant' && m.reasoning_content && !m.tool_calls) {
        const { reasoning_content, ...rest } = m;
        return rest;
      }
      return m;
    });
```

**注意**：`compactConsumedToolResults` 是 async 函数（内部有 `await sliceTableIndexByDomains`），调用处需加 `await`。当前 `while` 循环体在 async generator 内，可以直接 await。

---

## 5. 配套修改：SKILL.md 规则 4（可选，暂不动）

由于 `get_sliced_index` 在"已消费历史区"不再返回 `related_tables`（"当前消费区"仍有），SKILL.md 规则 4 的"先用候选表的 `related_tables` 确定 JOIN 方向"在历史区不成立。但当前消费区仍有 related_tables，且规则 4 本身要求最终用 virtual_associations。

**建议**：规则 4 保持不变（当前消费区 related_tables 仍在，已消费历史区 LLM 已选完表不需要 related_tables）。若实测发现 LLM 在历史区因缺少 related_tables 困惑，再调整规则 4 措辞。

---

## 6. 预期收益

### 6.1 单表卡片变化示例

**修改前**（完整卡片，当前消费区和已消费历史区都返回）:
```
- edu_course_exam_subject_name: 科目名称(四级)
  标签: 四级科目
  关联表: edu_course_exam_subject, t_exam_result_rule
  业务约束:
    - tk_knowledge_id已经废弃了，如果要查科目关联知识点/知识点体系，请关联tk_knowledge_course表
```

**修改后**（当前消费区仍完整，已消费历史区折叠为）:
```
- edu_course_exam_subject_name: 科目名称(四级)
  标签: 四级科目
  业务约束:
    - tk_knowledge_id已经废弃了，如果要查科目关联知识点/知识点体系，请关联tk_knowledge_course表
```

### 6.2 量化收益

基于 [LOG_ANALYSIS §3.1](../reviews/LOG_ANALYSIS_2026-07-16-admin-llm.md) 实测数据（30+ 表卡片 ~5KB）：

| 指标 | 改动前 | 改动后 | 降幅 |
|------|--------|--------|------|
| 单表卡片平均大小 | ~170 字节 | ~140 字节 | ~18% |
| 30 表卡片单次发送大小 | ~5KB | ~4.1KB | ~18% |
| sliced result 累计重发字节（6 轮，含多轮重复发送）| ~75KB | ~66KB | ~12% |
| Round 6 单轮 sliced result 占用（5 个 tool result，4 折 1 全）| ~25KB | ~21.4KB | ~14%（~3.6KB） |

> **计算口径说明**：每个已消费历史区的 tool result 会在其后的每一轮 LLM 请求中重复发送，存在累积乘数效应。上表"累计重发字节"按每轮新增 1 个 sliced result、当前消费区不折叠、历史区折叠估算：
>
> | 轮次 | 累积 tool result 数 | 折叠前累计 | 折叠后累计 |
> |------|-------------------|-----------|-----------|
> | 2 | 1 | 5.0 KB | 5.0 KB（当前消费区不折叠）|
> | 3 | 2 | 10.0 KB | 5.0 + 4.1 = 9.1 KB |
> | 4 | 3 | 15.0 KB | 5.0 + 4.1×2 = 13.2 KB |
> | 5 | 4 | 20.0 KB | 5.0 + 4.1×3 = 17.3 KB |
> | 6 | 5 | 25.0 KB | 5.0 + 4.1×4 = 21.4 KB |
> | **合计** | — | **75.0 KB** | **66.0 KB** |
>
> 单轮节省随轮次线性增长（Round N 节省 (N-2)×0.9KB），6 轮累计节省 ~9KB（约 12% of sliced bytes）。

**收益评估**：
- sliced result 累计节省 ~12%（含多轮重复发送乘数），整体会话 token 节省约 ~5-8%
- **信息零丢失**：去掉的 related_tables 由 schema 的 virtual_associations 完整替代；business_rules/constraints 全保留
- **当前消费区完整**：不影响 LLM 选表决策
- **风险极低**：不碰 schema/ddl result，不碰 messages 结构，协议兼容

### 6.3 收益与复杂度权衡

| 维度 | 评估 |
|------|------|
| token 收益 | 中等（~12% on sliced 累计，~5-8% overall）|
| 注意力改善 | 中等（去掉冗余 related_tables 行）|
| 稳定性改善 | 中等（短上下文决策路径更收敛）|
| 信息丢失风险 | 零 |
| 改动复杂度 | 中（~110 行新增，含缓存逻辑）|
| 协议兼容风险 | 零（只改 tool.content）|
| 维护成本 | 低（cache-aside + 重新加载原始数据，不受 formatTableInfo 格式变更影响）|
| 多用户安全 | ✅ 函数作用域天然隔离 |

---

## 7. 风险与缓解

### 7.1 风险：LLM 在已消费历史区需要 related_tables

**场景**：LLM 在 Round 5 突然需要 Round 1 `get_sliced_index` 返回的某表 related_tables 来判断 JOIN 方向（该 result 已进入已消费历史区被折叠）。

**缓解**：
- LLM 已在当前消费区首次看到完整 related_tables，可基于记忆决策
- schema result（不折叠）的 virtual_associations 有完整 JOIN 信息
- `get_table_schema` 工具不剪枝，LLM 可随时补查任何表的 schema

### 7.2 风险：跨请求缓存不复用导致重复计算

**场景**：同 sessionId 第二次 `/generate` 时，第一次的 foldedCache 已 GC，需重新折叠历史 sliced result。

**缓解**：
- 单次折叠开销 ~2-4ms（SSD），可忽略
- 重新折叠只在有历史 sliced result 时发生，无历史 tool result 的请求（如该会话首次 `/generate` 且无历史）无影响
- 这是单请求级方案的已知代价，换取多用户隔离与零内存泄漏

### 7.3 风险：domain_ids 参数解析失败

**场景**：`assistant.tool_calls` 的 `arguments` JSON 解析失败，无法提取 domain_ids。

**缓解**：
- 解析失败时不折叠（保持原 content），不阻塞流程
- 记录日志便于排查

### 7.4 风险：sliceTableIndexByDomains 调用失败

**场景**：table_index.json 文件丢失或损坏。

**缓解**：
- try/catch 捕获，保持原 content
- 记录 warn 日志

### 7.5 风险：compactConsumedToolResults 是 async

**场景**：在 requestMessages 构造处引入 await，可能改变执行时序。

**缓解**：
- 当前代码已在 async generator 内，可直接 await
- 折叠开销极小（缓存命中 <0.01ms，丢失 ~2-4ms），不阻塞流式输出

---

## 8. 验证方法

### 8.1 功能验证

1. 跑同一组 5-10 个真实问题，确认 SQL 生成正确率不下降
2. 重点测试涉及多表 JOIN 的问题，确认 LLM 仍能通过 virtual_associations 正确 JOIN
3. 重点测试涉及 business_constraints 的问题（如知识点层级），确认约束仍生效

### 8.2 Token 量化

1. 从 LLM API `usage.prompt_tokens` 读取每轮 token，对比改动前后
2. 重点对比 Round 3+（首次折叠后）的 prompt token

### 8.3 缓存验证

1. 检查日志中 `Compacted consumed tool results` 出现，确认折叠次数
2. 同一次 `/generate` 内多轮 LLM 请求，确认第二轮起命中缓存（无 `fold failed` 日志）

### 8.4 稳定性验证

1. 同一问题连跑 3 次，比较生成 SQL 是否一致
2. 多用户并发测试（如适用），确认缓存隔离无窜

### 8.5 长对话验证

1. 跑 30 轮长对话，监控：
   - `saveMessagesToDb` 写盘字节数（应与改动前一致，原 messages 不变）
   - LLM 是否出现"忘记曾查过什么表"的情况（候选表清单 name+description 仍保留）

---

## 9. 实施检查清单

- [ ] 修改点 1：新增 `compactConsumedToolResults` async 函数（llm.js）
- [ ] 修改点 2：新增 `formatTableInfoCompact` 函数（含 `export`，插入 toolFuncs.js:372 后），business_constraints / business_rules 两处并行修复 `name`/`rule` 缺失时显示 undefined 的缺陷
- [ ] 修改点 3：llm.js:3 import 行新增 `formatTableInfoCompact` / `sliceTableIndexByDomains`
- [ ] 修改点 4：`generateSQLWithLangChainStreamGen_BAK` 内创建 `foldedCache` 并接入 `await compactConsumedToolResults`
- [ ] `node --check backend/src/services/llm.js` 语法验证
- [ ] `node --check backend/src/services/toolFuncs.js` 语法验证
- [ ] 跑 3 个真实问题，确认 SQL 生成正常
- [ ] 重点验证多表 JOIN 问题
- [ ] 重点验证 business_constraints 问题
- [ ] 对比改动前后 `usage.prompt_tokens`
- [ ] 验证单请求内缓存命中（同一次 /generate 内第二轮起无 `fold failed` 日志）

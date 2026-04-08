# LangChain动态Skill调用实现计划

> **状态**: 已合并到主实现计划 `2026-04-03-data-query-assistant-implementation-plan.md`

**Goal:** 使用LangChain LCEL + Function Calling实现动态skill调用，LLM按需获取表结构而非一次性注入所有数据

**Architecture:** 
- 定义Tool: get_tables (获取表列表), get_table_schema (获取表结构), get_table_ddl, get_output_format, get_mysql_limits
- 模式: `stream` (流式SSE，推荐)
- Agent 循环调用工具获取数据，直到生成最终 SQL

**Tech Stack:** LangChain ^0.3.0, DynamicTool, SSE

---

## 实现状态 (2026-04-06)

✅ **已完成实现**，见 `backend/src/services/llm.js` 中的 `generateSQLWithLangChainStreamGen` 函数

主要功能：
1. 直接使用 fetch API 调用 LLM（支持 DeepSeek/OpenAI/MiniMax）
2. 手动处理 tool_calls 循环
3. yield log 事件显示工具调用过程
4. 最终解析 ```json ... ``` 代码块提取 SQL 和 message

```javascript
// 核心实现
export async function* generateSQLWithLangChainStreamGen(question, history = '') {
  // ... 初始化 LLM 配置
  
  while (maxToolCalls > 0) {
    // 调用 LLM
    const response = await fetch(...);
    const assistantMessage = json.choices?.[0]?.message;
    
    if (assistantMessage?.tool_calls) {
      // 处理工具调用
      for (const toolCall of assistantMessage.tool_calls) {
        yield { type: 'log', log: `🔧 调用工具: ${toolName}...` };
        // 执行工具
        yield { type: 'log', log: `📋 工具 ${toolName} 返回: ...` };
      }
      continue;
    }
    break;
  }
  
  // 解析最终结果
  yield { type: 'done', sql, message };
}
```

**SSE 事件**：
- `type: 'chunk'` - LLM 输出
- `type: 'log'` - 工具调用日志
- `type: 'done'` - 最终结果 { sql, message }
- `type: 'error'` - 错误

---

## 流式输出参数传递修复 (2026-04-08)

### 问题描述
将 `generateSQLWithLangChainStreamGen_BAK` 函数改为流式输出后，发现工具调用时参数传递不正确，出现错误提示：
```
🔧 调用工具: get_table_schema
📋 工具 get_table_schema 返回: 请提供表名参数
```

### 根本原因
在流式输出模式下，工具调用的参数是通过多个 `data:` 事件分块传输的：
1. 第一个事件可能包含：`{"index": 0, "function": {"name": "get_table_schema", "arguments": "{"}`
2. 第二个事件可能包含：`{"index": 0, "function": {"arguments": "table_name"}}`
3. 第三个事件可能包含：`{"index": 0, "function": {"arguments": ":"users"}}`

原始实现错误地将每个 `data:` 事件中的工具调用视为独立调用，导致参数无法正确累积。

### 修复方案
更新流式处理逻辑，正确处理工具调用的分块参数：

```javascript
// 检查工具调用
const toolCalls = data.choices?.[0]?.delta?.tool_calls;
if (toolCalls && toolCalls.length > 0) {
  for (const tc of toolCalls) {
    const toolIndex = tc.index;
    if (toolIndex !== undefined) {
      // 确保数组有足够的长度
      while (streamToolCalls.length <= toolIndex) {
        streamToolCalls.push({
          index: streamToolCalls.length,
          id: '',
          function: { name: '', arguments: '' }
        });
      }

      // 更新现有的工具调用
      const existing = streamToolCalls[toolIndex];

      // 更新 id
      if (tc.id) {
        existing.id = tc.id;
      }

      // 更新函数名
      if (tc.function?.name) {
        existing.function.name = tc.function.name;
      }

      // 累积参数
      if (tc.function?.arguments) {
        existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments;
      }
    }
  }
}
```

### 关键改进
1. **基于索引的参数累积**：根据 `tool.index` 跟踪不同的工具调用
2. **参数拼接**：将分块的 `arguments` 字符串拼接成完整JSON
3. **空值过滤**：只处理有实际工具名称的有效调用
4. **错误恢复**：参数解析失败时使用空对象并记录警告

### 修改位置
- `backend/src/services/llm.js` 中的 `generateSQLWithLangChainStreamGen_BAK` 函数
- `backend/src/services/llm.js` 中的 `generateSQLWithLangChainStreamGen` 函数（同步修复）

### 测试验证
修复后，工具调用能够正确接收参数：
```
🔧 调用工具: get_table_schema
参数: {"table_name": "users"}
📋 工具 get_table_schema 返回: [成功返回表结构信息]
```

### 相关函数更新状态
| 函数 | 流式支持 | 参数传递修复 | 状态 |
|------|----------|--------------|------|
| `generateSQLWithLangChainStreamGen_BAK` | ✅ | ✅ | 已修复 |
| `generateSQLWithLangChainStreamGen` | ✅ | ✅ | 已修复 |
| `generateSQLWithLangChainStreamGenV2` | ✅ | ✅ | 已修复 |
| `generateSQLWithLangChain` | ❌ | ❌ | 非流式 |

### 后续建议
1. 考虑将所有流式函数统一为相同的参数处理逻辑
2. 添加更详细的日志记录以调试工具调用过程
3. 考虑使用LangChain原生的流式工具调用API以简化实现
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
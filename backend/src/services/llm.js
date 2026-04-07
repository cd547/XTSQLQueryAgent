import { getLlmConfig } from './config.js';
import { logger } from '../logger.js';

logger.info('LLM service loaded');
import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_V2_PATH = path.join(__dirname, '../../../skills/sql-creator-skill-v2');
const LOGS_PATH = path.join(__dirname, '../../../logs');

function writeLlmLog(content) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const logFile = path.join(LOGS_PATH, `llm_${dateStr}.log`);
  const timestamp = now.toISOString();
  const logLine = `${timestamp}: ${content}\n`;
  fs.appendFileSync(logFile, logLine, 'utf-8');
}

let cachedTableIndex = null;
let cachedSkillMd = null;

function loadTableIndex() {
  if (cachedTableIndex) return cachedTableIndex;
  
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  if (fs.existsSync(tableIndexPath)) {
    cachedTableIndex = JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  }
  return cachedTableIndex;
}

function loadSkillMd() {
  if (cachedSkillMd) return cachedSkillMd;

  const skillMdPath = path.join(SKILL_V2_PATH, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    throw new Error('SKILL.md 未找到，请确保目录存在 skills/sql-creator-skill-v2/SKILL.md');
  }

  cachedSkillMd = fs.readFileSync(skillMdPath, 'utf-8');
  return cachedSkillMd;
}

function getTableSchema(tableName) {
  const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${tableName}.json`);
  if (fs.existsSync(fieldConfigPath)) {
    return JSON.parse(fs.readFileSync(fieldConfigPath, 'utf-8'));
  }
  return { error: `表 ${tableName} 的配置不存在` };
}

function getTableDDL(tableName) {
  const ddlPath = path.join(SKILL_V2_PATH, 'ddl', `${tableName}.sql`);
  if (fs.existsSync(ddlPath)) {
    return fs.readFileSync(ddlPath, 'utf-8');
  }
  return `表 ${tableName} 的DDL不存在`;
}

function getOutputFormat() {
  const outputFormatPath = path.join(SKILL_V2_PATH, 'templates', 'output_format.md');
  if (fs.existsSync(outputFormatPath)) {
    return fs.readFileSync(outputFormatPath, 'utf-8');
  }
  return '输出格式模板不存在';
}

function getMysqlLimits() {
  const mysqlLimitsPath = path.join(SKILL_V2_PATH, 'docs', 'mysql57_limits.md');
  if (fs.existsSync(mysqlLimitsPath)) {
    return fs.readFileSync(mysqlLimitsPath, 'utf-8');
  }
  return 'MySQL 5.7 限制信息不存在';
}

const tools = [
  new DynamicTool({
    name: "get_tables",
    description: "获取所有可用的表列表。每个表包含name(表名)、description(描述)、tags(标签)、related_tables(关联表)、business_constraints(业务约束)、business_rules(业务规则)。用于了解数据库中有哪些表可用。",
    func: () => {
      const tableIndex = loadTableIndex();
      if (!tableIndex || !tableIndex.tables) return '暂无表数据';
      
      return tableIndex.tables.map(t => {
        let info = `- ${t.name}: ${t.description || ''}`;
        if (t.tags?.length) info += `\n  标签: ${t.tags.join(', ')}`;
        if (t.related_tables?.length) info += `\n  关联表: ${t.related_tables.join(', ')}`;
        if (t.business_constraints?.length) {
          info += `\n  业务约束:`;
          t.business_constraints.forEach(c => {
            info += `\n    - ${c.name}: ${c.description}`;
          });
        }
        if (t.business_rules?.length) {
          info += `\n  业务规则:`;
          t.business_rules.forEach(r => {
            info += `\n    - ${r.rule || r.description}: ${r.description}`;
            if (r.query) info += `\n      示例: ${r.query}`;
          });
        }
        return info;
      }).join('\n\n');
    }
  }),
  new DynamicTool({
    name: "get_table_schema",
    description: "获取指定表的部分字段的详细信息，包括字段别名、枚举值、业务约束等。参数: table_name(表名，必须)",
    func: (tableName) => {
      console.log('get_table_schema called with:', tableName);
      if (!tableName) return '请提供表名参数';
      // tableName 可能是 JSON 字符串，需要解析
      try {
        if (typeof tableName === 'string') {
          const parsed = JSON.parse(tableName);
          tableName = parsed.table_name;
        }
      } catch (e) {}
      return JSON.stringify(getTableSchema(tableName), null, 2);
    }
  }),
  new DynamicTool({
    name: "get_table_ddl",
    description: "获取指定表的DDL建表语句。参数: table_name(表名，必须)",
    func: (tableName) => {
      console.log('get_table_ddl called with:', tableName);
      if (!tableName) return '请提供表名参数';
      // tableName 可能是 JSON 字符串，需要解析
      try {
        if (typeof tableName === 'string') {
          const parsed = JSON.parse(tableName);
          tableName = parsed.table_name;
        }
      } catch (e) {}
      return getTableDDL(tableName);
    }
  }),
  new DynamicTool({
    name: "get_output_format",
    description: "获取SQL输出的格式规范和模板。",
    func: () => {
      console.log('get_output_format called');
      return getOutputFormat();
    }
  }),
  new DynamicTool({
    name: "get_mysql_limits",
    description: "获取MySQL 5.7的语法限制和注意事项。",
    func: () => {
      console.log('get_mysql_limits called');
      return getMysqlLimits();
    }
  })
];

// TODO: 流式输出支持
// export async function generateSQLWithLangChainStream(question, history = '') {
//   const llm = new ChatOpenAI({...}).bindTools(tools);
//   const stream = await llm.stream([...]);
//   for await (const chunk of stream) { yield chunk.content; }
// }

async function generateSQLWithLangChain(question, history = '') {
  logger.info('generateSQLWithLangChain called', { question, historyLength: history?.length });
  
  let config;
  try {
    config = getLlmConfig();
    console.log(config);
  } catch (e) {
    logger.error('getLlmConfig failed', { error: e.message });
    throw new Error('LLM未配置，请先在配置面板设置LLM Provider和API Key');
  }
  
  const { provider, apiKey, model } = config;
  logger.info('LLM config loaded', { provider, model: model || 'default' });
  
  let baseURL, llmModel;
  
  switch (provider) {
    case 'openai':
      baseURL = 'https://api.openai.com/v1';
      llmModel = model || 'gpt-4o';
      break;
    case 'deepseek':
      baseURL = 'https://api.deepseek.com';
      llmModel = 'deepseek-chat';
      break;
    case 'minimax':
      baseURL = 'https://api.minimax.chat/v1';
      llmModel = model || 'abab6.5s-chat';
      break;
    default:
      throw new Error(`不支持的provider: ${provider}`);
  }
  
  logger.info('Creating ChatOpenAI', { baseURL, llmModel, apiKey: apiKey?.slice(0, 10) + '...' });

  const timeout = (provider === 'deepseek' && llmModel.includes('reasoner')) ? 300000 : 120000;
  logger.info('Timeout set', { timeout });

  const llm = new ChatOpenAI({
    model: llmModel,
    temperature: 0,
    apiKey: apiKey,
    baseURL: baseURL,
    timeout: timeout,
    maxRetries: 0
  }).bindTools(tools);

  const skillMd = loadSkillMd();
  const tableIndex = loadTableIndex();

  const systemMessage = `你是一个SQL查询专家。必须先读取并严格遵守 skills/sql-creator-skill-v2/SKILL.md 的规范，随后根据用户问题生成SQL。

## SKILL.md 内容（只读，严格执行）
${skillMd}

## 表索引数据（table_index.json）
${JSON.stringify(tableIndex, null, 2)}

## 可用Tools
- get_tables: 获取所有可用表列表
- get_table_schema(table_name): 获取指定表的详细信息
- get_table_ddl(table_name): 获取指定表的DDL建表语句
- get_output_format: 获取SQL输出的格式规范和模板
- get_mysql_limits: 获取MySQL 5.7的语法限制和注意事项

## 返回格式（必须严格遵守）
使用 markdown 格式返回，包含以下部分：
- **SQL**: 最终生成的SQL语句
- **说明**: 对SQL的简要解释
- **示例结果**: （可选）如果需要可以包含查询结果的示例

## 历史上下文
${history}

## 用户问题`;

  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: question }
  ];

  let maxToolCalls = 20;
  let responseText = '';

  while (maxToolCalls > 0) {
    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }))
    };

    console.log('=== DeepSeek API Request (round ' + (21 - maxToolCalls) + ') ===');

    try {
      const fetchResponse = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestParams)
      });
      
      const json = await fetchResponse.json();
      console.log('=== DeepSeek API Response (round ' + (21 - maxToolCalls) + ') ===');
      console.log(JSON.stringify(json, null, 2));
      
      const assistantMessage = json.choices?.[0]?.message;
      responseText = assistantMessage?.content || '';
      
      messages.push({ 
        role: 'assistant', 
        content: assistantMessage?.content || '',
        tool_calls: assistantMessage?.tool_calls
      });

      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log('=== Tool calls detected ===');
        
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          console.log('Calling tool:', toolName, 'with args:', toolArgs);
          
          const tool = tools.find(t => t.name === toolName);
          if (tool) {
            try {
              const parsedArgs = JSON.parse(toolArgs);
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(paramValue);
              console.log('Tool result:', toolResult);
              
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResult
              });
            } catch (e) {
              console.error('Tool execution error:', e);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${e.message}`
              });
            }
          }
        }
        
        maxToolCalls--;
        continue;
      }
      
      if (responseText.includes('SELECT') || responseText.includes('{"sql":')) {
        break;
      }
      
      break;
      
    } catch (e) {
      logger.error('Direct fetch failed', { error: e.message });
      throw e;
    }
  }

  let sql = '';
  let message = '';

  try {
    const parsed = JSON.parse(responseText);
    sql = parsed.sql || responseText;
    message = parsed.message || '';
  } catch {
    sql = responseText;
  }

  return { sql, message };
}

// 备份原有函数
export async function* generateSQLWithLangChainStreamGen_BAK(question, history = '') {
  logger.info('generateSQLWithLangChainStreamGen_BAK called (backup)', { question, historyLength: history?.length });
  
  let config;
  try {
    config = getLlmConfig();
  } catch (e) {
    throw new Error('LLM未配置，请先在配置面板设置LLM Provider和API Key');
  }
  
  const { provider, apiKey, model } = config;
  let baseURL, llmModel;
  
  switch (provider) {
    case 'openai':
      baseURL = 'https://api.openai.com/v1';
      llmModel = model || 'gpt-4o';
      break;
    case 'deepseek':
      baseURL = 'https://api.deepseek.com';
      llmModel = model || 'deepseek-chat';
      break;
    case 'minimax':
      baseURL = 'https://api.minimax.chat/v1';
      llmModel = model || 'abab6.5s-chat';
      break;
    default:
      throw new Error(`不支持的provider: ${provider}`);
  }
  
  const skillMd = loadSkillMd();
  //const tableIndex = loadTableIndex();

  const systemMessage = `你是一个SQL查询专家。必须先读取并严格遵守 skills/sql-creator-skill-v2/SKILL.md 的规范，随后根据用户问题生成SQL。

## SKILL.md 内容（只读，严格执行）
${skillMd}

## 可用Tools
- get_tables: 获取可以使用列表的基本信息，即table_index.json中可用列表基本信息。
- get_table_schema(table_name): 获取指定表的详细信息
- get_table_ddl(table_name): 获取指定表的DDL建表语句
- get_output_format: 获取SQL输出的格式规范和模板
- get_mysql_limits: 获取MySQL 5.7的语法限制和注意事项

## 返回格式（必须严格遵守）
使用 markdown 格式返回，包含以下部分：
- **SQL**: 最终生成的SQL语句
- **说明**: 对SQL的简要解释

## 历史上下文
${history}

## 用户问题`;

  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: question }
  ];

  let maxToolCalls = 30;
  let responseText = '';
  
  while (maxToolCalls > 0) {
    console.log(`第${31 - maxToolCalls}次调用`);
    
    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }))
    };
    
    writeLlmLog('generateSQLWithLangChainStreamGen_BAK Round ' + (31 - maxToolCalls) + ' Request:\n' + JSON.stringify(requestParams, null, 2));
    
    try {
      const fetchResponse = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestParams)
      });
      
      const json = await fetchResponse.json();
      writeLlmLog(`LLM响应: ${JSON.stringify(json, null, 2)}` );

      const assistantMessage = json.choices?.[0]?.message;
      responseText = assistantMessage?.content || '';
      
      // 输出LLM的思考过程（reasoning）
      const reasoning = json.choices?.[0]?.message?.content;
      if (reasoning) {
        yield { type: 'LLM', log: `💭 LLM思考过程:\n${reasoning.slice(0, 10000)}` };
      }
      
      messages.push({ 
        role: 'assistant', 
        content: assistantMessage?.content || '',
        tool_calls: assistantMessage?.tool_calls
      });

      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          writeLlmLog(`🔧 调用工具: ${toolCall.function.name} 参数:${JSON.stringify(toolCall.function.arguments)}` );
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          
          let logMsg = `🔧 调用工具: ${toolName}`;
          try {
            const parsedArgs = JSON.parse(toolArgs);
            if (Object.keys(parsedArgs).length > 0) {
              logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
            }
          } catch (e) {}
          yield { type: 'tool', log: logMsg };
          
          const tool = tools.find(t => t.name === toolName);
          if (tool) {
            try {
              const parsedArgs = JSON.parse(toolArgs);
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(paramValue);
              
              yield { type: 'tool_return', log: `📋 工具 ${toolName} 返回:\n${toolResult}` };
              
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResult
              });
            } catch (e) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${e.message}`
              });
            }
          }
        }
        
        maxToolCalls--;
        continue;
      }
      
      break;
      
    } catch (e) {
      yield { type: 'error', content: e.message };
      return;
    }
  }

  // 返回 markdown 格式的结果
  const message = responseText;

  yield { type: 'done', sql: '', message };
}

export async function* generateSQLWithLangChainStreamGen(question, history = '') {
  logger.info('generateSQLWithLangChainStreamGen called', { question, historyLength: history?.length });
  
  let config;
  try {
    config = getLlmConfig();
  } catch (e) {
    throw new Error('LLM未配置，请先在配置面板设置LLM Provider和API Key');
  }
  
  const { provider, apiKey, model } = config;
  let baseURL, llmModel;
  
  switch (provider) {
    case 'openai':
      baseURL = 'https://api.openai.com/v1';
      llmModel = model || 'gpt-4o';
      break;
    case 'deepseek':
      baseURL = 'https://api.deepseek.com';
      llmModel = model || 'deepseek-chat';
      break;
    case 'minimax':
      baseURL = 'https://api.minimax.chat/v1';
      llmModel = model || 'abab6.5s-chat';
      break;
    default:
      throw new Error(`不支持的provider: ${provider}`);
  }
  
  const skillMd = loadSkillMd();
  const tableIndex = loadTableIndex();

  const systemMessage = `你是一个SQL查询专家。必须先读取并严格遵守 skills/sql-creator-skill-v2/SKILL.md 的规范，随后根据用户问题生成SQL。

## SKILL.md 内容（只读，严格执行）
${skillMd}

## 表索引数据（table_index.json）
${JSON.stringify(tableIndex, null, 2)}

## 可用Tools
- get_tables: 获取所有可用表列表
- get_table_schema(table_name): 获取指定表的详细信息
- get_table_ddl(table_name): 获取指定表的DDL建表语句
- get_output_format: 获取SQL输出的格式规范和模板
- get_mysql_limits: 获取MySQL 5.7的语法限制和注意事项

## 返回格式（必须严格遵守）
使用 markdown 格式返回，包含以下部分：
- **SQL**: 最终生成的SQL语句
- **说明**: 对SQL的简要解释

## 历史上下文
${history}

## 用户问题`;

  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: question }
  ];

  let maxToolCalls = 15;
  let responseText = '';
  
  while (maxToolCalls > 0) {
    console.log(`第${16 - maxToolCalls}次调用`);
    
    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      stream: true,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }))
    };
    
    try {
      const fetchResponse = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestParams)
      });
      
      if (!fetchResponse.ok) {
        const errorJson = await fetchResponse.json();
        throw new Error(errorJson.error?.message || fetchResponse.statusText);
      }
      
      // 流式处理响应
      const reader = fetchResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const streamToolCalls = [];
      responseText = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                responseText += content;
                yield { type: 'chunk', content: content };
              }
              
              // 检查工具调用
              const toolCalls = data.choices?.[0]?.delta?.tool_calls;
              if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                  const toolName = tc.function?.name;
                  if (toolName) {
                    // 检查是否已存在相同的 tool call，避免重复添加
                    const existingIdx = streamToolCalls.findIndex(t => t.function?.name === toolName);
                    if (existingIdx === -1) {
                      streamToolCalls.push(tc);
                    }
                    // 延迟输出日志，等参数收集完成后再输出
                  }
                }
              }
            } catch (e) {}
          }
        }
      }
      
      // 流式响应结束，输出工具调用日志
      for (const tc of streamToolCalls) {
        const toolName = tc.function?.name;
        if (toolName) {
          yield { type: 'log', log: `🔧 调用工具: ${toolName}` };
        }
      }
      
      // 流式响应结束，处理工具调用
      // 保存 assistant 消息，需要包含 tool_calls
      const assistantMsg = { 
        role: 'assistant', 
        content: responseText || ''
      };
      if (streamToolCalls.length > 0) {
        // 为每个 tool_call 确保有 id
        streamToolCalls.forEach((tc, idx) => {
          if (!tc.id) {
            tc.id = `call_${Date.now()}_${idx}`;
          }
        });
        assistantMsg.tool_calls = streamToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || '{}'
          }
        }));
      }
      messages.push(assistantMsg);
      
      if (streamToolCalls.length > 0) {
        for (const toolCall of streamToolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          const toolCallId = toolCall.id || `call_${Date.now()}_${streamToolCalls.indexOf(toolCall)}`;
          
          const tool = tools.find(t => t.name === toolName);
          if (tool) {
            try {
              const parsedArgs = JSON.parse(toolArgs);
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(paramValue);
              
              yield { type: 'log', log: `📋 工具 ${toolName} 返回:\n${toolResult}` };
              
              messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: toolResult
              });
            } catch (e) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: `Error: ${e.message}`
              });
            }
          }
        }
        
        maxToolCalls--;
        continue;
      }
      
      break;
      
    } catch (e) {
      yield { type: 'error', content: e.message };
      return;
    }
  }

  let sql = '';
  let message = '';

  console.log('=== 解析最终响应 ===');
  console.log('responseText 长度:', responseText?.length);
  console.log('responseText 前200字符:', responseText?.substring(0, 200) + '...');

  // 提取 JSON 从 code block 中
  let jsonText = responseText;
  const codeBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch && codeBlockMatch[1]) {
    jsonText = codeBlockMatch[1];
    console.log('提取到 code block JSON，长度:', jsonText.length);
    console.log('提取的 JSON 前200字符:', jsonText.substring(0, 200) + '...');
  }

  try {
    console.log('准备解析的 JSON 前200字符:', jsonText?.trim().substring(0, 200) + '...');
    const parsed = JSON.parse(jsonText.trim());
    sql = parsed.sql || responseText;
    message = parsed.message || '';
    console.log('解析成功 - sql长度:', sql?.length, 'message长度:', message?.length);
  } catch (e) {
    console.log('JSON解析失败:', e.message);
    console.log('失败的内容前200字符:', jsonText?.trim().substring(0, 200) + '...');
    
    // 尝试提取 SQL 代码块
    const sqlCodeBlockMatch = responseText.match(/```sql\s*([\s\S]*?)\s*```/);
    if (sqlCodeBlockMatch && sqlCodeBlockMatch[1]) {
      console.log('找到 SQL 代码块，提取 SQL');
      sql = sqlCodeBlockMatch[1].trim();
      message = '从 SQL 代码块中提取的查询';
      console.log('SQL 提取成功，长度:', sql.length);
    } else {
      // 如果都失败，使用原始文本
      console.log('未找到 SQL 代码块，使用原始文本');
      sql = responseText;
    }
  }

  yield { type: 'done', sql, message };
}

// 使用 LangChain 实现的流式生成方法
export async function* generateSQLWithLangChainStreamGenV2(question, history = '') {
  logger.info('generateSQLWithLangChainStreamGenV2 called', { question, historyLength: history?.length });
  
  let config;
  try {
    config = getLlmConfig();
  } catch (e) {
    throw new Error('LLM未配置，请先在配置面板设置LLM Provider和API Key');
  }
  
  const { provider, apiKey, model } = config;
  let baseURL, llmModel;
  
  switch (provider) {
    case 'openai':
      baseURL = 'https://api.openai.com/v1';
      llmModel = model || 'gpt-4o';
      break;
    case 'deepseek':
      baseURL = 'https://api.deepseek.com';
      llmModel = model || 'deepseek-chat';
      break;
    case 'minimax':
      baseURL = 'https://api.minimax.chat/v1';
      llmModel = model || 'abab6.5s-chat';
      break;
    default:
      throw new Error(`不支持的provider: ${provider}`);
  }
  
  const skillMd = loadSkillMd();
  const tableIndex = loadTableIndex();

  const systemMessage = `你是一个SQL查询专家。必须先读取并严格遵守 skills/sql-creator-skill-v2/SKILL.md 的规范，随后根据用户问题生成SQL。

## SKILL.md 内容（只读，严格执行）
${skillMd}

## 表索引数据（table_index.json）
${JSON.stringify(tableIndex, null, 2)}

## 可用工具
- get_tables: 获取所有可用表列表。每个表包含name(表名)、description(描述)、tags(标签)。
- get_table_schema(table_name): 获取指定表的详细信息，包括字段别名、枚举值、业务约束等。参数: table_name(表名，必须)。
- get_table_ddl(table_name): 获取指定表的DDL建表语句。参数: table_name(表名，必须)。
- get_output_format: 获取SQL输出的格式规范和模板。
- get_mysql_limits: 获取MySQL 5.7的语法限制和注意事项。

## 工具使用方法
1. 首先使用 get_tables 工具获取所有可用表列表，了解数据库结构
2. 根据用户问题和表列表，识别需要查询的表
3. 使用 get_table_schema 工具获取相关表的详细结构
4. 根据表结构和用户需求，生成SQL查询
5. 确保返回JSON格式：{"sql": "SQL语句", "message": "简要说明"}

## 返回格式（必须严格遵守）
使用 markdown 格式返回，包含以下部分：
- **SQL**: 最终生成的SQL语句
- **说明**: 对SQL的简要解释

## 历史上下文
${history}

## 用户问题`;

  // 创建 LLM 实例
  let llm;
  if (provider === 'deepseek') {
    try {
      const { ChatDeepSeek } = await import('@langchain/deepseek');
      llm = new ChatDeepSeek({
        model: llmModel,
        temperature: 0,
        apiKey: apiKey,
        baseURL: baseURL,
        timeout: 180000,
        maxRetries: 0
      });
    } catch (error) {
      // 回退到 ChatOpenAI
      llm = new ChatOpenAI({
        model: llmModel,
        temperature: 0,
        apiKey: apiKey,
        baseURL: baseURL,
        timeout: 180000,
        maxRetries: 0
      });
    }
  } else {
    llm = new ChatOpenAI({
      model: llmModel,
      temperature: 0,
      apiKey: apiKey,
      baseURL: baseURL,
      timeout: 180000,
      maxRetries: 0
    });
  }

  // 绑定工具
  const llmWithTools = llm.bindTools(tools);

  // 构建消息
  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: question }
  ];

  try {
    // 使用 LLM 的流式方法
    const llmStream = await llmWithTools.stream(messages);
    let fullContent = '';
    
    for await (const chunk of llmStream) {
      const content = chunk.content || '';
      fullContent += content;
      
      if (content) {
        yield { type: 'chunk', content: content };
      }
      
      // 检查是否有工具调用
      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        for (const toolCall of chunk.tool_calls) {
          // LangChain 流式响应中 tool_calls 结构可能不同
          const toolName = toolCall.name || toolCall.function?.name;
          const toolArgs = toolCall.args ? JSON.stringify(toolCall.args) : (toolCall.function?.arguments || '{}');
          
          if (!toolName) {
            console.log('toolCall 结构:', JSON.stringify(toolCall, null, 2));
            continue;
          }
          
          yield { type: 'log', log: `🔧 调用工具: ${toolName}...` };
          
          const tool = tools.find(t => t.name === toolName);
          if (tool) {
            try {
              let paramValue = '';
              try {
                const parsedArgs = typeof toolArgs === 'string' ? JSON.parse(toolArgs) : toolArgs;
                paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              } catch {
                paramValue = '';
              }
              const toolResult = tool.func(paramValue);
              
              const preview = toolResult.length > 200 ? toolResult.substring(0, 200) + '...' : toolResult;
              yield { type: 'log', log: `📋 工具 ${toolName} 返回:\n${preview}` };
              
              // 继续流式处理工具结果
              const toolMessages = [
                ...messages,
                {
                  role: 'assistant',
                  content: chunk.content || '',
                  tool_calls: chunk.tool_calls
                },
                {
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: toolResult
                }
              ];
              
              const toolStream = await llmWithTools.stream(toolMessages);
              for await (const toolChunk of toolStream) {
                const toolContent = toolChunk.content || '';
                fullContent += toolContent;
                
                if (toolContent) {
                  yield { type: 'chunk', content: toolContent };
                }
              }
            } catch (e) {
              yield { type: 'log', log: `❌ 工具调用失败: ${e.message}` };
            }
          }
        }
      }
    }
    
    // 解析最终响应
    let sql = '';
    let message = '';
    
    try {
      // 提取 JSON 从 code block 中
      let jsonText = fullContent;
      const codeBlockMatch = fullContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonText = codeBlockMatch[1];
        console.log('提取到 code block JSON，长度:', jsonText.length);
      } else {
        console.log('未找到 code block，使用完整内容，长度:', fullContent.length);
        console.log('完整内容前200字符:', fullContent.substring(0, 200) + '...');
      }
      
      console.log('准备解析的 JSON 前200字符:', jsonText.trim().substring(0, 200) + '...');
      const parsed = JSON.parse(jsonText.trim());
      sql = parsed.sql || fullContent;
      message = parsed.message || '';
      console.log('JSON 解析成功，sql长度:', sql?.length, 'message长度:', message?.length);
    } catch (e) {
      console.log('JSON 解析失败:', e.message);
      console.log('失败的内容前200字符:', fullContent.substring(0, 200) + '...');
      sql = fullContent;
    }
    
    yield { type: 'done', sql, message };
  } catch (e) {
    yield { type: 'error', content: e.message };
    return;
  }
}

export { generateSQLWithLangChain, loadSkillMd };
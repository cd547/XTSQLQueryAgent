import { getLlmConfig, getAgentConfig } from './config.js';
import { logger } from '../logger.js';
import { ChatOpenAI } from '@langchain/openai';
import { loadTableIndex, loadSkillMd, tools } from './toolFuncs.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = path.join(__dirname, '../../../logs');

function writeLlmLog(content) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const logFile = path.join(LOGS_PATH, `llm_${dateStr}.log`);
  const timestamp = now.toISOString();
  const logLine = `${timestamp}: ${content}\n`;
  fs.appendFileSync(logFile, logLine, 'utf-8');
}

const LOG_BUFFER = [];
let flushTimer = null;

function flushLogs() {
  if (LOG_BUFFER.length === 0) return;
  const flushing = LOG_BUFFER.splice(0);
  const content = flushing.join('\n');
  writeLlmLog(content);
}

function queueLog(content, immediate = false) {
  LOG_BUFFER.push(content);
  if (immediate) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLogs();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, 1000);
  }
}

function getProviderConfig(provider, model) {
  const configs = {
    openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' },
    deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
    minimax: { baseURL: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat' },
    ollama: { baseURL: 'http://localhost:11434', model: 'llama3.2' }
  };
  const cfg = configs[provider];
  if (!cfg) throw new Error(`不支持的provider: ${provider}`);
  return {
    baseURL: cfg.baseURL,
    llmModel: model || cfg.model
  };
}

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
  
  try {
    const providerCfg = getProviderConfig(provider, model);
    baseURL = providerCfg.baseURL;
    llmModel = providerCfg.llmModel;
  } catch (e) {
    throw e;
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
- request_tag_confirmation(term, table, description): 请求用户确认是否将术语添加到表的标签中。当用户纠正表名或提供新的术语-表关联时使用。

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
          
          const tool = toolsMap.get(toolName);
          if (tool) {
            try {
              const parsedArgs = JSON.parse(toolArgs);
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(parsedArgs);
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
  
  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;
  
  const skillMd = loadSkillMd();

  const toolsDefinition = tools.map(t => ({
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
  }));

  const toolsMap = new Map(tools.map(t => [t.name, t]));
  //const tableIndex = loadTableIndex();

  const systemMessage = `你是一个SQL查询专家。必须先读取并严格遵守 skills/sql-creator-skill-v2/SKILL.md 的规范，随后根据用户问题生成SQL。

## SKILL.md 内容（只读，严格执行）
${skillMd}


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

  const agentConfig = getAgentConfig();
  let maxToolCalls = parseInt(agentConfig.agent_max_tool_calls || '30', 10);
  let responseText = '';
  let sql = '';
  
  while (maxToolCalls > 0) {
    console.log(`第${31 - maxToolCalls}次调用`);

    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      tools: toolsDefinition
    };

    queueLog('generateSQLWithLangChainStreamGen_BAK Round ' + (31 - maxToolCalls) + ' Request:\n' + JSON.stringify(requestParams, null, 2), true);
    
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
        
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        if (done) {
          buffer = '';
          break;
        } else {
          buffer = lines.pop() || '';
        }
        
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              const usage = data.usage;
              if (usage) {
                yield { type: 'usage', usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } };
              }
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                responseText += content;
                yield { type: 'chunk', content: content };
              }
              
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
            } catch (e) { logger.debug('JSON parse/split failed', { error: e.message }); }
          }
        }
      }

      // 输出LLM的思考过程（reasoning）
      if (responseText) {
        yield { type: 'LLM', log: `💭 LLM思考过程:\n${responseText.slice(0, 10000)}` };
      }

      // 过滤出有实际工具名称的工具调用
      const validToolCalls = streamToolCalls.filter(tc => tc.function?.name && tc.function.name.trim());

      // 流式响应结束，输出工具调用日志
      for (const tc of validToolCalls) {
        const toolName = tc.function.name;
        queueLog(`🔧 调用工具: ${toolName} 参数:${JSON.stringify(tc.function.arguments)}`, true);
        let logMsg = `🔧 调用工具: ${toolName}`;
        try {
          const parsedArgs = JSON.parse(tc.function.arguments || '{}');
          if (Object.keys(parsedArgs).length > 0) {
            logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
          }
        } catch (e) { logger.debug('JSON parse/split failed', { error: e.message }); }
        yield { type: 'tool', log: logMsg };
      }

      // 保存 assistant 消息，需要包含 tool_calls
      const assistantMsg = {
        role: 'assistant',
        content: responseText || ''
      };
      if (validToolCalls.length > 0) {
        // 为每个 tool_call 确保有 id
        validToolCalls.forEach((tc, idx) => {
          if (!tc.id) {
            tc.id = `call_${Date.now()}_${idx}`;
          }
        });
        assistantMsg.tool_calls = validToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || '{}'
          }
        }));
      }
      messages.push(assistantMsg);

      if (validToolCalls.length > 0) {
        for (const toolCall of validToolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          const toolCallId = toolCall.id || `call_${Date.now()}_${validToolCalls.indexOf(toolCall)}`;

          const tool = toolsMap.get(toolName);
          if (tool) {
            try {
              // 尝试解析参数，如果失败则使用空对象
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(toolArgs);
              } catch (e) {
                console.warn(`工具 ${toolName} 参数解析失败: ${e.message}, 参数: ${toolArgs}`);
              }
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(parsedArgs);

              yield { type: 'tool_return', log: `📋 工具 ${toolName} 返回:\n${toolResult}` };

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

  // 返回 markdown 格式的结果
  const message = responseText;

  queueLog(`=== BAK 完成 SQL: ${sql || responseText}`, true);
  flushLogs();
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
  
  const providerCfg = getProviderConfig(provider, model);
  const baseURL = providerCfg.baseURL;
  const llmModel = providerCfg.llmModel;
  
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
- request_tag_confirmation(term, table, description): 请求用户确认是否将术语添加到表的标签中。当用户纠正表名或提供新的术语-表关联时使用。
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

  const toolsDefinition = tools.map(t => ({
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
  }));

  const toolsMap = new Map(tools.map(t => [t.name, t]));

  let maxToolCalls = 15;
  let responseText = '';
  
  while (maxToolCalls > 0) {
    console.log(`第${16 - maxToolCalls}次调用`);
    
    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      stream: true,
      tools: toolsDefinition
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
        
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        if (done) {
          buffer = '';
          break;
        } else {
          buffer = lines.pop() || '';
        }
        
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              const usage = data.usage;
              if (usage) {
                yield { type: 'usage', usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } };
              }
              const content = data.choices?.[0]?.delta?.content || '';
              if (content) {
                responseText += content;
                yield { type: 'chunk', content: content };
              }
              
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
            } catch (e) { logger.debug('JSON parse/split failed', { error: e.message }); }
          }
        }
      }

      // 输出LLM的思考过程（reasoning）
      if (responseText) {
        yield { type: 'LLM', log: `💭 LLM思考过程:\n${responseText.slice(0, 10000)}` };
      }

      // 过滤出有实际工具名称的工具调用
      const validToolCalls = streamToolCalls.filter(tc => tc.function?.name && tc.function.name.trim());

      // 流式响应结束，输出工具调用日志
      for (const tc of validToolCalls) {
        const toolName = tc.function.name;
        queueLog(`🔧 调用工具: ${toolName} 参数:${JSON.stringify(tc.function.arguments)}`, true);
        let logMsg = `🔧 调用工具: ${toolName}`;
        try {
          const parsedArgs = JSON.parse(tc.function.arguments || '{}');
          if (Object.keys(parsedArgs).length > 0) {
            logMsg += `\n参数: ${JSON.stringify(parsedArgs)}`;
          }
        } catch (e) { logger.debug('JSON parse/split failed', { error: e.message }); }
        yield { type: 'tool', log: logMsg };
      }

      // 流式响应结束，处理工具调用
      // 保存 assistant 消息，需要包含 tool_calls
      const assistantMsg = {
        role: 'assistant',
        content: responseText || ''
      };
      if (validToolCalls.length > 0) {
        // 为每个 tool_call 确保有 id
        validToolCalls.forEach((tc, idx) => {
          if (!tc.id) {
            tc.id = `call_${Date.now()}_${idx}`;
          }
        });
        assistantMsg.tool_calls = validToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || '{}'
          }
        }));
      }
      messages.push(assistantMsg);

      if (validToolCalls.length > 0) {
        for (const toolCall of validToolCalls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          const toolCallId = toolCall.id || `call_${Date.now()}_${validToolCalls.indexOf(toolCall)}`;

          const tool = toolsMap.get(toolName);
          if (tool) {
            try {
              // 尝试解析参数，如果失败则使用空对象
              let parsedArgs = {};
              try {
                parsedArgs = JSON.parse(toolArgs);
              } catch (e) {
                console.warn(`工具 ${toolName} 参数解析失败: ${e.message}, 参数: ${toolArgs}`);
              }
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(parsedArgs);

              yield { type: 'tool_return', log: `📋 工具 ${toolName} 返回:\n${toolResult}` };

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

  queueLog(`=== 完成 SQL: ${sql?.substring(0, 100)}... ===`, true);
  flushLogs();
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
    case 'ollama':
      baseURL = apiKey || 'http://localhost:11434';
      llmModel = model || 'llama3.2';
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
- request_tag_confirmation(term, table, description): 请求用户确认是否将术语添加到表的标签中。当用户纠正表名或提供新的术语-表关联时使用。
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
          
          yield { type: 'tool', log: `🔧 调用工具: ${toolName}...` };
          
          const tool = toolsMap.get(toolName);
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
              yield { type: 'tool_return', log: `📋 工具 ${toolName} 返回:\n${preview}` };
              
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
              yield { type: 'tool_return', log: `❌ 工具调用失败: ${e.message}` };
            }
          }
        }
      }
    }

    // 输出LLM的思考过程
    if (fullContent) {
      yield { type: 'LLM', log: `💭 LLM思考过程:\n${fullContent.slice(0, 10000)}` };
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
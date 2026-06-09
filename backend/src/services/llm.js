import { getLlmConfig, getAgentConfig } from './config.js';
import { logger } from '../logger.js';
import { ChatOpenAI } from '@langchain/openai';
import { loadTableIndex, loadSkillMd, tools } from './toolFuncs.js';
import { getDb } from '../db/sqlite.js';
import { countMessagesTokens } from './tokenizer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = process.env.LOG_PATH || './logs';

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

let lastMessages = null;

export function getLastMessages() {
  return lastMessages;
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
    deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
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

function saveMessagesToDb(sessionId, messages) {
  try {
    const db = getDb();
    const messagesJson = JSON.stringify(messages);
    
    // 异步计算 token 数
    const messageTokens = countMessagesTokens(messages);
    
    const existing = db.prepare('SELECT id FROM llm_messages WHERE session_id = ?').get(sessionId);
    if (existing) {
      db.prepare('UPDATE llm_messages SET messages = ?, message_tokens = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?')
        .run(messagesJson, messageTokens, sessionId);
    } else {
      db.prepare('INSERT INTO llm_messages (session_id, messages, message_tokens) VALUES (?, ?, ?)')
        .run(sessionId, messagesJson, messageTokens);
    }
    logger.debug('Saved messages to database', { sessionId, messageCount: messages.length, messageTokens });
  } catch (e) {
    logger.error('Failed to save messages to database', { error: e.message });
  }
}

export function loadMessagesFromDb(sessionId) {
  try {
    const db = getDb();
    const record = db.prepare('SELECT messages, message_tokens FROM llm_messages WHERE session_id = ?').get(sessionId);
    if (record && record.messages) {
      return {
        messages: JSON.parse(record.messages),
        messageTokens: record.message_tokens || 0
      };
    }
    return null;
  } catch (e) {
    logger.error('Failed to load messages from database', { error: e.message });
    return null;
  }
}

// 备份原有函数
export async function* generateSQLWithLangChainStreamGen_BAK(question, history = '', signal, sessionId = null) {
  logger.info('generateSQLWithLangChainStreamGen_BAK called (backup)', { question, historyLength: history?.length, sessionId });
  
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
      parameters: t.lc_kwargs.params || { type: 'object', properties: {}, required: [] }
    }
  }));

  const toolsMap = new Map(tools.map(t => [t.name, t]));
  //const tableIndex = loadTableIndex();

  const systemMessage = `你是XTSQLQueryAgent。严格遵守以下规则，随后根据用户问题生成SQL。

## SKILL.md 内容（只读）
${skillMd}

## 用户问题`;

  let messages;
  
  // 如果有 sessionId，尝试从数据库加载历史消息
  if (sessionId) {
    const savedResult = loadMessagesFromDb(sessionId);
    const savedMessages = savedResult?.messages;
    if (savedMessages && savedMessages.length > 0) {
      logger.info('Loaded messages from database', { sessionId, messageCount: savedMessages.length });
      // 更新 system 消息（可能有更新）并添加新用户消息
      messages = savedMessages;
      // 替换系统消息（保持最新）
      const systemIndex = messages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        messages[systemIndex] = { role: 'system', content: systemMessage };
      }
      // 添加新的用户消息
      messages.push({ role: 'user', content: question });
    } else {
      messages = [
        { role: 'system', content: systemMessage },
        { role: 'user', content: question }
      ];
    }
  } else {
    messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: question }
    ];
  }

  const agentConfig = getAgentConfig();
  let maxToolCalls = parseInt(agentConfig.agent_max_tool_calls || '30', 10);
  let responseText = '';
  let sql = '';
  
  while (maxToolCalls > 0) {
    const requestParams = {
      model: llmModel,
      messages: messages,
      temperature: 0,
      stream: true,
      stream_options: { include_usage: true },
      tools: toolsDefinition,
      thinking: {
        type: 'enabled'
      }
    };

    if (signal?.aborted) {
      yield { type: 'error', content: '请求已被用户中断' };
      return;
    }

    queueLog('generateSQLWithLangChainStreamGen_BAK Round ' + (31 - maxToolCalls) + ' Request:\n' + JSON.stringify(requestParams, null, 2), true);

    try {
      const fetchResponse = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestParams),
        signal
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
      let reasoningContent = '';
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
                            // 提取 reasoning_content（DeepSeek API 要求）
              const reasoning = data.choices?.[0]?.delta?.reasoning_content || '';
              if (reasoning) {
                reasoningContent += reasoning;
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
      if (reasoningContent) {
        yield { type: 'LLM', log: `💭 LLM思考过程:\n${reasoningContent.slice(0, 10000)}` };
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
        content: responseText || '',
        reasoning_content: reasoningContent || '',
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
      lastMessages = JSON.parse(JSON.stringify(messages));
      
      // 保存到数据库（如果有 sessionId）
      if (sessionId) {
        saveMessagesToDb(sessionId, messages);
      }

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
      if (e.name === 'AbortError') {
        yield { type: 'error', content: '请求已被用户中断' };
      } else {
        yield { type: 'error', content: e.message };
      }
      return;
    }
  }

  // 返回 markdown 格式的结果
  const message = responseText;

  queueLog(`=== BAK 完成 SQL: ${sql || responseText}`, true);
  flushLogs();
  yield { type: 'done', sql: '', message };
}

// （已废弃：generateSQLWithLangChainStreamGen 从未被任何代码调用，2026-06 阶段性优化清理）
// （已废弃：generateSQLWithLangChainStreamGenV2 从未被任何代码调用，2026-06 阶段性优化清理）

export { loadSkillMd };
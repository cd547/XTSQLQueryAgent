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
    description: "获取所有可用的表列表。每个表包含name(表名)、description(描述)、tags(标签)。用于了解数据库中有哪些表可用。",
    func: () => {
      const tableIndex = loadTableIndex();
      if (!tableIndex || !tableIndex.tables) return '暂无表数据';
      
      return tableIndex.tables.map(t => 
        `- ${t.name}: ${t.description} (标签: ${t.tags?.join(', ')})`
      ).join('\n');
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
      // 强制使用 deepseek-chat，reasoner 模式太慢且容易超时
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

  // deepseek-reasoner 思考模式需要更长时间，增加超时
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

## 规则
1. 返回JSON格式：{"sql": "SQL语句", "message": "简要说明"}

## 历史上下文
${history}

## 用户问题`;

  const apiUrl = `${baseURL}/chat/completions`;
  console.log('=== DeepSeek API Request ===');
  console.log(`URL: ${apiUrl}`);
  console.log(`Method: POST`);
  console.log(`Headers: { "Content-Type": "application/json", "Authorization": "Bearer ${apiKey?.slice(0, 10)}..." }`);
  
  const llmRequestParams = {
    model: llmModel,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: question }
    ],
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
  console.log('=== DeepSeek API Request ===');
  console.log(JSON.stringify(llmRequestParams, null, 2));
  
logger.info('Calling LLM with model', { model: llmModel });

  const messages = [
    { role: 'system', content: systemMessage },
    { role: 'user', content: question }
  ];

  let maxToolCalls = 20; // 最多调用20次工具
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
      
      // 将助手消息添加到历史
      messages.push({ 
        role: 'assistant', 
        content: assistantMessage?.content || '',
        tool_calls: assistantMessage?.tool_calls
      });

      // 检查是否有 tool_calls
      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log('=== Tool calls detected ===');
        
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments || '{}';
          console.log('Calling tool:', toolName, 'with args:', toolArgs);
          
          // 找到对应的工具函数
          const tool = tools.find(t => t.name === toolName);
          if (tool) {
            try {
              // 解析参数并传递给工具函数
              const parsedArgs = JSON.parse(toolArgs);
              const paramValue = parsedArgs.table_name || parsedArgs[Object.keys(parsedArgs)[0]] || '';
              const toolResult = tool.func(paramValue);
              console.log('Tool result:', toolResult);
              
              // 将工具结果添加到消息
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
        continue; // 继续循环，让LLM基于工具结果生成下一轮回复
      }
      
      // 没有更多tool_calls，检查是否已生成 SQL
      if (responseText.includes('SELECT') || responseText.includes('{"sql":')) {
        break;
      }
      
      // 没有 tool_calls 且没有 SQL，停止
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

export { generateSQLWithLangChain, loadSkillMd };
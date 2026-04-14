import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { getDb } from '../db/sqlite.js';
import { getConfig, getLlmConfig } from '../services/config.js';
import { logger } from '../logger.js';
import { generateSQLWithLangChain, generateSQLWithLangChainStreamGen_BAK, loadSkillMd } from '../services/llm.js';

function ensureSession() {
  const db = getDb();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM sessions').get();
  const newOrder = (maxOrder?.max || 0) + 1;
  const sessionName = `新对话#${newOrder}`;
  const result = db.prepare('INSERT INTO sessions (name, sort_order) VALUES (?, ?)').run(sessionName, newOrder);
  return result.lastInsertRowid;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const SKILL_V2_PATH = path.join(__dirname, '../../../skills/sql-creator-skill-v2');

let cachedSkill = {
  tableIndex: null,
  fieldConfigs: {},
  version: 0,
  md5: '',
  lastLoad: null
};

function loadSkillV2(forceReload = false) {
  try {
    const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
    if (!fs.existsSync(tableIndexPath)) {
      logger.warn('Skill V2 table_index.json not found');
      return cachedSkill;
    }

    const content = fs.readFileSync(tableIndexPath, 'utf-8');
    const md5 = crypto.createHash('md5').update(content).digest('hex');

    const needsReload = !cachedSkill.md5 || forceReload || cachedSkill.md5 !== md5;

    if (!needsReload) {
      return cachedSkill;
    }

    const tableIndex = JSON.parse(content);
    const newVersion = (cachedSkill.version || 0) + 1;
    logger.info('Skill V2 reloaded', { version: newVersion, md5, tableCount: tableIndex.tables?.length || 0 });

    cachedSkill = {
      tableIndex,
      fieldConfigs: {},
      version: newVersion,
      md5,
      lastLoad: new Date()
    };

    return cachedSkill;
  } catch (e) {
    logger.error('Skill V2 load failed', { error: e.message });
    return cachedSkill;
  }
}

function loadFieldConfig(tableName) {
  if (cachedSkill.fieldConfigs[tableName]) {
    return cachedSkill.fieldConfigs[tableName];
  }

  const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${tableName}.json`);
  if (fs.existsSync(fieldConfigPath)) {
    const config = JSON.parse(fs.readFileSync(fieldConfigPath, 'utf-8'));
    cachedSkill.fieldConfigs[tableName] = config;
    return config;
  }
  return null;
}

function matchTables(question, tableIndex) {
  if (!tableIndex || !tableIndex.tables) return [];
  
  const questionLower = question.toLowerCase();
  const matched = [];

  for (const table of tableIndex.tables) {
    let score = 0;

    if (table.description && questionLower.includes(table.description.toLowerCase())) {
      score += 10;
    }

    if (table.tags) {
      for (const tag of table.tags) {
        if (questionLower.includes(tag.toLowerCase())) {
          score += 5;
        }
      }
    }

    if (table.name && questionLower.includes(table.name.toLowerCase())) {
      score += 8;
    }

    if (score > 0) {
      matched.push({ table, score });
    }
  }

  matched.sort((a, b) => b.score - a.score);
  return matched.slice(0, 5).map(m => m.table);
}

function buildSchemaFromSkillV2(question, tableIndex) {
  const matchedTables = matchTables(question, tableIndex);
  
  if (matchedTables.length === 0) {
    return '未找到相关表，请提供更多上下文信息。';
  }

  let schemaText = '## 数据库表结构\n\n';

  for (const table of matchedTables) {
    schemaText += `### ${table.name} (${table.description || ''})\n`;
    schemaText += `标签: ${table.tags?.join(', ') || ''}\n`;

    if (table.business_constraints?.length > 0) {
      schemaText += `业务约束: ${table.business_constraints.join('; ')}\n`;
    }

    if (table.business_rules?.length > 0) {
      schemaText += `业务规则:\n`;
      for (const rule of table.business_rules) {
        if (rule.query) {
          schemaText += `- ${rule.description}: ${rule.query}\n`;
        }
      }
    }

    const fieldConfig = loadFieldConfig(table.name);
    if (fieldConfig) {
      if (fieldConfig.field_aliases && Object.keys(fieldConfig.field_aliases).length > 0) {
        schemaText += `\n字段别名:\n`;
        for (const [field, aliases] of Object.entries(fieldConfig.field_aliases)) {
          schemaText += `- ${field}: ${aliases.join(', ')}\n`;
        }
      }

      if (fieldConfig.field_enums && Object.keys(fieldConfig.field_enums).length > 0) {
        schemaText += `\n枚举值:\n`;
        for (const [field, enums] of Object.entries(fieldConfig.field_enums)) {
          schemaText += `- ${field}:\n`;
          for (const [value, info] of Object.entries(enums)) {
            schemaText += `  - ${value}: ${info.label} (${info.description})\n`;
          }
        }
      }

      if (fieldConfig.business_rules?.length > 0) {
        schemaText += `\n业务规则:\n`;
        for (const rule of fieldConfig.business_rules) {
          schemaText += `- ${rule}\n`;
        }
      }
    }

    schemaText += '\n';
  }

  if (matchedTables.length > 1) {
    schemaText += '### 关联关系\n';
    for (const table of matchedTables) {
      if (table.related_tables?.length > 0) {
        schemaText += `- ${table.name} 关联: ${table.related_tables.join(', ')}\n`;
      }
    }
  }

  return schemaText;
}

loadSkillV2();

router.get('/version', async (req, res) => {
  loadSkillV2();
  res.json({ 
    version: cachedSkill.version, 
    md5: cachedSkill.md5, 
    lastLoad: cachedSkill.lastLoad,
    tableCount: cachedSkill.tableIndex?.tables?.length || 0
  });
});

router.post('/generate', async (req, res) => {
  let { question, sessionId, schemaMode } = req.body;

  // 如果没有sessionId，自动创建
  if (!sessionId) {
    sessionId = ensureSession();
    logger.info('Auto-created session', { sessionId });
  }

  try {
    // 保存用户消息到数据库
    if (sessionId && question) {
      try {
        const db = getDb();
        db.prepare('INSERT INTO messages (session_id, role, content, sql, results) VALUES (?, ?, ?, ?, ?)')
          .run(sessionId, 'user', question, '', '');
      } catch (e) {
        logger.error('保存用户消息失败', { error: e.message });
      }
    }

    const skillMd = loadSkillMd();
    logger.info('Skill.md loaded at generate request', { length: skillMd.length });

    let schema = '';
    let historyText = '';

    if (sessionId) {
      const db = getDb();
      const messages = db.prepare(`
        SELECT content, sql FROM messages
        WHERE session_id = ? AND role IN ('user', 'assistant')
        ORDER BY id ASC LIMIT 20
      `).all(sessionId);
      historyText = messages.map(m => `用户: ${m.content}\n助手: ${m.sql || ''}`).join('\n');
    }

    if (schemaMode === 'langchain') {
      logger.info('Query: langchain mode', { question, sessionId });
      try {
        const result = await generateSQLWithLangChain(question, historyText);
        logger.info('Query result', { sql: result.sql, message: result.message });
        return res.json({ ...result, sessionId });
      } catch (error) {
        logger.error('LangChain query failed', { error: error.message, stack: error.stack });
        return res.json({ error: error.message, sql: '', sessionId });
      }
    } else if (schemaMode === 'stream') {
      logger.info('Query: stream mode', { question, sessionId });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        const generator = generateSQLWithLangChainStreamGen_BAK(question, historyText);
        let fullContent = '';
        let sql = '';
        let message = '';
        const allLogs = [];
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;

        for await (const chunk of generator) {
          if (chunk.type === 'chunk') {
            fullContent += chunk.content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'usage') {
            totalPromptTokens += chunk.usage.prompt_tokens;
            totalCompletionTokens += chunk.usage.completion_tokens;
            totalTokens += chunk.usage.total_tokens;
            // 每轮API调用都保存token记录
            if (sessionId) {
              try {
                const db = getDb();
                db.prepare('INSERT INTO messages (session_id, role, content, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?)')
                  .run(sessionId, 'usage', `Round token: ${chunk.usage.total_tokens} (prompt: ${chunk.usage.prompt_tokens}, completion: ${chunk.usage.completion_tokens})`, chunk.usage.prompt_tokens, chunk.usage.completion_tokens, chunk.usage.total_tokens);
              } catch (e) {
                logger.error('保存usage失败', { error: e.message });
              }
            }
          } else if (chunk.type === 'LLM' || chunk.type === 'tool' || chunk.type === 'tool_return') {
            const logContent = chunk.log || '';
            allLogs.push(logContent);
            res.write(`data: ${JSON.stringify({ type: chunk.type, log: logContent })}\n\n`);

            // 实时保存每条日志到数据库
            if (sessionId && logContent) {
              try {
                const db = getDb();
                db.prepare('INSERT INTO messages (session_id, role, content, sql, results) VALUES (?, ?, ?, ?, ?)')
                  .run(sessionId, chunk.type, logContent, '', '');
              } catch (e) {
                logger.error('保存单条日志失败', { error: e.message });
              }
            }
          } else if (chunk.type === 'error') {
            res.write(`data: ${JSON.stringify({ type: 'error', content: chunk.content })}\n\n`);
          } else if (chunk.type === 'done') {
            sql = chunk.sql || '';
            message = chunk.message || '';
          }
        }

        // 保留合并保存（兼容）
        if (sessionId && allLogs.length > 0) {
          try {
            const db = getDb();
            const logContent = allLogs.join('\n---\n');
            logger.info('保存日志', { sessionId: String(sessionId), logLength: logContent.length, logCount: allLogs.length });
          } catch (e) {
            logger.error('保存日志失败', { error: e.message, stack: e.stack });
          }
        }

        // 如果 sql 为空，尝试从 message 或 fullContent 中提取 SQL
        if (!sql || sql.trim() === '') {
          const contentToExtract = message || fullContent;
          // 从 markdown 中提取 SQL
          const sqlMatch = contentToExtract.match(/```sql\s*([\s\S]*?)```/i) || contentToExtract.match(/```mysql\s*([\s\S]*?)```/i);
          if (sqlMatch) {
            sql = sqlMatch[1].trim();
          } else {
            const sqlLineMatch = contentToExtract.match(/SQL[:：]\s*[\n\r]?([\s\S]*?)(?:\n\n|\n$|$)/i);
            if (sqlLineMatch) {
              sql = sqlLineMatch[1].trim();
            }
          }
        }

        // 如果 message 为空，使用 fullContent
        if (!message || message.trim() === '') {
          message = fullContent;
        }

logger.info('Stream done, sending final result', { sql: sql?.substring(0, 50), message: message?.substring(0, 50), totalTokens });
        
        // 保存最终消息到数据库（包含token统计）
        const contentForDb = fullContent || message;
        if (sessionId && contentForDb) {
          try {
            const db = getDb();
            db.prepare('INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
              .run(sessionId, 'assistant', contentForDb, sql || '', '', totalPromptTokens, totalCompletionTokens, totalTokens);
          } catch (e) {
            logger.error('保存最终消息失败', { error: e.message });
          }
          
          // 更新会话的累积 token
          if (sessionId && totalTokens > 0) {
            try {
              const db = getDb();
              const current = db.prepare('SELECT total_tokens FROM sessions WHERE id = ?').get(sessionId);
              const newTotal = (current?.total_tokens || 0) + totalTokens;
              db.prepare('UPDATE sessions SET total_tokens = ? WHERE id = ?')
                .run(newTotal, sessionId);
            } catch (e) {
              logger.error('更新会话token失败', { error: e.message });
            }
          }
        }
        
        res.write(`data: ${JSON.stringify({ type: 'done', sql, message, sessionId, totalTokens })}\n\n`);
      } catch (error) {
        logger.error('Stream query failed', { error: error.message, stack: error.stack });
        res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
      }

      res.end();
      return;
    } 
  } catch (error) {
    logger.error('SQL generation failed', { error: error.message });
    res.json({ error: error.message, sql: '' });
  }
});

async function callLLM(provider, prompt, apiKey, model) {
  const timeout = (ms) => new Promise((_, reject) => 
    setTimeout(() => reject(new Error('LLM调用超时')), ms)
  );

  const providers = {
    openai: async () => {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0
        })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    },
    deepseek: async () => {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0
        })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    },
    minimax: async () => {
      const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'abab6.5s-chat',
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    },
    ollama: async () => {
      const host = apiKey || 'http://localhost:11434';
      const response = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'llama2',
          prompt,
          stream: false
        })
      });
      const data = await response.json();
      return data.response || '';
    }
  };

  const fn = providers[provider];
  if (!fn) throw new Error(`不支持的provider: ${provider}`);
  
  return Promise.race([fn(), timeout(30000)]);
}

router.post('/execute', async (req, res) => {
  const { sql, sessionId } = req.body;

  if (!sql || typeof sql !== 'string') {
    return res.json({ error: 'SQL不能为空', rowCount: 0 });
  }

  const upper = sql.toUpperCase().trim();
  
  // 去除SQL中的所有注释（-- 和 /* */）
  let cleanSql = upper
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  
  // 先检查是否以SELECT或WITH开头（最准确的检测方法）
  if (!cleanSql.startsWith('SELECT') && !cleanSql.toUpperCase().startsWith('WITH')) {
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    for (const word of forbidden) {
      if (cleanSql.includes(word)) {
        return res.json({ error: `不允许执行 ${word} 操作`, rowCount: 0 });
      }
    }
    return res.json({ error: '只允许SELECT查询', rowCount: 0 });
  }

  try {
    const config = getConfig();
    if (!config) {
      return res.json({ error: '数据库未配置', rowCount: 0 });
    }
    const connection = await mysql.createConnection(config);

    // 去除SQL末尾的分号，避免拼接LIMIT出错
    const cleanSql = sql.replace(/;$/, '').trim();
    const execSql = cleanSql.includes('LIMIT') ? cleanSql : cleanSql + ' LIMIT 1000';
    const [rows] = await connection.query(execSql);
    await connection.end();

    if (sessionId) {
      const db = getDb();
      db.prepare(`
        INSERT INTO messages (session_id, role, sql, results)
        VALUES (?, 'user', ?, ?)
      `).run(sessionId, sql, JSON.stringify(rows));
      db.prepare(`
        INSERT INTO messages (session_id, role, results)
        VALUES (?, 'assistant', ?)
      `).run(sessionId, JSON.stringify({ rowCount: rows.length }));
    }

    res.json({ results: rows, rowCount: rows.length });
  } catch (error) {
    logger.error('SQL execution failed', { error: error.message, sql });
    res.json({ error: error.message, rowCount: 0 });
  }
});

router.post('/explain', async (req, res) => {
  const { sql } = req.body;
  
  if (!sql || typeof sql !== 'string') {
    return res.json({ error: '请提供 SQL 语句', rowCount: 0 });
  }
  
  // 提取有效 SQL（去除注释，只保留 SQL 语句）
  const lines = sql.split('\n');
  const validLines = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('--') && !trimmed.startsWith('/*');
  });
  const cleanSql = validLines.join(' ').trim();
  
  if (!cleanSql.toUpperCase().startsWith('SELECT') && !cleanSql.toUpperCase().startsWith('EXPLAIN') && !cleanSql.toUpperCase().startsWith('WITH')) {
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
    const upperSql = cleanSql.toUpperCase();
    for (const word of forbidden) {
      if (upperSql.includes(word)) {
        return res.json({ error: `不允许执行 ${word} 操作`, rowCount: 0 });
      }
    }
    return res.json({ error: '只允许 SELECT/EXPLAIN 查询', rowCount: 0 });
  }

  try {
    const config = getConfig();
    if (!config) {
      return res.json({ error: '数据库未配置', rowCount: 0 });
    }
const connection = await mysql.createConnection(config);
    
    // 对于普通SELECT查询，使用标准EXPLAIN格式（不是JSON）
    const isSelectOrWith = cleanSql.toUpperCase().startsWith('SELECT') || cleanSql.toUpperCase().startsWith('WITH');
    const explainSql = cleanSql.toUpperCase().startsWith('EXPLAIN') 
      ? cleanSql 
      : isSelectOrWith
        ? `EXPLAIN ${cleanSql}`  // 使用标准表格格式
        : `EXPLAIN ${cleanSql}`;
    const [rows] = await connection.query(explainSql);
    await connection.end();
    
    res.json({ results: rows, rowCount: rows.length });
  } catch (error) {
    logger.error('EXPLAIN execution failed', { error: error.message, sql });
    res.json({ error: error.message, rowCount: 0 });
  }
});

router.post('/explain-analyze', async (req, res) => {
  const { sql, explainResults } = req.body;
  
  logger.info('EXPLAIN analyze called', { sql: sql?.substring(0, 100), resultsLength: explainResults?.length });
  
  if (!sql || !explainResults || !Array.isArray(explainResults)) {
    return res.json({ error: '请提供 SQL 语句和 EXPLAIN 结果', rowCount: 0 });
  }

  try {
    const config = getLlmConfig();
    if (!config || !config.apiKey) {
      return res.json({ error: 'LLM 未配置', rowCount: 0 });
    }

    const prompt = `你是数据库性能优化专家。请分析以下 MySQL EXPLAIN 执行计划，找出潜在的性能问题并给出优化建议。

## SQL 语句
\`\`\`sql
${sql}
\`\`\`

## EXPLAIN 执行计划
\`\`\`json
${JSON.stringify(explainResults, null, 2)}
\`\`\`

请分析以下内容：
1. 是否使用了合适的索引（type 字段）
2. 是否有全表扫描（type=ALL）
3. 是否使用了 filesort 或 temporary
4. 可能的优化建议

请用中文回复，结构化输出分析结果。`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const provider = config.provider || 'deepseek';
    const apiKey = config.apiKey;
    const model = config.model || 'deepseek-chat';
    
    let apiUrl = '';
    let requestBody = {};
    
    if (provider === 'deepseek') {
      apiUrl = 'https://api.deepseek.com/chat/completions';
      requestBody = {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        stream: true
      };
    } else if (provider === 'openai') {
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      requestBody = {
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        stream: true
      };
    } else {
      return res.json({ error: '不支持的 LLM provider', rowCount: 0 });
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error('LLM API 请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') {
            res.write(`data: ${JSON.stringify({ type: 'done', analysis: fullContent })}\n\n`);
            break;
          }
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
              res.flush();
            }
          } catch (e) {
          }
        }
      }
    }

    res.end();
  } catch (error) {
    logger.error('EXPLAIN analyze failed', { error: error.message });
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

export default router;
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { getDb } from '../db/sqlite.js';
import { getConfig, getLlmConfig } from '../services/config.js';
import { logger } from '../logger.js';
import { generateSQLWithLangChain, loadSkillMd } from '../services/llm.js';

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
  const { question, sessionId, schemaMode } = req.body;

  try {
    // 强制流程：先读取 SKILL.md 并理解改入口
    const skillMd = loadSkillMd();
    logger.info('Skill.md loaded at generate request', { length: skillMd.length });

    let schema = '';
    let historyText = '';

    if (sessionId) {
      const db = getDb();
      const messages = db.prepare(`
        SELECT content, sql FROM messages
        WHERE session_id = ?
        ORDER BY id DESC LIMIT 10
      `).all(sessionId);
      historyText = messages.reverse().map(m => `用户: ${m.content}\n助手: ${m.sql || ''}`).join('\n');
    }

    if (schemaMode === 'langchain') {
      logger.info('Query: langchain mode', { question, sessionId });
      try {
        console.log("ll");
        const result = await generateSQLWithLangChain(question, historyText);
        logger.info('Query result', { sql: result.sql, message: result.message });
        return res.json(result);
      } catch (error) {
        logger.error('LangChain query failed', { error: error.message, stack: error.stack });
        return res.json({ error: error.message, sql: '' });
      }
    } else if (schemaMode === 'skill' || schemaMode === undefined) {
      loadSkillV2();
      schema = buildSchemaFromSkillV2(question, cachedSkill.tableIndex);
    } else if (schemaMode === 'manual') {
      const db = getDb();
      const rows = db.prepare('SELECT table_name, description, columns FROM table_schemas').all();
      schema = rows.map(r => `${r.table_name}: ${r.description}\n${r.columns}`).join('\n');
    } else if (schemaMode === 'auto') {
      const config = getConfig();
      const connection = await mysql.createConnection(config);
      const [tables] = await connection.query('SHOW TABLES');
      
      schema = '## 数据库表结构\n\n';
      for (const t of tables) {
        const tableName = Object.values(t)[0];
        const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
        schema += `### ${tableName}\n`;
        for (const col of columns) {
          schema += `- ${col.Field}: ${col.Type} ${col.Null === 'YES' ? '(NULL)' : '(NOT NULL)'}\n`;
        }
        schema += '\n';
      }
      await connection.end();
    }

    const llmConfig = getLlmConfig();
    const { provider, apiKey, model } = llmConfig;

    const prompt = `你是一个SQL查询专家。根据以下数据库表结构，回答用户的问题并生成对应的SQL查询。

${schema}

## 历史上下文（参考之前对话）
${historyText}

## 规则
1. 只生成SELECT查询，不要生成INSERT/UPDATE/DELETE
2. 使用标准的MySQL语法
3. 如需限制结果条数，使用LIMIT默认1000
4. 返回JSON格式：{"sql": "SQL语句", "message": "简要说明"}

## 用户问题
${question}`;

    const result = await callLLM(provider, prompt, apiKey, model);

    let sql = '';
    let message = '';
    try {
      const parsed = JSON.parse(result);
      sql = parsed.sql || result;
      message = parsed.message || '';
    } catch {
      sql = result;
    }

    res.json({ sql, message });
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
            console.log("openai");
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
      console.log("dddeeeppp");
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
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
  for (const word of forbidden) {
    if (upper.includes(word)) {
      return res.json({ error: `不允许执行 ${word} 操作`, rowCount: 0 });
    }
  }

  if (!upper.startsWith('SELECT')) {
    return res.json({ error: '只允许SELECT查询', rowCount: 0 });
  }

  try {
    const config = getConfig();
    const connection = await mysql.createConnection(config);

    const countSql = sql.includes('LIMIT') ? sql : sql + ' LIMIT 1000';
    const [rows] = await connection.query(countSql);
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

export default router;
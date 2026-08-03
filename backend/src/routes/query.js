import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getDb } from '../db/sqlite.js';
import { getConfig, getLlmConfig } from '../services/config.js';
import { authRequired, adminRequired, sessionBelongsToUser } from '../services/auth.js';
import { logger } from '../logger.js';
import { generateSQLWithLangChainStreamGen_BAK, loadSkillMd, getLastMessages, loadMessagesFromDb, clearSessionRegistry } from '../services/llm.js';
import { validateReadOnlySql } from '../services/sqlValidator.js';
import { poolQuery } from '../services/mysqlPool.js';
import { config } from '../config.js';

// /execute 端点：只允许查询，不允许 EXPLAIN
const EXECUTE_SQL_OPTIONS = { allowedPrefixes: ['SELECT', 'WITH'] };
// /explain 端点：允许查询 + EXPLAIN
const EXPLAIN_SQL_OPTIONS = { allowedPrefixes: ['SELECT', 'WITH', 'EXPLAIN'] };

const router = Router();

// 所有查询接口都要求登录
router.use(authRequired);

function ensureSession(userId) {
  const db = getDb();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM sessions WHERE user_id = ?').get(userId);
  const newOrder = (maxOrder?.max || 0) + 1;
  const sessionName = `新对话#${newOrder}`;
  const result = db.prepare('INSERT INTO sessions (name, sort_order, user_id) VALUES (?, ?, ?)').run(sessionName, newOrder, userId);
  return result.lastInsertRowid;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = config.projectRoot;
const SKILL_V2_PATH = path.join(config.skillPath, 'sql-creator-skill-v2');

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

// 注意：此接口前端未调用（前端统一通过 /query/messages/:sessionId 获取消息历史）。
// 保留仅作开发调试用途；返回的是 getLastMessages() 的进程级全局缓存，
// 任何登录用户调用都可能拿到最后一个提问者的消息内容。
// 双闸门保护：生产环境直接 404 屏蔽；非生产环境额外要求 admin 角色。
const debugMessagesGate = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not Found' });
  }
  next();
};
router.get('/messages', debugMessagesGate, adminRequired, async (req, res) => {
  const messages = getLastMessages();
  if (messages) {
    res.json({
      success: true,
      messages,
      count: messages.length
    });
  } else {
    res.json({
      success: false, 
      message: '暂无消息数据，请先执行一次 SQL 生成请求' 
    });
  }
});

router.get('/messages/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    if (!sessionBelongsToUser(sessionId, req.user.id)) {
      return res.status(403).json({ success: false, message: '无权访问此会话' });
    }
    const result = loadMessagesFromDb(sessionId);
    if (result) {
      res.json({
        success: true,
        messages: result.messages,
        count: result.messages.length,
        messageTokens: result.messageTokens,
        sessionId
      });
    } else {
      res.json({
        success: false,
        message: `会话 ${sessionId} 暂无消息历史`,
        sessionId
      });
    }
  } catch (e) {
    logger.error('Failed to load messages from database', { error: e.message });
    res.json({
      success: false,
      message: '加载消息历史失败: ' + e.message
    });
  }
});

router.delete('/messages/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    if (!sessionBelongsToUser(sessionId, req.user.id)) {
      return res.status(403).json({ success: false, message: '无权访问此会话' });
    }
    const db = getDb();
    const result = db.prepare('DELETE FROM llm_messages WHERE session_id = ?').run(sessionId);
    // 清空工具调用注册表，避免后续请求仍按旧清单拦截
    clearSessionRegistry(sessionId);
    if (result.changes > 0) {
      res.json({
        success: true,
        message: `已清除会话 ${sessionId} 的消息历史`,
        deletedRows: result.changes
      });
    } else {
      res.json({
        success: false,
        message: `会话 ${sessionId} 没有消息历史可清除`
      });
    }
  } catch (e) {
    logger.error('Failed to delete messages from database', { error: e.message });
    res.json({
      success: false,
      message: '清除消息历史失败: ' + e.message
    });
  }
});

router.post('/generate', async (req, res) => {
  let { question, sessionId, schemaMode } = req.body;

  // 如果没有sessionId，自动创建（归属当前用户）
  if (!sessionId) {
    sessionId = ensureSession(req.user.id);
    logger.info('Auto-created session', { sessionId, userId: req.user.id });
  } else {
    // 显式传入了 sessionId，必须校验归属
    if (!sessionBelongsToUser(sessionId, req.user.id)) {
      return res.status(403).json({ error: '无权访问此会话' });
    }
  }

  try {
    // 记录请求开始时间：用于计算 assistant 消息耗时（前端回显显示"耗时 Xs"）
    // 这是后端权威耗时，包含网络传输/历史读取/LLM 调用/工具调用全过程
    const requestStartTime = Date.now();

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

    const skillMd = await loadSkillMd();
    logger.info('Skill.md loaded at generate request', { length: skillMd.length });

    // [DEAD-CODE 2026-07-15] historyText 当前未被 llm.js 消费（llm.js 用 llm_messages.messages JSON blob）
    // 保留这段代码以备未来"双上下文"设计（如：用 messages 表做更精细的 token 控制 / 摘要压缩 / 工具调用审计）
    // 恢复方法：在 llm.js:677 generateSQLWithLangChainStreamGen_BAK 函数体内使用 history 形参
    let schema = '';
    let historyText = '';
    if (false && sessionId) {  // ← 临时禁用入口，避免无谓 SQL 查询
      const db = getDb();
      // 取最近 20 条消息（长对话保留近期上下文），再翻转成时间正序拼入 prompt
      const messages = db.prepare(`
        SELECT content, sql FROM messages
        WHERE session_id = ? AND role IN ('user', 'assistant')
        ORDER BY id DESC LIMIT 20
      `).all(sessionId);
      historyText = messages.reverse().map(m => `用户: ${m.content}\n助手: ${m.sql || ''}`).join('\n');
    }

    if (schemaMode === 'stream') {
      logger.info('Query: stream mode', { question, sessionId });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // SSE 场景关闭 Nagle 算法，每个 chunk 立即发出，避免小包攒批导致 100-200ms 顿挫
      req.socket.setNoDelay(true);

      let streamCompleted = false;
      const abortController = new AbortController();

      // T3 整体 SSE 超时（5min）—— 防御 agent loop 30 轮全部接近超时边界的极端情况
      const OVERALL_TIMEOUT_MS = 5 * 60_000;
      const overallTimer = setTimeout(() => {
        if (!streamCompleted) {
          logger.warn('Overall SSE timeout, aborting LLM request', { OVERALL_TIMEOUT_MS });
          abortController.abort(new Error(`Overall SSE timeout after ${OVERALL_TIMEOUT_MS}ms`));
        }
      }, OVERALL_TIMEOUT_MS);

      res.on('close', () => {
        if (!streamCompleted) {
          logger.info('Client disconnected, aborting LLM request');
          abortController.abort();
        }
      });

      res.flushHeaders();

      // ★ F9 修复：流开始即下发权威 sessionId，避免中断/异常路径下
      //   前端永远拿不到后端 auto-create 的 sessionId → 下次提问又以 null
      //   调 /generate → 后端再建一个新 session → 上下文断裂 + 孤儿会话。
      //   三个失败场景：用户主动 stop / 5min OVERALL_TIMEOUT / 网络断连。
      //   必须放在 flushHeaders 之后、for-await 之前：保证是流首事件、时序可预期。
      res.write(`data: ${JSON.stringify({ type: 'meta', sessionId })}\n\n`);

      try {
        const generator = generateSQLWithLangChainStreamGen_BAK(question, historyText, abortController.signal, sessionId, req.user.username);
        let fullContent = '';
        let sql = '';
        let message = '';
        const allLogs = [];
        let totalPromptTokens = 0;
        let totalCompletionTokens = 0;
        let totalTokens = 0;
        // ★ 防止 happy path 落库后 catch 块重复插入 partial（流中断 partial 保存时会检查此标志）
        let messageSaved = false;
        // ★ 跟踪当前 chunk 的 round，中断时 partial 落库需要正确的 round 用于前端轮次轴分组
        //   2026-07-29 修复：之前漏写 round 字段，partial 消息 round=0 与第一轮日志混淆
        let lastRound = 0;
        // ★ request_user_choice 弹窗请求：捕获 llm.js yield done 中的事件字段
        // 用于穿透到 SSE doneData，驱动前端 UserChoiceDialog
        let userChoiceRequestFromStream = null;

        for await (const chunk of generator) {
          if (abortController.signal.aborted) break;

          // 统一更新 lastRound：所有 chunk 都来自 llm.js:1112 计算的 currentRound
          // 在这里集中处理一次，避免每个 chunk 类型分支都漏写
          if (typeof chunk.round === 'number') {
            lastRound = chunk.round;
          }

          if (chunk.type === 'chunk') {
            fullContent += chunk.content;
            res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          } else if (chunk.type === 'usage') {
            totalPromptTokens += chunk.usage.prompt_tokens;
            totalCompletionTokens += chunk.usage.completion_tokens;
            totalTokens += chunk.usage.total_tokens;
            // 每轮API调用都保存token记录（带 round 字段）
            if (sessionId) {
              try {
                const db = getDb();
                db.prepare('INSERT INTO messages (session_id, role, content, prompt_tokens, completion_tokens, total_tokens, round) VALUES (?, ?, ?, ?, ?, ?, ?)')
                  .run(sessionId, 'usage', `Round token: ${chunk.usage.total_tokens} (prompt: ${chunk.usage.prompt_tokens}, completion: ${chunk.usage.completion_tokens})`, chunk.usage.prompt_tokens, chunk.usage.completion_tokens, chunk.usage.total_tokens, chunk.round || 0);
              } catch (e) {
                logger.error('保存usage失败', { error: e.message });
              }
            }
          } else if (chunk.type === 'LLM' || chunk.type === 'tool' || chunk.type === 'tool_return') {
            const logContent = chunk.log || '';
            allLogs.push(logContent);
            res.write(`data: ${JSON.stringify({ type: chunk.type, log: logContent, round: chunk.round || 0 })}\n\n`);

            // 实时保存每条日志到数据库（带 round 字段，用于历史回显的"轮次轴"展示）
            if (sessionId && logContent) {
              try {
                const db = getDb();
                db.prepare('INSERT INTO messages (session_id, role, content, sql, results, round) VALUES (?, ?, ?, ?, ?, ?)')
                  .run(sessionId, chunk.type, logContent, '', '', chunk.round || 0);
              } catch (e) {
                logger.error('保存单条日志失败', { error: e.message });
              }
            }
          } else if (chunk.type === 'reasoning_chunk') {
            // 实时流式思考过程：只透传给前端，不入 DB，不累计到 fullContent
            res.write(`data: ${JSON.stringify({ type: 'reasoning_chunk', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          } else if (chunk.type === 'message_final') {
            // 后处理：剥离 LLM 误倒进 content 的 thinking 后，更新前端 assistant 消息
            res.write(`data: ${JSON.stringify({ type: 'message_final', content: chunk.content, extraThinking: chunk.extraThinking, round: chunk.round || 0 })}\n\n`);
          } else if (chunk.type === 'reasoning_done') {
            // 思考过程结束：单条入 DB（历史回显用），不传给 UI（UI 已通过 reasoning_chunk 实时显示）
            if (sessionId && chunk.content) {
              try {
                const db = getDb();
                db.prepare('INSERT INTO messages (session_id, role, content, sql, results, round) VALUES (?, ?, ?, ?, ?, ?)')
                  .run(sessionId, 'LLM', chunk.content, '', '', chunk.round || 0);
              } catch (e) {
                logger.error('保存reasoning失败', { error: e.message });
              }
            }
          } else if (chunk.type === 'error') {
            res.write(`data: ${JSON.stringify({ type: 'error', content: chunk.content, round: chunk.round || 0 })}\n\n`);
          } else if (chunk.type === 'done') {
            sql = chunk.sql || '';
            message = chunk.message || '';
            // ★ 捕获 userChoiceRequest 事件字段（来自 llm.js 终止分支 yield）
            // 与 confirm_tag_add 不同：userChoiceRequest 通过事件字段直接传，不靠 regex
            if (chunk.userChoiceRequest && !userChoiceRequestFromStream) {
              userChoiceRequestFromStream = chunk.userChoiceRequest;
            }
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

        // 计算本次请求耗时：后端权威时间，含网络/历史读取/LLM/工具调用
        const elapsedMs = Date.now() - requestStartTime;

        // 保存最终消息到数据库（包含token统计与耗时）
        // ★ Bug A 修复（2026-07-29）：abort 场景下允许空内容落库
        //   之前 fullContent='' 且 message='' 时整段 INSERT 被跳过（line 484 原条件 `if (sessionId && contentForDb)`），
        //   导致"LLM 还在 thinking 阶段就被用户中断"的消息彻底丢失——既无记录也无 interrupted 标记。
        //   现在：正常完成保持原行为（空内容不存，避免噪音）；中断场景补占位符 '(已中断)' 让消息入库。
        const wasInterrupted = abortController.signal.aborted ? 1 : 0;
        let contentForDb = fullContent || message;
        if (wasInterrupted && !contentForDb) {
          contentForDb = '(已中断)';  // 占位符；前端 ChatMessage badge 已显示"⚠ 已中断"
        }
        if (sessionId && contentForDb) {
          try {
            const db = getDb();
            // ★ 如果 abortController 已触发（客户端断连 / 超时），happy path 也会走到这里（for 循环 break 后自然退出 try）
            //   此时把 interrupted 标为 1，前端可显示"已中断"
            db.prepare('INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, round, interrupted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(sessionId, 'assistant', contentForDb, sql || '', '', totalPromptTokens, totalCompletionTokens, totalTokens, elapsedMs, lastRound, wasInterrupted);
            messageSaved = true;  // ★ 标记 happy path 已落库,catch 块不再重复插入
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
        
        const doneData = {
          type: 'done',
          sql,
          message,
          sessionId,
          totalTokens,
          // 后端权威耗时（毫秒）：前端优先用此值显示，回显历史消息时也用 DB 中的此字段
          elapsedMs
        };

        // ★ request_user_choice 弹窗请求：来自 llm.js 终止分支 yield 的 userChoiceRequest 事件字段
        // null 表示 DB 写失败降级（不弹窗）/ 正常路径（无 user_choice 调用）
        if (userChoiceRequestFromStream) {
          doneData.user_choice_request = userChoiceRequestFromStream;
        }

        const confirmMatch = message.match(/<!--confirm_tag_add:(\{[^}]+\})-->/);
        if (confirmMatch) {
          try {
            const confirmData = JSON.parse(confirmMatch[1]);
            doneData.confirm_tag_add = confirmData;
          } catch (e) {
            logger.warn('confirm_tag_add parse failed', { error: e.message });
          }
        }

        streamCompleted = true; clearTimeout(overallTimer);
        res.write(`data: ${JSON.stringify(doneData)}\n\n`);
      } catch (error) {
        streamCompleted = true; clearTimeout(overallTimer);
        logger.error('Stream query failed', { error: error.message, stack: error.stack });

        // ★ 修复流中断时 partial 不落库的 bug（2026-07-29）：
        //   原代码只写 error 事件，已生成的 fullContent / 已消耗的 token 全部丢失。
        //   现在在 catch 块里补一次 partial 落库（仅中断/超时场景；LLM 真实错误不保存 partial）。
        //   三个条件：① 客户端主动中断或超时（abortController.signal.aborted）
        //             ② happy path 还没成功落库（!messageSaved）
        //             ③ 有 sessionId
        //   ★ Bug A 修复：去掉 fullContent 非空要求；中断场景即使 LLM 一字未吐也落库（用占位符）
        const isAbort = abortController.signal.aborted
          || error.name === 'AbortError'
          || /aborted|abort|timeout/i.test(error.message || '');
        if (isAbort && !messageSaved && sessionId) {
          try {
            const db = getDb();
            const elapsedMs = Date.now() - requestStartTime;
            // ★ Bug A：空内容也落库，用占位符让前端能识别"已中断但无内容"
            const contentForDb = fullContent || message || '(已中断)';
            // 1) 写入 partial 消息，标记 interrupted=1，round=lastRound（前端按 round 分组）
            db.prepare('INSERT INTO messages (session_id, role, content, sql, results, prompt_tokens, completion_tokens, total_tokens, elapsed_ms, round, interrupted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(sessionId, 'assistant', contentForDb, sql || '', '', totalPromptTokens, totalCompletionTokens, totalTokens, elapsedMs, lastRound, 1);
            messageSaved = true;
            // 2) 累计 token 到 session（不管中断与否，LLM token 已消耗）
            if (totalTokens > 0) {
              const current = db.prepare('SELECT total_tokens FROM sessions WHERE id = ?').get(sessionId);
              const newTotal = (current?.total_tokens || 0) + totalTokens;
              db.prepare('UPDATE sessions SET total_tokens = ? WHERE id = ?').run(newTotal, sessionId);
            }
            logger.info('Partial assistant message saved (interrupted)', {
              sessionId, contentLength: fullContent.length, totalTokens, elapsedMs, round: lastRound,
              isEmptyContent: !fullContent && !message  // ★ 标记空内容场景,便于排错
            });
          } catch (saveErr) {
            logger.error('保存中断 partial 消息失败', { error: saveErr.message });
          }
        }

        if (!res.writableEnded) {
          // 把 interrupted 标记也透传给前端，前端可选择性显示"已中断"提示
          res.write(`data: ${JSON.stringify({ type: 'error', content: error.message, interrupted: isAbort })}\n\n`);
        }
      }

      if (!res.writableEnded) {
        res.end();
      }
      return;
    } 
  } catch (error) {
    logger.error('SQL generation failed', { error: error.message, stack: error.stack });
    // 关键：SSE 头可能已经发出（res.flushHeaders），此时不能再用 res.json
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', content: '生成失败：' + error.message })}\n\n`);
        res.end();
      } catch (_) { /* 客户端已断开 */ }
    } else {
      logger.error('Generate SQL failed (non-stream)', { error: error.message });
      res.status(500).json({ error: error.message, sql: '' });
    }
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
  const startTime = Date.now();

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQL不能为空', rowCount: 0, queryTime: 0 });
  }

  // 若传入了 sessionId，需要校验归属
  if (sessionId && !sessionBelongsToUser(sessionId, req.user.id)) {
    return res.status(403).json({ error: '无权访问此会话', rowCount: 0, queryTime: 0 });
  }

  // 统一 SQL 校验：剥离注释、前缀白名单、危险函数黑名单、多语句检测
  const sqlCheck = validateReadOnlySql(sql, EXECUTE_SQL_OPTIONS);
  if (!sqlCheck.valid) {
    return res.status(400).json({ error: sqlCheck.message, code: sqlCheck.code, rowCount: 0, queryTime: 0 });
  }

  try {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({ error: '数据库未配置', rowCount: 0, queryTime: 0 });
    }
    // 复用 sqlValidator 已清理过的 SQL（注释、末尾分号已剥离）
    // 不再静默追加 LIMIT 1000：会破坏含 LIMIT 的复杂查询、UNION 也不会被正确处理。
    // 改为在应用层做显示上限，超过则截断并标记 truncated。
    const execSql = sqlCheck.cleaned;
    const [allRows] = await poolQuery(execSql);

    // 应用层显示上限：默认 1000 行（保留与旧实现一致的默认值）
    const MAX_DISPLAY_ROWS = 1000;
    const truncated = allRows.length > MAX_DISPLAY_ROWS;
    const rows = truncated ? allRows.slice(0, MAX_DISPLAY_ROWS) : allRows;
    if (truncated) {
      logger.warn('Query result exceeded display limit', {
        total: allRows.length,
        returned: rows.length,
        sql: execSql.substring(0, 200)
      });
    }

    if (sessionId) {
      const db = getDb();
      // ★ results 改为 NULL（防御性修复，2026-07-29）
      // 原代码:JSON.stringify(allRows) 把全量结果集塞进 messages.results
      //   → 单次大查询(SELECT * FROM huge_table)可能写数百 MB 到 SQLite
      //   → SELECT * FROM messages 会把这些巨型 JSON 全量回读(session.js:83 无 LIMIT)
      //   → 前端仅做 JSON 原样展示(App.jsx:525),不解析 results 字段
      //   → 当前前端从不传 sessionId(仅"复制并执行/查询"按钮触发 /execute)
      //     所以此分支目前为死代码,但保留它作为未来 chat 流调 /execute 的安全兜底
      // 存 NULL 的收益:保留 SQL 历史(用户能查看历史查询) + 彻底杜绝 DB 体积爆炸
      db.prepare(`
        INSERT INTO messages (session_id, role, sql, results)
        VALUES (?, 'user', ?, NULL)
      `).run(sessionId, sql);
      db.prepare(`
        INSERT INTO messages (session_id, role, results)
        VALUES (?, 'assistant', ?)
      `).run(sessionId, JSON.stringify({ rowCount: allRows.length, truncated }));
    }

    const queryTime = Date.now() - startTime;
    res.json({
      results: rows,
      rowCount: allRows.length,        // 实际行数（包含被截断的）
      returned: rows.length,           // 返回给前端的行数
      truncated,                       // 是否被截断
      queryTime
    });
  } catch (error) {
    logger.error('SQL execution failed', { error: error.message, sql });
    res.status(500).json({ error: error.message, rowCount: 0, queryTime: Date.now() - startTime });
  }
});

router.post('/explain', async (req, res) => {
  const { sql } = req.body;
  
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: '请提供 SQL 语句', rowCount: 0 });
  }

  // 统一 SQL 校验：剥离注释、前缀白名单、危险函数黑名单、多语句检测
  const sqlCheck = validateReadOnlySql(sql, EXPLAIN_SQL_OPTIONS);
  if (!sqlCheck.valid) {
    return res.status(400).json({ error: sqlCheck.message, code: sqlCheck.code, rowCount: 0 });
  }
  const cleanSql = sqlCheck.cleaned;

  try {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({ error: '数据库未配置', rowCount: 0 });
    }

    // 对于普通SELECT查询，使用标准EXPLAIN格式（不是JSON）
    const isSelectOrWith = cleanSql.toUpperCase().startsWith('SELECT') || cleanSql.toUpperCase().startsWith('WITH');
    const explainSql = cleanSql.toUpperCase().startsWith('EXPLAIN') 
      ? cleanSql 
      : isSelectOrWith
        ? `EXPLAIN ${cleanSql}`  // 使用标准表格格式
        : `EXPLAIN ${cleanSql}`;
    logger.info('EXPLAIN executing', { cleanSql, explainSql });
    const [rows] = await poolQuery(explainSql);

    res.json({ results: rows, rowCount: rows.length });
  } catch (error) {
    logger.error('EXPLAIN execution failed', { error: error.message, sql });
    res.status(500).json({ error: error.message, rowCount: 0 });
  }
});

router.post('/explain-analyze', async (req, res) => {
  const { sql, explainResults } = req.body;

  logger.info('EXPLAIN analyze called', { sql: sql?.substring(0, 100), resultsLength: explainResults?.length });

  if (!sql || !explainResults || !Array.isArray(explainResults)) {
    return res.status(400).json({ error: '请提供 SQL 语句和 EXPLAIN 结果', rowCount: 0 });
  }

  // ★ 必须把 try 与 catch 共享的所有可变状态声明在 try 之外（路由函数级作用域）。
  //   原因：try / catch 在 ES2015+ 是不同块作用域，try 内的 `let` 在 catch 块里
  //   处于 TDZ（暂时性死区），访问会抛 ReferenceError → 同步 throw 出 async 路由
  //   → Express 4 不接 → unhandledRejection → 进程可能崩溃（Node 15+ 默认行为）。
  //   历史上至少踩过两次坑（F4 之前 / F4 之后），必须一次把所有共享变量搬出来：
  //   - overallTimer: catch 用 clearTimeout 清理
  //   - fullContent: catch 打日志需要知道中断时已收到多少字符
  //   - abortController: catch 在非 abort 错误时需要主动 abort + res.write 错误帧
  //   - streamCompleted: setTimeout 回调和 res.on('close') 都会读它
  let streamCompleted = false;
  let overallTimer = null;
  let abortController = null;
  let fullContent = '';

  try {
    const config = getLlmConfig();
    if (!config || !config.apiKey) {
      return res.status(400).json({ error: 'LLM 未配置', rowCount: 0 });
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

    // 共享函数：同步校验 LLM provider，避免在 flushHeaders() 之后 res.json 触发 ERR_HTTP_HEADERS_SENT
    const validateLlmProvider = (p) => {
      if (p === 'deepseek' || p === 'openai') return { valid: true, provider: p };
      return { valid: false, error: `不支持的 LLM provider: ${p}（仅支持 deepseek / openai）` };
    };

    const providerValidation = validateLlmProvider(config.provider || 'deepseek');
    if (!providerValidation.valid) {
      return res.status(400).json({ error: providerValidation.error, rowCount: 0 });
    }
    const provider = providerValidation.provider;
    const apiKey = config.apiKey;
    const model = config.model || (provider === 'openai' ? 'gpt-4o' : 'deepseek-chat');

    // SSE 头必须在所有参数校验完成后才能发送
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // SSE 场景关闭 Nagle 算法，每个 chunk 立即发出，避免小包攒批导致 100-200ms 顿挫
    req.socket.setNoDelay(true);

    // 客户端断连保护（NEW-2）：复用 /generate 的 abort 模式
    abortController = new AbortController();
    res.on('close', () => {
      if (!streamCompleted) {
        logger.info('EXPLAIN analyze: client disconnected, aborting LLM request');
        abortController.abort();
      }
    });

    // 整体 SSE 超时（5min）—— 防御 LLM 流异常长时间挂起（与 /generate 路由一致）
    const OVERALL_TIMEOUT_MS = 5 * 60_000;
    overallTimer = setTimeout(() => {
      if (!streamCompleted) {
        logger.warn('EXPLAIN analyze overall timeout, aborting LLM request', { OVERALL_TIMEOUT_MS });
        abortController.abort(new Error(`Overall timeout after ${OVERALL_TIMEOUT_MS}ms`));
      }
    }, OVERALL_TIMEOUT_MS);

    res.flushHeaders();

    let apiUrl;
    let requestBody;

    if (provider === 'deepseek') {
      apiUrl = 'https://api.deepseek.com/chat/completions';
      requestBody = {
        model,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        stream: true
      };
    } else { // 'openai'，已在 validateLlmProvider 中保证
      apiUrl = 'https://api.openai.com/v1/chat/completions';
      requestBody = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        stream: true
      };
    }
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error('LLM API 请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      if (abortController.signal.aborted) {
        logger.info('EXPLAIN analyze: aborted before read');
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') {
            streamCompleted = true; clearTimeout(overallTimer);
            if (!abortController.signal.aborted) {
              res.write(`data: ${JSON.stringify({ type: 'done', analysis: fullContent })}\n\n`);
            }
            break;
          }
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) {
                fullContent += content;
                if (!abortController.signal.aborted) {
                  res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
                }
              }
          } catch (e) {
            // 忽略单行 JSON 解析错误（LLM 流中偶发），继续处理后续行
          }
        }
      }
    }

    streamCompleted = true; clearTimeout(overallTimer);
    if (!res.writableEnded) {
      res.end();
    }
  } catch (error) {
    // catch 块访问的所有变量都已在 try 之外声明，TDZ 安全
    if (overallTimer) clearTimeout(overallTimer);
    if (error.name === 'AbortError') {
      // 2026-07-29 顺手加诊断日志：/explain-analyze 不落库（分析结果仅通过 SSE 返回给客户端），
      //   但记录下中断时已收到多少字符，方便排查"分析结果不完整"类工单
      logger.info('EXPLAIN analyze: aborted by client', { partialLength: fullContent.length });
    } else {
      logger.error('EXPLAIN analyze failed', { error: error.message });
      // abortController 在某些早抛错路径下可能仍未赋值（null），用 truthy 守卫
      if (abortController && !abortController.signal.aborted && !res.writableEnded) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
          res.end();
        } catch (_) { /* 客户端已断开 */ }
      }
    }
  }
});

export default router;
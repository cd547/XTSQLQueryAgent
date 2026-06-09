import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data/app.db');

// 确保数据库目录存在
const dbDir = path.dirname(dbPath);
try {
  mkdirSync(dbDir, { recursive: true });
} catch (e) {
  // 目录已存在，忽略
}

let db;

export function getDb() {
  if (!db) {
    db = new Database(dbPath, { 
      fileMustExist: false,
      timeout: 5000
    });
    try {
      db.pragma('journal_mode = WAL');
    } catch (e) {
      console.warn('Failed to set WAL mode, falling back to DELETE mode:', e.message);
      db.pragma('journal_mode = DELETE');
    }
  }
  return db;
}

export function initDatabase() {
  const db = getDb();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

// 如果 sort_order 列不存在，添加它
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN sort_order INTEGER DEFAULT 0`);
  } catch (e) {
    logger.debug('Column sort_order already exists');
  }

  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN total_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    logger.debug('Column total_tokens already exists');
  }

  // 添加 summary 字段
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN summary TEXT`);
  } catch (e) {
    logger.debug('Column summary already exists');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      role TEXT,
      content TEXT,
      sql TEXT,
      results TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  // 添加 token 字段
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN prompt_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    logger.debug('Column prompt_tokens already exists');
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN completion_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    logger.debug('Column completion_tokens already exists');
  }
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN total_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    logger.debug('Column total_tokens already exists');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 初始化默认配置
  const defaultConfigs = [
    { key: 'agent_max_tool_calls', value: '30' },
    { key: 'agent_timeout_ms', value: '60000' },
  ];
  for (const cfg of defaultConfigs) {
    try {
      db.prepare('INSERT OR IGNORE INTO configs (key, value) VALUES (?, ?)').run(cfg.key, cfg.value);
    } catch (e) {
      logger.debug('Default config already exists', { key: cfg.key });
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS table_schemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      description TEXT,
      columns TEXT,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'synced',
      auto_schema TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 创建索引提升查询性能
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session_role ON messages(session_id, role)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_sort_order ON sessions(sort_order)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_table_schemas_table_name ON table_schemas(table_name)`);

  // 创建 LLM 消息历史表（用于多轮对话恢复）
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      messages TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_llm_messages_session_id ON llm_messages(session_id)`);

  // 添加 message_tokens 字段（用于存储消息上下文的 token 数量）
  try {
    db.exec(`ALTER TABLE llm_messages ADD COLUMN message_tokens INTEGER DEFAULT 0`);
  } catch (e) {
    console.debug('message_tokens column already exists');
  }

  console.log('SQLite initialized');
}

export function initSkillLogTable() {
  const db = getDb();
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT,
      file_path TEXT,
      backup_path TEXT,
      old_content TEXT,
      new_content TEXT,
      status TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_logs_created_at ON skill_logs(created_at)`);
  
  console.log('Skill logs table initialized');
}

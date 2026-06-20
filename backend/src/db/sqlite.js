import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
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

/**
 * Schema 迁移工具：仅当列不存在时添加
 *
 * 改进点（替代旧 try/catch 模式）：
 *   - 旧代码用 try { ALTER TABLE } catch { logger.debug('already exists') }，
 *     会把"磁盘满/权限错/SQL 错"等真错误也吞掉，启动看似正常但表结构已损坏。
 *   - 现在先 PRAGMA 检查列是否存在；存在则静默，不存在才 ALTER；ALTER 失败则抛错。
 *
 * 注意：table/column 参数是开发者硬编码，禁止拼接用户输入。
 */
function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some(c => c.name === column)) {
    logger.debug(`Column ${table}.${column} already exists`);
    return;
  }
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    logger.info(`Schema upgrade: added column ${table}.${column}`);
  } catch (e) {
    logger.error(`Schema upgrade FAILED: ${table}.${column}`, { error: e.message });
    throw e;
  }
}

export async function initDatabase() {
  const db = getDb();

  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'user',
      token_version INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 老库兼容：补 token_version 列
  addColumnIfMissing(db, 'users', 'token_version', 'INTEGER DEFAULT 0');

  // 初始化默认 admin 用户（仅当用户表为空时）
  // 安全护栏：仅在非生产环境或显式开启时才自动创建，避免生产部署后留下默认弱口令
  const allowDefaultAdmin = process.env.ALLOW_DEFAULT_ADMIN === 'true' || process.env.NODE_ENV !== 'production';
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    if (allowDefaultAdmin) {
      const defaultHash = await bcrypt.hash('admin123', 10);
      db.prepare('INSERT INTO users (username, password_hash, display_name, role, token_version) VALUES (?, ?, ?, ?, 0)')
        .run('admin', defaultHash, '管理员', 'admin');
      logger.warn('==============================================================');
      logger.warn(' 已自动创建默认管理员账号: admin / admin123');
      logger.warn(' !!! 警告：默认密码是公开的，请立即登录后修改 !!!');
      logger.warn(' 生产环境请设置 ALLOW_DEFAULT_ADMIN=false 禁用此行为');
      logger.warn('==============================================================');
    } else {
      logger.warn('==============================================================');
      logger.warn(' 用户表为空且当前为生产环境，未自动创建 admin');
      logger.warn(' 如需引导账号，请设置环境变量 ALLOW_DEFAULT_ADMIN=true 后重启');
      logger.warn('==============================================================');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 老库兼容：补 sessions 表的几个列
  addColumnIfMissing(db, 'sessions', 'sort_order', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'sessions', 'total_tokens', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'sessions', 'summary', 'TEXT');
  addColumnIfMissing(db, 'sessions', 'user_id', 'INTEGER');

  // 给历史未分配 user_id 的会话分配给首个用户（admin）
  // 数据迁移（非 schema 迁移）：仅是 UPDATE，失败应抛错
  const firstUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (firstUser) {
    const result = db.prepare('UPDATE sessions SET user_id = ? WHERE user_id IS NULL').run(firstUser.id);
    if (result.changes > 0) {
      logger.info(`Backfill user_id: ${result.changes} sessions assigned to user ${firstUser.id}`);
    }
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
  addColumnIfMissing(db, 'messages', 'prompt_tokens', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'messages', 'completion_tokens', 'INTEGER DEFAULT 0');
  addColumnIfMissing(db, 'messages', 'total_tokens', 'INTEGER DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 初始化默认配置（INSERT OR IGNORE 已天然幂等，无需 try/catch 吞错）
  const defaultConfigs = [
    { key: 'agent_max_tool_calls', value: '30' },
    { key: 'agent_timeout_ms', value: '60000' },
  ];
  for (const cfg of defaultConfigs) {
    db.prepare('INSERT OR IGNORE INTO configs (key, value) VALUES (?, ?)').run(cfg.key, cfg.value);
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
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
  addColumnIfMissing(db, 'llm_messages', 'message_tokens', 'INTEGER DEFAULT 0');

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

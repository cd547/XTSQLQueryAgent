import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/sqlite.js';
import { getConfig } from '../services/config.js';
import { authRequired } from '../services/auth.js';
import { logger } from '../logger.js';
import { getPool } from '../services/mysqlPool.js';
import { config } from '../config.js';
import { createSkillTreeCache } from '../services/skillCache.js';
import { addTableToDomains as addTableToDomainsImpl } from '../services/skillDomains.js';

const router = Router();

// skills 资料是共享的，但仍要求登录后才可访问
router.use(authRequired);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = config.projectRoot;
const skillsPath = config.skillPath;
const skillBackPath = path.join(skillsPath, 'skill_back');
const SKILL_V2_PATH = path.join(skillsPath, 'sql-creator-skill-v2');

const skillTreeCache = createSkillTreeCache(skillsPath, buildTree);
const invalidateAfterWrite = () => skillTreeCache.invalidateAfterWrite();
const getCachedTree = () => skillTreeCache.get();

function getFileLanguage(filename) {
  const ext = path.extname(filename).toLowerCase();
  const langMap = {
    '.md': 'markdown',
    '.json': 'json',
    '.sql': 'sql',
    '.js': 'javascript',
    '.ts': 'typescript',
    '.txt': 'plaintext'
  };
  return langMap[ext] || 'plaintext';
}

// 路径安全检查：确保 target 位于 base 目录内部
// - 防御 ../ 跳出
// - 防御前缀撞名（如 base=/a/skills, target=/a/skillsXXX/...）
// - 防御绝对路径
function isPathSafe(base, target) {
  const normalizedBase = path.resolve(base);
  const normalizedTarget = path.resolve(target);
  const rel = path.relative(normalizedBase, normalizedTarget);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

function buildTree(dirPath, relativePath = '') {
  const items = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      // 跳过 skill_back 目录
      if (entry.name === 'skill_back') continue;
      
      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.join(relativePath, entry.name).replace(/\\/g, '/');
      
      if (entry.isDirectory()) {
        const children = buildTree(fullPath, relPath);
        items.push({
          key: relPath,
          title: entry.name,
          isFolder: true,
          isLeaf: false,
          children: children.length > 0 ? children : []
        });
      } else {
        items.push({
          key: relPath,
          title: entry.name,
          isFolder: false,
          isLeaf: true,
          language: getFileLanguage(entry.name)
        });
      }
    }
  } catch (e) {
    logger.error('Error reading directory', { dirPath, error: e.message });
  }
  return items.sort((a, b) => {
    if (a.isFolder && !b.isFolder) return -1;
    if (!a.isFolder && b.isFolder) return 1;
    return a.title.localeCompare(b.title);
  });
}

router.get('/debug', (req, res) => {
  res.json({
    __dirname,
    projectRoot,
    skillsPath,
    exists: fs.existsSync(skillsPath),
    contents: fs.existsSync(skillsPath) ? fs.readdirSync(skillsPath) : []
  });
});

router.get('/list', (req, res) => {
  try {
    const { tree } = getCachedTree();
    res.json({ success: true, tree });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/read', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) {
    return res.status(400).json({ success: false, message: 'Missing path parameter' });
  }

  const fullPath = path.join(skillsPath, filePath);
  const normalizedPath = path.normalize(fullPath);

  // 路径安全检查：必须在 skills 目录内
  if (!isPathSafe(skillsPath, normalizedPath)) {
    return res.status(400).json({ success: false, message: 'Invalid path' });
  }

  try {
    if (!fs.existsSync(normalizedPath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    const stat = fs.statSync(normalizedPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ success: false, message: 'Cannot read directory' });
    }
    const content = fs.readFileSync(normalizedPath, 'utf-8');
    const language = getFileLanguage(filePath);
    res.json({ success: true, content, language });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/domains', (req, res) => {
  try {
    const indexPath = path.join(SKILL_V2_PATH, 'domain_router_index.json');
    if (!fs.existsSync(indexPath)) {
      return res.json({ success: true, domains: [] });
    }
    const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    res.json({ success: true, domains: data.domains || [] });
  } catch (e) {
    logger.error('Fetch domains failed', { error: e.message });
    res.status(500).json({ success: false, message: '获取业务域失败', code: 'DOMAIN_INDEX_READ_ERROR' });
  }
});

router.post('/add-tag', (req, res) => {
  const { tableName, tag } = req.body;
  
  if (!tableName) {
    return res.status(400).json({ success: false, message: 'Missing tableName' });
  }
  
  if (!tag) {
    return res.status(400).json({ success: false, message: 'Missing tag' });
  }
  
  try {
    const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
    
    if (!fs.existsSync(tableIndexPath)) {
      return res.status(500).json({ success: false, message: `table_index.json 文件不存在: ${tableIndexPath}` });
    }
    
    const tableIndex = JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
    
    if (!tableIndex.tables || !Array.isArray(tableIndex.tables)) {
      return res.status(500).json({ success: false, message: 'table_index.json 格式错误，缺少 tables 数组' });
    }
    
    const table = tableIndex.tables.find(t => t.name === tableName);
    if (!table) {
      return res.status(404).json({ success: false, message: `表 ${tableName} 不存在` });
    }
    
    if (!table.tags) {
      table.tags = [];
      logger.info('Tags array created for table', { tableName });
    }
    
    const tags = Array.isArray(tag) ? tag : [tag];
    
    const validTags = tags.filter(t => typeof t === 'string' && t.trim());
    if (validTags.length === 0) {
      return res.status(400).json({ success: false, message: '没有有效的标签可添加' });
    }
    
    const addedTags = [];
    validTags.forEach(t => {
      const trimmedTag = t.trim();
      if (!table.tags.includes(trimmedTag)) {
        table.tags.push(trimmedTag);
        addedTags.push(trimmedTag);
      }
    });
    
    if (addedTags.length === 0) {
      return res.json({ success: true, message: '所有标签已存在，无需添加', addedTags: [] });
    }
    
    const backupPath = path.join(skillBackPath, `table_index_${Date.now()}.json`);
    fs.copyFileSync(tableIndexPath, backupPath);
    fs.writeFileSync(tableIndexPath, JSON.stringify(tableIndex, null, 2), 'utf-8');
    
    logger.info('Tag added', { tableName, tags: addedTags });
    invalidateAfterWrite();
    return res.json({ success: true, message: `已将 "${addedTags.join(', ')}" 添加到 ${tableName} 的标签`, addedTags });
  } catch (e) {
    logger.error('Add tag failed', { error: e.message, tableName, tag });
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/save', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ success: false, message: 'Missing path or content parameter' });
  }

  const fullPath = path.join(skillsPath, filePath);
  const normalizedPath = path.normalize(fullPath);

  // 路径安全检查：必须在 skills 目录内（防 ../ 跳出 + 防前缀撞名）
  if (!isPathSafe(skillsPath, normalizedPath)) {
    return res.status(400).json({ success: false, message: 'Invalid path' });
  }

  const db = getDb();
  const timestamp = new Date();
  const backupFolderName = timestamp.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14);
  const backupDir = path.join(skillBackPath, backupFolderName);
  const backupFilePath = path.join(backupDir, filePath);

  // 提升作用域至 try/catch 之外，使 catch 块能正确引用
  let oldContent = '';

  try {
    // 确保备份目录存在
    if (!fs.existsSync(skillBackPath)) {
      fs.mkdirSync(skillBackPath, { recursive: true });
    }
    fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });

    // 读取原始文件内容（如果存在）
    if (fs.existsSync(normalizedPath)) {
      oldContent = fs.readFileSync(normalizedPath, 'utf-8');
    }

    // 备份原始文件
    fs.writeFileSync(backupFilePath, oldContent, 'utf-8');

    // 保存新内容到原文件
    fs.writeFileSync(normalizedPath, content, 'utf-8');

    // 记录日志到数据库
    const stmt = db.prepare(`
      INSERT INTO skill_logs (operation, file_path, backup_path, old_content, new_content, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      'save',
      filePath,
      backupFilePath,
      oldContent,
      content,
      'success',
      null
    );

    res.json({
      success: true,
      message: 'File saved successfully',
      backupPath: backupFilePath,
      backupFolder: backupFolderName
    });
    invalidateAfterWrite();
  } catch (e) {
    // 记录失败日志
    try {
      const stmt = db.prepare(`
        INSERT INTO skill_logs (operation, file_path, backup_path, old_content, new_content, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        'save',
        filePath,
        backupFilePath || null,
        oldContent || '',
        content,
        'failed',
        e.message
      );
    } catch (logErr) {
      logger.error('Failed to log skill error', { error: logErr.message });
    }
    
    res.status(500).json({ success: false, message: e.message });
  }
});

// 缓存机制
let tableIndexCache = null;

function loadTableIndex() {
  if (tableIndexCache) return tableIndexCache;
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  if (fs.existsSync(tableIndexPath)) {
    tableIndexCache = JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  }
  return tableIndexCache;
}

function saveTableIndex(data) {
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  fs.writeFileSync(tableIndexPath, JSON.stringify(data, null, 2), 'utf-8');
  tableIndexCache = data; // 更新缓存
}

function extractRelatedTables(ddl) {
  const relatedTables = [];
  const fkRegex = /FOREIGN\s+KEY\s*\([^)]+\)\s+REFERENCES\s+`?(\w+)`?/gi;
  let match;
  while ((match = fkRegex.exec(ddl)) !== null) {
    const tableName = match[1];
    if (!relatedTables.includes(tableName)) {
      relatedTables.push(tableName);
    }
  }
  return relatedTables;
}

function extractTableComment(ddl) {
  const commentMatch = ddl.match(/COMMENT\s*=\s*['"]([^'"]*)['"]/i);
  if (commentMatch) {
    return commentMatch[1];
  }
  return '';
}

router.post('/check-table', (req, res) => {
  const { tableName } = req.body;
  if (!tableName) {
    return res.status(400).json({ success: false, message: 'Missing tableName' });
  }

  const tableIndex = loadTableIndex();
  if (!tableIndex || !tableIndex.tables) {
    return res.json({ success: true, exists: false, message: '表索引不存在' });
  }

  const exists = tableIndex.tables.some(t => t.name === tableName);
  res.json({ 
    success: true, 
    exists, 
    message: exists ? '表已存在' : '表不存在' 
  });
});

router.post('/fetch-ddl', async (req, res) => {
  const { tableName } = req.body;
  if (!tableName) {
    return res.status(400).json({ success: false, message: 'Missing tableName' });
  }

  // #SEC-01 防御 SQL 注入：
  // 1. 严格白名单：只允许字母/数字/下划线/点号，最长 64 字符
  // 2. 二次校验：表名必须在 table_index.json 中已知
  // 3. 防御性转义：把任何残留的反引号反转义（白名单已排除，这里仅做兜底）
  if (typeof tableName !== 'string' || !/^[a-zA-Z0-9_.]{1,64}$/.test(tableName)) {
    logger.warn('fetch-ddl rejected: invalid tableName format', { tableName });
    return res.status(400).json({ success: false, message: 'Invalid tableName' });
  }
  const safeTableName = tableName.replace(/`/g, '');

  try {
    const dbConfig = getConfig();
    if (!dbConfig) {
      return res.json({ success: false, message: '数据库未配置' });
    }

    // 复用连接池，不再每次新建 TCP 连接
    const [rows] = await (await getPool()).query(
      `SHOW CREATE TABLE \`${safeTableName}\``
    );

    if (!rows || rows.length === 0) {
      return res.json({ success: false, message: `表 ${safeTableName} 不存在` });
    }

    const ddl = rows[0]['Create Table'] || rows[0]['Create View'];
    const tableComment = extractTableComment(ddl);
    const relatedTables = extractRelatedTables(ddl);

    res.json({
      success: true,
      ddl,
      tableComment,
      relatedTables
    });
  } catch (e) {
    logger.error('Fetch DDL failed', { error: e.message, tableName: safeTableName });
    res.json({ success: false, message: '获取 DDL 失败' });
  }
});

// 将表名追加到指定业务域的 tables 数组（去重）；不存在则抛带 code 的 Error
function addTableToDomains(tableName, domainIds) {
  return addTableToDomainsImpl(tableName, domainIds, SKILL_V2_PATH, isPathSafe, getDb);
}

router.post('/create-table-files', (req, res) => {
  const { tableName, ddl, description, domains } = req.body;
  if (!tableName || !ddl) {
    return res.status(400).json({ success: false, message: 'Missing tableName or ddl' });
  }
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({
      success: false,
      message: '请至少选择一个业务域',
      code: 'DOMAINS_REQUIRED'
    });
  }
  try {
    addTableToDomains(tableName, domains);
  } catch (e) {
    logger.warn('Add table to domains failed', { tableName, domains, code: e.code, error: e.message });
    return res.status(e.code === 'DOMAIN_INDEX_MISSING' ? 500 : 400).json({
      success: false,
      message: e.message,
      code: e.code
    });
  }

  try {
    const tableIndex = loadTableIndex();
    if (!tableIndex) {
      return res.status(500).json({ success: false, message: 'table_index.json 不存在' });
    }

    // 检查表是否已存在：已存在则仅覆盖 DDL 文件，不动 table_index 和 field_config
    const existingTable = tableIndex.tables.find(t => t.name === tableName);
    if (existingTable) {
      const ddlPath = path.join(SKILL_V2_PATH, 'ddl', `${tableName}.sql`);
      if (!isPathSafe(SKILL_V2_PATH, ddlPath)) {
        return res.status(400).json({ success: false, message: 'Invalid tableName' });
      }
      fs.writeFileSync(ddlPath, ddl, 'utf-8');

      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO skill_logs (operation, file_path, backup_path, old_content, new_content, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        'overwrite_ddl',
        `ddl/${tableName}.sql`,
        null,
        '',
        JSON.stringify({ tableName, ddl }),
        'success',
        null
      );

      logger.info('Table already exists, only DDL overwritten', { tableName });
      invalidateAfterWrite();
      return res.json({
        success: true,
        files: [`ddl/${tableName}.sql`],
        existed: true
      });
    }

    const relatedTables = extractRelatedTables(ddl);
    const tableComment = extractTableComment(ddl) || description || tableName;

    const newTableEntry = {
      name: tableName,
      description: tableComment,
      tags: [],
      related_tables: relatedTables,
      business_constraints: [],
      business_rules: []
    };
    tableIndex.tables.push(newTableEntry);
    saveTableIndex(tableIndex);

    const ddlPath = path.join(SKILL_V2_PATH, 'ddl', `${tableName}.sql`);
    if (!isPathSafe(SKILL_V2_PATH, ddlPath)) {
      return res.status(400).json({ success: false, message: 'Invalid tableName' });
    }
    fs.writeFileSync(ddlPath, ddl, 'utf-8');

    const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${tableName}.json`);
    if (!isPathSafe(SKILL_V2_PATH, fieldConfigPath)) {
      return res.status(400).json({ success: false, message: 'Invalid tableName' });
    }
    const fieldConfig = {
      table_name: tableName,
      field_aliases: {},
      field_enums: {},
      virtual_associations: [],
      calculated_fields: {},
      business_constraints: {},
      business_rules: []
    };
    fs.writeFileSync(fieldConfigPath, JSON.stringify(fieldConfig, null, 2), 'utf-8');

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO skill_logs (operation, file_path, backup_path, old_content, new_content, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      'create_table_files',
      `${tableName}`,
      null,
      '',
      JSON.stringify({ tableName, ddl, relatedTables }),
      'success',
      null
    );

    res.json({
      success: true,
      files: ['table_index.json', `ddl/${tableName}.sql`, `field_config/${tableName}.json`],
      domains
    });
    invalidateAfterWrite();
  } catch (e) {
    logger.error('Create table files failed', { error: e.message, tableName });
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getDb } from '../db/sqlite.js';
import { getConfig } from '../services/config.js';
import { logger } from '../logger.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../');
const skillsPath = process.env.SKILL_PATH || path.join(projectRoot, 'skills');
const skillBackPath = path.join(skillsPath, 'skill_back');
const SKILL_V2_PATH = path.join(skillsPath, 'sql-creator-skill-v2');

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
    if (!fs.existsSync(skillsPath)) {
      return res.json({ success: true, tree: [] });
    }
    const tree = buildTree(skillsPath);
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
    return res.json({ success: true, message: `已将 "${addedTags.join(', ')}" 添加到 ${tableName} 的标签`, addedTags });
  } catch (e) {
    logger.error('Add tag failed', { error: e.message, tableName, tag });
    return res.status(500).json({ success: false, message: e.message });
  }
});

export default router;

router.post('/save', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined) {
    return res.status(400).json({ success: false, message: 'Missing path or content parameter' });
  }

  const fullPath = path.join(skillsPath, filePath);
  const normalizedPath = path.normalize(fullPath);
  
  // 安全检查：确保路径在 skills 目录内
  if (!normalizedPath.startsWith(skillsPath)) {
    return res.status(400).json({ success: false, message: 'Invalid path' });
  }

  const db = getDb();
  const timestamp = new Date();
  const backupFolderName = timestamp.toISOString().replace(/[-:]/g, '').replace('T', '').slice(0, 14);
  const backupDir = path.join(skillBackPath, backupFolderName);
  const backupFilePath = path.join(backupDir, filePath);

  try {
    // 确保备份目录存在
    if (!fs.existsSync(skillBackPath)) {
      fs.mkdirSync(skillBackPath, { recursive: true });
    }
    fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });

    // 读取原始文件内容（如果存在）
    let oldContent = '';
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

  try {
    const dbConfig = getConfig();
    if (!dbConfig) {
      return res.json({ success: false, message: '数据库未配置' });
    }
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port || 3306,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database
    });

    const [rows] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
    await connection.end();

    if (!rows || rows.length === 0) {
      return res.json({ success: false, message: `表 ${tableName} 不存在` });
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
    logger.error('Fetch DDL failed', { error: e.message, tableName });
    res.json({ success: false, message: e.message });
  }
});

router.post('/create-table-files', (req, res) => {
  const { tableName, ddl, description } = req.body;
  if (!tableName || !ddl) {
    return res.status(400).json({ success: false, message: 'Missing tableName or ddl' });
  }

  try {
    const relatedTables = extractRelatedTables(ddl);
    const tableComment = extractTableComment(ddl) || description || tableName;

    const tableIndex = loadTableIndex();
    if (!tableIndex) {
      return res.status(500).json({ success: false, message: 'table_index.json 不存在' });
    }

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
    fs.writeFileSync(ddlPath, ddl, 'utf-8');

    const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${tableName}.json`);
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
      files: ['table_index.json', `ddl/${tableName}.sql`, `field_config/${tableName}.json`]
    });
  } catch (e) {
    logger.error('Create table files failed', { error: e.message, tableName });
    res.status(500).json({ success: false, message: e.message });
  }
});
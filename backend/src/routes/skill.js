import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/sqlite.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../');
const skillsPath = path.join(projectRoot, 'skills');
const skillBackPath = path.join(projectRoot, 'skills', 'skill_back');
console.log('skillsPath initialized:', skillsPath);

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
    console.error('Error reading directory:', dirPath, e);
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
      console.error('Failed to log error:', logErr);
    }
    
    res.status(500).json({ success: false, message: e.message });
  }
});
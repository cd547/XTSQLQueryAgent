import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../');
const skillsPath = path.join(projectRoot, 'skills');
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
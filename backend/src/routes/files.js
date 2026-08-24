/**
 * DeepSeek Files API 路由
 *   POST   /api/files/upload   - 上传文件（multipart/form-data, field=file）
 *   GET    /api/files          - 列出本用户可见的文件
 *   DELETE /api/files/:id      - 删除文件
 *
 * 鉴权：全部走 authRequired；上传/列表/删除均允许普通用户。
 *   - 文件归属于 LLM API Key（共享），不做 per-user 隔离（与 DeepSeek 行为一致）
 *   - 限流复用现有的通用限流中间件
 *
 * Multer 配置：
 *   - memory storage：直接拿到 buffer，节省磁盘 IO
 *   - 64 MiB 上限（与 DeepSeek 对齐）；前端另行按 user-config 二次校验给 UX 提示
 *   - fileFilter：mimetype 白名单，不在白名单直接拒绝
 */
import { Router } from 'express';
import multer from 'multer';
import { authRequired } from '../services/auth.js';
import { uploadFile, listFiles, deleteFile, validateUpload } from '../services/files.js';
import { getFilesConfig } from '../services/config.js';
import { logger } from '../logger.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = Router();
router.use(authRequired);

// Multer 单文件上传配置（基于 agent_files_config 动态调整上限）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // 硬上限 64 MiB（DeepSeek 限制），multer 自身会拒收更大的请求
    fileSize: 64 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const config = getFilesConfig();
    if (config.allowedTypes.includes((file.mimetype || '').toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型：${file.mimetype || '未知'}`));
    }
  },
});

// 上传：multer 单文件 + 二次校验 + DeepSeek 代理
router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // multer 错误：file too large / unexpected field 等
      logger.warn('Multer rejected upload', { error: err.message, code: err.code });
      return res.status(400).json({ error: err.message, code: err.code || 'UPLOAD_REJECTED' });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  const check = validateUpload(req.file);
  if (!check.ok) {
    return res.status(400).json({ error: check.message, code: check.code });
  }
  const result = await uploadFile(req.file);
  res.json({
    success: true,
    file: {
      id: result.id,
      filename: result.filename,
      bytes: result.bytes,
      created_at: result.created_at,
      purpose: result.purpose,
      expires_at: result.expires_at,
    },
  });
}));

// 列表
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit, 10) || 100));
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  const files = await listFiles({ limit, order });
  res.json({ success: true, files });
}));

// 删除
router.delete('/:id', asyncHandler(async (req, res) => {
  try {
    const result = await deleteFile(req.params.id);
    res.json({ success: true, result });
  } catch (e) {
    // INVALID_ID（白名单不过）→ 400；其他错误 → 500
    if (e?.code === 'INVALID_ID') {
      return res.status(400).json({ error: e.message, code: 'INVALID_ID' });
    }
    throw e;
  }
}));

export default router;

/**
 * DeepSeek Files API 路由
 *   POST   /api/files/upload         - 上传文件（multipart/form-data, field=file）
 *   GET    /api/files                - 列出本用户可见的文件
 *   GET    /api/files/:id/content    - 下载文件二进制（用于历史图片回显）
 *   DELETE /api/files/:id            - 删除文件
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
import { uploadFile, listFiles, deleteFile, downloadFile, validateUpload, DEEPSEEK_BASE, getApiKey } from '../services/files.js';
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

// 下载文件二进制（代理 DeepSeek /files/{id}/content）
//   - 用途：用户上传后只在本地缓存缩略图，跨页面/刷新后 blobURL 失效，
//     历史回看时按需从 DeepSeek 拉回原图
//   - 响应：原图二进制 + 对应 Content-Type
//   - 错误：INVALID_ID → 400；NOT_FOUND（DeepSeek 404）→ 404；其他 → 500
router.get('/:id/content', asyncHandler(async (req, res) => {
  try {
    const { contentType, buffer } = await downloadFile(req.params.id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    // 浏览器可缓存 1 天（图片通常不会变；DeepSeek 端以 file_id 为 key）
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(buffer);
  } catch (e) {
    if (e?.code === 'INVALID_ID') {
      return res.status(400).json({ error: e.message, code: 'INVALID_ID' });
    }
    if (e?.code === 'NOT_FOUND') {
      return res.status(404).json({ error: e.message, code: 'NOT_FOUND' });
    }
    throw e;
  }
}));

// ★ 2026-08-25 诊断：list vs content 一致性
//   - 现象：list 还能看到 file，但 /files/{id}/content 404
//   - 假设：DeepSeek content 保留期 < metadata 保留期（典型云存储设计）
//   - 验证：并行调 list + content 两次，把 status/body 都返回
//   - 仅 admin 可用
router.get('/_diagnose/:id', asyncHandler(async (req, res) => {
  const apiKey = getApiKey();
  const fileId = req.params.id;
  if (!/^file-api-[A-Za-z0-9-]+$/.test(fileId)) {
    return res.status(400).json({ error: '非法的 file_id' });
  }
  const headers = { 'Authorization': `Bearer ${apiKey}` };
  const [listResp, contentResp, retrieveResp] = await Promise.all([
    fetch(`${DEEPSEEK_BASE}/files?purpose=user_data&limit=200`, { headers }),
    fetch(`${DEEPSEEK_BASE}/files/${fileId}/content`, { headers }),
    fetch(`${DEEPSEEK_BASE}/files/${fileId}`, { headers }),
  ]);
  const listData = await listResp.json().catch(() => null);
  const retrieveData = await retrieveResp.json().catch(() => null);
  const contentType = contentResp.headers.get('content-type');
  const contentLength = contentResp.headers.get('content-length');
  let contentPreview = null;
  if (contentResp.ok) {
    const buf = Buffer.from(await contentResp.arrayBuffer());
    contentPreview = { bytes: buf.length, firstBytes: buf.slice(0, 16).toString('hex') };
  } else {
    contentPreview = await contentResp.text().catch(() => '').then(t => t.slice(0, 500));
  }
  const inList = listData?.data?.some(f => f.id === fileId) || false;
  const inListInfo = listData?.data?.find(f => f.id === fileId) || null;
  res.json({
    fileId,
    inList,
    inListInfo,
    retrieveStatus: retrieveResp.status,
    retrieveData,
    contentStatus: contentResp.status,
    contentType,
    contentLength,
    contentPreview,
    listFileCount: listData?.data?.length,
    listFirstId: listData?.first_id,
    listLastId: listData?.last_id,
  });
}));

export default router;

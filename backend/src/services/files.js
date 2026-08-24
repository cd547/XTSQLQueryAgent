/**
 * DeepSeek Files API 代理
 *
 * 文档：
 *  - 总览：https://api-docs.deepseek.com/zh-cn/guides/files_api
 *  - 上传：POST /files (multipart/form-data)
 *  - 列表：GET  /files
 *  - 详情：GET  /files/{id}
 *  - 删除：DELETE /files/{id}
 *
 * 设计要点：
 *  - 仅代理当前管理员配置的 LLM API Key（getLlmConfig），不暴露明文 key
 *  - 上传前强校验白名单 + 大小（后端为权威，前端 accept 仅作 UX 提示）
 *  - 上传流式直传 DeepSeek，避免把大文件落本地盘
 *  - DeepSeek 返回的 id 形如 "file-api-xxxxxxxxxxxxxxxx"，原样回给前端
 */
import FormData from 'form-data';
import { getLlmConfig, getFilesConfig } from './config.js';
import { logger } from '../logger.js';

const DEEPSEEK_BASE = 'https://api.deepseek.com';

function getApiKey() {
  const cfg = getLlmConfig();
  if (!cfg || !cfg.apiKey) {
    const err = new Error('未配置 DeepSeek API Key');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return cfg.apiKey;
}

function buildFormFromBuffer({ buffer, filename, contentType, expiresAfterSeconds }) {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType });
  form.append('purpose', 'user_data');
  if (Number.isFinite(expiresAfterSeconds)) {
    // DeepSeek 字段：expires_after[anchor]=created_at & expires_after[seconds]=<int>
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', String(expiresAfterSeconds));
  }
  return form;
}

/**
 * 校验上传文件（白名单 + 大小）。
 * @param {object} file - multer file 对象 { buffer, mimetype, originalname, size }
 * @returns {{ok: true, config} | {ok: false, code, message}}
 */
export function validateUpload(file) {
  if (!file) {
    return { ok: false, code: 'NO_FILE', message: '未收到文件' };
  }
  const config = getFilesConfig();
  const mt = (file.mimetype || '').toLowerCase();
  if (!config.allowedTypes.includes(mt)) {
    return {
      ok: false,
      code: 'TYPE_NOT_ALLOWED',
      message: `不支持的文件类型：${mt || '未知'}（允许：${config.allowedTypes.join(', ')}）`,
    };
  }
  const maxBytes = config.maxSizeMiB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `文件大小 ${(file.size / 1024 / 1024).toFixed(2)} MiB 超过上限 ${config.maxSizeMiB} MiB`,
    };
  }
  return { ok: true, config };
}

/**
 * 上传文件到 DeepSeek Files API。
 * @param {object} file - multer file
 * @returns {Promise<{id, filename, bytes, created_at, purpose, expires_at?}>}
 */
export async function uploadFile(file) {
  const apiKey = getApiKey();
  const { config } = validateUpload(file);
  const form = buildFormFromBuffer({
    buffer: file.buffer,
    filename: file.originalname,
    contentType: file.mimetype,
    expiresAfterSeconds: config.expiresAfterSeconds,
  });

  const resp = await fetch(`${DEEPSEEK_BASE}/files`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form.getBuffer(),
  });

  const text = await resp.text();
  if (!resp.ok) {
    logger.error('DeepSeek files.upload failed', { status: resp.status, body: text.slice(0, 500) });
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const err = new Error(parsed?.error?.message || `DeepSeek files.upload 失败：HTTP ${resp.status}`);
    err.code = parsed?.error?.type || 'UPLOAD_FAILED';
    err.status = resp.status;
    throw err;
  }
  return JSON.parse(text);
}

export async function listFiles({ limit = 100, order = 'desc' } = {}) {
  const apiKey = getApiKey();
  const url = new URL(`${DEEPSEEK_BASE}/files`);
  url.searchParams.set('purpose', 'user_data');
  url.searchParams.set('limit', String(Math.max(1, Math.min(1000, limit))));
  url.searchParams.set('order', order);

  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  if (!resp.ok) {
    logger.error('DeepSeek files.list failed', { status: resp.status, body: text.slice(0, 500) });
    throw new Error(`DeepSeek files.list 失败：HTTP ${resp.status}`);
  }
  const data = JSON.parse(text);
  return Array.isArray(data?.data) ? data.data : [];
}

export async function deleteFile(fileId) {
  if (!fileId || !/^file-api-[A-Za-z0-9-]+$/.test(fileId)) {
    const err = new Error('非法的 file_id');
    err.code = 'INVALID_ID';
    throw err;
  }
  const apiKey = getApiKey();
  const resp = await fetch(`${DEEPSEEK_BASE}/files/${fileId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  if (!resp.ok) {
    logger.error('DeepSeek files.delete failed', { status: resp.status, fileId, body: text.slice(0, 500) });
    throw new Error(`DeepSeek files.delete 失败：HTTP ${resp.status}`);
  }
  return JSON.parse(text);
}

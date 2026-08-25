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
 *
 * ★ 2026-08-25 A6：本地文件缓存
 *   - 痛点：DeepSeek Files API 即使 `expiresAfterSeconds=null`，服务端仍有保留期
 *     上限（实测 7 天级别），过期后 GET /files/{id}/content 返回 404，
 *     历史会话里上传的图片全部无法回显。
 *   - 解法：上传成功后立即把 buffer 落盘到 backend/file_cache/，
 *     downloadFile 优先读本地 → 没有再走 DeepSeek。本地副本不受 DeepSeek 过期影响。
 *   - 旧历史文件（缓存功能上线前上传的）无法恢复，DeepSeek 那边的副本已经没了。
 *   - 缓存目录：backend/file_cache/（启动时 ensureDir 创建，不进 git）
 */
import FormData from 'form-data';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLlmConfig, getFilesConfig } from './config.js';
import { getDb } from '../db/sqlite.js';
import { logger } from '../logger.js';
import { ensureDir } from '../utils/fs.js';

const DEEPSEEK_BASE = 'https://api.deepseek.com';
// 导出供 /_diagnose 路由用
export { DEEPSEEK_BASE };

// ★ 2026-08-25 A6：本地缓存目录
//   - 与 multer / DeepSeek 无关，是给前端 GET /files/{id}/content 提供"持久副本"的兜底层
//   - 文件命名：<file_id>（file_id 已经过 [A-Za-z0-9-]+ 白名单校验，可直接当文件名）
//   - 关联 mimetype 单独存 <file_id>.meta.json（避免靠 mimetype 猜扩展名导致无法区分 jpg/jpeg/png 等）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FILE_CACHE_DIR = join(__dirname, '..', '..', 'file_cache');

/**
 * 确保缓存目录存在。server 启动时调一次（index.js）。
 */
export function ensureFileCacheDir() {
  ensureDir(FILE_CACHE_DIR, 'file_cache');
}

/**
 * 根据 file_id 拿到本地缓存路径（不存在则返回 null）。
 * 存两份：
 *   - <id>            —— 原始 buffer
 *   - <id>.meta.json  —— { contentType, savedAt, bytes }
 */
function readCache(fileId) {
  const bufPath = join(FILE_CACHE_DIR, fileId);
  const metaPath = `${bufPath}.meta.json`;
  if (!existsSync(bufPath) || !existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const buffer = readFileSync(bufPath);
    return { contentType: meta.contentType, buffer };
  } catch (e) {
    logger.warn('file_cache read failed', { fileId, error: e.message });
    return null;
  }
}

function writeCache(fileId, contentType, buffer) {
  try {
    const bufPath = join(FILE_CACHE_DIR, fileId);
    const metaPath = `${bufPath}.meta.json`;
    writeFileSync(bufPath, buffer);
    writeFileSync(metaPath, JSON.stringify({
      contentType,
      bytes: buffer.length,
      savedAt: new Date().toISOString(),
    }));
  } catch (e) {
    // 缓存写失败不应阻塞主流程；log warn 即可
    logger.warn('file_cache write failed', { fileId, error: e.message });
  }
}

function removeCache(fileId) {
  try {
    const bufPath = join(FILE_CACHE_DIR, fileId);
    const metaPath = `${bufPath}.meta.json`;
    if (existsSync(bufPath)) unlinkSync(bufPath);
    if (existsSync(metaPath)) unlinkSync(metaPath);
  } catch (e) {
    logger.warn('file_cache remove failed', { fileId, error: e.message });
  }
}

// ★ 2026-08-25 A10 v2：本地副本 + DB 路径索引
//   背景：DeepSeek `user_data` purpose 的 content 端点永远是 404（即使是刚上传的文件）
//     A6 磁盘缓存只能服务"上线后上传的文件"，旧历史文件无法恢复
//   解法：上传成功后立即把 buffer 落盘到 backend/file_cache/<file_id>（A6 复用），
//     DB file_storage 表只存 file_id → file_path 的映射 + 元数据
//     - 二进制不进 DB（避免 BLOB 膨胀）
//     - DB 是路径索引，readStorage 命中后按 file_path 读磁盘
//     - 删除时同步清 DB 记录 + 磁盘文件
//     - 读取优先级：DB 路径索引 → 磁盘兜底（A6 期间上传的文件可能没有 DB 记录） → DeepSeek
function readStorage(fileId) {
  try {
    const row = getDb().prepare('SELECT file_path, mimetype FROM file_storage WHERE file_id = ?').get(fileId);
    if (!row) return null;
    if (!existsSync(row.file_path)) {
      // 索引还在但文件没了 → 当作未命中，让上层走兜底
      logger.warn('file_storage path missing on disk', { fileId, filePath: row.file_path });
      return null;
    }
    const buffer = readFileSync(row.file_path);
    return { contentType: row.mimetype || 'application/octet-stream', buffer };
  } catch (e) {
    logger.warn('file_storage read failed', { fileId, error: e.message });
    return null;
  }
}

function writeStorage(fileId, contentType, buffer) {
  try {
    const filePath = join(FILE_CACHE_DIR, fileId);
    // 1) 写磁盘（A6 目录，二进制落这里）
    writeFileSync(filePath, buffer);
    // 2) DB 仅记录路径 + 元数据（无 BLOB）
    getDb().prepare(
      'INSERT OR REPLACE INTO file_storage (file_id, file_path, mimetype, bytes, saved_at) VALUES (?, ?, ?, ?, ?)'
    ).run(fileId, filePath, contentType || 'application/octet-stream', buffer.length, new Date().toISOString());
  } catch (e) {
    // 副本写失败不应阻塞主流程（DeepSeek 上传已成功），log warn 即可
    logger.warn('file_storage write failed', { fileId, error: e.message });
  }
}

function removeStorage(fileId) {
  try {
    // 1) 拿路径，删磁盘文件
    const row = getDb().prepare('SELECT file_path FROM file_storage WHERE file_id = ?').get(fileId);
    if (row?.file_path && existsSync(row.file_path)) {
      unlinkSync(row.file_path);
    }
    // 2) DB 记录删除
    getDb().prepare('DELETE FROM file_storage WHERE file_id = ?').run(fileId);
  } catch (e) {
    logger.warn('file_storage remove failed', { fileId, error: e.message });
  }
}

function getApiKey() {
  const cfg = getLlmConfig();
  if (!cfg || !cfg.apiKey) {
    const err = new Error('未配置 DeepSeek API Key');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return cfg.apiKey;
}
// 导出供 /_diagnose 路由用
export { getApiKey };

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
  const result = JSON.parse(text);
  // ★ 2026-08-25 A10 v2：上传成功后立即把 buffer 存到本地（DeepSeek content 端点永远 404）
  //   - multer 还在内存里，buffer 现成，不需要再向 DeepSeek 拉一次
  //   - writeStorage 自包含：写磁盘 + INSERT DB 路径索引
  //   - 写失败不阻塞主流程（DeepSeek 上传已成功，log warn 即可）
  if (result?.id && file.buffer) {
    const mimetype = file.mimetype || 'application/octet-stream';
    writeStorage(result.id, mimetype, file.buffer);
  }
  return result;
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
  // ★ 2026-08-25 A10 v2：同步清理本地副本（DB 索引 + 磁盘文件）
  //   - removeStorage 自包含：按 DB 里的 file_path 删文件 + DELETE 记录
  //   - 删除后历史会话指向该 file_id 会落到 404（DB/磁盘都没了）
  removeStorage(fileId);
  return JSON.parse(text);
}

/**
 * 下载 file 二进制内容。
 *
 * ★ 2026-08-25 A10 v2：读取优先级
 *   1. DB file_storage 路径索引（命中后按 file_path 读磁盘，永远可用）
 *   2. 磁盘 file_cache（A6 期间上传但 A10 上线前没有 DB 索引的旧文件兜底）
 *   3. DeepSeek /files/{id}/content（永远是 404，但保留以防 DeepSeek 行为变化）
 *
 * 历史回显：用户切换会话/刷新页面后，blobURL 失效 → 调本接口拉回原图。
 *
 * 返回：{ contentType, buffer }
 * 错误：
 *   - INVALID_ID：file_id 不符合 ^file-api-[A-Za-z0-9-]+$ 白名单
 *   - NOT_FOUND：DB/磁盘/DeepSeek 三层都没命中
 */
export async function downloadFile(fileId) {
  if (!fileId || !/^file-api-[A-Za-z0-9-]+$/.test(fileId)) {
    const err = new Error('非法的 file_id');
    err.code = 'INVALID_ID';
    throw err;
  }
  // 1) DB 路径索引优先（命中后按 file_path 读磁盘）
  const stored = readStorage(fileId);
  if (stored) {
    return stored;
  }
  // 2) 磁盘兜底（A6 期间上传的文件可能没有 DB 索引）
  const cached = readCache(fileId);
  if (cached) {
    // 顺手补 DB 索引，下次走 DB 路径
    writeStorage(fileId, cached.contentType, cached.buffer);
    return cached;
  }
  // 3) DeepSeek content（目前永远是 404，但保留兼容）
  const apiKey = getApiKey();
  const resp = await fetch(`${DEEPSEEK_BASE}/files/${fileId}/content`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    logger.error('DeepSeek files.content failed', { status: resp.status, fileId, body: text.slice(0, 500) });
    if (resp.status === 404) {
      const err = new Error('文件不存在或已过期（请重新上传）');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }
    throw new Error(`DeepSeek files.content 失败：HTTP ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  // 顺手写本地：writeStorage 自包含（磁盘 + DB 路径索引）
  writeStorage(fileId, contentType, buffer);
  return { contentType, buffer };
}

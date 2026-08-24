/**
 * useFileUpload Hook
 *
 * 封装 DeepSeek Files API 的上传/列表/删除状态机。
 *
 * 设计要点：
 *  - uploadedFiles: 全局（跨会话）已上传文件列表，由 App.jsx 持 state + setState
 *  - uploadingFiles: 正在上传中的任务（带 progress，可取消）
 *  - 拉取后端 /files 时注意限流：进入登录态 + chat 页加载时各拉一次即可，避免拉满带宽
 *  - 上传过程错误用 antd message 直接弹（不抛到业务）
 *  - 删除本地 state 即视为删除，不等后端成功（乐观更新；后端 4xx 才回滚）
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { message } from 'antd';
import {
  uploadFileWithProgress,
  listFiles,
  deleteFileApi,
  getFilesConfig,
} from '../api';

export function useFileUpload() {
  // 已上传文件（DeepSeek 返回的 metadata）
  const [uploadedFiles, setUploadedFiles] = useState([]);
  // 正在上传的任务：{ tempId, name, size, progress, controller }
  const [uploadingFiles, setUploadingFiles] = useState([]);
  // 后端返回的 allowlist（前端按钮的 accept 字符串同步生成）
  const [filesConfig, setFilesConfig] = useState({
    allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSizeMiB: 64,
    expiresAfterSeconds: null,
  });

  // 初始拉取：登录态生效时拉一次 config + list
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await getFilesConfig();
        if (mounted) setFilesConfig(cfg);
      } catch { /* 用默认 */ }
      try {
        const data = await listFiles({ limit: 100, order: 'desc' });
        if (mounted && data && Array.isArray(data.files)) {
          setUploadedFiles(data.files.map(f => normalize(f)));
        }
      } catch { /* 静默 */ }
    })();
    return () => { mounted = false; };
  }, []);

  // 上传单个文件
  const uploadFile = useCallback(async (file) => {
    if (!file) return null;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    setUploadingFiles(prev => [
      ...prev,
      { tempId, name: file.name, size: file.size, progress: 0, controller },
    ]);
    try {
      const result = await uploadFileWithProgress(file, {
        signal: controller.signal,
        onProgress: (pct) => {
          setUploadingFiles(prev => prev.map(u => u.tempId === tempId ? { ...u, progress: pct } : u));
        },
      });
      const normalized = normalize(result);
      setUploadedFiles(prev => [normalized, ...prev.filter(f => f.id !== normalized.id)]);
      return normalized;
    } catch (e) {
      if (e?.code !== 'ABORTED') {
        message.error(e?.message || '上传失败');
      }
      return null;
    } finally {
      setUploadingFiles(prev => prev.filter(u => u.tempId !== tempId));
    }
  }, []);

  // 取消上传
  const cancelUpload = useCallback((tempId) => {
    setUploadingFiles(prev => {
      const target = prev.find(u => u.tempId === tempId);
      if (target) target.controller.abort();
      return prev.filter(u => u.tempId !== tempId);
    });
  }, []);

  // 删除已上传文件
  const removeFile = useCallback(async (fileId) => {
    const prev = uploadedFiles;
    setUploadedFiles(prev.filter(f => f.id !== fileId));  // 乐观更新
    try {
      await deleteFileApi(fileId);
    } catch (e) {
      message.error(e?.message || '删除失败');
      setUploadedFiles(prev);  // 回滚
    }
  }, [uploadedFiles]);

  // 刷新列表（用于删除后/其他客户端上传后重新同步）
  const refreshFiles = useCallback(async () => {
    try {
      const data = await listFiles({ limit: 100, order: 'desc' });
      if (data && Array.isArray(data.files)) {
        setUploadedFiles(data.files.map(f => normalize(f)));
      }
    } catch { /* 静默 */ }
  }, []);

  return {
    uploadedFiles,
    uploadingFiles,
    filesConfig,
    uploadFile,
    cancelUpload,
    removeFile,
    refreshFiles,
  };
}

function normalize(f) {
  if (!f) return null;
  return {
    id: f.id,
    filename: f.filename,
    bytes: f.bytes,
    created_at: f.created_at,
    purpose: f.purpose,
    expires_at: f.expires_at,
  };
}

/**
 * useFileUpload Hook
 *
 * 封装 DeepSeek Files API 的上传/列表/删除状态机 + 视觉选择管理。
 *
 * 设计要点：
 *  - uploadedFiles: 全局（跨会话）已上传文件列表，由 App.jsx 持 state + setState
 *  - uploadingFiles: 正在上传中的任务（带 progress，可取消）
 *  - selectedFileIds: 本次发送要使用的 file_id 子集（Set），发完由 App.jsx 调 clearSelected
 *  - blobUrlMap: file_id → objectURL 的 React state（不是 ref，触发重渲）
 *    - 写时机：① 上传成功（createObjectURL 本地 File）
 *             ② getBlobUrl() 拉取历史图（fetchFileContent → blob → createObjectURL）
 *    - 读时机：ChatInput picker、ChatMessage 消息气泡内的 <img>
 *  - getBlobUrl(fileId)：懒加载接口
 *    - 命中 map → 立即返回
 *    - 未命中 → 调 fetchFileContent（后端代理拉 DeepSeek）→ createObjectURL → 写 map
 *    - inflightRef 去重：同一 fileId 并发只发 1 个请求
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
  fetchFileContent,
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
  // ★ 2026-08-24 vision：本次发送要用的 file_id 子集
  //   - 默认空集（不会自动选中，避免"上传即发送"误操作）
  //   - 上传成功后自动 add；用户点 chip 可 toggle；removeFile 时同步 delete
  const [selectedFileIds, setSelectedFileIds] = useState(() => new Set());
  // ★ 2026-08-24 vision：file_id → 本地 objectURL（缩略图缓存）
  //   - 用 useState 而非 useRef：写 map 时自动触发依赖此 state 的组件重渲
  //   - 上传时一次性 createObjectURL，历史回看时按需 fetchFileContent 后 createObjectURL
  //   - 组件卸载时全量 revoke
  const [blobUrlMap, setBlobUrlMap] = useState(() => new Map());
  // inflight 拉取去重：同一 fileId 并发只发 1 个请求
  const inflightRef = useRef(new Map());

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

  // ★ 组件卸载时清理所有 blobURL，避免内存泄漏
  useEffect(() => {
    const map = blobUrlMap;
    return () => {
      map.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      });
      map.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ vision 内部辅助：写 blobURL 进 map
  const setBlobUrl = useCallback((fileId, url) => {
    setBlobUrlMap(prev => {
      // 防止重复 set 同一 url 触发 re-render
      if (prev.get(fileId) === url) return prev;
      const next = new Map(prev);
      next.set(fileId, url);
      return next;
    });
  }, []);

  // ★ vision：懒加载 file_id 对应的 blobURL
  //   - 命中缓存立即返回 url
  //   - 未命中 → fetch 后端代理（DeepSeek /files/{id}/content）→ createObjectURL → 写缓存 → 返回
  //   - 错误（400/404/网络）→ 返回 {error: code, message}，调用方按 code 区分渲染
  //   - 并发去重：同 fileId 同时多次调用只发 1 个请求
  // ★ 2026-08-25 A6：返回值改为对象 {url?, error?, message?}
  //   - error: 'NOT_FOUND' | 'INVALID_ID' | 'NETWORK' | 'UNKNOWN'
  //   - 旧：返回 url | null（前端无法区分"过期"和"网络失败"）
  //   - 新：返回结构化对象，前端可针对 404 单独提示"图片已失效"
  const getBlobUrl = useCallback(async (fileId) => {
    if (!fileId) return { error: 'INVALID_ID', message: '非法的 file_id' };
    // 1) 命中缓存
    const cached = blobUrlMap.get(fileId);
    if (cached) return { url: cached };
    // 2) inflight 去重
    const inflight = inflightRef.current.get(fileId);
    if (inflight) return inflight;
    // 3) 新拉
    const p = (async () => {
      try {
        const blob = await fetchFileContent(fileId);
        const url = URL.createObjectURL(blob);
        setBlobUrl(fileId, url);
        return { url };
      } catch (e) {
        // ★ 区分错误码：axios 拦截器会包成 error.response.data.code
        const code = e?.response?.data?.code || e?.code || 'NETWORK';
        const message = e?.response?.data?.error || e?.message || '加载失败';
        return { error: code, message };
      } finally {
        inflightRef.current.delete(fileId);
      }
    })();
    inflightRef.current.set(fileId, p);
    return p;
  }, [blobUrlMap, setBlobUrl]);

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
      // ★ vision：上传成功后自动加入"本次发送选择"
      setSelectedFileIds(prev => {
        const next = new Set(prev);
        next.add(normalized.id);
        return next;
      });
      // ★ vision：图片类型才生成缩略图（DeepSeek 限定 JPEG/PNG/GIF/WebP，均为 image/*）
      if (file.type && file.type.startsWith('image/')) {
        try {
          const url = URL.createObjectURL(file);
          setBlobUrl(normalized.id, url);
        } catch { /* 缩略图失败不影响主流程 */ }
      }
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
  }, [setBlobUrl]);

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
    // ★ vision：清理本地 blobURL
    setBlobUrlMap(prev => {
      const url = prev.get(fileId);
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
      if (!prev.has(fileId)) return prev;
      const next = new Map(prev);
      next.delete(fileId);
      return next;
    });
    // ★ vision：从 selected 中移除
    setSelectedFileIds(prev => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
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

  // ★ vision：切换某个文件的选中状态
  const toggleSelectFile = useCallback((fileId) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  // ★ vision：清空选中（App.jsx 在 meta 事件后调，确保 LLM 已接受请求）
  const clearSelected = useCallback(() => {
    setSelectedFileIds(new Set());
  }, []);

  return {
    uploadedFiles,
    uploadingFiles,
    filesConfig,
    selectedFileIds,       // Set<string>
    blobUrlMap,            // ★ Map<file_id, objectURL>（React state，触发重渲）
    getBlobUrl,            // ★ 懒加载历史图
    uploadFile,
    cancelUpload,
    removeFile,
    refreshFiles,
    toggleSelectFile,      // ★
    clearSelected,         // ★
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

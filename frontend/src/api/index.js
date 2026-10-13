import axios from 'axios';
import { message } from 'antd';

const isElectron = window.location.protocol === 'file:';

// ===== 鸿蒙平板壳（ArkWeb）旁路分支：不影响 web / electron 现有行为 =====
// 壳通过 resource://rawfile/web/index.html 加载本地打包前端，协议为 resource:；
// 壳侧同时注入 window.__XTSQL_TABLET__ = true 作双重标记。
// 平板模式下：接口地址由用户配置（localStorage），鉴权走 Authorization: Bearer
//（跨源场景 SameSite=Lax 的 httpOnly cookie 不会随请求发送，后端已支持 Bearer 头）。
const isTablet = window.location.protocol === 'resource:' || window.__XTSQL_TABLET__ === true;
const SERVER_KEY = 'xtsql_server';
const TABLET_TOKEN_KEY = 'xtsql_tablet_token';

function normalizeServer(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function getStoredServer() {
  try { return normalizeServer(localStorage.getItem(SERVER_KEY)); } catch { return ''; }
}

// 设置/切换服务器地址：更新 localStorage + axios baseURL，并清理旧服务器的登录态
export function applyServerAddress(url) {
  const normalized = normalizeServer(url);
  try {
    if (normalized) localStorage.setItem(SERVER_KEY, normalized);
    else localStorage.removeItem(SERVER_KEY);
  } catch { /* localStorage 不可用时忽略 */ }
  clearTabletToken();
  api.defaults.baseURL = resolveBaseURL();
  window.dispatchEvent(new CustomEvent('xtsql:server-changed', { detail: normalized }));
  return normalized;
}

function getStoredToken() {
  try { return localStorage.getItem(TABLET_TOKEN_KEY) || ''; } catch { return ''; }
}

function setStoredToken(token) {
  try { localStorage.setItem(TABLET_TOKEN_KEY, token); } catch { /* ignore */ }
}

function clearTabletToken() {
  try { localStorage.removeItem(TABLET_TOKEN_KEY); } catch { /* ignore */ }
}

// 平板模式下接口地址可配置且运行期可变；web/electron 恒为固定值，行为不变
function resolveBaseURL() {
  if (isTablet) return (getStoredServer() || '') + '/api';
  return isElectron ? 'http://localhost:5002/api' : '/api';
}

function getBaseURL() {
  return api.defaults.baseURL || resolveBaseURL();
}

// 平板模式 SSE / XHR 请求需要手动带 Bearer 头（fetch/XHR 不走 axios 拦截器）
function tabletAuthHeaders() {
  if (!isTablet) return {};
  const t = getStoredToken();
  return t ? { Authorization: 'Bearer ' + t } : {};
}

// 鉴权走 httpOnly cookie；axios 必须带 withCredentials 让浏览器自动附加 cookie
const api = axios.create({
  baseURL: resolveBaseURL(),
  withCredentials: true
});

// 平板模式：axios 请求统一附加 Bearer 头
api.interceptors.request.use((config) => {
  if (isTablet) {
    const t = getStoredToken();
    if (t) config.headers.Authorization = 'Bearer ' + t;
  }
  return config;
});

// localStorage 中只缓存"用户信息展示"用，不放敏感 token。
// token 现在由后端通过 Set-Cookie 注入，浏览器自动随请求带上，前端 JS 不可读 → 防 XSS 窃取。
const USER_KEY = 'xtsql_user';

// 老版本把 JWT 存在 localStorage 的 'xtsql_token' 里。
// 新版本完全使用 httpOnly cookie，XSS 也读不到 token。
// 为防止残留的老 token 被旧的 Authorization 头兜底利用，迁移时主动清掉。
const LEGACY_TOKEN_KEY = 'xtsql_token';
(function cleanupLegacyToken() {
  try {
    if (localStorage.getItem(LEGACY_TOKEN_KEY)) {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      console.info('[auth] 已清理遗留的 localStorage token（升级到 httpOnly cookie 流程）');
    }
  } catch { /* localStorage 不可用时忽略 */ }
})();

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

// 响应拦截器：401 时清理本地用户信息并触发全局事件；
// 4xx/5xx 业务错误（后端返回 { error, code, ... }）自动 toast，调用方无需 try/catch 重复处理。
// 之前 5xx 留给调用方，但很多调用方没 try/catch 5xx，导致 500 类错误"页面无反应"，
// 反馈体验比重复 toast 更差。
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;
    if (status === 401) {
      clearTabletToken();
      setStoredUser(null);
      window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
    } else if (status === 429) {
      // 限流不弹 toast：后端在限制频率，频繁刷新时不要刷一堆错误
      // 调用方（如 AuthContext.bootstrap）会区分状态码处理
    } else if (status >= 400 && data && data.error) {
      message.error(data.error);
    }
    return Promise.reject(error);
  }
);

export function testConnection(config) {
  return api.post('/config/test', config).then(r => r.data);
}

export function saveDbConfig(config) {
  return api.post('/config/db', config).then(r => r.data);
}

export function getDbConfig() {
  return api.get('/config/db').then(r => r.data);
}

export function saveLlMConfig(config) {
  return api.post('/config/llm', config).then(r => r.data);
}

export function getLlMConfig() {
  return api.get('/config/llm').then(r => r.data);
}

export function getDeepseekModels() {
  return api.get('/config/llm/models').then(r => r.data);
}

// ★ 2026-08-17：查询 DeepSeek 账户余额
//   返回：{ success, is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
export function getDeepseekBalance() {
  return api.get('/config/llm/balance').then(r => r.data);
}

export function queryGenerate(data) {
  return api.post('/query/generate', data).then(r => r.data);
}

export function queryGenerateStream(data, signal) {
  return fetch(getBaseURL() + '/query/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tabletAuthHeaders() },
    body: JSON.stringify(data),
    signal: signal
  }).then((resp) => {
    if (resp.status === 401) {
      // SSE 不走 axios 拦截器，需手动派发事件让前端切回登录页
      clearTabletToken();
      setStoredUser(null);
      window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
    }
    return resp;
  });
}

export function queryExecute(data) {
  return api.post('/query/execute', data).then(r => r.data);
}

export function explainQuery(data) {
  return api.post('/query/explain', data).then(r => r.data);
}

export function explainAnalyze(sql, explainResults, signal) {
  return fetch(getBaseURL() + '/query/explain-analyze', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...tabletAuthHeaders() },
    body: JSON.stringify({ sql, explainResults }),
    signal: signal
  }).then((resp) => {
    if (resp.status === 401) {
      clearTabletToken();
      setStoredUser(null);
      window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
    }
    return resp;
  });
}

export function getSessions({ limit = 20, offset = 0 } = {}) {
  return api.get('/sessions', { params: { limit, offset } }).then(r => r.data);
}

export function createSession(name) {
  return api.post('/sessions', { name }).then(r => r.data);
}

export function getSessionMessages(sessionId) {
  return api.get(`/sessions/${sessionId}/messages`).then(r => r.data);
}

export function getQueryMessages(sessionId) {
  return api.get(`/query/messages/${sessionId}`).then(r => r.data);
}

export function saveSessionMessage(sessionId, data) {
  return api.post(`/sessions/${sessionId}/messages`, data).then(r => r.data);
}

export function updateSession(sessionId, name) {
  return api.put(`/sessions/${sessionId}`, { name }).then(r => r.data);
}

export function getSessionTokens(sessionId) {
  return api.get(`/sessions/${sessionId}/tokens`).then(r => r.data);
}

export function deleteSession(sessionId) {
  return api.delete(`/sessions/${sessionId}`).then(r => r.data);
}

export function summarizeSession(sessionId) {
  return api.post(`/sessions/${sessionId}/summarize`).then(r => r.data);
}

export function getSkillsList() {
  return api.get('/skills/list').then(r => r.data);
}

export function readSkillFile(path) {
  return api.get('/skills/read', { params: { path } }).then(r => r.data);
}

export function saveSkillFile(path, content) {
  return api.post('/skills/save', { path, content }).then(r => r.data);
}

export function checkTableExists(tableName) {
  return api.post('/skills/check-table', { tableName }).then(r => r.data);
}

export function fetchTableDDL(tableName) {
  return api.post('/skills/fetch-ddl', { tableName }).then(r => r.data);
}

export function createTableFiles(tableName, ddl, description, domains) {
  return api.post('/skills/create-table-files', { tableName, ddl, description, domains }).then(r => r.data);
}

export function getDomains() {
  return api.get('/skills/domains').then(r => r.data);
}

export function addTagToTable(tableName, tag) {
  return api.post('/skills/add-tag', { tableName, tag }).then(r => r.data);
}

// 我的查询（常用 SQL 收藏）
export function saveFavoriteQuery({ userQuestion, sqlOutput }) {
  return api.post('/queries/favorite', { userQuestion, sqlOutput }).then(r => r.data);
}

// 批量检查收藏状态（用于会话回显）
export function checkFavorites(items) {
  return api.post('/queries/favorites/check', { items }).then(r => r.data);
}

// 取消收藏
export function unfavoriteQuery(sqlOutput) {
  return api.delete('/queries/favorite', { data: { sqlOutput } }).then(r => r.data);
}

// 新会话建议：随机从收藏中抽取
export function getFavoriteSuggestions(count = 4) {
  return api.get('/queries/suggestions', { params: { count } }).then(r => r.data);
}

export function getAgentConfig() {
  return api.get('/config/agent').then(r => r.data);
}

export function updateAgentConfig(key, value) {
  return api.put(`/config/agent/${key}`, { value }).then(r => r.data);
}

// ★ 2026-08-24：DeepSeek Files API（附件）
//   - 文档：https://api-docs.deepseek.com/zh-cn/guides/files_api
//   - 当前仅支持 4 种图片格式：JPEG/PNG/GIF/WebP（后端从 agent_files_config 拉 allowlist 二次校验）
//   - 仅 deepseek-v4-flash-vision-exp 模型能消费（其他模型调用会 400）
//   - 上传走 fetch + XHR（axios 默认不支持 progress 事件），返回 { promise, abort }
export function getFilesConfig() {
  return api.get('/config/files').then(r => r.data);
}

export function listFiles({ limit = 100, order = 'desc' } = {}) {
  return api.get('/files', { params: { limit, order } }).then(r => r.data);
}

export function deleteFileApi(fileId) {
  return api.delete(`/files/${encodeURIComponent(fileId)}`).then(r => r.data);
}

/**
 * 下载文件二进制（用于历史图片按需回显）。
 *
 * 返回 Blob（responseType=blob），由调用方 URL.createObjectURL 缓存。
 * 错误：
 *   - 400 INVALID_ID：file_id 不合法
 *   - 404 NOT_FOUND：DeepSeek 端文件已过期或被清理
 *   - 其他：HTTP 状态码 + 错误信息
 */
export function fetchFileContent(fileId) {
  return api.get(`/files/${encodeURIComponent(fileId)}/content`, {
    responseType: 'blob',
  }).then(r => r.data);
}

/**
 * 上传文件到 DeepSeek Files API，附带进度回调。
 * @param {File} file
 * @param {{onProgress?: (percent:number)=>void, signal?: AbortSignal}} opts
 * @returns {Promise<{id,filename,bytes,created_at,purpose,expires_at}>}
 */
export function uploadFileWithProgress(file, opts = {}) {
  const { onProgress, signal } = opts;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (signal) {
      const onAbort = () => xhr.abort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    xhr.open('POST', getBaseURL() + '/files/upload', true);
    xhr.withCredentials = true;
    // 平板模式：XHR 也不走 axios 拦截器，手动带 Bearer 头
    if (isTablet) {
      const headers = tabletAuthHeaders();
      if (headers.Authorization) xhr.setRequestHeader('Authorization', headers.Authorization);
    }
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) {
        if (data && data.success && data.file) resolve(data.file);
        else resolve(data);
      } else {
        const msg = (data && data.error) || `上传失败：HTTP ${xhr.status}`;
        const err = new Error(msg);
        err.code = (data && data.code) || 'UPLOAD_FAILED';
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => {
      const err = new Error('网络错误，上传失败');
      err.code = 'NETWORK_ERROR';
      reject(err);
    };
    xhr.onabort = () => {
      const err = new Error('已取消上传');
      err.code = 'ABORTED';
      reject(err);
    };
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

// 鉴权相关 API
export function loginApi(payload) {
  // 平板模式：要求后端返回 token（跨源 cookie 不生效），登录后由本层存入 localStorage
  const url = isTablet ? '/auth/login?auth_mode=token' : '/auth/login';
  return api.post(url, payload).then(r => {
    if (isTablet && r.data && r.data.token) setStoredToken(r.data.token);
    return r.data;
  });
}

export function registerApi(payload) {
  const url = isTablet ? '/auth/register?auth_mode=token' : '/auth/register';
  return api.post(url, payload).then(r => {
    if (isTablet && r.data && r.data.token) setStoredToken(r.data.token);
    return r.data;
  });
}

export function getMeApi() {
  return api.get('/auth/me').then(r => r.data);
}

export function changePasswordApi(payload) {
  return api.post('/auth/change-password', payload).then(r => r.data);
}

export function logoutApi() {
  // 平板模式：本地 token 立即清理（改密后 token_version 已递增，旧 token 天然失效）
  clearTabletToken();
  return api.post('/auth/logout').then(r => r.data);
}

// 平板模式：测试服务器地址连通性（/api/health 无需鉴权）
export function testServerConnection(serverUrl) {
  const base = normalizeServer(serverUrl);
  if (!base) return Promise.reject(new Error('请输入服务器地址'));
  return fetch(base + '/api/health', { method: 'GET' })
    .then(resp => ({ ok: resp.ok, status: resp.status }))
    .catch(() => ({ ok: false, status: 0 }));
}

export { isTablet };

export default api;


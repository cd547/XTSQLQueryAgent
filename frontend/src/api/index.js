import axios from 'axios';
import { message } from 'antd';

const isElectron = window.location.protocol === 'file:';
const baseURL = isElectron ? 'http://localhost:5002/api' : '/api';

// 鉴权走 httpOnly cookie；axios 必须带 withCredentials 让浏览器自动附加 cookie
const api = axios.create({
  baseURL: baseURL,
  withCredentials: true
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

export function queryGenerate(data) {
  return api.post('/query/generate', data).then(r => r.data);
}

export function queryGenerateStream(data, signal) {
  return fetch(baseURL + '/query/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: signal
  }).then((resp) => {
    if (resp.status === 401) {
      // SSE 不走 axios 拦截器，需手动派发事件让前端切回登录页
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
  return fetch(baseURL + '/query/explain-analyze', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, explainResults }),
    signal: signal
  }).then((resp) => {
    if (resp.status === 401) {
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

// 鉴权相关 API
export function loginApi(payload) {
  return api.post('/auth/login', payload).then(r => r.data);
}

export function registerApi(payload) {
  return api.post('/auth/register', payload).then(r => r.data);
}

export function getMeApi() {
  return api.get('/auth/me').then(r => r.data);
}

export function changePasswordApi(payload) {
  return api.post('/auth/change-password', payload).then(r => r.data);
}

export function logoutApi() {
  return api.post('/auth/logout').then(r => r.data);
}

export default api;


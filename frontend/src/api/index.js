import axios from 'axios';

const isElectron = window.location.protocol === 'file:';
const baseURL = isElectron ? 'http://localhost:5002/api' : '/api';

const api = axios.create({
  baseURL: baseURL
});

// Token 存储键名（localStorage）
const TOKEN_KEY = 'xtsql_token';
const USER_KEY = 'xtsql_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

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

// 请求拦截器：自动附带 Authorization 头
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401 时清理 token（外层 AuthContext 会监听 logout 事件跳转）
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response && error.response.status === 401) {
      setToken('');
      setStoredUser(null);
      // 触发全局事件，AuthContext 监听到后会切回登录页
      window.dispatchEvent(new CustomEvent('xtsql:auth-expired'));
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

export function queryGenerate(data) {
  return api.post('/query/generate', data).then(r => r.data);
}

export function queryGenerateStream(data, signal) {
  return fetch(baseURL + '/query/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify(data),
    signal: signal
  });
}

export function queryExecute(data) {
  return api.post('/query/execute', data).then(r => r.data);
}

export function explainQuery(data) {
  return api.post('/query/explain', data).then(r => r.data);
}

export function explainAnalyze(sql, explainResults) {
  return fetch(baseURL + '/query/explain-analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({ sql, explainResults })
  });
}

export function getSessions() {
  return api.get('/sessions').then(r => r.data);
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

export function createTableFiles(tableName, ddl, description) {
  return api.post('/skills/create-table-files', { tableName, ddl, description }).then(r => r.data);
}

export function addTagToTable(tableName, tag) {
  return api.post('/skills/add-tag', { tableName, tag }).then(r => r.data);
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

export default api;


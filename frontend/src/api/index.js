import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

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

export function queryExecute(data) {
  return api.post('/query/execute', data).then(r => r.data);
}

export function explainQuery(data) {
  return api.post('/query/explain', data).then(r => r.data);
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

export function getAgentConfig() {
  return api.get('/config/agent').then(r => r.data);
}

export function updateAgentConfig(key, value) {
  return api.put(`/config/agent/${key}`, { value }).then(r => r.data);
}

export default api;


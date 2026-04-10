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

export function deleteSession(sessionId) {
  return api.delete(`/sessions/${sessionId}`).then(r => r.data);
}

export function getSkillsList() {
  return api.get('/skills/list').then(r => r.data);
}

export function readSkillFile(path) {
  return api.get('/skills/read', { params: { path } }).then(r => r.data);
}

export default api;


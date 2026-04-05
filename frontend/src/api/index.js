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

export default api;


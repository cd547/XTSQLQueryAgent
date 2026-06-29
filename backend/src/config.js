import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const _projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..');

/**
 * 静态配置统一入口（来自环境变量）。
 *
 * 所有路径字段在 fallback 时基于 backend/src/config.js 的位置解析为绝对路径，
 * 避免依赖进程 CWD，行为对 dev/prod/打包后均一致。
 *
 * 动态配置（运行时可改）请用 ./services/config.js 的
 * getConfig / getAgentConfig / getLlmConfig。
 */
export const config = {
  port: parseInt(process.env.PORT, 10) || 5002,
  dbPath: process.env.DB_PATH || path.join(_projectRoot, 'data/app.db'),
  skillPath: process.env.SKILL_PATH || path.join(_projectRoot, 'skills'),
  logPath: process.env.LOG_PATH || path.join(_projectRoot, 'logs'),
  projectRoot: _projectRoot,
};

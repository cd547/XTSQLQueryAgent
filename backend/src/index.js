import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDatabase, initSkillLogTable } from './db/sqlite.js';
import { config } from './config.js';

const app = express();
const PORT = config.port;

app.use(cors({
  origin: (origin, cb) => cb(null, true), // 任意 origin；通过 cookie+SameSite 保护
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
import configRouter from './routes/config.js';
import queryRouter from './routes/query.js';
import tablesRouter from './routes/tables.js';
import sessionRouter from './routes/session.js';
import tableSchemaRouter from './routes/tableSchema.js';
import skillRouter from './routes/skill.js';
import exportRouter from './routes/export.js';
import authRouter from './routes/auth.js';
import favoriteQueryRouter from './routes/favoriteQuery.js';

app.use('/api/auth', authRouter);
app.use('/api/config', configRouter);
app.use('/api/query', queryRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/table-schema', tableSchemaRouter);
app.use('/api/skills', skillRouter);
app.use('/api/export', exportRouter);
app.use('/api/queries', favoriteQueryRouter);

// ★ 兜底（B13 修复）：Express 4 不自动捕获 async 路由的 rejected promise，
//   漏 try/catch 时 Node 15+ 会以 unhandledRejection 终止进程。
//   任何逃出路由的异常都会落到这里，统一 500 + 日志。
app.use((err, req, res, next) => {
  // ★ 必须保留 next 形参（即便未用），Express 靠 4 参数识别错误中间件
  logger.error('[express:unhandled]', {
    method: req.method,
    url: req.url,
    error: err.message,
    stack: err.stack
  });
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ★ 最后一道防线（B13 修复）：即使错误中间件也漏掉的极端情况，
//   也只记录日志不退出进程——避免用户每次遇到坏 JSON 配置就把后端炸掉。
//   依据：Node 官方建议 unhandledRejection 应至少打日志；uncaughtException 后
//   进程状态已不可靠但 Electron 主进程会检测子进程退出并提示用户重启。
process.on('unhandledRejection', (reason) => {
  logger.error('[process:unhandledRejection]', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('[process:uncaughtException]', { error: err.message, stack: err.stack });
});

// 启动序列：必须先完成数据库初始化，再启动 HTTP 监听
// 失败时 process.exit(1)，让 Electron 立即看到 stderr
(async () => {
  try {
    await initDatabase();
    await initSkillLogTable();
    console.log('Server running on port ' + PORT);
    app.listen(PORT);
  } catch (e) {
    console.error('Fatal: failed to initialize database, refusing to start', e);
    process.exit(1);
  }
})();

export default app;


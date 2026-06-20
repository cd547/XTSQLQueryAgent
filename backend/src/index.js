import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { initDatabase, initSkillLogTable } from './db/sqlite.js';

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors({
  origin: (origin, cb) => cb(null, true), // 任意 origin；通过 cookie+SameSite 保护
  credentials: true
}));
app.use(express.json());
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

app.use('/api/auth', authRouter);
app.use('/api/config', configRouter);
app.use('/api/query', queryRouter);
app.use('/api/tables', tablesRouter);
app.use('/api/sessions', sessionRouter);
app.use('/api/table-schema', tableSchemaRouter);
app.use('/api/skills', skillRouter);
app.use('/api/export', exportRouter);

// 启动序列：必须先完成数据库初始化，再启动 HTTP 监听
// - 修复 #LOG-03：之前 initDatabase/initSkillLogTable 是 fire-and-forget，
//   DB 失败时 HTTP 仍然 listen，路由能 hit 但都 500
// - 失败时 process.exit(1)，让 Electron 在 30s 超时窗内看到 stderr 立即报错
(async () => {
  try {
    await initDatabase();
    initSkillLogTable();      // 同步函数（better-sqlite3 同步），但放在 try 里以捕获任何 throw
    console.log('Server running on port ' + PORT);
    app.listen(PORT);
  } catch (e) {
    console.error('Fatal: failed to initialize database, refusing to start', e);
    process.exit(1);
  }
})();

export default app;


import express from 'express';
import cors from 'cors';
import { initDatabase, initSkillLogTable } from './db/sqlite.js';

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Initialize SQLite
initDatabase();
initSkillLogTable();

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

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});

export default app;


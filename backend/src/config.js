export const config = {
  port: process.env.PORT || 5002,
  dbPath: process.env.DB_PATH || './data/app.db',
  skillPath: process.env.SKILL_PATH || './skills',
  logPath: process.env.LOG_PATH || './logs',
};


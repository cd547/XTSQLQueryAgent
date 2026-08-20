import Database from 'better-sqlite3';
const db = new Database('d:/Ai_Program_Files/XTSQLQueryAgent/data/app.db', { readonly: true });

// 查所有 content 以 "🚫" 开头的 log 消息
const rows = db.prepare(`
  SELECT id, session_id, role, round, created_at,
         substr(content, 1, 60) as preview
  FROM messages
  WHERE content LIKE '🚫%'
  ORDER BY id DESC
  LIMIT 20
`).all();

console.log(`找到 ${rows.length} 条 checklist 行:\n`);
for (const r of rows) {
  console.log(`  id=${r.id} session=${r.session_id} round=${r.round} role=${r.role} time=${r.created_at}`);
  console.log(`    preview: ${r.preview}...`);
}

// 总览：最新 5 条 log 行
console.log('\n最新 5 条 role=log 消息:');
const recent = db.prepare(`
  SELECT id, session_id, role, round, created_at,
         substr(content, 1, 50) as preview
  FROM messages
  WHERE role = 'log'
  ORDER BY id DESC
  LIMIT 5
`).all();
for (const r of recent) {
  console.log(`  id=${r.id} session=${r.session_id} round=${r.round} time=${r.created_at} | ${r.preview}...`);
}

// API 端到端验证：业务域选择功能
import http from 'http';

const HOST = 'localhost';
const PORT = 5002;

function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      host: HOST, port: PORT, path, method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(opts, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        const setCookie = res.headers['set-cookie'];
        const cookies = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : (setCookie || '');
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json, cookies });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function log(line) { console.log(line); }
function pass(name) { log('  PASS  ' + name); }
function fail(name, detail) { log('  FAIL  ' + name + (detail ? '  ' + detail : '')); process.exitCode = 1; }

(async () => {
  log('=== A. 登录获取 cookie ===');
  const login = await request('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  if (login.status === 200) pass('登录成功');
  else { fail('登录失败', JSON.stringify(login.json)); return; }
  const cookie = login.cookies;

  log('\n=== B. GET /api/skills/domains 返回域列表 ===');
  const domainsResp = await request('GET', '/api/skills/domains', { cookie });
  if (domainsResp.status !== 200) { fail('HTTP 非 200', JSON.stringify(domainsResp.json)); return; }
  if (domainsResp.json?.success !== true) { fail('success=false', JSON.stringify(domainsResp.json)); return; }
  const domains = domainsResp.json.domains;
  if (!Array.isArray(domains)) { fail('domains 不是数组'); return; }
  if (domains.length === 0) { fail('domains 为空'); return; }
  pass('返回 ' + domains.length + ' 个域');
  const sample = domains[0];
  if (sample.id && sample.name && sample.description) pass('第 1 个域字段完整: ' + sample.id + ' / ' + sample.name);
  else fail('第 1 个域字段缺失', JSON.stringify(sample));
  const expectedIds = ['people', 'department', 'permission', 'campus', 'course', 'product', 'finance', 'activity', 'crm', 'study_abroad'];
  const actualIds = new Set(domains.map(d => d.id));
  const missing = expectedIds.filter(id => !actualIds.has(id));
  if (missing.length === 0) pass('10 个期望的域 ID 全部存在');
  else fail('缺少域: ' + missing.join(','));

  log('\n=== C. POST /create-table-files 缺 domains 参数 ===');
  const missingDomains = await request('POST', '/api/skills/create-table-files', {
    cookie,
    body: {
      tableName: 'e2e_test_no_domains',
      ddl: 'CREATE TABLE e2e_test_no_domains (id INT PRIMARY KEY);'
    }
  });
  if (missingDomains.status === 400 && missingDomains.json?.code === 'DOMAINS_REQUIRED') {
    pass('缺 domains 返回 400 DOMAINS_REQUIRED: ' + missingDomains.json.message);
  } else {
    fail('缺 domains 校验失败', 'status=' + missingDomains.status + ' code=' + missingDomains.json?.code);
  }

  log('\n=== D. POST /create-table-files domains 为空数组 ===');
  const emptyDomains = await request('POST', '/api/skills/create-table-files', {
    cookie,
    body: { tableName: 'e2e_test_empty', ddl: 'CREATE TABLE e2e_test_empty (id INT);', domains: [] }
  });
  if (emptyDomains.status === 400 && emptyDomains.json?.code === 'DOMAINS_REQUIRED') {
    pass('空数组返回 400 DOMAINS_REQUIRED');
  } else {
    fail('空数组校验失败', JSON.stringify(emptyDomains.json));
  }

  log('\n=== E. POST /create-table-files 正常流程（多域） ===');
  const tblName = 'e2e_test_domains_' + Date.now();
  const valid = await request('POST', '/api/skills/create-table-files', {
    cookie,
    body: {
      tableName: tblName,
      ddl: 'CREATE TABLE ' + tblName + ' (id INT PRIMARY KEY, name VARCHAR(64)) COMMENT \'e2e test\';',
      description: 'e2e test table',
      domains: ['course', 'finance']
    }
  });
  if (valid.status === 200 && valid.json?.success === true) {
    pass('创建成功，返回 files: ' + JSON.stringify(valid.json.files));
    pass('返回 domains 字段: ' + JSON.stringify(valid.json.domains));
  } else {
    fail('正常创建失败', JSON.stringify(valid.json));
  }

  log('\n=== F. 验证 domains/{id}.json 包含新表名 ===');
  // 验证 course.json 包含新表
  const fs = await import('fs');
  const path = await import('path');
  const courseFile = path.join('d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/domains/course.json');
  const financeFile = path.join('d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/domains/finance.json');
  if (fs.existsSync(courseFile)) {
    const data = JSON.parse(fs.readFileSync(courseFile, 'utf-8'));
    if (Array.isArray(data.tables) && data.tables.includes(tblName)) pass('course.json.tables 包含 ' + tblName);
    else fail('course.json 未包含新表', JSON.stringify(data.tables));
  } else {
    fail('course.json 不存在');
  }
  if (fs.existsSync(financeFile)) {
    const data = JSON.parse(fs.readFileSync(financeFile, 'utf-8'));
    if (Array.isArray(data.tables) && data.tables.includes(tblName)) pass('finance.json.tables 包含 ' + tblName);
    else fail('finance.json 未包含新表', JSON.stringify(data.tables));
  } else {
    fail('finance.json 不存在');
  }

  log('\n=== G. 幂等：再次添加同一表到同域，tables 数组应去重 ===');
  const dup = await request('POST', '/api/skills/create-table-files', {
    cookie,
    body: {
      tableName: tblName,
      ddl: 'CREATE TABLE ' + tblName + ' (id INT PRIMARY KEY);',
      domains: ['course']
    }
  });
  // 覆盖 DDL 也要走 addTableToDomains，去重逻辑会生效
  if (dup.status === 200) {
    const data = JSON.parse(fs.readFileSync(courseFile, 'utf-8'));
    const count = data.tables.filter(t => t === tblName).length;
    if (count === 1) pass('重复添加已去重（course.json 中 ' + tblName + ' 仅 1 次）');
    else fail('未去重，course.json 中 ' + tblName + ' 出现 ' + count + ' 次');
  } else {
    fail('重复添加请求失败', JSON.stringify(dup.json));
  }

  log('\n=== H. 错误码：未注册的域 ID ===');
  const badId = await request('POST', '/api/skills/create-table-files', {
    cookie,
    body: { tableName: 'e2e_bad_id', ddl: 'CREATE TABLE e2e_bad_id (id INT);', domains: ['nonexistent_domain'] }
  });
  if (badId.status === 400 && badId.json?.code === 'DOMAIN_NOT_FOUND') {
    pass('未注册域返回 400 DOMAIN_NOT_FOUND');
  } else {
    fail('未注册域校验失败', JSON.stringify(badId.json));
  }

  log('\n=== I. 清理：删除 e2e 测试遗留 ===');
  // 从域文件移除测试表
  for (const file of [courseFile, financeFile]) {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(data.tables)) {
        data.tables = data.tables.filter(t => t !== tblName);
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  }
  // 移除生成的 DDL 和 field_config
  const ddlFile = path.join('d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/ddl/' + tblName + '.sql');
  const fcFile = path.join('d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/field_config/' + tblName + '.json');
  if (fs.existsSync(ddlFile)) { fs.unlinkSync(ddlFile); pass('已删除 DDL 文件'); }
  if (fs.existsSync(fcFile)) { fs.unlinkSync(fcFile); pass('已删除 field_config 文件'); }
  // 移除 table_index 中的测试表条目
  const idxFile = path.join('d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/table_index.json');
  if (fs.existsSync(idxFile)) {
    const data = JSON.parse(fs.readFileSync(idxFile, 'utf-8'));
    if (Array.isArray(data.tables)) {
      data.tables = data.tables.filter(t => t.name !== tblName);
      fs.writeFileSync(idxFile, JSON.stringify(data, null, 2), 'utf-8');
      pass('已从 table_index 移除测试表');
    }
  }
  // 移除 skill_back 中的备份
  const backDir = path.join('d:/Ai_Program_Files/XTSQLQueryAgent/skills/sql-creator-skill-v2/skill_back');
  if (fs.existsSync(backDir)) {
    const entries = fs.readdirSync(backDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const sub = path.join(backDir, e.name);
        for (const f of fs.readdirSync(sub)) {
          if (f.includes(tblName) || f === tblName + '.sql' || f === 'table_index.json') {
            fs.unlinkSync(path.join(sub, f));
          }
        }
      }
    }
  }

  log('\n=== 完成 ===');
  if (process.exitCode === 1) log('\n有测试失败');
  else log('\n所有 API 测试通过');
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });

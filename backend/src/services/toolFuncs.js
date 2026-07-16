import { DynamicTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = config.projectRoot;
const SKILL_V2_PATH = path.join(config.skillPath, 'sql-creator-skill-v2');

// 读取文件（如不存在返回 null）。单次系统调用，无 TOCTOU 竞态。
// 每次调用都重新读盘——文件内容可能变化（schema 重建、tag 修改、DDL 变更等），
// 禁止缓存。
async function readFileIfExists(filePath, encoding = 'utf-8') {
  try {
    return await fs.promises.readFile(filePath, encoding);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function loadTableIndex() {
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  const content = await readFileIfExists(tableIndexPath);
  return content ? JSON.parse(content) : null;
}

export async function loadDomainRouterIndex() {
  const domainIndexPath = path.join(SKILL_V2_PATH, 'domain_router_index.json');
  const content = await readFileIfExists(domainIndexPath);
  return content ? JSON.parse(content) : null;
}

export async function sliceTableIndex(tableNames) {
  // 1. 规范化输入：转数组、去重、过滤空值和非字符串
  const arr = Array.isArray(tableNames) ? tableNames : [tableNames];
  const uniqueNames = [...new Set(
    arr.filter(n => typeof n === 'string' && n.trim())
  )];

  // 2. 加载全量索引
  const full = await loadTableIndex();
  if (!full || !Array.isArray(full.tables) || full.tables.length === 0) {
    logger.warn('sliceTableIndex: 全量索引为空或加载失败', { tableNames });
    return {
      version: full?.version || 'unknown',
      description: 'Sliced index (source empty)',
      sliced_at: new Date().toISOString(),
      source: 'table_index.json',
      request_tables: uniqueNames,
      tables: []
    };
  }

  // 3. 建 name → table 映射 (O(1) 查找)
  const fullByName = Object.fromEntries(full.tables.map(t => [t.name, t]));

  // 4. 切片：按入参顺序、跳过不存在的
  const tables = [];
  const missing = [];
  for (const name of uniqueNames) {
    if (fullByName[name]) {
      tables.push(fullByName[name]);
    } else {
      missing.push(name);
    }
  }

  // 5. 输出结构对齐 table_index.json
  const result = {
    version: full.version,
    description: `Sliced index (${tables.length}/${uniqueNames.length} matched)`,
    sliced_at: new Date().toISOString(),
    source: 'table_index.json',
    request_tables: uniqueNames,
    tables
  };
  if (missing.length > 0) {
    result.missing_tables = missing;
    logger.warn('sliceTableIndex: 部分表名未在索引中找到', { missing, requested: uniqueNames });
  }

  return result;
}

export async function sliceTableIndexByDomains(domainIds) {
  // 1. 规范化输入
  const arr = Array.isArray(domainIds) ? domainIds : [domainIds];
  const uniqueIds = [...new Set(
    arr.filter(id => typeof id === 'string' && id.trim())
  )];

  // 2. 并行加载每个域的表名（多域时不再串行读盘）
  const domainEntries = await Promise.all(uniqueIds.map(async (id) => {
    const domainPath = path.join(SKILL_V2_PATH, 'domains', `${id}.json`);
    const content = await readFileIfExists(domainPath);
    if (!content) return { id, status: 'missing' };
    const domain = JSON.parse(content);
    if (!domain.tables || domain.tables.length === 0) return { id, status: 'empty' };
    return { id, status: 'ok', tables: domain.tables };
  }));

  const tableNames = [];
  const missingDomains = [];
  const emptyDomains = [];
  for (const { id, status, tables } of domainEntries) {
    if (status === 'missing') missingDomains.push(id);
    else if (status === 'empty') emptyDomains.push(id);
    else tableNames.push(...tables);
  }

  // 3. 去重
  const uniqueTableNames = [...new Set(tableNames)];

  // 4. 复用 sliceTableIndex 拿完整卡片
  const sliced = await sliceTableIndex(uniqueTableNames);

  // 5. 补充域层信息
  sliced.request_domains = uniqueIds;
  sliced.description = `Sliced by domains (${uniqueIds.length} domains → ${sliced.tables.length}/${uniqueTableNames.length} tables matched)`;
  if (missingDomains.length > 0) sliced.missing_domains = missingDomains;
  if (emptyDomains.length > 0) sliced.empty_domains = emptyDomains;

  return sliced;
}
export async function loadSkillMd() {
  const skillMdPath = path.join(SKILL_V2_PATH, 'SKILL.md');
  const content = await readFileIfExists(skillMdPath);
  if (!content) {
    throw new Error('SKILL.md 未找到，请确保目录存在 skills/sql-creator-skill-v2/SKILL.md');
  }
  return content;
}

function removeEmptyProperties(obj) {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.trim() === '') return undefined;
    return obj;
  }
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return undefined;
    const filtered = obj.map(item => removeEmptyProperties(item)).filter(item => item !== undefined);
    return filtered.length === 0 ? undefined : filtered;
  }
  
  const result = {};
  for (const key of Object.keys(obj)) {
    const value = removeEmptyProperties(obj[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

export async function getTableSchema(tableNames) {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  // 并行读所有表的 field_config（多表时不再串行读盘）
  const entries = await Promise.all(names.map(async (name) => {
    const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${name}.json`);
    const content = await readFileIfExists(fieldConfigPath);
    if (content) {
      const config = JSON.parse(content);
      const simplified = removeEmptyProperties(config);
      return [name, simplified || {}];
    }
    return [name, { error: `表 ${name} 的配置不存在` }];
  }));
  const result = Object.fromEntries(entries);
  return names.length === 1 ? result[names[0]] : result;
}

function simplifyDDL(ddlContent) {
  const lines = ddlContent.split('\n');
  const filtered = [];

  const skipPatterns = [
    /^\s*CREATE TABLE/i,
    /^\s*\)\s*ENGINE/i,
    /^\s*PRIMARY KEY/i,
    /^\s*(UNIQUE\s+)?KEY\s/i,
    /^\s*CONSTRAINT/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (skipPatterns.some(p => p.test(trimmed))) continue;

    // 精简字段行：只保留 字段名 + 类型 + COMMENT
    const nameMatch = trimmed.match(/`\w+`/);
    const typeMatch = trimmed.match(/`\w+`\s+(\w+(?:\([^)]*\))?)/);
    const commentMatch = trimmed.match(/(COMMENT\s+'[^']*(?:''[^']*)*')/);
    if (nameMatch && typeMatch) {
      let simplified = nameMatch[0] + ' ' + typeMatch[1];
      if (commentMatch) {
        simplified += ' ' + commentMatch[1];
      }
      if (/,\s*$/.test(trimmed)) {
        simplified += ',';
      }
      filtered.push(simplified);
    } else {
      filtered.push(trimmed);
    }
  }

  if (filtered.length > 0) {
    filtered[filtered.length - 1] = filtered[filtered.length - 1].replace(/,\s*$/, '');
  }

  return filtered.join('\n');
}

export async function getTableDDL(tableNames, options = {}) {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  const short = options.short == 1;
  // 并行读所有表的 DDL（多表时不再串行读盘）
  const blocks = await Promise.all(names.map(async (name) => {
    const ddlPath = path.join(SKILL_V2_PATH, 'ddl', `${name}.sql`);
    const content = await readFileIfExists(ddlPath);
    if (content) {
      const ddl = short ? simplifyDDL(content) : content;
      return `-- @@TABLE ${name}\n${ddl}`;
    }
    return `-- @@TABLE ${name}\n-- 表 ${name} 的DDL不存在`;
  }));
  return blocks.join('\n\n');
}

export async function getOutputFormat() {
  const outputFormatPath = path.join(SKILL_V2_PATH, 'templates', 'output_format.md');
  const content = await readFileIfExists(outputFormatPath);
  return content || '输出格式模板不存在';
}

export async function getMysqlLimits() {
  const mysqlLimitsPath = path.join(SKILL_V2_PATH, 'docs', 'mysql57_limits.md');
  const content = await readFileIfExists(mysqlLimitsPath);
  return content || 'MySQL 5.7 限制信息不存在';
}

export function requestTagConfirmation(term, table, description) {
  if (!Array.isArray(term)) {
    term = [term];
  }
  return `<!--confirm_tag_add:${JSON.stringify({ term, table, description })}-->`;
}

// request_user_choice: 生成稳定 id + marker 字符串
// 关键：返回结构化对象 {id, marker, payload} —— 让 caller 拿到 id 写入 registry
// 不返回单纯 marker 字符串（否则 registry 与 marker 的 id 无法关联，reviewer #2 已确认是严重 bug）
export function makeUserChoiceId() {
  return 'uc_' + Math.random().toString(36).slice(2, 8);
}

export function buildUserChoiceMarker(question, options, multiSelect, header) {
  const id = makeUserChoiceId();
  const payload = {
    id,
    question: String(question || '').slice(0, 200),
    options: (Array.isArray(options) ? options : []).slice(0, 4).map(o => String(o).slice(0, 100)),
    multi_select: !!multiSelect,
    header: String(header || '').slice(0, 12)
  };
  return {
    id,
    marker: `<!--user_choice:${JSON.stringify(payload)}-->`,
    payload
  };
}

// ★ 校验 questions[] 数组：每条 question 必须 1-4 options + question ≤200 字
// 返回 {ok, msg} —— ok=false 时 caller 应把 msg 当 error 返回 LLM 让其重试
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, msg: "questions 必须是非空数组" };
  }
  if (questions.length > 3) {
    return { ok: false, msg: `questions 最多 3 条（再多弹窗链过长），当前 ${questions.length}` };
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] || {};
    const idx = i + 1;
    if (!q.question || typeof q.question !== 'string') {
      return { ok: false, msg: `第 ${idx} 题 question 必填且为字符串` };
    }
    if (q.question.length > 200) {
      return { ok: false, msg: `第 ${idx} 题 question ≤200 字（当前 ${q.question.length}）` };
    }
    if (!Array.isArray(q.options) || q.options.length < 1) {
      return { ok: false, msg: `第 ${idx} 题 options 至少 1 个` };
    }
    if (q.options.length > 4) {
      return { ok: false, msg: `第 ${idx} 题 options 最多 4 个（当前 ${q.options.length}）` };
    }
    for (let j = 0; j < q.options.length; j++) {
      const opt = q.options[j];
      if (!opt || typeof opt !== 'string') {
        return { ok: false, msg: `第 ${idx} 题 第 ${j+1} 个 option 必填且为字符串` };
      }
      if (opt.length > 100) {
        return { ok: false, msg: `第 ${idx} 题 第 ${j+1} 个 option ≤100 字（当前 ${opt.length}）` };
      }
    }
  }
  return { ok: true };
}

// ★ v3: request_user_choice(questions: [{...}]) 单调用多问题契约
//  返回结构：
//    success: {markers:[...], payloads:[...], ids:[...], content:"..."}
//      - markers 给后端 phase 3 解析后 yield 给前端
//      - payloads 是已 parse 的对象数组（直接给前端用）
//      - ids 给 recordToolCall 写 registry
//      - content 给 LLM 看的 tool 消息（多个 marker 拼接）
//    error:   {error, content:"⚠️..."}
//      - 后端不会终止 TURN 1，LLM 看到 content 修正后重试
export function requestUserChoice(questions) {
  const v = validateQuestions(questions);
  if (!v.ok) {
    return {
      error: v.msg,
      content: `⚠️ ${v.msg}。请修正后重新调用 request_user_choice(questions: [...])。`
    };
  }
  const items = questions.map(q => {
    const r = buildUserChoiceMarker(q.question, q.options, q.multi_select, q.header);
    return { marker: r.marker, payload: r.payload, id: r.id };
  });
  return {
    markers: items.map(it => it.marker),
    payloads: items.map(it => it.payload),
    ids: items.map(it => it.id),
    content: items.map(it => it.marker).join(''),
  };
}

// 表格卡片格式化：与 get_tables 输出保持一致，供 get_sliced_index 共用
function formatTableInfo(tables) {
  return tables.map(t => {
    let info = `- ${t.name}: ${t.description || ''}`;
    if (t.tags?.length) info += `\n  标签: ${t.tags.join(', ')}`;
    if (t.related_tables?.length) info += `\n  关联表: ${t.related_tables.join(', ')}`;
    if (t.business_constraints?.length) {
      info += `\n  业务约束:`;
      t.business_constraints.forEach(c => {
        if (typeof c === 'string') {
          info += `\n    - ${c}`;
        } else {
          info += `\n    - ${c.name}: ${c.description}`;
        }
      });
    }
    if (t.business_rules?.length) {
      info += `\n  业务规则:`;
      t.business_rules.forEach(r => {
        if (typeof r === 'string') {
          info += `\n    - ${r}`;
        } else {
          info += `\n    - ${r.rule || r.description}: ${r.description}`;
          if (r.query) info += `\n      示例: ${r.query}`;
        }
      });
    }
    return info;
  }).join('\n\n');
}

export const tools = [
  new DynamicTool({
    name: "get_tables",
    description: "【兜底工具，谨慎使用】返回全部表信息。仅在 get_domain_index/get_sliced_index 都不够用时调用。",
    params: {
      type: 'object',
      properties: {},
      required: []
    },
    func: async () => {
      const tableIndex = await loadTableIndex();
      if (!tableIndex || !tableIndex.tables) return '暂无表数据';

      return tableIndex.tables.map(t => {
        let info = `- ${t.name}: ${t.description || ''}`;
        if (t.tags?.length) info += `\n  标签: ${t.tags.join(', ')}`;
        if (t.related_tables?.length) info += `\n  关联表: ${t.related_tables.join(', ')}`;
        if (t.business_constraints?.length) {
          info += `\n  业务约束:`;
          t.business_constraints.forEach(c => {
            if (typeof c === 'string') {
              info += `\n    - ${c}`;
            } else {
              info += `\n    - ${c.name}: ${c.description}`;
            }
          });
        }
        if (t.business_rules?.length) {
          info += `\n  业务规则:`;
          t.business_rules.forEach(r => {
            if (typeof r === 'string') {
              info += `\n    - ${r}`;
            } else {
              info += `\n    - ${r.rule || r.description}: ${r.description}`;
              if (r.query) info += `\n      示例: ${r.query}`;
            }
          });
        }
        return info;
      }).join('\n\n');
    }
  }),
  new DynamicTool({
    name: "get_table_schema",
    description: "获取指定表的字段详情（别名、枚举、约束、业务、关联），支持多表。",
    params: {
      type: 'object',
      properties: {
        table_names: { type: 'array', items: { type: 'string' }, description: '需要查询的表名列表' }
      },
      required: ['table_names']
    },
    func: async (input) => {
      let tableNames = [];
      try {
        if (typeof input === 'object' && input !== null) {
          tableNames = input.table_names || [];
        } else if (typeof input === 'string') {
          const parsed = JSON.parse(input);
          tableNames = parsed.table_names || [];
        }
      } catch (e) { logger.debug('Parse tableNames failed', { error: e.message }); }
      if (!Array.isArray(tableNames) || tableNames.length === 0) return '请提供 table_names 参数（表名数组）';
      return JSON.stringify(await getTableSchema(tableNames), null, 2);
    }
  }),
  new DynamicTool({
    name: "get_table_ddl",
    description: "获取指定表的DDL（short=1 仅列定义；short=0 含索引/外键）。",
    params: {
      type: 'object',
      properties: {
        table_names: { type: 'array', items: { type: 'string' }, description: '需要查询DDL的表名列表' },
        short: { type: 'integer', description: '默认1只返回列定义；传0返回完整DDL含索引/主键/外键' }
      },
      required: ['table_names']
    },
    func: async (input) => {
      let tableNames = [];
      let short = 1;
      try {
        if (typeof input === 'object' && input !== null) {
          tableNames = input.table_names || [];
          short = input.short ?? 1;
        } else if (typeof input === 'string') {
          const parsed = JSON.parse(input);
          tableNames = parsed.table_names || [];
          short = parsed.short ?? 1;
        }
      } catch (e) { logger.debug('Parse tableNames failed', { error: e.message }); }
      if (!Array.isArray(tableNames) || tableNames.length === 0) return '请提供 table_names 参数（表名数组）';
      return await getTableDDL(tableNames, { short });
    }
  }),
  new DynamicTool({
    name: "request_tag_confirmation",
    description: "请求用户确认是否将术语添加到表的标签中。当用户纠正表名或提供新的术语-表关联时使用。返回带特殊标记的字符串，会触发前端确认框弹出。",
    params: {
      type: 'object',
      properties: {
        term: { type: 'array', items: { type: 'string' }, description: '术语/关键词数组' },
        table: { type: 'string', description: '关联的表名' },
        description: { type: 'string', description: '表的描述信息' }
      },
      required: ['term', 'table']
    },
    func: (params) => {
      let term, table, description;
      try {
        if (typeof params === 'object') {
          term = params.term;
          table = params.table;
          description = params.description;
        } else if (typeof params === 'string') {
          const parsed = JSON.parse(params);
          term = parsed.term;
          table = parsed.table;
          description = parsed.description;
        }
      } catch (e) { logger.debug('Parse params failed', { error: e.message }); }

      if (!term || !table) {
        return '请提供 term(术语数组) 和 table(表名) 参数';
      }

      return requestTagConfirmation(term, table, description || '');
    }
  }),
  // ★ request_user_choice 工具（v3: questions[] 数组契约）
  //   位置：稳定工具组末尾，**严禁放首位**——会破坏 prefix cache
  new DynamicTool({
    name: "request_user_choice",
    description: "【需要用户输入】当任务需要用户确认/选择/补充才能继续时调用。\n" +
      "参数 questions: 1-3 个问题的数组，每个问题独立可答。\n" +
      "  - question: 必填，问题文本，≤200 字\n" +
      "  - options: 必填，1-4 个选项，每项 ≤100 字\n" +
      "  - multi_select: 可选，true=多选(checkbox)，false=单选(radio)，默认 false\n" +
      "  - header: 可选，问题分类标签，≤12 字\n" +
      "调用后程序自动结束当前轮次并弹出对话框（链式展示 N 张卡片，按钮『下一个』→『完成』）。",
    params: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1-3 个问题的数组',
          minItems: 1, maxItems: 3,
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: '问题文本，≤200 字' },
              options: { type: 'array', items: { type: 'string' }, description: '1-4 个选项，每项 ≤100 字', minItems: 1, maxItems: 4 },
              multi_select: { type: 'boolean', description: 'true=多选/checkbox，false=单选/radio，默认 false' },
              header: { type: 'string', description: '问题分类标签，≤12 字' }
            },
            required: ['question', 'options']
          }
        }
      },
      required: ['questions']
    },
    func: (params) => {
      // 解析（string/object 双兼容）
      let questions;
      try {
        if (typeof params === 'object' && params !== null) {
          questions = params.questions;
        } else if (typeof params === 'string') {
          const parsed = JSON.parse(params);
          questions = parsed.questions;
        }
      } catch (e) {
        logger.debug('Parse request_user_choice params failed', { error: e.message });
        return { error: '参数解析失败', content: '⚠️ request_user_choice 参数解析失败，请传入合法 JSON。' };
      }

      // ★ 校验 + 单调用拆 N marker
      //   success: {markers, payloads, ids, content} 给后端 phase 3 解析
      //   error:   {error, content} LLM 看到 content 修正后重试
      return requestUserChoice(questions);
    }
  }),
  // ===== 可变工具：调用一次后会被剪枝（见 llm.js 中的剪枝逻辑）=====
  // 剪枝顺序：get_domain_index 先剪（Round 2 后），get_sliced_index 后剪（Round 3 后）
  // 顺序必须按"调用顺序"排，先被调用的先剪
  new DynamicTool({
    name: "get_domain_index",
    description: "列出所有业务域（id + 名称 + 描述），用于域路由第一步。",
    params: {
      type: 'object',
      properties: {},
      required: []
    },
    func: async () => {
      const domainIndex = await loadDomainRouterIndex();
      if (!domainIndex || !domainIndex.domains) return '暂无业务域数据';
      return domainIndex.domains.map(d =>
        `- ${d.id} (${d.name}): ${d.description}`
      ).join('\n');
    }
  }),
  new DynamicTool({
    name: "get_sliced_index",
    description: "【按域裁剪】传入 1-5 个 domain_id，返回这些域的候选表池（含标签/关联表/业务规则）。",
    params: {
      type: 'object',
      properties: {
        domain_ids: { type: 'array', items: { type: 'string' }, description: '业务域 id 数组（1-5 个），如 [\"people\", \"finance\"]' }
      },
      required: ['domain_ids']
    },
    func: async (input) => {
      let domainIds = [];
      try {
        if (typeof input === 'object' && input !== null) {
          domainIds = input.domain_ids || [];
        } else if (typeof input === 'string') {
          const parsed = JSON.parse(input);
          domainIds = parsed.domain_ids || [];
        }
      } catch (e) { logger.debug('Parse domainIds failed', { error: e.message }); }
      if (!Array.isArray(domainIds) || domainIds.length === 0) {
        return '请提供 domain_ids 参数（业务域 id 数组）';
      }
      const sliced = await sliceTableIndexByDomains(domainIds);
      if (!sliced.tables || sliced.tables.length === 0) {
        return '指定域下未找到任何表';
      }
      return formatTableInfo(sliced.tables);
    }
  })
];
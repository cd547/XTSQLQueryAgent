import { DynamicTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../../');
const SKILL_V2_PATH = path.join(process.env.SKILL_PATH || path.join(projectRoot, 'skills'), 'sql-creator-skill-v2');

export function loadTableIndex() {
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  if (fs.existsSync(tableIndexPath)) {
    return JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  }
  return null;
}

export function loadDomainRouterIndex() {
  const domainIndexPath = path.join(SKILL_V2_PATH, 'domain_router_index.json');
  if (fs.existsSync(domainIndexPath)) {
    return JSON.parse(fs.readFileSync(domainIndexPath, 'utf-8'));
  }
  return null;
}

export function sliceTableIndex(tableNames) {
  // 1. 规范化输入：转数组、去重、过滤空值和非字符串
  const arr = Array.isArray(tableNames) ? tableNames : [tableNames];
  const uniqueNames = [...new Set(
    arr.filter(n => typeof n === 'string' && n.trim())
  )];

  // 2. 加载全量索引
  const full = loadTableIndex();
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

export function sliceTableIndexByDomains(domainIds) {
  // 1. 规范化输入
  const arr = Array.isArray(domainIds) ? domainIds : [domainIds];
  const uniqueIds = [...new Set(
    arr.filter(id => typeof id === 'string' && id.trim())
  )];

  // 2. 加载每个域的表名
  const tableNames = [];
  const missingDomains = [];
  const emptyDomains = [];

  for (const id of uniqueIds) {
    const domainPath = path.join(SKILL_V2_PATH, 'domains', `${id}.json`);
    if (!fs.existsSync(domainPath)) {
      missingDomains.push(id);
      continue;
    }
    const domain = JSON.parse(fs.readFileSync(domainPath, 'utf-8'));
    if (!domain.tables || domain.tables.length === 0) {
      emptyDomains.push(id);
      continue;
    }
    tableNames.push(...domain.tables);
  }

  // 3. 去重
  const uniqueTableNames = [...new Set(tableNames)];

  // 4. 复用 sliceTableIndex 拿完整卡片
  const sliced = sliceTableIndex(uniqueTableNames);

  // 5. 补充域层信息
  sliced.request_domains = uniqueIds;
  sliced.description = `Sliced by domains (${uniqueIds.length} domains → ${sliced.tables.length}/${uniqueTableNames.length} tables matched)`;
  if (missingDomains.length > 0) sliced.missing_domains = missingDomains;
  if (emptyDomains.length > 0) sliced.empty_domains = emptyDomains;

  return sliced;
}
export function loadSkillMd() {
  const skillMdPath = path.join(SKILL_V2_PATH, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    throw new Error('SKILL.md 未找到，请确保目录存在 skills/sql-creator-skill-v2/SKILL.md');
  }

  return fs.readFileSync(skillMdPath, 'utf-8');
}

function removeEmptyProperties(obj) {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== 'object') return obj;
  
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

export function getTableSchema(tableNames) {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  const result = {};
  for (const name of names) {
    const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${name}.json`);
    if (fs.existsSync(fieldConfigPath)) {
      const config = JSON.parse(fs.readFileSync(fieldConfigPath, 'utf-8'));
      const simplified = removeEmptyProperties(config);
      result[name] = simplified || {};
    } else {
      result[name] = { error: `表 ${name} 的配置不存在` };
    }
  }
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

    filtered.push(trimmed);
  }

  if (filtered.length > 0) {
    filtered[filtered.length - 1] = filtered[filtered.length - 1].replace(/,\s*$/, '');
  }

  return filtered.join('\n');
}

export function getTableDDL(tableNames, options = {}) {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  const short = options.short == 1;
  return names.map(name => {
    const ddlPath = path.join(SKILL_V2_PATH, 'ddl', `${name}.sql`);
    if (fs.existsSync(ddlPath)) {
      let ddl = fs.readFileSync(ddlPath, 'utf-8');
      if (short) {
        ddl = simplifyDDL(ddl);
      }
      return `-- @@TABLE ${name}\n${ddl}`;
    }
    return `-- @@TABLE ${name}\n-- 表 ${name} 的DDL不存在`;
  }).join('\n\n');
}

export function getOutputFormat() {
  const outputFormatPath = path.join(SKILL_V2_PATH, 'templates', 'output_format.md');
  if (fs.existsSync(outputFormatPath)) {
    return fs.readFileSync(outputFormatPath, 'utf-8');
  }
  return '输出格式模板不存在';
}

export function getMysqlLimits() {
  const mysqlLimitsPath = path.join(SKILL_V2_PATH, 'docs', 'mysql57_limits.md');
  if (fs.existsSync(mysqlLimitsPath)) {
    return fs.readFileSync(mysqlLimitsPath, 'utf-8');
  }
  return 'MySQL 5.7 限制信息不存在';
}

export function requestTagConfirmation(term, table, description) {
  if (!Array.isArray(term)) {
    term = [term];
  }
  return `<!--confirm_tag_add:${JSON.stringify({ term, table, description })}-->`;
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
        info += `\n    - ${c.name}: ${c.description}`;
      });
    }
    if (t.business_rules?.length) {
      info += `\n  业务规则:`;
      t.business_rules.forEach(r => {
        info += `\n    - ${r.rule || r.description}: ${r.description}`;
        if (r.query) info += `\n      示例: ${r.query}`;
      });
    }
    return info;
  }).join('\n\n');
}

export const tools = [
  new DynamicTool({
    name: "get_tables",
    description: "【兜底工具，非必要时禁止使用】返回全部表的完整信息。请优先使用 get_domain_index → get_sliced_index 域路由流程。仅当所有业务域都不匹配或 get_sliced_index 返回的表确实不够用时，才调用此工具。",
    params: {
      type: 'object',
      properties: {},
      required: []
    },
    func: () => {
      const tableIndex = loadTableIndex();
      if (!tableIndex || !tableIndex.tables) return '暂无表数据';

      return tableIndex.tables.map(t => {
        let info = `- ${t.name}: ${t.description || ''}`;
        if (t.tags?.length) info += `\n  标签: ${t.tags.join(', ')}`;
        if (t.related_tables?.length) info += `\n  关联表: ${t.related_tables.join(', ')}`;
        if (t.business_constraints?.length) {
          info += `\n  业务约束:`;
          t.business_constraints.forEach(c => {
            info += `\n    - ${c.name}: ${c.description}`;
          });
        }
        if (t.business_rules?.length) {
          info += `\n  业务规则:`;
          t.business_rules.forEach(r => {
            info += `\n    - ${r.rule || r.description}: ${r.description}`;
            if (r.query) info += `\n      示例: ${r.query}`;
          });
        }
        return info;
      }).join('\n\n');
    }
  }),
  new DynamicTool({
    name: "get_table_schema",
    description: "从field_config/表名.json中获取指定表的字段详细信息，包括字段别名、枚举值、业务约束等，支持一次获取多个表。",
    params: {
      type: 'object',
      properties: {
        table_names: { type: 'array', items: { type: 'string' }, description: '需要查询的表名列表' }
      },
      required: ['table_names']
    },
    func: (input) => {
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
      return JSON.stringify(getTableSchema(tableNames), null, 2);
    }
  }),
  new DynamicTool({
    name: "get_table_ddl",
    description: "获取指定表的DDL建表语句。默认只返回列定义（short=1），不含索引、主键、外键。传short=0返回完整DDL。",
    params: {
      type: 'object',
      properties: {
        table_names: { type: 'array', items: { type: 'string' }, description: '需要查询DDL的表名列表' },
        short: { type: 'integer', description: '默认1只返回列定义；传0返回完整DDL含索引/主键/外键' }
      },
      required: ['table_names']
    },
    func: (input) => {
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
      return getTableDDL(tableNames, { short });
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
    new DynamicTool({
    name: "get_domain_index",
    description: "获取业务域路由索引：列出所有业务域。用于判断用户问题归属哪些业务域。",
    params: {
      type: 'object',
      properties: {},
      required: []
    },
    func: () => {
      const domainIndex = loadDomainRouterIndex();
      if (!domainIndex || !domainIndex.domains) return '暂无业务域数据';
      return domainIndex.domains.map(d =>
        `- ${d.id} (${d.name}): ${d.description}`
      ).join('\n');
    }
  }),
  new DynamicTool({
    name: "get_sliced_index",
    description: "【按域裁剪→精简 table_index】在 get_domain_index 选定业务域后调用。传入 1-5 个 domain id 数组，返回这些域涉及的所有表的完整卡片，作为候选表池和最终喂给 SQL 生成器的精简 table_index。",
    params: {
      type: 'object',
      properties: {
        domain_ids: { type: 'array', items: { type: 'string' }, description: '业务域 id 数组（1-5 个），如 [\"people\", \"finance\"]' }
      },
      required: ['domain_ids']
    },
    func: (input) => {
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
      const sliced = sliceTableIndexByDomains(domainIds);
      if (!sliced.tables || sliced.tables.length === 0) {
        return '指定域下未找到任何表';
      }
      return formatTableInfo(sliced.tables);
    }
  })
];
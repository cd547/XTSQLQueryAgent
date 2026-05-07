import { DynamicTool } from '@langchain/core/tools';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_V2_PATH = path.join(process.env.SKILL_PATH || './skills', 'sql-creator-skill-v2');

let cachedSkillMd = null;

export function loadTableIndex() {
  const tableIndexPath = path.join(SKILL_V2_PATH, 'table_index.json');
  if (fs.existsSync(tableIndexPath)) {
    return JSON.parse(fs.readFileSync(tableIndexPath, 'utf-8'));
  }
  return null;
}

export function loadSkillMd() {
  if (cachedSkillMd) return cachedSkillMd;

  const skillMdPath = path.join(SKILL_V2_PATH, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    throw new Error('SKILL.md 未找到，请确保目录存在 skills/sql-creator-skill-v2/SKILL.md');
  }

  cachedSkillMd = fs.readFileSync(skillMdPath, 'utf-8');
  return cachedSkillMd;
}

export function getTableSchema(tableNames) {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  const result = {};
  for (const name of names) {
    const fieldConfigPath = path.join(SKILL_V2_PATH, 'field_config', `${name}.json`);
    if (fs.existsSync(fieldConfigPath)) {
      result[name] = JSON.parse(fs.readFileSync(fieldConfigPath, 'utf-8'));
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

export const tools = [
  new DynamicTool({
    name: "get_tables",
    description: "从table_index.json中列出全部表名、描述、标签、关联表及业务约束（business_constraints）、业务规则（business_constraints）。用于按主题找表。",
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
    description: "获取指定表的DDL建表语句，支持一次获取多个表。传short=1时只返回列定义，不含索引、主键、外键。",
    params: {
      type: 'object',
      properties: {
        table_names: { type: 'array', items: { type: 'string' }, description: '需要查询DDL的表名列表' },
        short: { type: 'integer', description: '传1时只返回列定义，不含索引、主键、外键' }
      },
      required: ['table_names']
    },
    func: (input) => {
      let tableNames = [];
      let short = 0;
      try {
        if (typeof input === 'object' && input !== null) {
          tableNames = input.table_names || [];
          short = input.short || 0;
        } else if (typeof input === 'string') {
          const parsed = JSON.parse(input);
          tableNames = parsed.table_names || [];
          short = parsed.short || 0;
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
  })
];
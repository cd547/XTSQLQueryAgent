/**
 * SQL 校验器
 *
 * 职责：判断一段 SQL 是否"安全可执行"。
 * 被以下场景调用：
 *   1. /query/execute  —— 用户提交 SQL
 *   2. /query/explain  —— 用户提交 SQL
 *   3. 未来：AI 生成的 SQL（validate-then-execute 流程）
 *
 * 设计原则：
 *   - 纯函数，不依赖 Express / DB，方便单元测试
 *   - 返回结构化结果（rule code + message + severity），便于未来"SQL 验证器 UI"展示
 *   - 配置可注入：不同调用方可以指定不同的允许前缀、严格度
 */

/* ============================ 规则注册表 ============================ */

export const RULES = {
  EMPTY_SQL: {
    code: 'EMPTY_SQL',
    severity: 'error',
    message: 'SQL 不能为空',
  },
  TOO_LONG: {
    code: 'TOO_LONG',
    severity: 'error',
    message: `SQL 过长（> {max} 字符）`,
  },
  EMPTY_AFTER_CLEAN: {
    code: 'EMPTY_AFTER_CLEAN',
    severity: 'error',
    message: 'SQL 为空（去除注释后）',
  },
  MULTI_STATEMENT: {
    code: 'MULTI_STATEMENT',
    severity: 'error',
    message: '不允许执行多条 SQL 语句',
  },
  FORBIDDEN_PREFIX: {
    code: 'FORBIDDEN_PREFIX',
    severity: 'error',
    message: '只允许 {prefixes} 查询',
  },
  FORBIDDEN_FUNCTION: {
    code: 'FORBIDDEN_FUNCTION',
    severity: 'error',
    message: 'SQL 中包含不允许的函数或操作：{detail}',
  },
};

/* ============================ 危险函数黑名单 ============================ */

/**
 * 这些函数即使出现在 SELECT 中也可能造成：
 *   - 数据外泄（LOAD_FILE）
 *   - 文件写入（INTO OUTFILE / INTO DUMPFILE）
 *   - DoS（SLEEP / BENCHMARK）
 *   - 会话劫持（GET_LOCK / RELEASE_LOCK）
 *   - 信息泄露（USER / SYSTEM_USER）
 *
 * 用 \b 锚定词边界，避免误伤字面量 `SELECT 'SLEEP' FROM t`。
 */
const DANGEROUS_FUNCTIONS = [
  { re: /\bINTO\s+(?:OUT|DUMP)FILE\b/i,     detail: 'INTO OUTFILE / INTO DUMPFILE' },
  { re: /\bSLEEP\s*\(/i,                     detail: 'SLEEP()' },
  { re: /\bBENCHMARK\s*\(/i,                 detail: 'BENCHMARK()' },
  { re: /\bLOAD_FILE\s*\(/i,                 detail: 'LOAD_FILE()' },
  { re: /\bGET_LOCK\s*\(/i,                  detail: 'GET_LOCK()' },
  { re: /\bRELEASE_LOCK\s*\(/i,              detail: 'RELEASE_LOCK()' },
  { re: /\bUSER\s*\(/i,                      detail: 'USER() / CURRENT_USER()' },
  { re: /\bSYSTEM_USER\s*\(/i,               detail: 'SYSTEM_USER()' },
];

/* ============================ 工具函数 ============================ */

/**
 * 剥离 SQL 中所有注释
 * 处理：/* ... *\/ 块注释、-- 行注释、# MySQL 行注释
 */
export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */ 块注释
    .replace(/--[^\n]*/g, '')            // -- 行注释
    .replace(/#[^\n]*/g, '');            // # 行注释（MySQL 特有）
}

/**
 * 拼接前缀正则
 */
function buildPrefixRe(prefixes) {
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^\\s*(${escaped.join('|')})\\b`, 'i');
}

/* ============================ 公开 API ============================ */

/**
 * 校验 SQL 是否为只读查询
 *
 * @param {string} sql           - 待校验的 SQL
 * @param {object} [options]     - 配置项
 * @param {string[]} [options.allowedPrefixes=['SELECT','WITH']]
 *                                允许的语句前缀
 * @param {number}   [options.maxLength=20000]
 *                                SQL 最大长度
 * @returns {{valid: boolean, code?: string, message?: string, severity?: string, detail?: string, cleaned?: string}}
 */
export function validateReadOnlySql(sql, options = {}) {
  const {
    allowedPrefixes = ['SELECT', 'WITH'],
    maxLength = 20000,
  } = options;

  // 1) 基本类型检查
  if (typeof sql !== 'string' || !sql.trim()) {
    return { valid: false, ...RULES.EMPTY_SQL };
  }

  // 2) 长度上限（防 DoS）
  if (sql.length > maxLength) {
    return {
      valid: false,
      ...RULES.TOO_LONG,
      message: RULES.TOO_LONG.message.replace('{max}', String(maxLength)),
    };
  }

  // 3) 剥离所有注释 + 末尾分号
  const cleaned = stripSqlComments(sql).replace(/;\s*$/, '').trim();

  if (!cleaned) {
    return { valid: false, ...RULES.EMPTY_AFTER_CLEAN, cleaned };
  }

  // 4) 多语句检测：剩余分号 = 第二条语句
  if (/;/.test(cleaned)) {
    return { valid: false, ...RULES.MULTI_STATEMENT, cleaned };
  }

  // 5) 前缀必须是允许的查询语句
  const prefixRe = buildPrefixRe(allowedPrefixes);
  if (!prefixRe.test(cleaned)) {
    return {
      valid: false,
      ...RULES.FORBIDDEN_PREFIX,
      message: RULES.FORBIDDEN_PREFIX.message.replace('{prefixes}', allowedPrefixes.join(' / ')),
      cleaned,
    };
  }

  // 6) 危险函数黑名单
  for (const { re, detail } of DANGEROUS_FUNCTIONS) {
    if (re.test(cleaned)) {
      return {
        valid: false,
        ...RULES.FORBIDDEN_FUNCTION,
        message: RULES.FORBIDDEN_FUNCTION.message.replace('{detail}', detail),
        detail,
        cleaned,
      };
    }
  }

  // 通过校验
  return { valid: true, cleaned };
}

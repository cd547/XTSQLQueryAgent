/**
 * SQL 校验器
 *
 * 职责：判断一段 SQL 是否"安全可执行"。
 * 被以下场景调用：
 *   1. /query/execute  —— 用户提交 SQL
 *   2. /query/explain  —— 用户提交 SQL
 *   3. /query/explain-analyze —— 上一步的 SQL
 *   4. agent 生成的 SQL（validate-then-execute 流程，复制并执行按钮走同一路径）
 *
 * 设计原则：
 *   - 纯函数，不依赖 Express / DB，方便单元测试
 *   - 返回结构化结果（rule code + message + severity），便于未来"SQL 验证器 UI"展示
 *   - 配置可注入：不同调用方可以指定不同的允许前缀、严格度
 *   - 两阶段校验：阶段 1 处理注释（边界绕过），阶段 2 处理结构（白名单/危险函数/多语句）
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
  MYSQL_CONDITIONAL_COMMENT: {
    code: 'MYSQL_CONDITIONAL_COMMENT',
    severity: 'error',
    message: 'SQL 中禁止使用 MySQL 条件注释（/*!...*/）',
  },
  INVALID_SQL: {
    code: 'INVALID_SQL',
    severity: 'error',
    message: 'SQL 语法错误：{detail}',
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

/* ============================ 阶段 1：注释处理（状态机） ============================ */

/**
 * 单遍字符级状态机：剥离普通注释 + 检测 MySQL 条件注释 + 检测未闭合的字符串/块注释
 *
 * 设计要点（防御 SEC-1 边界绕过）：
 *   1. MySQL 条件注释 形如 `/*! ... *\/`（含版本号形式 `/*!12345 ... *\/`）
 *      → MySQL 会把 `*\/` 之间的内容当 SQL 执行；剥离层无法判断目标 MySQL 版本，
 *        因此一律拒绝（一发现即短路返回）。
 *   2. 字符串/反引号内的伪注释符 → 原样保留，不参与剥离。
 *   3. 未闭合的块注释/单引号/双引号/反引号 → 返回 INVALID_SQL 错误。
 *   4. `--` 行注释必须后跟空白或行尾（避免误伤负数 `SELECT -1`）。
 *   5. `\` 转义下一字符（MySQL 默认 SQL_MODE 支持）。
 *   6. `''` / `""` / `` `` `` 双写转义（SQL 标准字面量）。
 *
 * @param {string} sql
 * @returns {{cleaned: string, errors: Array<{code: string, severity: string, message: string}>}}
 */
export function stripSqlComments(sql) {
  const errors = [];
  let cleaned = '';
  let i = 0;
  const len = sql.length;
  // 状态：'NORMAL' | 'IN_LINE_COMMENT' | 'IN_BLOCK_COMMENT'
  //       | 'IN_STRING' | 'IN_QUOTE_STRING' | 'IN_BACKTICK'
  let state = 'NORMAL';

  while (i < len) {
    const c = sql[i];
    const next = i + 1 < len ? sql[i + 1] : '';
    const next2 = i + 2 < len ? sql[i + 2] : '';

    if (state === 'NORMAL') {
      // MySQL 条件注释：/*! 或 /*!12345 一律拒绝（一发现即短路）
      if (c === '/' && next === '*' && next2 === '!') {
        return {
          cleaned: '',
          errors: [{ code: 'MYSQL_CONDITIONAL_COMMENT', ...RULES.MYSQL_CONDITIONAL_COMMENT }],
        };
      }

      // 块注释开始 /*
      if (c === '/' && next === '*') {
        state = 'IN_BLOCK_COMMENT';
        i += 2;
        continue;
      }

      // 行注释 --（后必须跟空白/行尾，避免误伤负数 SELECT -1）
      if (
        c === '-' && next === '-' &&
        (i + 2 >= len || next2 === ' ' || next2 === '\t' || next2 === '\n' || next2 === '\r')
      ) {
        state = 'IN_LINE_COMMENT';
        i += 2;
        continue;
      }

      // 行注释 #（MySQL 特有；不要求后跟空白）
      if (c === '#') {
        state = 'IN_LINE_COMMENT';
        i += 1;
        continue;
      }

      // 字符串/反引号开始
      if (c === "'") { state = 'IN_STRING'; cleaned += c; i += 1; continue; }
      if (c === '"') { state = 'IN_QUOTE_STRING'; cleaned += c; i += 1; continue; }
      if (c === '`') { state = 'IN_BACKTICK'; cleaned += c; i += 1; continue; }

      // 普通字符
      cleaned += c;
      i += 1;
      continue;
    }

    if (state === 'IN_LINE_COMMENT') {
      if (c === '\n') {
        state = 'NORMAL';
        cleaned += c; // 保留换行，避免两行被压成一行
      }
      i += 1;
      continue;
    }

    if (state === 'IN_BLOCK_COMMENT') {
      if (c === '*' && next === '/') {
        state = 'NORMAL';
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    // 字符串 / 双引号 / 反引号：分支合并，靠 quote 字符区分
    const quote = state === 'IN_STRING' ? "'" : state === 'IN_QUOTE_STRING' ? '"' : '`';
    cleaned += c;
    if (c === '\\' && i + 1 < len) {
      // 反斜杠转义下一字符
      cleaned += sql[i + 1];
      i += 2;
      continue;
    }
    if (c === quote) {
      if (next === quote) {
        // 双写转义 '' / "" / ``
        cleaned += quote;
        i += 2;
        continue;
      }
      state = 'NORMAL';
    }
    i += 1;
  }

  // 收尾检查：未闭合的块注释/字符串/反引号
  if (state === 'IN_BLOCK_COMMENT') {
    errors.push({
      code: 'INVALID_SQL',
      ...RULES.INVALID_SQL,
      message: RULES.INVALID_SQL.message.replace('{detail}', '未闭合的块注释 /* ... */'),
    });
  } else if (state === 'IN_STRING') {
    errors.push({
      code: 'INVALID_SQL',
      ...RULES.INVALID_SQL,
      message: RULES.INVALID_SQL.message.replace('{detail}', '未闭合的单引号字符串'),
    });
  } else if (state === 'IN_QUOTE_STRING') {
    errors.push({
      code: 'INVALID_SQL',
      ...RULES.INVALID_SQL,
      message: RULES.INVALID_SQL.message.replace('{detail}', '未闭合的双引号字符串'),
    });
  } else if (state === 'IN_BACKTICK') {
    errors.push({
      code: 'INVALID_SQL',
      ...RULES.INVALID_SQL,
      message: RULES.INVALID_SQL.message.replace('{detail}', '未闭合的反引号标识符'),
    });
  }
  // IN_LINE_COMMENT 自然结束（注释到 EOF）属于正常情况，不报错

  return { cleaned, errors };
}

/**
 * 拼接前缀正则
 */
function buildPrefixRe(prefixes) {
  const escaped = prefixes.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^\\s*(${escaped.join('|')})\\b`, 'i');
}

/* ============================ 阶段 2：结构校验 ============================ */

/**
 * 在已剥离注释的 SQL 上做结构校验：
 *   - 长度上限
 *   - 多语句检测（剩余分号）
 *   - 前缀白名单
 *   - 危险函数黑名单
 *
 * @param {string} cleaned - 已剥离注释的 SQL
 * @param {object} options
 * @returns {{valid: boolean, code?: string, message?: string, severity?: string, detail?: string, cleaned?: string}}
 */
export function validateStructure(cleaned, options = {}) {
  const { allowedPrefixes = ['SELECT', 'WITH'], maxLength = 20000 } = options;

  // 1) 长度上限（防 DoS）
  if (cleaned.length > maxLength) {
    return {
      valid: false,
      ...RULES.TOO_LONG,
      message: RULES.TOO_LONG.message.replace('{max}', String(maxLength)),
    };
  }

  // 2) 多语句检测：剩余分号 = 第二条语句
  if (/;/.test(cleaned)) {
    return { valid: false, ...RULES.MULTI_STATEMENT, cleaned };
  }

  // 3) 前缀必须是允许的查询语句
  const prefixRe = buildPrefixRe(allowedPrefixes);
  if (!prefixRe.test(cleaned)) {
    return {
      valid: false,
      ...RULES.FORBIDDEN_PREFIX,
      message: RULES.FORBIDDEN_PREFIX.message.replace('{prefixes}', allowedPrefixes.join(' / ')),
      cleaned,
    };
  }

  // 4) 危险函数黑名单
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

  return { valid: true, cleaned };
}

/* ============================ 公开 API ============================ */

/**
 * 校验 SQL 是否为只读查询（两阶段编排）
 *
 * 阶段 1：stripSqlComments —— 拒绝 MySQL 条件注释、检测未闭合、剥离普通注释
 * 阶段 2：validateStructure —— 长度/多语句/前缀白名单/危险函数黑名单
 *
 * @param {string} sql           - 待校验的 SQL
 * @param {object} [options]     - 配置项
 * @param {string[]} [options.allowedPrefixes=['SELECT','WITH']]
 * @param {number}   [options.maxLength=20000]
 * @returns {{valid, code?, message?, severity?, detail?, cleaned?}}
 */
export function validateReadOnlySql(sql, options = {}) {
  const { maxLength = 20000 } = options;

  // 0) 基本类型检查
  if (typeof sql !== 'string' || !sql.trim()) {
    return { valid: false, ...RULES.EMPTY_SQL };
  }

  // 0.5) 长度上限（在剥离前先做粗检，避免巨长 SQL 触发状态机）
  if (sql.length > maxLength) {
    return {
      valid: false,
      ...RULES.TOO_LONG,
      message: RULES.TOO_LONG.message.replace('{max}', String(maxLength)),
    };
  }

  // === 阶段 1：注释处理 ===
  const { cleaned: cleanedWithComments, errors } = stripSqlComments(sql);
  if (errors.length > 0) {
    return { valid: false, ...errors[0] };
  }

  // 末尾分号剥离 + 修剪
  const cleaned = cleanedWithComments.replace(/;\s*$/, '').trim();
  if (!cleaned) {
    return { valid: false, ...RULES.EMPTY_AFTER_CLEAN, cleaned };
  }

  // === 阶段 2：结构校验 ===
  return validateStructure(cleaned, options);
}

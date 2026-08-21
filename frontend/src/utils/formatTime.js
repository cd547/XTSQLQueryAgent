/**
 * 时间格式化工具。
 *
 * 背景：SQLite 的 CURRENT_TIMESTAMP 返回 `'YYYY-MM-DD HH:MM:SS'` 这种
 *   "无时区信息的字符串"。前端直接 `new Date('2026-08-21 10:30:00')` 时，
 *   引擎按**本地时区**错解析（中国时区会少 8 小时），导致历史回显时间全错。
 *
 * 修法：显式加上 'T' 分隔符和 'Z' 后缀，构造成 ISO 8601 UTC 格式
 *   (`'YYYY-MM-DDTHH:MM:SSZ'`)，让 `new Date()` 正确按 UTC 解析后再转换到本地时区。
 *
 * 兼容：实时 SSE 流式期间用 `new Date().toISOString()` 直接产出 ISO 字符串，
 *   已是 `...T...Z` 格式，本函数原样返回，不重复处理。
 */

/**
 * 把 SQLite UTC 时间字符串转成 ISO 8601 UTC 格式。
 *  - 输入 `'2026-08-21 10:30:00'` → 输出 `'2026-08-21T10:30:00Z'`
 *  - 输入 `null` / `undefined` / `''` → 原样返回
 *  - 输入已是 ISO 格式（含 'T'）→ 原样返回
 *
 * @param {string|null|undefined} sqliteUtc
 * @returns {string|null|undefined}
 */
export function sqliteUtcToIso(sqliteUtc) {
  if (!sqliteUtc) return sqliteUtc;
  // 已经是 ISO 格式（实时 SSE 路径产出的 `new Date().toISOString()`），直接返回
  if (typeof sqliteUtc === 'string' && sqliteUtc.includes('T')) return sqliteUtc;
  return sqliteUtc.replace(' ', 'T') + 'Z';
}

/**
 * 把 SQLite UTC 时间字符串格式化为本地时区的中文时间字符串。
 *  - 自动走 sqliteUtcToIso 转 ISO，再 new Date() 正确解析
 *  - 24 小时制（与项目偏好一致）
 *
 * @param {string|null|undefined} sqliteUtc
 * @param {Intl.DateTimeFormatOptions} [options] - 透传给 toLocaleString，默认 24 小时制年月日时分
 * @returns {string}
 */
export function formatSqliteUtcLocal(sqliteUtc, options) {
  const iso = sqliteUtcToIso(sqliteUtc);
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', options || { hour12: false });
}

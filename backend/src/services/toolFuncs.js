import { DynamicTool } from "@langchain/core/tools";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { validateSqlFields } from "./validators.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = config.projectRoot;
const SKILL_V2_PATH = path.join(config.skillPath, "sql-creator-skill-v2");

/**
 * DDL 缺失标记：getTableDDL 在表 DDL 文件不存在时返回的占位块。
 * validators.js 用 includes() 检测哪些表 DDL 缺失，必须用同一字符串。
 * 抽常量避免硬编码耦合；格式：`-- 表 <name> 的 DDL 不存在`（注：-- + 1 空格是 SQL 注释）。
 */
export const MISSING_DDL_BLOCK = (name) =>
  `-- 表 ${name} 的 DDL 不存在`;

// 读取文件（如不存在返回 null）。单次系统调用，无 TOCTOU 竞态。
// 每次调用都重新读盘——文件内容可能变化（schema 重建、tag 修改、DDL 变更等），
// 禁止缓存。
async function readFileIfExists(filePath, encoding = "utf-8") {
  try {
    return await fs.promises.readFile(filePath, encoding);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function loadTableIndex() {
  const tableIndexPath = path.join(SKILL_V2_PATH, "table_index.json");
  const content = await readFileIfExists(tableIndexPath);
  return content ? JSON.parse(content) : null;
}

export async function loadDomainRouterIndex() {
  const domainIndexPath = path.join(SKILL_V2_PATH, "domain_router_index.json");
  const content = await readFileIfExists(domainIndexPath);
  return content ? JSON.parse(content) : null;
}

export async function sliceTableIndex(tableNames) {
  // 1. 规范化输入：转数组、去重、过滤空值和非字符串
  const arr = Array.isArray(tableNames) ? tableNames : [tableNames];
  const uniqueNames = [
    ...new Set(arr.filter((n) => typeof n === "string" && n.trim())),
  ];

  // 2. 加载全量索引
  const full = await loadTableIndex();
  if (!full || !Array.isArray(full.tables) || full.tables.length === 0) {
    logger.warn("sliceTableIndex: 全量索引为空或加载失败", { tableNames });
    return {
      version: full?.version || "unknown",
      description: "Sliced index (source empty)",
      sliced_at: new Date().toISOString(),
      source: "table_index.json",
      request_tables: uniqueNames,
      tables: [],
    };
  }

  // 3. 建 name → table 映射 (O(1) 查找)
  const fullByName = Object.fromEntries(full.tables.map((t) => [t.name, t]));

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
    source: "table_index.json",
    request_tables: uniqueNames,
    tables,
  };
  if (missing.length > 0) {
    result.missing_tables = missing;
    logger.warn("sliceTableIndex: 部分表名未在索引中找到", {
      missing,
      requested: uniqueNames,
    });
  }

  return result;
}

export async function sliceTableIndexByDomains(domainIds) {
  // 1. 规范化输入
  const arr = Array.isArray(domainIds) ? domainIds : [domainIds];
  const uniqueIds = [
    ...new Set(arr.filter((id) => typeof id === "string" && id.trim())),
  ];

  // 2. 并行加载每个域的表名（多域时不再串行读盘）
  const domainEntries = await Promise.all(
    uniqueIds.map(async (id) => {
      const domainPath = path.join(SKILL_V2_PATH, "domains", `${id}.json`);
      const content = await readFileIfExists(domainPath);
      if (!content) return { id, status: "missing" };
      const domain = JSON.parse(content);
      if (!domain.tables || domain.tables.length === 0)
        return { id, status: "empty" };
      return { id, status: "ok", tables: domain.tables };
    }),
  );

  const tableNames = [];
  const missingDomains = [];
  const emptyDomains = [];
  for (const { id, status, tables } of domainEntries) {
    if (status === "missing") missingDomains.push(id);
    else if (status === "empty") emptyDomains.push(id);
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
  const skillMdPath = path.join(SKILL_V2_PATH, "SKILL.md");
  const content = await readFileIfExists(skillMdPath);
  if (!content) {
    throw new Error(
      "SKILL.md 未找到，请确保目录存在 skills/sql-creator-skill-v2/SKILL.md",
    );
  }
  return content;
}

/**
 * 工具入参解析器：统一 5 个工具的 string/object 双兼容 + try/catch 模板。
 *
 * 用法：
 *   const { parsed, error, content } = parseToolArgs(input, "get_table_schema");
 *   if (error) return { error, content };
 *   const tableNames = parsed?.table_names || [];
 *
 * 返回：
 *   - {parsed: {...}}       成功：input 是 object 时直接返回；string 时 JSON.parse
 *   - {error, content}      失败：caller 直接 return 给 LLM，error 字段给 caller
 *                           判断是否"不终止 TURN 1"（content 是给 LLM 看的字符串）
 *
 * 设计取舍：
 *   - 不做字段级校验：每个工具的 schema 不同，由各工具自己校验
 *   - 不抹平 `null`：parsed?.foo 让 caller 处理 undefined
 *   - 统一报错前缀 `⚠️ <toolName>`：LLM 看到能直接定位是哪个工具传错
 */
function parseToolArgs(input, toolName) {
  if (input !== null && typeof input === "object") {
    return { parsed: input };
  }
  if (typeof input === "string") {
    try {
      return { parsed: JSON.parse(input) };
    } catch (e) {
      logger.debug(`Parse ${toolName} params failed`, { error: e.message });
      return {
        error: "参数解析失败",
        content: `⚠️ ${toolName} 参数解析失败，请传入合法 JSON。`,
      };
    }
  }
  return {
    error: "参数格式错误",
    content: `⚠️ ${toolName} 入参必须是 object 或 JSON 字符串。`,
  };
}

function removeEmptyProperties(obj) {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== "object") {
    if (typeof obj === "string" && obj.trim() === "") return undefined;
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return undefined;
    const filtered = obj
      .map((item) => removeEmptyProperties(item))
      .filter((item) => item !== undefined);
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

/**
 * 解析 DDL 文件，提取每张表的列信息（含索引 / 外键）。
 *
 * 输出 schema（短键名，与 SKILL.md L32 的图例一致）：
 *   {
 *     "id":            { "t": "bigint(20) unsigned", "c": "主键id",      "k": "PRI" },
 *     "admin_user_id": { "t": "int(11)",            "c": "员工ID",      "k": "MUL" },
 *     "campus_value":  { "t": "varchar(20)",        "c": "校区编码",    "k": "MUL", "nn": true, "d": "" },
 *     ...
 *   }
 *
 * 短键：
 *   t  = type           字段类型（含 size / unsigned / 修饰符）
 *   c  = comment        字段注释（缺省时省略）
 *   k  = key            索引标记：PRI / MUL / UNI（缺省时省略）
 *   nn = NOT NULL       字段非空时为 true（可空时省略，符合"省略默认值"原则）
 *   d  = default        默认值字符串（缺省时省略；空串也省略）
 *   fk = 外键引用       形如 "target_table.col"（缺省时省略）
 *
 * 设计取舍：
 *   1. 字段顺序保留 DDL 原序（与 MySQL `DESCRIBE` 一致），方便 LLM 写 SQL 时按位置参考
 *   2. nn/d/fk/c 全部 "省略默认值"，最大化 token 节省
 *   3. KEY / UNIQUE KEY 的多列索引：把所有列都标 "MUL"/"UNI"（MySQL 行为一致）
 *   4. FOREIGN KEY：只标记第一个被引用的列（MySQL 多列 FK 在本项目 DDL 中未出现）
 *
 * @param {string} ddlContent - 完整 DDL SQL 文本
 * @returns {Object<string, Object>} - 字段名 → 字段元信息
 */
function parseDDLFields(ddlContent) {
  const fields = {};
  // FK 引用映射：列名 → "target_table.col"（从 CONSTRAINT ... FOREIGN KEY ... REFERENCES 提取）
  const fkRefs = new Map();

  for (const rawLine of ddlContent.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // 跳过表头 / 表尾 / 分隔行
    if (/^CREATE\s+TABLE/i.test(line)) continue;
    if (/^\)/.test(line)) continue;
    if (/^ENGINE\s*=/i.test(line)) continue;
    if (/^\)\s*ENGINE/i.test(line)) continue;

    // PRIMARY KEY (`col1`,`col2`)
    const pkMatch = line.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (pkMatch) {
      for (const col of extractColumnNames(pkMatch[1])) {
        ensureField(fields, col).k = "PRI";
      }
      continue;
    }

    // KEY `idx_name` (`col1`,`col2`)  /  KEY (`col`)
    // UNIQUE KEY `name` (`cols`)
    const keyMatch = line.match(
      /^(UNIQUE\s+)?KEY\s+(?:`[^`]+`\s+)?\(([^)]+)\)/i,
    );
    if (keyMatch) {
      const isUnique = !!keyMatch[1];
      const marker = isUnique ? "UNI" : "MUL";
      for (const col of extractColumnNames(keyMatch[2])) {
        // 已被 PRI 标记的不覆盖
        if (fields[col]?.k === "PRI") continue;
        ensureField(fields, col).k = marker;
      }
      continue;
    }

    // CONSTRAINT `name` FOREIGN KEY (`col`) REFERENCES `tgt` (`col`)
    const fkMatch = line.match(
      /^CONSTRAINT\s+`?[^`\s(]+`?\s+FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?(\w+)`?\s*\(([^)]+)\)/i,
    );
    if (fkMatch) {
      const srcCols = extractColumnNames(fkMatch[1]);
      const tgtTable = fkMatch[2];
      const tgtCols = extractColumnNames(fkMatch[3]);
      srcCols.forEach((src, i) => {
        fkRefs.set(src, `${tgtTable}.${tgtCols[i] || tgtCols[0]}`);
      });
      continue;
    }

    // 字段定义行： `col` type [NOT NULL] [DEFAULT ...] [COMMENT '...']
    // 类型可能带 size / unsigned / CHARACTER SET 等
    const colMatch = line.match(
      /^`(\w+)`\s+([^\s,']+(?:\s*\([^)]*\))?(?:\s+unsigned|\s+zerofill)*)/i,
    );
    if (colMatch) {
      const colName = colMatch[1];
      const colType = colMatch[2].trim();
      // 单行内可能含 COMMENT（COMMENT 内容可能含逗号，因此用 rest 而非按行末 split）
      const rest = line.slice(colMatch[0].length);
      const isNotNull = /\bNOT\s+NULL\b/i.test(rest);
      // DEFAULT 后面跟一个字面量（数字 / 字符串 / 关键字如 CURRENT_TIMESTAMP）
      const defaultMatch = rest.match(
        /\bDEFAULT\s+((?:'[^']*')|(?:\([^)]*\))|(?:CURRENT_TIMESTAMP(?:\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP)?)|[^\s,]+)/i,
      );
      const commentMatch = rest.match(/\bCOMMENT\s+'((?:''|[^'])*)'/i);

      const f = ensureField(fields, colName);
      f.t = colType;
      if (isNotNull) f.nn = true;
      if (defaultMatch) {
        let dv = defaultMatch[1];
        // 字符串默认值去引号（'0' → 0, 'pending' → pending）——LLM 视觉上更干净
        if (/^'.*'$|^".*"$/.test(dv)) dv = dv.slice(1, -1);
        // 跳过空串默认（对 nullable 字段无信息量）+ 跳过 NULL（缺省即 nullable 语义）
        if (dv !== "" && dv !== "NULL") f.d = dv;
      }
      if (commentMatch) f.c = commentMatch[1].replace(/''/g, "'");
      continue;
    }
  }

  // 注入外键引用
  for (const [col, ref] of fkRefs) {
    if (fields[col]) fields[col].fk = ref;
  }

  return fields;
}

/** 辅助：从 "(col1, `col2`)" 字符串里提取所有列名（去反引号 / trim / 去重保序） */
function extractColumnNames(colListStr) {
  const names = [];
  const seen = new Set();
  for (const part of colListStr.split(",")) {
    const name = part.trim().replace(/^`|`$/g, "");
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 辅助：保证 fields[col] 存在并返回；用于上面在多分支里渐进式填字段 */
function ensureField(fields, colName) {
  if (!fields[colName]) fields[colName] = {};
  return fields[colName];
}

/**
 * 精简字段属性：只保留 t (类型) / c (注释) / fk (外键引用)
 * - 去掉 k (索引)、nn (NOT NULL)、d (默认值)：对 SELECT 生成几乎无用
 * - 用户在 EXPLAIN 优化等少数场景下需要完整属性时，可传 verbose=true 拿全量
 */
function slimFieldProps(f) {
  if (!f) return f;
  const slim = { t: f.t };
  if (f.c !== undefined) slim.c = f.c;
  if (f.fk !== undefined) slim.fk = f.fk;
  return slim;
}

export async function getTableSchema(tableNames, options = {}) {
  const { verbose = false } = options;
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  // 并行读所有表的 field_config + DDL（多表场景下两个盘都并行触发，不再串行）
  const entries = await Promise.all(
    names.map(async (name) => {
      const fieldConfigPath = path.join(
        SKILL_V2_PATH,
        "field_config",
        `${name}.json`,
      );
      const ddlPath = path.join(SKILL_V2_PATH, "ddl", `${name}.sql`);

      // 单表内也并行读两个文件（fs.promises 读两个盘比串行快一截）
      const [fcContent, ddlContent] = await Promise.all([
        readFileIfExists(fieldConfigPath),
        readFileIfExists(ddlPath),
      ]);

      if (!fcContent && !ddlContent) {
        return [name, { error: `表 ${name} 的 field_config 和 DDL 均不存在` }];
      }

      const result = {};

      // 1. field_config 部分：aliases / enums / associations / rules
      if (fcContent) {
        const config = JSON.parse(fcContent);
        const simplified = removeEmptyProperties(config);
        if (simplified) Object.assign(result, simplified);
        // 外层 key 已是表名，剔除配置文件里冗余的 table_name 字段
        delete result.table_name;
      }

      // 2. DDL 部分：fields（含类型/索引/外键）
      //    放在第一位：LLM 工具 prompt 里把"fields"作为主结构，更显眼
      if (ddlContent) {
        result.fields = parseDDLFields(ddlContent);
      }

      // ★ 2026-08-24：恢复 name 字段（让 JSON 自描述表名）
      //   早期版本有 `delete result.table_name` 注释说"冗余省 15 字符"，
      //   但用户在前端读 JSON 时经常困惑"这是哪张表的数据"——LLM 从 args.table_names 知道，
      //   但人类看不到。name 字段短（一般 10-25 字符），相比可读性收益值得保留。
      result.name = name;

      return [name, result];
    }),
  );
  const result = Object.fromEntries(entries);
  // F20 (2026-08)：精简模式（默认）下过滤掉 k/nn/d 三类对 SELECT 几乎无用的属性
  //   verbose=true 时保留全量（EXPLAIN 优化 / 排查默认值等场景）
  //   在聚合前对每表 fields 单独处理，避免对每个字段重复判断
  if (!verbose) {
    for (const tableData of Object.values(result)) {
      if (tableData?.fields) {
        for (const col of Object.keys(tableData.fields)) {
          tableData.fields[col] = slimFieldProps(tableData.fields[col]);
        }
      }
    }
  }
  return names.length === 1 ? result[names[0]] : result;
}

function simplifyDDL(ddlContent) {
  const lines = ddlContent.split("\n");
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
    if (skipPatterns.some((p) => p.test(trimmed))) continue;

    // 精简字段行：只保留 字段名 + 类型 + COMMENT
    const nameMatch = trimmed.match(/`\w+`/);
    const typeMatch = trimmed.match(/`\w+`\s+(\w+(?:\([^)]*\))?)/);
    const commentMatch = trimmed.match(/(COMMENT\s+'[^']*(?:''[^']*)*')/);
    if (nameMatch && typeMatch) {
      let simplified = nameMatch[0] + " " + typeMatch[1];
      if (commentMatch) {
        simplified += " " + commentMatch[1];
      }
      if (/,\s*$/.test(trimmed)) {
        simplified += ",";
      }
      filtered.push(simplified);
    } else {
      filtered.push(trimmed);
    }
  }

  if (filtered.length > 0) {
    filtered[filtered.length - 1] = filtered[filtered.length - 1].replace(
      /,\s*$/,
      "",
    );
  }

  return filtered.join("\n");
}

export async function getTableDDL(tableNames, options = {}) {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  const short = options.short == 1;
  // 并行读所有表的 DDL（多表时不再串行读盘）
  const blocks = await Promise.all(
    names.map(async (name) => {
      const ddlPath = path.join(SKILL_V2_PATH, "ddl", `${name}.sql`);
      const content = await readFileIfExists(ddlPath);
      if (content) {
        const ddl = short ? simplifyDDL(content) : content;
        return `-- @@TABLE ${name}\n${ddl}`;
      }
      return `-- @@TABLE ${name}\n${MISSING_DDL_BLOCK(name)}`;
    }),
  );
  return blocks.join("\n\n");
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
  return "uc_" + Math.random().toString(36).slice(2, 8);
}

export function buildUserChoiceMarker(question, options, multiSelect, header) {
  const id = makeUserChoiceId();
  const payload = {
    id,
    question: String(question || "").slice(0, 200),
    options: (Array.isArray(options) ? options : [])
      .slice(0, 4)
      .map((o) => String(o).slice(0, 100)),
    multi_select: !!multiSelect,
    header: String(header || "").slice(0, 12),
  };
  return {
    id,
    marker: `<!--user_choice:${JSON.stringify(payload)}-->`,
    payload,
  };
}

// ★ 校验 questions[] 数组：每条 question 必须 1-4 options + question ≤200 字
// 返回 {ok, msg} —— ok=false 时 caller 应把 msg 当 error 返回 LLM 让其重试
function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, msg: "questions 必须是非空数组" };
  }
  if (questions.length > 3) {
    return {
      ok: false,
      msg: `questions 最多 3 条（再多弹窗链过长），当前 ${questions.length}`,
    };
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] || {};
    const idx = i + 1;
    if (!q.question || typeof q.question !== "string") {
      return { ok: false, msg: `第 ${idx} 题 question 必填且为字符串` };
    }
    if (q.question.length > 200) {
      return {
        ok: false,
        msg: `第 ${idx} 题 question ≤200 字（当前 ${q.question.length}）`,
      };
    }
    if (!Array.isArray(q.options) || q.options.length < 1) {
      return { ok: false, msg: `第 ${idx} 题 options 至少 1 个` };
    }
    if (q.options.length > 4) {
      return {
        ok: false,
        msg: `第 ${idx} 题 options 最多 4 个（当前 ${q.options.length}）`,
      };
    }
    for (let j = 0; j < q.options.length; j++) {
      const opt = q.options[j];
      if (!opt || typeof opt !== "string") {
        return {
          ok: false,
          msg: `第 ${idx} 题 第 ${j + 1} 个 option 必填且为字符串`,
        };
      }
      if (opt.length > 100) {
        return {
          ok: false,
          msg: `第 ${idx} 题 第 ${j + 1} 个 option ≤100 字（当前 ${opt.length}）`,
        };
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
      content: `⚠️ ${v.msg}。请修正后重新调用 request_user_choice(questions: [...])。`,
    };
  }
  const items = questions.map((q) => {
    const r = buildUserChoiceMarker(
      q.question,
      q.options,
      q.multi_select,
      q.header,
    );
    return { marker: r.marker, payload: r.payload, id: r.id };
  });
  return {
    markers: items.map((it) => it.marker),
    payloads: items.map((it) => it.payload),
    ids: items.map((it) => it.id),
    content: items.map((it) => it.marker).join(""),
  };
}

// 表格卡片格式化：与 get_tables 输出保持一致，供 get_sliced_index 共用
// 注意：business_constraints / business_rules 五分支防御（避免 `${label}: ${desc}`
//   在任一为空时产生 "undefined: D" / "X: undefined"）。
// ★ 2026-08-25：formatTableInfoCompact 已随折叠机制移除（方案 B 不折叠），
//   本函数成为唯一的表格卡片格式化实现。
function formatTableInfo(tables) {
  return tables
    .map((t) => {
      let info = `- ${t.name}: ${t.description || ""}`;
      if (t.tags?.length) info += `\n  标签: ${t.tags.join(", ")}`;
      if (t.related_tables?.length)
        info += `\n  关联表: ${t.related_tables.join(", ")}`;
      if (t.business_constraints?.length) {
        info += `\n  业务约束:`;
        t.business_constraints.forEach((c) => {
          if (typeof c === "string") {
            info += `\n    - ${c}`;
          } else if (c.name) {
            info += `\n    - ${c.name}: ${c.description || ""}`;
          } else if (c.description) {
            info += `\n    - ${c.description}`;
          } else {
            info += `\n    - (空约束)`;
          }
        });
      }
      if (t.business_rules?.length) {
        info += `\n  业务规则:`;
        t.business_rules.forEach((r) => {
          if (typeof r === "string") {
            info += `\n    - ${r}`;
          } else if (r.rule) {
            info += `\n    - ${r.rule}: ${r.description || ""}`;
          } else if (r.description) {
            info += `\n    - ${r.description}`;
          } else {
            info += `\n    - (空规则)`;
          }
          if (r.query) info += `\n      示例: ${r.query}`;
        });
      }
      return info;
    })
    .join("\n\n");
}

// ★ 2026-08-25：formatTableInfoCompact 已删除 —— 它随折叠机制（compactConsumedToolResults）
//   一起移除（方案 B 不折叠）。它与 formatTableInfo 的唯一差异是不输出 related_tables，
//   实测该差异仅占完整版 token 的 ~47%，却导致模型无法批量规划多表 schema 调用。

export const tools = [
  // new DynamicTool({
  //   name: "get_tables",
  //   description: "【兜底工具，谨慎使用】返回全部表信息。仅在 get_domain_index/get_sliced_index 都不够用时调用。",
  //   params: {
  //     type: 'object',
  //     properties: {},
  //     required: []
  //   },
  //   func: async () => {
  //     const tableIndex = await loadTableIndex();
  //     if (!tableIndex || !tableIndex.tables) return '暂无表数据';

  //     return tableIndex.tables.map(t => {
  //       let info = `- ${t.name}: ${t.description || ''}`;
  //       if (t.tags?.length) info += `\n  标签: ${t.tags.join(', ')}`;
  //       if (t.related_tables?.length) info += `\n  关联表: ${t.related_tables.join(', ')}`;
  //       if (t.business_constraints?.length) {
  //         info += `\n  业务约束:`;
  //         t.business_constraints.forEach(c => {
  //           if (typeof c === 'string') {
  //             info += `\n    - ${c}`;
  //           } else {
  //             info += `\n    - ${c.name}: ${c.description}`;
  //           }
  //         });
  //       }
  //       if (t.business_rules?.length) {
  //         info += `\n  业务规则:`;
  //         t.business_rules.forEach(r => {
  //           if (typeof r === 'string') {
  //             info += `\n    - ${r}`;
  //           } else {
  //             info += `\n    - ${r.rule || r.description}: ${r.description}`;
  //             if (r.query) info += `\n      示例: ${r.query}`;
  //           }
  //         });
  //       }
  //       return info;
  //     }).join('\n\n');
  //   }
  // }),
  new DynamicTool({
    name: "get_table_schema",
    description:
      "获取指定表的字段信息。返回 JSON：\n" +
      "• 单表: {fields, aliases?, enums?, virtual_associations?, business_constraints?, business_rules?}\n" +
      "  - fields: {列名: {t:类型, c?:注释, fk?:外键}}\n" +
      "  - 失败: {error: '原因'}\n" +
      "• 多表: {表名: <单表结构>, ...}",
    params: {
      type: "object",
      properties: {
        table_names: {
          type: "array",
          items: { type: "string" },
          description: "表名数组",
        },
      },
      required: ["table_names"],
    },
    func: async (input) => {
      const { parsed, error, content } = parseToolArgs(
        input,
        "get_table_schema",
      );
      if (error) return { error, content };
      const tableNames = parsed?.table_names || [];
      if (!Array.isArray(tableNames) || tableNames.length === 0) {
        return {
          error: "table_names 必填",
          content: "⚠️ get_table_schema 需要 table_names 参数（表名数组）。",
        };
      }
      // 紧凑 JSON：无缩进。deepseek-v3 对 JSON 结构化数据解析无差别，
      // 但能省 25-40% token（多表场景节省更显著），且对多轮上下文累积友好。
      // F20：LLM 永远拿到精简版（仅 t/c/fk），无需 verbose 选项
      return JSON.stringify(await getTableSchema(tableNames));
    },
  }),
  new DynamicTool({
    name: "request_tag_confirmation",
    description:
      "当用户纠正表名或给出术语-表映射时，请求用户确认是否将该术语加入表标签。",
    params: {
      type: "object",
      properties: {
        term: {
          type: "array",
          items: { type: "string" },
          description: "术语/关键词数组",
        },
        table: { type: "string", description: "关联的表名" },
        description: { type: "string", description: "表的描述信息" },
      },
      required: ["term", "table"],
    },
    func: (params) => {
      const { parsed, error, content } = parseToolArgs(
        params,
        "request_tag_confirmation",
      );
      if (error) return { error, content };
      const { term, table, description } = parsed || {};
      if (!term || !table) {
        return {
          error: "term 和 table 必填",
          content:
            "⚠️ request_tag_confirmation 需要 term(术语数组) 和 table(表名) 参数。",
        };
      }
      return requestTagConfirmation(term, table, description || "");
    },
  }),
  // ★ request_user_choice 工具（v3: questions[] 数组契约）
  //   位置：稳定工具组末尾，**严禁放首位**——会破坏 prefix cache
  new DynamicTool({
    name: "request_user_choice",
    description:
      "当需要用户确认/选择/补充才能继续时调用。",
    params: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "问题数组",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "≤200 字" },
              options: {
                type: "array",
                items: { type: "string" },
                description: "每项 ≤100 字",
                minItems: 1,
                maxItems: 4,
              },
              multi_select: {
                type: "boolean",
                description: "true=多选, false=单选(默认)",
              },
              header: { type: "string", description: "问题标签，≤12 字" },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    },
    func: (params) => {
      const { parsed, error, content } = parseToolArgs(
        params,
        "request_user_choice",
      );
      if (error) return { error, content };
      // ★ 校验 + 单调用拆 N marker
      //   success: {markers, payloads, ids, content} 给后端 phase 3 解析
      //   error:   {error, content} LLM 看到 content 修正后重试
      return requestUserChoice(parsed?.questions);
    },
  }),
  // ===== 可变工具：调用一次后会被剪枝（见 llm.js 中的剪枝逻辑）=====
  // 剪枝顺序：get_sliced_index 后剪（Round 3 后）
  // 注：get_domain_index 已迁移至 system 消息内嵌（2026-08），不再作为 LLM 工具调用。
  //     为兼容旧会话（history 中已存在 get_domain_index tool message）暂时保留，
  //     description 显式标记"已废弃"，LLM 不应再调用。
  new DynamicTool({
    name: "get_domain_index",
    description:
      "【已废弃，请勿调用】业务域列表已嵌入系统提示词的「可用业务域」小节，根据问题直接选域后调用 get_sliced_index(domain_ids) 即可。调用本工具将浪费 token 且不会得到新信息。",
    params: {
      type: "object",
      properties: {},
      required: [],
    },
    func: async () => {
      const domainIndex = await loadDomainRouterIndex();
      if (!domainIndex || !domainIndex.domains) {
        return {
          error: "domain_index 不存在",
          content: "⚠️ get_domain_index 暂无业务域数据。",
        };
      }
      return domainIndex.domains
        .map((d) => `- ${d.id} (${d.name}): ${d.description}`)
        .join("\n");
    },
  }),
  new DynamicTool({
    name: "get_sliced_index",
    description: "传入domain_id，返回这些域的候选表。",
    params: {
      type: "object",
      properties: {
        domain_ids: {
          type: "array",
          items: { type: "string" },
          description: '业务域 id 数组（1-5 个），如 [\"people\", \"finance\"]',
        },
      },
      required: ["domain_ids"],
    },
    func: async (input) => {
      const { parsed, error, content } = parseToolArgs(
        input,
        "get_sliced_index",
      );
      if (error) return { error, content };
      const domainIds = parsed?.domain_ids || [];
      if (!Array.isArray(domainIds) || domainIds.length === 0) {
        return {
          error: "domain_ids 必填",
          content: "⚠️ get_sliced_index 需要 domain_ids 参数（业务域 id 数组）。",
        };
      }
      const sliced = await sliceTableIndexByDomains(domainIds);
      if (!sliced.tables || sliced.tables.length === 0) {
        return {
          error: "域下无表",
          content: `⚠️ get_sliced_index: 指定域 ${JSON.stringify(domainIds)} 下未找到任何表。`,
        };
      }
      return formatTableInfo(sliced.tables);
    },
  }),
  // ===== 稳定工具（不剪枝，可多次调用）=====
  // validate_sql_fields：LLM 输出 SQL 前的自检工具（不剪枝，LLM 可反复调用直到通过）
  // 详见 docs/superpowers/plans/2026-07-23-validate-sql-fields-tool-final.md
  new DynamicTool({
    name: "validate_sql_fields",
    description:
      "【SQL 质量自检】输出 SQL 前必调，校验规则：\n" +
      "  R1 字段-表归属\n" +
      "  R2 字段别名反引号\n" +
      "  R3 MySQL 5.7 限制\n" +
      "  R5 必须含 LIMIT\n" +
      "返回 {valid, errors, summary}。",
    params: {
      type: "object",
      properties: {
        sql: { type: "string", description: "待校验的SQL" },
      },
      required: ["sql"],
    },
    func: async (input) => {
      const { parsed, error, content } = parseToolArgs(
        input,
        "validate_sql_fields",
      );
      if (error) return { error, content };
      const sql = String(parsed?.sql || "");
      if (!sql.trim()) {
        return {
          error: "sql 必填",
          content: "⚠️ validate_sql_fields 需要 sql 参数。",
        };
      }
      // 返回结构化对象（caller 从 rawResult 读 valid / errors 写入 registry）
      //   - content 字段：序列化后的字符串，给 LLM 看的（content 必须是 string/list）
      //   - valid / errors / summary 字段：结构化数据，给 llm.js 写 registry 用
      //   紧凑 JSON（与 get_table_schema 一致，省 20-30% token）；
      //   前端 ChatMessage 对紧凑 JSON 会自动 pretty 后再展示，人类阅读不受影响
      const result = await validateSqlFields({ sql });
      return {
        content: JSON.stringify(result),
        valid: result.valid,
        errors: result.errors,
        summary: result.summary,
      };
    },
  }),
  // ===== F23 (2026-08): get_call_history =====
  // 由 llm.js 在每轮强制注入到 assistant.tool_calls 最前面的"系统工具"。
  // 工具描述里**不写"避免重复调用"**——那是 SKILL.md / system 的事，
  // description 字段写"无入参"避免 LLM 误传参数。
  // 真正的返回内容由 llm.js 在执行阶段拦截、按当前 reg.callHistory 构造。
  // 不放入 LLM_TOOLS（filter 已过滤），LLM 看不到该工具。
  new DynamicTool({
    name: "get_call_history",
    description:
      "【系统工具，由程序自动注入】返回本会话已调用的工具历史。无入参。",
    params: {
      type: "object",
      properties: {},
      required: [],
    },
    func: async () => {
      // 占位返回：实际值由 llm.js 工具执行循环拦截后构造
      return '{"called_count":0,"called_tools":[],"_note":"interceptor-overridden"}';
    },
  }),
];

// ============================================================
// LLM_TOOLS：发送给 LLM 的工具列表（去掉已废弃工具和系统自动注入的工具）
// F18 (2026-08)：get_domain_index 已迁移至 system 消息内嵌，LLM 不应再看到。
//   - tools 数组保留 get_domain_index 定义（旧会话 history 兼容 + 兜底执行
//     toolsMap 仍能命中，避免"未知工具"错误）
// F23 (2026-08)：get_call_history 由 llm.js 在每轮强制注入到 assistant.tool_calls
//   的最前面，无需 LLM 主动调用，也不应展示给 LLM（避免"要不要调"的决策延迟）。
//   - tools 数组保留 get_call_history 定义（执行层 toolsMap 命中用）
//   - LLM_TOOLS 过滤掉，让 LLM 看不到该工具
//   - llm.js 强制注入时使用 synthetic tool_call_id
// ============================================================
export const LLM_TOOLS = tools.filter(
  (t) => t.name !== "get_domain_index" && t.name !== "get_call_history",
);

// ============================================================
// buildSystemMessage：CC path + Responses path 共用的 system message 装配函数
// 单一来源（避免两处各写一份导致漂移）。
// 输入：已加载的 SKILL.md 内容
// 输出：完整 system message（身份前缀 + SKILL + 可用业务域清单）
// ============================================================
export async function buildSystemMessage(skillMd) {
  // 每次请求重新读 domain_router_index.json（用户决策：保证热更新即时生效，
  // 接受少量 IO 开销）。文件通常 <10KB，单次 readFile <1ms。
  const domainIndex = await loadDomainRouterIndex();
  // F19 (2026-08)：id 加反引号 + 中文名用全角括号，结构上让 id 更突出
  //   降低模型把"name"误当成 id 传给 get_sliced_index 的概率
  const domainList =
    (domainIndex?.domains || [])
      .map((d) => `- \`${d.id}\`（${d.name}）: ${d.description}`)
      .join("\n") || "（暂无业务域）";
  return (
    `你是XTSQLQueryAgent。严格遵守以下规则，随后根据用户问题生成SQL。\n` +
    `${skillMd}\n\n` +
    `## 可用业务域\n` +
    `> 传给 get_sliced_index 的 domain_ids 必须是左侧 \`id\`（英文部分），不是括号里的中文名。\n` +
    `${domainList}\n\n` +
    `## 输出风格（硬规则）\n` +
    `- **遇到信息不足时立即询问用户**：如果连续调用 2 次工具仍无法定位所需字段或表，**必须立刻调 \`request_user_choice\` 询问用户**，不要继续调工具。\n` +
    `- **每个工具调用前必须明确目的**：在调用工具前先用一句话说明要查什么、为什么查。`
  );
}

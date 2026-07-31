/**
 * MySQL 连接池
 *
 * 用途：所有热路径（/execute、/explain、/fetch-ddl 等）复用同一个连接池，
 *      避免每次请求都 TCP 握手 + auth + close。
 *
 * 设计：
 *  - 基于 db_config（来自 SQLite configs 表）生成 pool key，配置变更时自动重建
 *  - 单例：每个进程内同一个 (host, port, user, database) 只存在一个 pool
 *  - 池大小：默认 10 个连接（满足 N 个用户并发查询不排队）
 *  - 等待连接：超过上限时排队等待，最长 5s
 *  - 空闲回收：10 分钟无活动则关闭（防 DB 端 idle timeout 杀连接）
 */

import mysql from 'mysql2/promise';
import { getConfig } from './config.js';
import { logger } from '../logger.js';

const POOL_CONFIG = {
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,            // 0 = 不限队列长度（依赖 acquireTimeout 兜底，2026-07-29 B12 修复）
  idleTimeout: 600000,      // 10 分钟（毫秒）
  enableKeepAlive: true,    // TCP keepalive，防中间网络设备断连
  keepAliveInitialDelay: 30000,  // 30s 后开始 keepalive
  multipleStatements: false,    // 显式禁用多语句（防 SQL 注入）
  connectTimeout: 10000,    // 单次 TCP 握手超时（mysql2 默认 10s，显式声明）
};

// 2026-07-29 B12 修复：mysql2/promise 原生不支持 acquireTimeout，
// 在 poolQuery 包装层用 Promise.race 强制兜底。
// 行为：慢查询占满 10 个连接后，第 11+ 个请求排队；超过 15s 仍拿不到连接就报错给前端，
// 避免前端无限转圈。queryTimeout 30s 兜底单查询执行时间。
const ACQUIRE_TIMEOUT_MS = 15000;  // 拿不到连接 15s 报错
const QUERY_TIMEOUT_MS = 30000;    // 单查询 30s 超时（mysql2 会 destroy 连接）

let pool = null;
let poolKey = null;     // 当前 pool 对应的配置指纹
let poolConfigSnapshot = null;  // 当前 pool 用到的完整 config（用于查询/连接参数）
// ★ B22 修复：单例锁——并发请求只跑一次 getPool 主体，防止 double-close / 重复创建
//   场景：配置变更期间 await closePool() 挂起时，新请求进入会"看到"旧 pool 并触发
//   第二次 closePool，把刚刚被赋值的 pool 错误地关闭掉。
//   锁存在时所有并发请求共享同一 Promise 解析结果，串行化整个初始化过程。
let poolInitPromise = null;

/**
 * 计算 config 指纹：host/port/user/database 任一变化则重建 pool
 */
function buildPoolKey(cfg) {
  return `${cfg.host || 'localhost'}:${cfg.port || 3306}|${cfg.user || ''}@${cfg.database || ''}`;
}

/**
 * 销毁当前 pool（配置变更或进程退出时调用）
 */
export async function closePool() {
  if (pool) {
    try {
      await pool.end();
      logger.info('MySQL pool closed', { poolKey });
    } catch (e) {
      logger.warn('MySQL pool close failed', { error: e.message });
    } finally {
      pool = null;
      poolKey = null;
      poolConfigSnapshot = null;
    }
  }
}

/**
 * 获取当前 pool（不存在则创建；配置变更则重建）
 *
 * @returns {Promise<mysql.Pool>}
 * @throws  当 db_config 未配置或连接失败时抛错
 */
export async function getPool() {
  // ★ B22 修复：单例锁——已有进行中的初始化，直接复用其结果
  if (poolInitPromise) return poolInitPromise;

  poolInitPromise = (async () => {
    const cfg = getConfig();
    if (!cfg) {
      throw new Error('数据库未配置');
    }

    const key = buildPoolKey(cfg);

    // 配置指纹变了 → 关旧 pool，开新的
    if (pool && poolKey !== key) {
      logger.info('MySQL config changed, recreating pool', { oldKey: poolKey, newKey: key });
      await closePool();
    }

    if (!pool) {
      pool = mysql.createPool({
        ...POOL_CONFIG,
        host: cfg.host,
        port: cfg.port || 3306,
        user: cfg.user,
        password: cfg.password,
        database: cfg.database,
      });
      poolKey = key;
      poolConfigSnapshot = cfg;
      logger.info('MySQL pool created', { key, connectionLimit: POOL_CONFIG.connectionLimit });
    }

    return pool;
  })().finally(() => {
    // 无论成功失败都解锁，让下一轮 getPool 能正常进入
    poolInitPromise = null;
  });

  return poolInitPromise;
}

/**
 * 用 Promise.race 给任意 Promise 加超时；超时后 reject 带明确错误信息。
 * 注意：超时不会取消底层 Promise（只是不再 await 它），调用方需自己保证资源释放
 * —— 对应到 poolQuery，超时后底层 connection 仍会被 mysql2 通过 conn.destroy() 处理（见 queryTimeout 路径），
 * 或被 pool 自身的回收机制处理。
 */
function withTimeout(promise, timeoutMs, errorMsg) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
    })
  ]);
}

/**
 * 执行一次查询的便捷方法（从 pool 取连接、用完自动 release）
 *
 * 2026-07-29 B12 修复：加双层超时保护
 *   - acquireTimeout (15s)：拿不到连接时直接报错，避免慢查询占满 10 个连接后请求永久挂起
 *   - queryTimeout (30s)：单查询执行超时，mysql2 会 destroy 连接避免泄漏
 *
 * @param {string} sql
 * @param {Array}  [params]
 * @returns {Promise<[rows, fields]>}
 */
export async function poolQuery(sql, params) {
  const p = await getPool();
  const conn = await withTimeout(
    p.getConnection(),
    ACQUIRE_TIMEOUT_MS,
    `acquireTimeout: failed to get MySQL connection in ${ACQUIRE_TIMEOUT_MS}ms (pool saturated: ${p.pool?._allConnections?.length || '?'}/${POOL_CONFIG.connectionLimit} used)`
  );
  try {
    // mysql2 原生 query timeout：超时会 destroy 连接（不会泄漏）；
    // 服务端查询可能仍在跑，但客户端不再等待，符合"前端转圈兜底"诉求
    const queryOptions = { sql, timeout: QUERY_TIMEOUT_MS };
    if (params !== undefined) queryOptions.values = params;
    const [rows, fields] = await conn.query(queryOptions);
    return [rows, fields];
  } finally {
    conn.release();
  }
}

// 进程退出时优雅关闭 pool
process.on('SIGTERM', () => { closePool().catch(() => {}); });
process.on('SIGINT',  () => { closePool().catch(() => {}); });

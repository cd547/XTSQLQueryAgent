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
  queueLimit: 0,            // 0 = 不限队列长度
  idleTimeout: 600000,      // 10 分钟（毫秒）
  enableKeepAlive: true,    // TCP keepalive，防中间网络设备断连
  keepAliveInitialDelay: 30000,  // 30s 后开始 keepalive
  multipleStatements: false,    // 显式禁用多语句（防 SQL 注入）
};

let pool = null;
let poolKey = null;     // 当前 pool 对应的配置指纹
let poolConfigSnapshot = null;  // 当前 pool 用到的完整 config（用于查询/连接参数）

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
}

/**
 * 执行一次查询的便捷方法（从 pool 取连接、用完自动 release）
 *
 * @param {string} sql
 * @param {Array}  [params]
 * @returns {Promise<[rows, fields]>}
 */
export async function poolQuery(sql, params) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    const [rows, fields] = await conn.query(sql, params);
    return [rows, fields];
  } finally {
    conn.release();
  }
}

// 进程退出时优雅关闭 pool
process.on('SIGTERM', () => { closePool().catch(() => {}); });
process.on('SIGINT',  () => { closePool().catch(() => {}); });

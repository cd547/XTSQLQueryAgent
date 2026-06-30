/**
 * 文件系统工具（CODE-3 修复）
 */

import { mkdirSync } from 'fs';
import { logger } from '../logger.js';

/**
 * 确保目录存在；区分"已存在"与真实错误。
 *
 * 替代旧的 `try { mkdirSync(..., { recursive: true }) } catch (e) {}` 模式，
 * 避免静默吞掉 EACCES/ENOSPC/EROFS 等真错误。
 *
 * @param {string} dir   - 要确保存在的目录路径
 * @param {string} label - 描述性名称（用于错误日志，如 "database" / "log"）
 * @throws 真实错误（权限不足、磁盘满等）会被记录到 logger.error 并抛出
 */
export function ensureDir(dir, label = 'directory') {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    if (e.code === 'EEXIST') return;  // 目录已存在是预期场景
    logger.error(`Failed to create ${label} directory`, {
      dir,
      code: e.code,
      error: e.message
    });
    throw e;
  }
}

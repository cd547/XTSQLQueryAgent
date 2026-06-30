/**
 * Skill 树缓存（PERF-5 修复）
 *
 * 设计：fs.watch 主动失效（300ms 防抖）+ mtime 兜底（请求时校验）
 *
 * 失效触发：
 *   - fs.watch 'change' / 'rename'（增、删、改）→ 300ms 防抖合并
 *   - 显式调用 invalidateAfterWrite()（/save /add-tag /create-table-files 写后）
 *   - mtime 不一致（fs.watch 漏事件兜底）
 */

import fs from 'fs';
import { logger } from '../logger.js';

export function createSkillTreeCache(skillsPath, buildTree) {
  let treeCache = null;        // { tree, mtimeMs, builtAt }
  let watchDebounceTimer = null;
  let watcher = null;

  function invalidate(reason) {
    if (treeCache) {
      logger.debug('Skill tree cache invalidated', { reason });
      treeCache = null;
    }
  }

  function invalidateAfterWrite() {
    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = null;
    }
    invalidate('explicit write');
  }

  function setupWatcher() {
    if (watcher) return;
    if (!fs.existsSync(skillsPath)) return;

    try {
      watcher = fs.watch(
        skillsPath,
        { recursive: true, persistent: true },
        (eventType, filename) => {
          if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
          watchDebounceTimer = setTimeout(() => {
            invalidate(`fs.watch ${eventType} ${filename || '?'}`);
          }, 300);
        }
      );
      watcher.on('error', (e) => {
        logger.error('Skill tree watcher error, falling back to mtime-only mode', { error: e.message });
        watcher = null;
      });
      logger.info('Skill tree watcher initialized', { skillsPath });
    } catch (e) {
      logger.warn('fs.watch recursive failed, using mtime-only mode', { error: e.message });
      watcher = null;
    }
  }

  function countTree(nodes) {
    let n = 0;
    for (const node of nodes) {
      n++;
      if (node.children) n += countTree(node.children);
    }
    return n;
  }

  function get() {
    if (!fs.existsSync(skillsPath)) return { tree: [] };

    const dirStat = fs.statSync(skillsPath);
    const mtimeMs = dirStat.mtimeMs;

    if (treeCache && treeCache.mtimeMs === mtimeMs) {
      return treeCache;
    }

    const tree = buildTree(skillsPath);
    treeCache = { tree, mtimeMs, builtAt: Date.now() };
    logger.info('Skill tree rebuilt', { mtimeMs, files: countTree(tree) });
    return treeCache;
  }

  function close() {
    if (watchDebounceTimer) {
      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = null;
    }
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    treeCache = null;
  }

  setupWatcher();

  return { get, invalidate, invalidateAfterWrite, close, _cacheRef: () => treeCache };
}

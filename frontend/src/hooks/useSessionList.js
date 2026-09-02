/**
 * useSessionList Hook
 *
 * 封装会话列表的数据层 + 分页加载：
 *  - 状态：sessions / sessionsTotal / hasMoreSessions / loadingMoreSessions
 *  - 加载：loadMoreSessions（分页加载下一页）
 *  - 滚动：handleSiderScroll（触底 80px 内自动加载更多）
 *  - 列表变更原语：addSession / removeSession / updateSessionName
 *    （供 App.jsx 的 handleNewSession / handleDeleteSession / handleRenameSession 等调用）
 *
 * 设计决策：
 *  - loadSessions 故意不放在这里：它有"加载后自动选第一会话"的副作用，
 *    需要 setCurrentSessionId / setCurrentTokens / setCurrentSessionName 等跨切关注点。
 *    App.jsx 保留 loadSessions 实现，使用本 hook 暴露的 setters。
 *  - 不在此 hook 内做跨切 setState（currentSessionId、messages、abortController 等），
 *    保持职责单一。
 *  - 内部用 loadingRef 防止重复加载（与 App.jsx 的 loadingRef 独立，不共享 model/messages 等键）。
 *  - 不使用 useCallback 包裹 setSessions 等 setter（React 保证 setState 引用稳定）。
 */
import { useState, useRef, useCallback } from 'react';
import { getSessions } from '../api/index.js';
import { SESSIONS_PAGE_SIZE } from '../utils/constants.js';

export function useSessionList() {
  const [sessions, setSessions] = useState([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);

  // 加载锁：sessions（首屏加载）和 sessionsMore（分页）独立标记
  const loadingRef = useRef({ sessions: false, sessionsMore: false });

  // 列表变更原语
  // 新会话插到列表最前，分页计数 +1
  const addSession = useCallback((session) => {
    setSessions(prev => [session, ...prev]);
    setSessionsTotal(prev => prev + 1);
  }, []);

  // 本地移除并同步分页计数
  const removeSession = useCallback((sessionId) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setSessionsTotal(prev => Math.max(0, prev - 1));
  }, []);

  // 重命名后同步本地列表（可选同步 summary，供会话列表 tooltip 展示）
  const updateSessionName = useCallback((sessionId, newName, summary) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: newName, ...(summary !== undefined ? { summary } : {}) } : s));
  }, []);

  // 分页加载下一页会话
  const loadMoreSessions = useCallback(async () => {
    if (loadingRef.current.sessionsMore) return;
    if (!hasMoreSessions) return;
    loadingRef.current.sessionsMore = true;
    setLoadingMoreSessions(true);
    try {
      const data = await getSessions({ limit: SESSIONS_PAGE_SIZE, offset: sessions.length });
      const list = data.sessions || [];
      // 去重防御：相同 id 不重复入列
      setSessions(prev => {
        const seen = new Set(prev.map(s => s.id));
        return [...prev, ...list.filter(s => !seen.has(s.id))];
      });
      setSessionsTotal(typeof data.total === 'number' ? data.total : sessions.length + list.length);
      setHasMoreSessions(!!data.hasMore);
    } catch (e) {
      console.error('加载更多会话失败:', e);
    } finally {
      loadingRef.current.sessionsMore = false;
      setLoadingMoreSessions(false);
    }
  }, [hasMoreSessions, sessions.length]);

  // 侧边栏列表滚动监听：距底 80px 内触发加载更多
  const handleSiderScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      loadMoreSessions();
    }
  }, [loadMoreSessions]);

  return {
    // 状态
    sessions, sessionsTotal, hasMoreSessions, loadingMoreSessions,
    // 变更原语
    setSessions, setSessionsTotal, setHasMoreSessions,
    addSession, removeSession, updateSessionName,
    // 加载
    loadMoreSessions, handleSiderScroll,
    // 内部状态（仅供 App.jsx 的 loadSessions 复用加载锁，避免重复实现 sessions loading 锁）
    sessionsLoadingRef: loadingRef,
  };
}

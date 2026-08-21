/**
 * useFavorites Hook
 *
 * 封装收藏 + 建议词两套数据层：
 *  - 收藏（favoriteStates）：按 msgId 维护每条消息的收藏状态（idle / loading / done）
 *  - 建议词（chatSuggestions）：从用户收藏中抽 4 条作为新建对话的快捷入口
 *
 * 业务回调：
 *  - handleFavorite: 切换收藏态（已收藏 → 取消；未收藏 → 收藏）
 *  - hydrateFavoriteStates: 历史回看时批量查询哪些 SQL 已被收藏，回显 ✓ 状态
 *  - clearFavoriteStates: 切换会话 / 空会话早返回时清空旧状态
 *  - refetchSuggestions: 首次加载 / 新建对话时主动拉一次
 *
 * 设计决策：
 *  - state + 回调全部内聚,App.jsx 不再持有 favoriteStates / chatSuggestions 这两个 useState
 *  - 接受 messageApi 作参数(由 App.jsx 顶部 AntdApp.useApp() 提供)
 *    → 消除静态 message 警告 + 跟随动态主题
 *  - clearFavoriteStates 暴露:App.jsx 的 loadMessages 空会话早返回 + 切换会话后清空
 *  - 首次拉建议词的 useEffect 内化在 hook 内,App.jsx 不再写 useEffect
 *  - handleFavorite / hydrateFavoriteStates 内部用 setX(prev => ...) 闭包,符合 useCallback 旧风格
 */
import { useState, useCallback, useEffect } from 'react';
import {
  saveFavoriteQuery,
  unfavoriteQuery,
  checkFavorites,
  getFavoriteSuggestions,
} from '../api/index.js';

export function useFavorites({ messageApi }) {
  // 收藏：按 msgId 维护状态,支持 toggle 取消
  const [favoriteStates, setFavoriteStates] = useState({});

  // 新会话建议：从用户自己的收藏（admin 跨用户）随机抽 4 条
  // 不足 4 条时返回几条就显几个；接口失败/未登录时显示空数组,由渲染层 fallback 到写死
  const [chatSuggestions, setChatSuggestions] = useState([]);

  /**
   * 收藏为常用 SQL：已收藏 → 取消；未收藏 → 收藏
   * @param {{ msgId: string, userQuestion: string, sqlOutput: string }} params
   */
  const handleFavorite = useCallback(async ({ msgId, userQuestion, sqlOutput }) => {
    if (!msgId || !userQuestion || !sqlOutput) return;
    if (favoriteStates[msgId] === 'loading') return;
    // toggle：已收藏 → 取消；未收藏 → 收藏
    if (favoriteStates[msgId] === 'done') {
      setFavoriteStates(prev => ({ ...prev, [msgId]: 'loading' }));
      try {
        const res = await unfavoriteQuery(sqlOutput);
        if (res?.success) {
          setFavoriteStates(prev => ({ ...prev, [msgId]: 'idle' }));
          messageApi.success('已取消收藏');
        } else {
          setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' }));
          messageApi.error(res?.message || '取消收藏失败');
        }
      } catch (e) {
        setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' }));
        const apiMsg = e?.response?.data?.message;
        messageApi.error(apiMsg || `取消收藏失败: ${e.message}`);
      }
      return;
    }
    setFavoriteStates(prev => ({ ...prev, [msgId]: 'loading' }));
    try {
      const res = await saveFavoriteQuery({ userQuestion, sqlOutput });
      if (res?.success) {
        setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' }));
        messageApi.success(`已收藏：${res.optimizedQuestion || userQuestion}`);
      } else {
        setFavoriteStates(prev => ({ ...prev, [msgId]: 'idle' }));
        messageApi.error(res?.message || '收藏失败');
      }
    } catch (e) {
      setFavoriteStates(prev => ({ ...prev, [msgId]: 'idle' }));
      // 后端 500 时附带的 message 字段更具体
      const apiMsg = e?.response?.data?.message;
      messageApi.error(apiMsg || `收藏失败: ${e.message}`);
    }
  }, [favoriteStates, messageApi]);

  /**
   * 加载消息完成后,批量查询哪些 SQL 已被收藏,把对应 msgId 标为 done
   * @param {Array} msgs - 渲染层消息数组
   */
  const hydrateFavoriteStates = useCallback(async (msgs) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return;
    const sqlItems = [];
    const sqlToMsgIds = new Map();   // sql -> msgId（取第一个匹配）
    msgs.forEach(m => {
      if (m.role === 'assistant' && m.sql && m.sql.trim()) {
        const sql = m.sql.trim();
        if (!sqlToMsgIds.has(sql)) {
          sqlToMsgIds.set(sql, m.id);
          sqlItems.push({ sqlOutput: sql });
        }
      }
    });
    if (sqlItems.length === 0) return;
    try {
      const res = await checkFavorites(sqlItems);
      const matched = (res?.items || []).filter(it => it.matched);
      if (matched.length === 0) return;
      setFavoriteStates(prev => {
        const next = { ...prev };
        matched.forEach(it => {
          const msgId = sqlToMsgIds.get(it.sqlOutput);
          if (msgId && next[msgId] !== 'loading') next[msgId] = 'done';
        });
        return next;
      });
    } catch (e) {
      console.error('回显收藏状态失败:', e);
    }
  }, []);

  /**
   * 清空收藏状态:切换会话 / 空会话早返回时调用
   */
  const clearFavoriteStates = useCallback(() => {
    setFavoriteStates({});
  }, []);

  /**
   * 主动拉一次建议词(首次加载 + handleNewSession 都调)
   */
  const refetchSuggestions = useCallback(async () => {
    try {
      const res = await getFavoriteSuggestions(4);
      setChatSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
    } catch (e) {
      console.error('获取建议失败:', e);
      setChatSuggestions([]);
    }
  }, []);

  // 首次进入/刷新页面：立即拉一次建议（解决"刷新后还显示写死"的问题）
  useEffect(() => {
    refetchSuggestions();
  }, [refetchSuggestions]);

  return {
    // 收藏
    favoriteStates,
    handleFavorite,
    hydrateFavoriteStates,
    clearFavoriteStates,
    // 建议词
    chatSuggestions,
    refetchSuggestions,
  };
}

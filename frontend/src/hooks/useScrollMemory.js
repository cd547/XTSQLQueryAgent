/**
 * useScrollMemory Hook
 *
 * 聊天区滚动位置记忆 + 流式自动跟随滚动。
 *
 * 职责:
 *  1. 切换 tab(chat ↔ SQL)时保存/恢复 chat 滚动位置(瞬时,无 smooth 动画)
 *  2. 切换会话时恢复该会话上次浏览位置(或滚到最新消息)
 *  3. 同会话流式增长时:仅当用户贴近底部才自动跟随(上翻查看历史时不打断)
 *  4. onScroll 实时记录当前会话 scrollTop(per-session Map,ref 不触发重渲染)
 *
 * 对外暴露:
 *  - chatContentRef / messagesEndRef: JSX ref 绑定
 *  - isNearBottomRef / streamingScrollRafRef: handleSend SSE 分支用
 *  - saveChatScrollTop: handleOpenSqlTab / handleCopyAndExecute 切 tab 前调
 *  - handleTabChange: Tabs onChange
 *  - handleChatScroll: chat area onScroll
 *
 * 依赖注入:
 *  - activeTabKey: 判断当前是否在 chat 页
 *  - setActiveTabKey: handleTabChange 切 tab
 *  - currentSessionId: per-session 滚动记忆 key
 *  - messagesLength: 触发"消息变化 → 滚动"的 useEffect
 */
import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react';

export function useScrollMemory({ activeTabKey, setActiveTabKey, currentSessionId, messagesLength }) {
  const [chatScrollTop, setChatScrollTop] = useState(0);
  const messagesEndRef = useRef(null);
  // ★ 修复：用户是否停留在聊天区底部附近（阈值 100px）。
  //   流式输出时仅当用户贴近底部才自动跟随滚动；用户上翻查看历史时不得被实时输出拉回底部。
  //   初始为 true：进入会话时自动滚到最新消息。
  const isNearBottomRef = useRef(true);
  // 记录上一次自动滚动的会话 id，用于区分"切换会话"与"同会话流式增长"
  const lastScrollSessionRef = useRef(null);
  // Per-session scrollTop 记忆：sessionId -> scrollTop。
  // 用 ref 而非 state，避免 onScroll 频繁触发重渲染。
  // 切换会话时优先恢复该会话上次的位置；无记忆时回退到"滚到最新消息"。
  const sessionScrollTopsRef = useRef(new Map());
  const chatContentRef = useRef(null);
  // 流式响应期间用于 rAF 节流的滚动句柄（避免每 chunk 触发 scrollIntoView）
  const streamingScrollRafRef = useRef(0);
  // 记录上一次的 messages.length，用于检测消息数量变化
  const messageCountRef = useRef(0);

  // 保存 chat 页滚动位置：仅在当前是 chat 页时才需要保存。
  // 抽出来供「复制并执行」「复制到SQL查询」「新增SQL页」等直接 setActiveTabKey 的入口复用，
  // 避免绕开 handleTabChange 导致 scrollTop 没保存、切回时跳回顶部。
  const saveChatScrollTop = () => {
    if (activeTabKey === 'chat' && chatContentRef.current) {
      setChatScrollTop(chatContentRef.current.scrollTop);
    }
  };

  const handleTabChange = (key) => {
    saveChatScrollTop();
    setActiveTabKey(key);
  };

  // 切回 chat 时恢复滚动位置。
  // 用 useLayoutEffect 而非 useEffect：必须在浏览器绘制前同步完成，
  // 否则用户会看到"先滚回顶部，再滚到目标位置"的动画。
  // 同时临时覆盖 scroll-behavior: smooth（来自全局 CSS），
  // 避免 scrollTop 赋值触发平滑滚动动画。
  useLayoutEffect(() => {
    if (activeTabKey === 'chat' && chatContentRef.current) {
      const el = chatContentRef.current;
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollTop = chatScrollTop;
      // 下一帧恢复内联样式（让用户后续手动滚动仍走 smooth 行为）
      requestAnimationFrame(() => {
        el.style.scrollBehavior = prev;
      });
    }
  }, [activeTabKey, chatScrollTop]);

  useEffect(() => {
    if (messagesLength > messageCountRef.current && currentSessionId) {
      const saved = sessionScrollTopsRef.current.get(currentSessionId);
      messageCountRef.current = messagesLength;
      // 区分"切换会话"（恢复该会话浏览位置）与"同会话流式增长"（仅在贴近底部时跟随）
      const sessionChanged = lastScrollSessionRef.current !== currentSessionId;
      lastScrollSessionRef.current = currentSessionId;
      // rAF 等 DOM 更新完成再操作 scrollTop，避免消息尚未渲染时 scrollHeight 还是旧值
      requestAnimationFrame(() => {
        if (!chatContentRef.current) return;
        if (sessionChanged) {
          // 切换会话：有记忆则恢复该会话上次浏览位置，无记忆则滚到最新消息
          if (saved !== undefined) {
            chatContentRef.current.scrollTop = saved;
          } else {
            messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
          }
        } else if (isNearBottomRef.current) {
          // 同会话流式增长：仅当用户贴近底部时跟随输出
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
        }
        // 用户已上翻查看历史（!isNearBottomRef.current）：保持当前位置，不滚动
      });
    }
  }, [messagesLength, currentSessionId]);

  // onScroll 实时记录当前会话的 scrollTop
  // 同时更新"是否贴近底部"标记，供流式自动滚动判断
  // 用 ref.set 不触发重渲染，性能开销可忽略
  const handleChatScroll = useCallback(() => {
    if (currentSessionId && chatContentRef.current) {
      const el = chatContentRef.current;
      sessionScrollTopsRef.current.set(currentSessionId, el.scrollTop);
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    }
  }, [currentSessionId]);

  // 重置消息计数器(handleNewSession / handleSessionClick 切会话前调,
  // 确保 loadMessages 后 useEffect 能检测到 messages.length 变化触发滚动)
  const resetMessageCount = useCallback(() => {
    messageCountRef.current = 0;
  }, []);

  return {
    chatContentRef,
    messagesEndRef,
    isNearBottomRef,
    streamingScrollRafRef,
    saveChatScrollTop,
    handleTabChange,
    handleChatScroll,
    resetMessageCount,
  };
}

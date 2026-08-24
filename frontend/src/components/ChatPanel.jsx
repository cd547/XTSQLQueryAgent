/**
 * ChatPanel 组件
 *
 * 聊天区主体：空态（带 AI 建议） + 消息列表（按 round 分组渲染）。
 *
 * 设计决策：
 *  - 父组件持有 messages / groupedMessages / chatSuggestions / favoriteStates / user。
 *    本组件不持有任何 state，纯展示。
 *  - 父组件持有的回调（onToggleCollapse / onFavorite / onOpenSqlTab / onCopyAndExecute）
 *    通过 props 透传，本组件不重新包装。
 *  - `activeTabKey === 'chat'` 判断在父组件做，本组件不感知 tab。
 *  - chatContentRef（滚动容器 ref）和 messagesEndRef（滚动锚点）保留在父组件。
 *    滚动定位是 App.jsx 级别的关注点，chat 区域只负责渲染。
 *  - 4 个固定建议词组硬编码在组件内（无后端配置时回退）。
 *  - 不使用 React.memo（父组件 re-render 时 groupedMessages 引用会变，memo 收益低）。
 */
import React from 'react';
import AppIcon from './AppIcon.jsx';
import ChatMessage from './ChatMessage';
import RoundGroup from './RoundGroup';

const DEFAULT_SUGGESTIONS = [
  '查询2024年的销售额',
  '统计每个分类的商品数量',
  '查找销售额最高的10个客户',
  '分析最近30天的订单趋势',
];

export default function ChatPanel({
  // ===== 业务数据 =====
  messages,             // any[], 用于判断是否空态
  chatSuggestions,      // string[], AI 生成的建议词组（可空）
  groupedMessages,      // any[], 父组件 useMemo 算好的分组
  favoriteStates,       // { [msgId]: state }, 收藏状态索引
  user,                 // { display_name, username, ... }, 用于头像首字母

  // ===== 业务回调 =====
  setInput,             // (s) => void, 点击建议词时回填输入框
  onToggleCollapse,     // (msgId) => void
  onFavorite,           // ({ msgId, userQuestion, sqlOutput }) => void
  onOpenSqlTab,         // (sql) => void
  onCopyAndExecute,     // (sql) => void
  globalStreaming,      // ★ 2026-08-24 多会话并行：是否全局有 LLM 流在跑，透传 ChatMessage 禁用"复制并执行"
}) {
  // 头像首字母提取（与原 inline 逻辑保持一致）
  const userAvatar = (user?.display_name || user?.username || 'U').slice(0, 1).toUpperCase();

  // 收藏点击包装（与原 inline 逻辑保持一致：非 userQuestion 消息不给 onFavorite）
  const makeFavoriteHandler = (msgId, userQuestion) => (userQuestion
    ? ({ userQuestion: uq, sqlOutput }) => onFavorite({ msgId, userQuestion: uq, sqlOutput })
    : undefined);

  if (messages.length === 0) {
    return (
      <div className="xtsql-empty">
        <div className="xtsql-empty-icon"><AppIcon size={64} style={{ borderRadius: 0 }} /></div>
        <div className="xtsql-empty-title">开始新对话</div>
        <div className="xtsql-empty-desc">用自然语言描述你想要的查询，AI 会自动生成 SQL 并执行</div>
        <div className="xtsql-suggestion-list">
          {(chatSuggestions.length > 0 ? chatSuggestions : DEFAULT_SUGGESTIONS).map(s => (
            <div key={s} className="xtsql-suggestion" onClick={() => setInput(s)}>
              {s}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="xtsql-chat-inner">
      {groupedMessages.map((group) => {
        const userQuestion = group.userQuestion;
        if (group.type === 'roundGroup') {
          return (
            <RoundGroup
              key={group.id}
              round={group.round}
              logs={group.logs}
              onToggleCollapse={onToggleCollapse}
              onFavorite={onFavorite}
              userQuestion={userQuestion}
              userAvatar={userAvatar}
              favoriteStates={favoriteStates}
            />
          );
        }
        // single message (user / assistant / 单条 log)
        const msg = group.msg;
        return (
          <ChatMessage
            key={msg.id}
            msgId={msg.id}
            role={msg.role}
            content={msg.content}
            isStreaming={msg.isStreaming}
            timestamp={msg.timestamp}
            collapsed={msg.collapsed !== undefined ? msg.collapsed : true}
            onToggleCollapse={onToggleCollapse}
            logType={msg.logType}
            // ★ 2026-08-17：透传 toolName（single log 消息也需要）
            //   历史回看：从 msg.toolName（regex 抽过）透传
            //   实时流式：单条 log 走 roundGroup 分支，但若 single 也走这里则从 msg.toolName 拿
            toolName={msg.toolName}
            sql={msg.sql}
            startTime={msg.startTime}
            elapsedMs={msg.elapsedMs}
            // ★ v5.16：single 消息（user/assistant/单 log）也透传 usage（v5.16 修复）
            //   之前 v5.16 第一版只改了 RoundGroup 内的 ChatMessage，遗漏了 single 分支的 assistant 消息
            //   → assistant 消息不走 roundGroup，usage 一直未传 → 缓存命中率不显示
            usage={msg.usage}
            onOpenSqlTab={onOpenSqlTab}
            onCopyAndExecute={onCopyAndExecute}
            userQuestion={userQuestion}
            favoriteState={favoriteStates[msg.id]}
            onFavorite={makeFavoriteHandler(msg.id, userQuestion)}
            userAvatar={userAvatar}
            interrupted={msg.interrupted}  // ★ 2026-07-29：从 DB 或 SSE error 传入，渲染"已中断" badge
            globalStreaming={globalStreaming}  // ★ 2026-08-24：透传全局流状态，用于禁用"复制并执行"按钮
          />
        );
      })}
    </div>
  );
}

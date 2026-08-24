import React, { memo, useState } from 'react';
import ChatMessage from './ChatMessage.jsx';

/**
 * RoundGroup — 把同一 round 内的多条 log（思考过程 / 工具调用 / 工具返回）
 * 包装在一个"轮次轴"容器里，左侧显示 round 数字 + 竖向连接线。
 *
 * 为什么需要这个组件：
 *   - 单次 user 问题会触发多轮 LLM 工具调用循环
 *   - 一轮 = 一次 LLM 请求（拼 checklist → fetch → 解析 → 工具执行 → 写回）
 *   - 用户在 UI 上需要清晰看到"第几轮"，并感知轮次切换
 *
 * 设计：
 *   - 左侧 44px 宽"数轴式"轴（与 assistant 消息头像对齐）
 *   - 圆点显示 round 数字
 *   - 圆点下方一条竖线，连到下一个 round 的圆点（视觉上把多轮串成时间线）
 *   - 右侧堆叠 log 卡片（去掉原 xtsql-log 的 margin-left，由父容器 padding 接管）
 *   - ★ 2026-08-24：圆圈可点击，折叠/展开本轮所有日志
 */
const RoundGroup = memo(function RoundGroup({
  round,
  logs,
  onToggleCollapse,
  onFavorite,
  userQuestion,
  userAvatar,
  favoriteStates,
}) {
  // 本地折叠状态：默认展开，点击圆圈切换
  const [collapsed, setCollapsed] = useState(false);
  if (!logs || logs.length === 0) return null;
  return (
    <div className={`xtsql-round-group ${collapsed ? 'is-collapsed' : ''}`} data-round={round}>
      <div
        className="xtsql-round-axis"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? '点击展开本轮日志' : '点击折叠本轮日志'}
        role="button"
        aria-expanded={!collapsed}
      >
        <div className="xtsql-round-dot">{round}</div>
        <div className="xtsql-round-line" />
      </div>
      {!collapsed && (
        <div className="xtsql-round-logs">
          {logs.map((log) => (
            <ChatMessage
              key={log.id}
              msgId={log.id}
              role={log.role}
              content={log.content}
              isStreaming={log.isStreaming}
              timestamp={log.timestamp}
              collapsed={log.collapsed !== undefined ? log.collapsed : true}
              onToggleCollapse={onToggleCollapse}
              logType={log.logType}
              // ★ 2026-08-17：透传 toolName（single log 消息也需要）
              toolName={log.toolName}
              sql={log.sql}
              startTime={log.startTime}
              elapsedMs={log.elapsedMs}
              // ★ v5.16：透传 usage（assistant 消息才有），用于在耗时左边展示"缓存命中率"
              usage={log.usage}
              userQuestion={userQuestion}
              favoriteState={favoriteStates?.[log.id]}
              onFavorite={userQuestion ? ({ userQuestion: uq, sqlOutput }) => onFavorite?.({ msgId: log.id, userQuestion: uq, sqlOutput }) : undefined}
              userAvatar={userAvatar}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default RoundGroup;

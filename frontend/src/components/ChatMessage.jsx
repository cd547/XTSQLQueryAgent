import React, { memo } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { CaretRightOutlined, DownOutlined, UserOutlined, CopyOutlined, ThunderboltOutlined, CheckOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppIcon from './AppIcon.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { createMarkdownRenderers } from './markdownRenderers.jsx';

const ChatMessage = memo(function ChatMessage({ msgId, role, content, isStreaming, timestamp, collapsed, onToggleCollapse, logType, sql, startTime, elapsedMs, liveTimerTick, onOpenSqlTab, onCopyAndExecute }) {
  // liveTimerTick 用于在父组件流式期间 100ms 触发一次重渲染，这里仅作为 memo 失效键，不参与业务计算
  const { theme: themeMode } = useTheme();
  const isUser = role === 'user';
  const isLog = role === 'log' || role === 'LLM' || role === 'tool' || role === 'tool_return';

  const timeStr = timestamp ? new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }) : '';

  // 格式化耗时：< 60s 显示 "3.2s"，>= 60s 显示 "1m 23s"
  // 流式期间：用 startTime + Date.now() 实时计算
  // 完成时：用冻结的 elapsedMs
  const displayMs = elapsedMs != null
    ? elapsedMs
    : (startTime ? Date.now() - startTime : null);
  const elapsedStr = (() => {
    if (displayMs == null) return null;
    const seconds = displayMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds - minutes * 60);
    return `${minutes}m ${remainder}s`;
  })();

  // 日志类型（工具调用 / 思考过程）
  if (isLog) {
    const typeLabel = logType === 'return' ? '工具返回' : logType === 'llm' ? '思考过程' : '工具调用';
    const tagClass = logType === 'return' ? 'return' : (logType === 'llm' ? 'llm' : 'call');
    return (
      <div className="xtsql-log">
        <div className="xtsql-log-card">
          <div className="xtsql-log-header" onClick={() => { if (onToggleCollapse) onToggleCollapse(msgId); }}>
            {collapsed ? <CaretRightOutlined /> : <DownOutlined />}
            <span className={`xtsql-log-tag ${tagClass}`}>{typeLabel}</span>
            <span style={{ marginLeft: 'auto' }}>{timeStr}</span>
          </div>
          {!collapsed && <div className="xtsql-log-body">{content}</div>}
        </div>
      </div>
    );
  }

  let messageText = '';
  if (!isUser && content) {
    messageText = content;
  }

  const { pre: PreRender, code: CodeRender } = createMarkdownRenderers(themeMode === 'dark');
  const markdownComponents = {
    pre: PreRender,
    code: CodeRender,
    table: ({ children, ...props }) => (
      <table {...props}>{children}</table>
    ),
    thead: ({ children, ...props }) => (
      <thead {...props}>{children}</thead>
    ),
    th: ({ children, ...props }) => <th {...props}>{children}</th>,
    td: ({ children, ...props }) => <td {...props}>{children}</td>,
    tr: ({ children, ...props }) => <tr {...props}>{children}</tr>
  };

  return (
    <div className={`xtsql-msg ${isUser ? 'user' : 'assistant'}`}>
      <div className={`xtsql-msg-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? <UserOutlined /> : <AppIcon size={48} />}
      </div>
      <div className="xtsql-msg-body">
        <div className="xtsql-msg-meta">
          <span>{isUser ? '我' : 'AI 助手'}</span>
          <span>·</span>
          <span>{timeStr}</span>
        </div>
        <div className="xtsql-msg-bubble">
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
          ) : (
            <>
              {messageText && (
                <div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {messageText}
                  </ReactMarkdown>
                </div>
              )}
              {isStreaming && <Spin size="small" style={{ marginTop: 8 }} />}
            </>
          )}
        </div>
        {!isUser && (isStreaming || elapsedStr || (sql && sql.trim())) && (
          <div className="xtsql-msg-actions">
            {elapsedStr && (
              <Tooltip title="本次回答从发送到完成的耗时（流式期间实时更新）">
                <span className="xtsql-msg-elapsed">耗时 {elapsedStr}</span>
              </Tooltip>
            )}
            {!isStreaming && sql && sql.trim() && (
              <>
                <Button
                  className="xtsql-action-btn"
                  icon={<CopyOutlined />}
                  onClick={() => onOpenSqlTab && onOpenSqlTab(sql)}
                >
                  复制到SQL查询
                </Button>
                <Button
                  className="xtsql-action-btn primary"
                  icon={<ThunderboltOutlined />}
                  onClick={() => onCopyAndExecute && onCopyAndExecute(sql)}
                >
                  复制并执行
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;

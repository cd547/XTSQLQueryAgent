import React from 'react';
import { Button, Spin } from 'antd';
import { CaretRightOutlined, DownOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function ChatMessage({ role, content, isStreaming, timestamp, collapsed, onToggleCollapse, logType, sql, onOpenSqlTab, onCopyAndExecute }) {
  const isUser = role === 'user';
  const isLog = role === 'log' || role === 'LLM' || role === 'tool' || role === 'tool_return';
  
  const timeStr = timestamp ? new Date(timestamp).toLocaleString('zh-CN', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit', 
    minute: '2-digit' 
  }) : '';
  
  if (isLog) {
    const typeLabel = logType === 'return' ? '工具返回' : logType === 'llm' ? '思考过程' : '工具调用';
    const bgColors = {
      llm: '#e6f7ff',
      call: '#f5f5f5',
      return: '#fff7e6'
    };
    const borderColors = {
      llm: '#1890ff',
      call: '#ddd',
      return: '#faad14'
    };
    
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'flex-start',
        marginBottom: 8,
        marginLeft: 20
      }}>
        <div style={{
          maxWidth: '70%',
          padding: '6px 10px',
          borderRadius: 8,
          background: bgColors[logType] || '#f5f5f5',
          color: '#666',
          fontSize: 10,
          border: `1px solid ${borderColors[logType] || '#ddd'}`
        }}>
          <div 
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', marginBottom: collapsed ? 0 : 4 }}
            onClick={() => { if (onToggleCollapse) onToggleCollapse(); }}
          >
            <span style={{ marginRight: 4, fontSize: 10 }}>
              {collapsed ? <CaretRightOutlined /> : <DownOutlined />}
            </span>
            <span style={{ fontSize: 9, color: '#999' }}>{timeStr} · {typeLabel}</span>
          </div>
          {!collapsed && (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10 }}>{content}</div>
          )}
        </div>
      </div>
    );
  }
  
  let messageText = '';

  if (!isUser && content) {
    messageText = content;
  }

  const markdownComponents = {
    table: ({children, ...props}) => (
      <table style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: 11 }} {...props}>
        {children}
      </table>
    ),
    thead: ({children, ...props}) => (
      <thead style={{ background: '#f5f5f5' }} {...props}>
        {children}
      </thead>
    ),
    th: ({children, ...props}) => (
      <th style={{ border: '1px solid #ddd', padding: '4px 8px', textAlign: 'left' }} {...props}>
        {children}
      </th>
    ),
    td: ({children, ...props}) => (
      <td style={{ border: '1px solid #ddd', padding: '4px 8px' }} {...props}>
        {children}
      </td>
    ),
    tr: ({children, ...props}) => (
      <tr style={{ background: '#fff' }} {...props}>
        {children}
      </tr>
    )
  };
  
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
      position: 'relative'
    }}>
      <div style={{
        maxWidth: '75%',
        padding: '12px 16px',
        borderRadius: 12,
        background: isUser ? '#1890ff' : '#f5f5f5',
        color: isUser ? '#fff' : '#333',
        boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
      }}>
        {isUser ? (
          <div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>{timeStr}</div>
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>{content}</div>
          </div>
) : (
          <div>
            <div style={{ fontSize: 9, color: '#999', marginBottom: 2 }}>{timeStr}</div>
            {messageText && (
              <div style={{ color: '#333', fontSize: 12 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{messageText}</ReactMarkdown>
              </div>
            )}
            {isStreaming && (
              <Spin size="small" style={{ marginTop: 8 }} />
            )}
            {!isUser && sql && sql.trim() && !isStreaming && (
              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <Button 
                  type="primary" 
                  size="small"
                  style={{ marginRight: 8 }}
                  onClick={() => onOpenSqlTab && onOpenSqlTab(sql)}
                >
                  复制到SQL查询
                </Button>
                <Button 
                  type="primary" 
                  size="small"
                  ghost
                  onClick={() => onCopyAndExecute && onCopyAndExecute(sql)}
                >
                  复制并执行SQL
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatMessage;
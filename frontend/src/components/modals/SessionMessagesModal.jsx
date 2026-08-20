import React from 'react';
import { Modal } from 'antd';
import Editor from '@monaco-editor/react';

/**
 * 会话消息详情 Modal（只读）
 *
 * 之前内联在 App.jsx 内部，状态机自洽、无外部副作用。
 * state (showMessagesModal / sessionMessagesContent / sessionMessagesTokens) 仍由父组件管理。
 */
export default function SessionMessagesModal({ open, onClose, content, tokens }) {
  return (
    <Modal
      title="会话消息详情"
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
      styles={{ body: { padding: 0 } }}
    >
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--xtsql-hover)',
          borderBottom: '1px solid var(--xtsql-border)',
          fontSize: 12,
        }}
      >
        <span style={{ color: '#666' }}>当前上下文长度（本地估算，非计费值）：</span>
        <span style={{ color: '#1890ff', fontWeight: 500, marginLeft: 4 }}>{tokens}</span>
        <span style={{ color: '#666', marginLeft: 2 }}>tokens</span>
      </div>
      <div style={{ height: 480, borderTop: '1px solid var(--xtsql-border)' }}>
        <Editor
          height={480}
          defaultLanguage="json"
          value={content}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 11,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'on',
            folding: true,
            readOnly: true,
          }}
        />
      </div>
    </Modal>
  );
}

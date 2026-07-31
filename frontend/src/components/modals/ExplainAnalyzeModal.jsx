import React from 'react';
import { Modal, Spin } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getMarkdownRenderers } from '../markdownRenderers.jsx';

/**
 * AI 分析 EXPLAIN 结果 Modal
 *
 * 状态机自洽，但 SSE 流式处理留在父组件（50+ 行流处理在 App.jsx 的 handleExplainAnalyze）。
 * 本组件只负责展示：
 *   - loading=true + 空内容：Spin + "正在分析..."
 *   - loading=true + 有内容：流式渲染 markdown
 *   - loading=false + 有内容：完整渲染
 *   - 空 + 加载中：占位
 */
export default function ExplainAnalyzeModal({ open, onClose, content, loading, isDarkTheme = false }) {
  return (
    <Modal
      title="AI 分析 EXPLAIN 结果"
      open={open}
      onCancel={onClose}
      footer={null}
      width={700}
      style={{ top: 20 }}
    >
      <div
        style={{
          maxHeight: '70vh',
          overflow: 'auto',
          padding: '8px 12px',
          background: 'var(--xtsql-code-bg)',
          borderRadius: 4,
        }}
      >
        {loading && !content ? (
          <>
            <Spin /> 正在分析...
          </>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ node, ...props }) => <p style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }} {...props} />,
              h1: ({ node, ...props }) => <h1 style={{ fontSize: 16, marginTop: 12, marginBottom: 8 }} {...props} />,
              h2: ({ node, ...props }) => <h2 style={{ fontSize: 14, marginTop: 10, marginBottom: 6 }} {...props} />,
              h3: ({ node, ...props }) => <h3 style={{ fontSize: 13, marginTop: 8, marginBottom: 6 }} {...props} />,
              ul: ({ node, ...props }) => <ul style={{ fontSize: 12, paddingLeft: 20, marginTop: 4, marginBottom: 8 }} {...props} />,
              li: ({ node, ...props }) => <li style={{ fontSize: 12, marginBottom: 4 }} {...props} />,
              // ★ F7 修复：用 getMarkdownRenderers（模块级缓存）替换 createMarkdownRenderers。
              //   流式 AI 分析期间每来一个 chunk 调用一次 → 旧实现 pre/code 引用每次新建 →
              //   SyntaxHighlighter 子树 unmount + remount + Prism 重算。getMarkdownRenderers
              //   在同 isDarkTheme + fontSize 下返回稳定引用 → 复用现有实例，零闪烁。
              ...getMarkdownRenderers(isDarkTheme, { fontSize: 11 }),
            }}
          >
            {content || (loading ? '正在分析...' : '')}
          </ReactMarkdown>
        )}
      </div>
    </Modal>
  );
}

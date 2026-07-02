import React from 'react';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { prism as prismLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

// 注册常用的几种语言；全部从本地 npm 包加载，运行时不会请求 CDN
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('python', python);

// LLM 经常输出的方言/别名，统一映射到 sql
SyntaxHighlighter.alias('sql', ['mysql', 'pgsql', 'postgresql', 'mariadb', 'plsql', 'tsql']);

/**
 * 为 react-markdown 的 components 生成 { pre, code } 工厂。
 * - code 块走 SyntaxHighlighter（自带 <pre>）
 * - pre 透传，避免双层 <pre> 嵌套
 * - 行内 `code` 仍由 <code> 渲染，由调用方 CSS 决定外观
 *
 * @param {boolean} isDark 是否深色模式
 * @param {object} [opts]
 * @param {number} [opts.fontSize=12] 代码字号
 * @param {string} [opts.fontFamily] 字体
 * @returns {{ pre: React.FC, code: React.FC }}
 */
export function createMarkdownRenderers(isDark, opts = {}) {
  const fontSize = opts.fontSize ?? 12;
  const fontFamily = opts.fontFamily || "'SF Mono','Monaco','Cascadia Code','Consolas',monospace";
  const hlStyle = isDark ? vscDarkPlus : prismLight;
  // 容器配色：跟随主题给个温和底色，让 Prism 自带前景色生效
  const containerBg = isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.04)';
  const containerBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const Pre = ({ children }) => <>{children}</>;
  const Code = ({ className, children, ...props }) => {
    // children 可能是 string / React 元素数组 / 数字 → 统一转 string
    // react-markdown v8 对 code block 通常传 string，但有些情况是元素数组
    let text = '';
    if (typeof children === 'string') {
      text = children;
    } else if (Array.isArray(children)) {
      text = children
        .map((c) => (typeof c === 'string' ? c : (c && c.props && c.props.children) || ''))
        .join('');
    } else if (children != null) {
      text = String(children);
    }
    const match = /language-(\w+)/.exec(className || '');
    const isBlock = match !== null || text.includes('\n');

    // 行内 code：单行、无 language- 前缀 → 原样返回
    if (!isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }

    // 块级 code
    let lang = match ? match[1] : null;

    // 兜底：未指定语言时启发式检测（LLM 经常只写 ``` 不带 sql）
    if (!lang) {
      const trimmed = text.trim().toUpperCase();
      if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|MERGE|EXPLAIN|SHOW|DESCRIBE|TRUNCATE|REPLACE)\b/.test(trimmed)) {
        lang = 'sql';
      } else {
        // 块级但不像 SQL：降级为带 pre 包裹的普通 code
        return (
          <pre style={{ margin: '8px 0', padding: '10px 12px', borderRadius: 6, fontSize, fontFamily, background: containerBg, border: `1px solid ${containerBorder}`, overflowX: 'auto' }}>
            <code className={className} {...props}>{children}</code>
          </pre>
        );
      }
    }

    return (
      <SyntaxHighlighter
        language={lang}
        style={hlStyle}
        customStyle={{
          margin: '8px 0',
          padding: '10px 12px',
          borderRadius: 6,
          fontSize,
          lineHeight: 1.55,
          background: containerBg,
          border: `1px solid ${containerBorder}`,
        }}
        codeTagProps={{
          style: { fontFamily, fontSize },
        }}
        wrapLongLines={false}
        showLineNumbers={false}
      >
        {text.replace(/\n$/, '')}
      </SyntaxHighlighter>
    );
  };
  return { pre: Pre, code: Code };
}

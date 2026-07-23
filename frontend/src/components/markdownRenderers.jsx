import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

    // LLM 经常把整段回答包在 ```(markdown|md|空|text|...) ... ``` 外层，SQL 写在内部 ```sql ... ``` 嵌套。
    // react-markdown 解析外层代码块时会把内部 ``` 当作纯文本，SQL 永远不会到我们这里。
    // 解决方案：只要 text 内任意行出现 ``` 嵌套（说明外层把整段当字符串包的代码块），
    // 就剥掉外壳递归渲染一次。
    //
    // 历史 bug：旧条件要求外层 lang 必须是 markdown/md。LLM 有时只写 ```（lang 为 null）
    // 或 ```text，此时第一个分支不触发，落到下面的"启发式检测 SQL 关键字"——但 text
    // 第一行是 "- 库:" 而非 SELECT，整段降级为无高亮的 <pre><code>，内层 ```sql 也跟着没高亮。
    // 修复：去掉 lang 限制，剥壳正则也放宽为接受任意语言。
    //
    // 历史 bug 2：检测嵌套的正则 `^````（无 \s*）要求行首直接是 ```。
    // 实际 LLM 输出经常把外层 ```markdown 写在顶层、内层 ```sql 用 2 空格缩进排版，
    // 此时内层 ``` 所在行不是以 ``` 开头而是 "  ```sql"，正则在 /m 下也不匹配，
    // 整段落到 SyntaxHighlighter(language=markdown)，但 markdown 未注册 → 无高亮。
    // 修复：检测行首允许 \s*，并 fallback 兜底"text 内任意位置出现 ``` 围栏"即认为嵌套。
    const hasNestedFence = /^\s*```/m.test(text) || /```[\s\S]*?```/m.test(text);
    if (hasNestedFence) {
      // 容忍任意语言：开头的 ``` 后可能跟 markdown / md / text / <空> / 其它语言标识，
      // 一律剥到第一个换行（含换行本身）。
      // 仅当 text 真的以 ``` 开头（外层是无 language 的裸 ```...```）才剥壳；
      // 外层是 ```markdown/text 的情况 text 由 react-markdown 已去掉外层围栏，
      // 直接递归渲染即可（strip 是 no-op，不影响结果）。
      const inner = /^```/.test(text)
        ? text.replace(/^```[^\n`]*\n?/, '').replace(/\n?```\s*$/, '')
        : text;
      return (
        <div className="xtsql-nested-markdown xtsql-msg-bubble" style={{ margin: '8px 0', padding: 0, background: 'transparent' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ pre: Pre, code: Code }}
          >
            {inner}
          </ReactMarkdown>
        </div>
      );
    }

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

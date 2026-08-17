import React, { memo, useState, useEffect } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { CaretRightOutlined, DownOutlined, UserOutlined, CopyOutlined, ThunderboltOutlined, CheckOutlined, StarOutlined, StarFilled } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppIcon from './AppIcon.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { getMarkdownRenderers } from './markdownRenderers.jsx';

const ChatMessage = memo(function ChatMessage({ msgId, role, content, isStreaming, timestamp, collapsed, onToggleCollapse, logType, sql, startTime, elapsedMs, onOpenSqlTab, onCopyAndExecute, onFavorite, favoriteState, userQuestion, userAvatar, interrupted, usage, toolName }) {
  const { theme: themeMode } = useTheme();
  const isUser = role === 'user';
  const isLog = role === 'log' || role === 'LLM' || role === 'tool' || role === 'tool_return';

  // 内部计时器：流式期间每 200ms 触发一次本组件局部重渲染，更新"已用时间"显示
  // 之前用父级 liveTimerTick (100ms) → 触发整树重渲染 + 旁路 React.memo
  // 现在下沉到本组件：父级 0 开销；只有这一条流式消息在更新
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isStreaming || !startTime) return undefined;
    // 立即跑一次，避免 0ms → 真实值之间的闪烁
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [isStreaming, startTime]);

  const timeStr = timestamp ? new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }) : '';

  // 格式化耗时：< 60s 显示 "3.2s"，>= 60s 显示 "1m 23s"
  // 流式期间：用 startTime + now (内部 200ms 计时器) 实时计算
  // 完成时：用冻结的 elapsedMs
  const displayMs = elapsedMs != null
    ? elapsedMs
    : (startTime ? now - startTime : null);
  const elapsedStr = (() => {
    if (displayMs == null) return null;
    const seconds = displayMs / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds - minutes * 60);
    return `${minutes}m ${remainder}s`;
  })();

  // ★ v5.16：DeepSeek prefix cache 命中率
  //   公式：cached_tokens / (cached_tokens + miss_tokens) = cached_tokens / prompt_tokens
  //   prompt_tokens = cached + miss（DeepSeek API 约定）
  //   只在 assistant 消息 + 有 usage 数据时显示
  const hitRateInfo = (() => {
    if (!usage || role === 'user' || role === 'log' || role === 'LLM' || role === 'tool' || role === 'tool_return') return null;
    const prompt = usage.prompt_tokens || 0;
    const cached = usage.cached_tokens || 0;
    if (prompt <= 0) return null;
    const miss = prompt - cached;
    const hitRate = ((cached / (cached + miss)) * 100).toFixed(1);
    // ★ 每轮命中率明细：来自 usage.rounds（流式 done / 历史回看两条路径都已附带）
    //   仅用于 tooltip 展示，不参与累计命中率计算
    const rounds = (usage.rounds && typeof usage.rounds === 'object')
      ? Object.keys(usage.rounds)
          .map(Number)
          .filter(n => !Number.isNaN(n))
          .sort((a, b) => a - b)
          .map(r => {
            const u = usage.rounds[r] || {};
            const p = u.prompt_tokens || 0;
            const c = u.cached_tokens || 0;
            return {
              round: r,
              cached: c,
              miss: Math.max(0, p - c),
              prompt: p,
              rate: p > 0 ? ((c / p) * 100).toFixed(1) : null,
            };
          })
      : [];
    return {
      hitRate,
      cached,
      miss,
      prompt,
      completion: usage.completion_tokens || 0,
      total: usage.total_tokens || 0,
      rounds,
    };
  })();

  // 日志类型（工具调用 / 思考过程）
  if (isLog) {
    // ★ 2026-08-17：工具调用 title 拼接工具名
    //   例：原 "工具调用 2026/08/13 06:25" → 新 "工具调用 validate_sql_fields 2026/08/13 06:25"
    //   仅 call 类型且有 toolName 时拼接；其他类型（return/llm）保持原样
    let typeLabel;
    if (logType === 'return') {
      typeLabel = '工具返回';
    } else if (logType === 'llm') {
      typeLabel = '思考过程';
    } else {
      typeLabel = toolName ? `工具调用 ${toolName}` : '工具调用';
    }
    const tagClass = logType === 'return' ? 'return' : (logType === 'llm' ? 'llm' : 'call');
    return (
      <div className="xtsql-log">
        <div className="xtsql-log-card">
          <div className="xtsql-log-header" onClick={() => { if (onToggleCollapse) onToggleCollapse(msgId); }}>
            {collapsed ? <CaretRightOutlined /> : <DownOutlined />}
            <span className={`xtsql-log-tag ${tagClass}`}>{typeLabel}</span>
            <span style={{ marginLeft: 'auto' }}>{timeStr}</span>
          </div>
          {!collapsed && (
            <div className="xtsql-log-body">
              {/* ★ 2026-08-17：统一过滤"🔧 调用工具: ..."行（标题已拼工具名，body 再显示就重复）
                  新数据 + 老数据 + 即使后端没重启跑旧代码 → 全部统一处理
                  兜底：过滤后为空（如空参数工具）→ 显示"(无参数)"占位，避免节点"消失" */}
              {logType === 'call' && content
                ? (content.replace(/^🔧 调用工具:[^\n]*\n?/, '').trim() || '(无参数)')
                : content}
            </div>
          )}
        </div>
      </div>
    );
  }

  let messageText = '';
  if (!isUser && content) {
    messageText = content;
  }

  // ★ F7 修复：用 getMarkdownRenderers 替换 createMarkdownRenderers。
  //   getMarkdownRenderers 内部用 Map 缓存 (isDark, opts) → renderers 引用，
  //   同主题同 opts 下返回稳定引用 → ReactMarkdown components.pre/code 类型不变 →
  //   流式 chunk 期间不 unmount/remount SyntaxHighlighter 子树（无闪烁 + 无滚动跳动 + 无高亮重算）。
  const isDarkTheme = themeMode === 'dark';
  const { pre: PreRender, code: CodeRender } = getMarkdownRenderers(isDarkTheme);
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
        {isUser ? (userAvatar || <UserOutlined />) : <AppIcon size={48} />}
      </div>
      <div className="xtsql-msg-body">
        <div className="xtsql-msg-meta">
          <span>{isUser ? '我' : 'AI 助手'}</span>
          <span>·</span>
          <span>{timeStr}</span>
          {/* ★ 2026-07-29：interrupted=1 时显示"已中断" badge
              来源：① SSE error 事件（实时中断）② 历史回显（DB.interrupted=1） */}
          {!isUser && interrupted && (
            <Tooltip title="本次回答因客户端断连或超时未正常完成,部分内容已保存">
              <span className="xtsql-msg-interrupted-tag">⚠ 已中断</span>
            </Tooltip>
          )}
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
            {hitRateInfo && (
              <Tooltip
                title={
                  <div style={{ fontSize: 12 }}>
                    <div>prefix cache 命中率</div>
                    <div>累计 命中 {hitRateInfo.cached} / 未命中 {hitRateInfo.miss} = {hitRateInfo.hitRate}%</div>
                    <div>prompt {hitRateInfo.prompt} · completion {hitRateInfo.completion} · total {hitRateInfo.total}</div>
                    {hitRateInfo.rounds.length > 0 && (
                      <div style={{ marginTop: 4, maxHeight: 180, overflowY: 'auto', fontSize: 11, lineHeight: 1.7 }}>
                        <div>各轮命中率：</div>
                        {hitRateInfo.rounds.map(r => (
                          <div key={r.round}>
                            Round {r.round}: {r.rate !== null ? `${r.rate}%` : '—'}
                            {r.rate !== null && `（命中 ${r.cached} / prompt ${r.prompt}）`}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                }
              >
                <span className="xtsql-msg-hitrate">缓存命中率 {hitRateInfo.hitRate}%</span>
              </Tooltip>
            )}
            {elapsedStr && (
              <Tooltip title="本次回答从发送到完成的耗时（流式期间实时更新）">
                <span className="xtsql-msg-elapsed">耗时 {elapsedStr}</span>
              </Tooltip>
            )}
            {!isStreaming && sql && sql.trim() && (
              <>
                <Button
                  className="xtsql-action-btn"
                  icon={favoriteState === 'done' ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                  loading={favoriteState === 'loading'}
                  disabled={favoriteState === 'loading'}
                  onClick={() => onFavorite && onFavorite({ userQuestion, sqlOutput: sql })}
                >
                  {favoriteState === 'done' ? '已收藏' : '收藏为常用SQL'}
                </Button>
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

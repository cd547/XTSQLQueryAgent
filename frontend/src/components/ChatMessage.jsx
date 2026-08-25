import React, { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { Button, Spin, Tooltip } from 'antd';
import { CaretRightOutlined, DownOutlined, UserOutlined, CopyOutlined, ThunderboltOutlined, CheckOutlined, StarOutlined, StarFilled, FileImageOutlined, CloseOutlined, DownloadOutlined, ZoomInOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { prism as prismLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import AppIcon from './AppIcon.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { getMarkdownRenderers } from './markdownRenderers.jsx';

const ChatMessage = memo(function ChatMessage({ msgId, role, content, isStreaming, timestamp, collapsed, onToggleCollapse, logType, sql, startTime, elapsedMs, onOpenSqlTab, onCopyAndExecute, onFavorite, favoriteState, userQuestion, userAvatar, interrupted, usage, toolName, globalStreaming, blobUrlMap, getBlobUrl }) {
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

  // ★ 2026-08-24：检测 SQL 是否是"安全可直执"的 SELECT 类语句
  //   - 先去掉块注释 /* ... */ 和行注释 -- / #
  //   - 找首词：SELECT / WITH / EXPLAIN / SHOW / DESCRIBE / DESC
  //   - 命中 → 允许"复制并执行"按钮
  //   - 不命中（INSERT/UPDATE/DELETE/DDL/...）→ 隐藏执行按钮，避免误改/误删数据
  const isSelectLikeSql = (raw) => {
    if (typeof raw !== 'string') return false;
    const cleaned = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
      .replace(/(^|\s)(?:--|#)[^\n]*/g, '$1') // 行注释
      .trim()
      .toUpperCase();
    return /^(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|DESC)\b/.test(cleaned);
  };

  // ★ 2026-08-24：工具返回如果是 JSON，split 成 prefix + JSON 两段
  //   返回 null 表示不是 JSON（保持原逻辑回退到普通文本）
  //   返回 {prefix, json, isBlock} 表示要 syntax highlight
  //   - prefix（"📋 工具 xxx 返回:\n"）：保持原样，前缀可包含 emoji 和中文
  //   - json：能 parse 且是对象/数组 → 紧凑→pretty；已是多行→保留
  const tryParseJsonReturn = (raw) => {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const firstBrace = trimmed.search(/[\{\[]/);
    if (firstBrace < 0) return null;
    const prefix = trimmed.slice(0, firstBrace);
    const jsonPart = trimmed.slice(firstBrace);
    let parsed;
    try { parsed = JSON.parse(jsonPart); } catch { return null; }
    if (parsed === null || typeof parsed !== 'object') return null;
    const pretty = jsonPart.includes('\n') ? jsonPart : JSON.stringify(parsed, null, 2);
    return { prefix, json: pretty };
  };

  // JSON 高亮样式：跟随主题（与 markdown 代码块一致）
  const isDarkHl = themeMode === 'dark';
  const hlStyle = isDarkHl ? vscDarkPlus : prismLight;
  const hlContainerBg = isDarkHl ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.04)';
  const hlContainerBorder = isDarkHl ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  // 日志类型（工具调用 / 思考过程）
  if (isLog) {
    // ★ F23 v3 (2026-08)：始终隐藏 get_call_history 工具的调用和返回结果
    //   该工具由系统自动注入（用于 LLM 上下文 cache 优化），用户无需感知
    //   toolName 由后端 tool/tool_return 事件透传过来，get_call_history 对应的 call/return 都隐藏
    if (toolName === 'get_call_history') return null;
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
    // 工具返回：尝试解析为 JSON 并 syntax highlight
    const jsonReturn = logType === 'return' ? tryParseJsonReturn(content) : null;
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
              {/* 三种分支：
                  1) call 类型：过滤 "🔧 调用工具: ..." 行（标题已拼工具名）
                  2) return 类型且能 parse 成 JSON：prefix 普通文本 + JSON 高亮代码块
                  3) 其他（llm / fallback return / call 无 content）：原样 */}
              {logType === 'call' && content
                ? (content.replace(/^🔧 调用工具:[^\n]*\n?/, '').trim() || '(无参数)')
                : jsonReturn
                ? (
                  <>
                    {jsonReturn.prefix}
                    <SyntaxHighlighter
                      language="json"
                      style={hlStyle}
                      customStyle={{
                        margin: '6px 0 0',
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: 8,
                        lineHeight: 1.45,
                        fontFamily: "'SF Mono','Monaco','Cascadia Code','Consolas',monospace",
                        background: hlContainerBg,
                        border: `1px solid ${hlContainerBorder}`,
                        overflowX: 'auto',
                      }}
                      /* ★ 2026-08-24：强制 pre + nowrap
                         外层 .xtsql-log-body 有 white-space: pre-wrap + word-break: break-word
                         会破坏 SyntaxHighlighter 的 token 边界高亮（高亮被换行切断）。
                         这里强制代码块内部 pre + nowrap，token 完整不换行；
                         横向溢出由 overflowX: auto 提供滚动条 */
                      PreTag="pre"
                      codeTagProps={{ style: { whiteSpace: 'pre', wordBreak: 'normal', wordWrap: 'normal' } }}
                    >
                      {jsonReturn.json}
                    </SyntaxHighlighter>
                  </>
                )
                : content}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ★ 2026-08-24 vision：content 双向兼容
  //   - string（老路径，99% 历史消息）：原样走 ReactMarkdown
  //   - Array<{type,text?}|{type,file_id?}|{type,file_data?,filename?}>：
  //     ① 抽出所有 text 块拼成纯文本给 messageText（assistant 走 ReactMarkdown）
  //     ② 抽出所有 file 块，user 消息气泡内额外渲染缩略图
  //   - 旧数据（messages.content 是 JSON 字符串但还没 parse）：被 [ 更或 { 起首才尝试 parse；
  //     parse 失败回退原值（与 utils/messageHistory.js:parseContent 同策略）
  const contentBlocks = useMemo(() => {
    if (Array.isArray(content)) return content;
    if (typeof content === 'string' && (content.startsWith('[') || content.startsWith('{'))) {
      try { const parsed = JSON.parse(content); if (Array.isArray(parsed)) return parsed; } catch { /* ignore */ }
    }
    return null;  // null = 走老字符串路径
  }, [content]);

  const hasFileBlocks = Array.isArray(contentBlocks) && contentBlocks.some(b => b && b.type === 'file');

  // ★ 2026-08-24 vision 修复（历史图懒加载）：
  //   - 历史 user 消息里的 file 块只有 file_id（无 file_data），blobURL 必须从后端代理拉
  //   - 命中 blobUrlMap 直接用；未命中 → 调 getBlobUrl() 触发后台 fetch
  //   - 加载失败（NOT_FOUND/INVALID_ID/NETWORK）→ 区分显示：
  //     - NOT_FOUND → "图片已失效"（DeepSeek 已清理 + 本地缓存也无 → 旧历史文件场景）
  //     - 其他 → "图片加载失败"（网络/服务器错误）
  //   - 用 useState 跟踪每个 file_id 的"已尝试 + 错误"状态，避免重复触发
  const fileBlockIds = useMemo(() => {
    if (!Array.isArray(contentBlocks)) return [];
    return contentBlocks
      .filter(b => b && b.type === 'file' && b.file_id && !b.file_data)
      .map(b => b.file_id);
  }, [contentBlocks]);
  // file_id → { error, message }（仅当拉取失败时存在）
  const [loadErrors, setLoadErrors] = useState(() => new Map());
  // file_id 集合：标记已发起过请求（无论成败），避免每次 render 都触发
  const [attemptedIds, setAttemptedIds] = useState(() => new Set());
  useEffect(() => {
    if (!getBlobUrl) return undefined;
    // 找出需要拉取的 file_id（不在 map、不在 attempted）
    const missing = fileBlockIds.filter(fid =>
      fid && !blobUrlMap?.get(fid) && !attemptedIds.has(fid)
    );
    if (missing.length === 0) return undefined;
    // 标记为已尝试（防止并发 useEffect 重复拉）
    setAttemptedIds(prev => {
      const next = new Set(prev);
      missing.forEach(fid => next.add(fid));
      return next;
    });
    // 异步拉：成功会写 blobUrlMap（state 变化触发重渲）；失败写 loadErrors
    let cancelled = false;
    (async () => {
      const results = await Promise.all(missing.map(fid => getBlobUrl(fid)));
      if (cancelled) return;
      // 收集失败项 → 写 loadErrors（让 UI 能显示具体错误码对应的文案）
      const errs = {};
      results.forEach((r, i) => {
        if (r?.error) errs[missing[i]] = { error: r.error, message: r.message };
      });
      if (Object.keys(errs).length > 0) {
        setLoadErrors(prev => {
          const next = new Map(prev);
          Object.entries(errs).forEach(([k, v]) => next.set(k, v));
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [fileBlockIds, blobUrlMap, attemptedIds, getBlobUrl]);

  // ★ 2026-08-25 A8：图片点击放大预览
  //   - 轻量自实现（不引 antd Modal/Image.PreviewGroup），全屏覆盖层 + ESC/遮罩/× 关闭
  //   - 为什么不引 antd：antd Modal 的 mask 颜色和层级与现有 ChatInput 弹层有冲突，且 Image.PreviewGroup
  //     要包所有 img，侵入大；自实现只 30 行，覆盖层 + body 两层 click 区分
  //   - 为什么不引 react-image-lightbox：多一个依赖，且包很大（~50KB）
  const [preview, setPreview] = useState(null);  // null = 关闭；{src, filename, fid}
  const openPreview = useCallback((info) => setPreview(info), []);
  const closePreview = useCallback(() => setPreview(null), []);
  // ESC 关闭
  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, closePreview]);
  // ★ A8 辅助：把 dataURL 转 Blob，便于 download 属性生效（部分浏览器对 dataURL+download 不友好）
  const dataUrlToBlob = useCallback((dataUrl) => {
    try {
      const [head, b64] = dataUrl.split(',');
      const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    } catch {
      return null;
    }
  }, []);
  // ★ A8 下载：dataURL 路径避免每次 render 重建 blob URL（会泄漏）
  //   - 每次点击用临时 URL.createObjectURL → a.click() → 延迟 revoke
  const handleDownload = useCallback((e) => {
    e.stopPropagation();
    if (!preview) return;
    const filename = preview.filename || (preview.fid ? `${preview.fid}.png` : 'image');
    if (preview.isDataUrl) {
      e.preventDefault();
      const blob = dataUrlToBlob(preview.src);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 给浏览器一帧时间发起下载，再 revoke
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    // 非 dataURL（blob URL）：让 <a download> 自然工作，不 preventDefault
  }, [preview, dataUrlToBlob]);

  let messageText = '';
  if (!isUser && content) {
    if (Array.isArray(contentBlocks)) {
      // ★ vision：拼接所有 text 块；file 块不进 markdown（用户消息气泡内额外渲染）
      messageText = contentBlocks
        .filter(b => b && b.type === 'text')
        .map(b => b.text || '')
        .join('\n');
    } else {
      messageText = content;
    }
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
            // ★ 2026-08-24 vision：user 消息支持多模态
            //   - contentBlocks 为 null（老字符串）→ pre-wrap 老路径
            //   - contentBlocks 为数组：先列 file 块缩略图，再列 text 块
            //   - blobURL 优先（本地缓存）；fallback 显示 file_id 文本
            Array.isArray(contentBlocks) ? (
              <div className="xtsql-msg-blocks">
                {contentBlocks.map((b, i) => {
                  if (!b || b.type === 'text') {
                    const text = b?.text || '';
                    if (!text) return null;
                    return (
                      <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {text}
                      </div>
                    );
                  }
                  if (b.type === 'file') {
                    const fid = b.file_id;
                    // ★ 2026-08-24 vision 修复：从 React state 读（写时触发重渲）
                    const localUrl = blobUrlMap?.get(fid);
                    if (b.file_data) {
                      // file_data 内联 base64：直接用
                      return (
                        <img
                          key={i}
                          src={b.file_data}
                          alt={b.filename || fid || 'inline-image'}
                          className="xtsql-msg-file-img"
                          onClick={() => openPreview({
                            src: b.file_data,
                            filename: b.filename,
                            fid,
                            isDataUrl: true,
                          })}
                        />
                      );
                    }
                    if (localUrl) {
                      return (
                        <img
                          key={i}
                          src={localUrl}
                          alt={b.filename || fid}
                          className="xtsql-msg-file-img"
                          title={b.filename ? `${b.filename}\n${fid}` : fid}
                          onClick={() => openPreview({
                            src: localUrl,
                            filename: b.filename,
                            fid,
                            isDataUrl: false,
                          })}
                        />
                      );
                    }
                    // ★ 2026-08-25 A6：按错误码区分占位文案
                    //   - NOT_FOUND：DeepSeek 已清理 + 本地缓存也未命中（A6 上线前的旧历史文件）
                    //   - 其他：网络/服务器错误，可重试
                    if (attemptedIds.has(fid)) {
                      const errInfo = loadErrors.get(fid);
                      const isGone = errInfo?.error === 'NOT_FOUND';
                      return (
                        <div key={i} className="xtsql-msg-file-missing">
                          📎 {fid}
                          <br />
                          <small>（{isGone ? '图片已失效（DeepSeek 已清理）' : (errInfo?.message || '图片加载失败')}）</small>
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="xtsql-msg-file-loading">
                        <FileImageOutlined /> {fid}
                        <br />
                        <small>（加载中…）</small>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
            )
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
                  styles={{
                    root: { maxWidth: 'none' },
                    container: { maxWidth: 'none' },
                    body: { maxWidth: 400 },
                  }}
                  title={
                    // ★ 2026-08-21：固定 width 撑开 Tooltip
                    <div style={{ fontSize: 12, width: 360 }}>
                    <div>prefix cache 命中率</div>
                    <div>累计 命中 {hitRateInfo.cached} / 未命中 {hitRateInfo.miss} = {hitRateInfo.hitRate}%</div>
                    <div>prompt {hitRateInfo.prompt} · completion {hitRateInfo.completion} · total {hitRateInfo.total}</div>
                    {hitRateInfo.rounds.length > 0 && (() => {
                      // ★ 2026-08-21：各轮命中率折线图（Recharts）
                      //   y轴 0-100 表示命中率百分比，x轴为轮次
                      //   Tooltip 内嵌定宽图表；hover 数据点显示该轮的命中/未命中/prompt
                      const roundsData = hitRateInfo.rounds
                        .map((r) => ({
                          round: `R${r.round}`,
                          rawRound: r.round,
                          rate: r.rate !== null ? parseFloat(r.rate) : null,
                          cached: r.cached,
                          miss: r.miss,
                          prompt: r.prompt,
                        }))
                        .filter((d) => d.rate !== null);
                      if (roundsData.length === 0) return null;
                      const tickStyle = { fontSize: 10, fill: 'rgba(255,255,255,0.65)' };
                      // ★ 2026-08-21：图表宽度留足余量（Tooltip 内边距 + Recharts 内部 margin）
                      //   轮次 > 6 时 x 轴标签 -30° 旋转避免重叠
                      const chartW = 320;
                      const chartH = 140;
                      const xAngle = roundsData.length > 6 ? -30 : 0;
                      const xTickProps = xAngle
                        ? { angle: xAngle, textAnchor: 'end', dy: 4, height: 36 }
                        : { height: 24 };
                      return (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 4 }}>各轮命中率：</div>
                          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '4px 2px 0' }}>
                            <LineChart
                              width={chartW}
                              height={chartH}
                              data={roundsData}
                              margin={{ top: 8, right: 8, bottom: 4, left: -12 }}
                            >
                              <CartesianGrid stroke="rgba(255,255,255,0.10)" strokeDasharray="3 3" vertical={false} />
                              <XAxis
                                dataKey="round"
                                interval={0}
                                tick={tickStyle}
                                axisLine={{ stroke: 'rgba(255,255,255,0.25)' }}
                                tickLine={{ stroke: 'rgba(255,255,255,0.25)' }}
                                {...xTickProps}
                              />
                              <YAxis
                                domain={[0, 100]}
                                ticks={[0, 25, 50, 75, 100]}
                                tickFormatter={(v) => `${v}%`}
                                tick={tickStyle}
                                axisLine={{ stroke: 'rgba(255,255,255,0.25)' }}
                                tickLine={{ stroke: 'rgba(255,255,255,0.25)' }}
                                width={40}
                              />
                              <ReTooltip
                                cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }}
                                content={({ active, payload }) => {
                                  if (!active || !payload || !payload.length) return null;
                                  const p = payload[0].payload;
                                  if (!p) return null;
                                  return (
                                    <div
                                      style={{
                                        background: 'rgba(20,20,20,0.95)',
                                        border: '1px solid rgba(255,255,255,0.15)',
                                        borderRadius: 4,
                                        padding: '6px 9px',
                                        fontSize: 11,
                                        color: 'rgba(255,255,255,0.92)',
                                      }}
                                    >
                                      <div>{`命中率: ${p.rate}%`}</div>
                                      <div>{`命中 ${p.cached} / 未命中 ${p.miss} / prompt ${p.prompt}`}</div>
                                    </div>
                                  );
                                }}
                              />
                              <ReferenceLine y={50} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 3" />
                              <Line
                                type="monotone"
                                dataKey="rate"
                                name="命中率"
                                stroke="#69b1ff"
                                strokeWidth={1.8}
                                dot={{ r: 3.5, fill: '#69b1ff', stroke: 'rgba(255,255,255,0.85)', strokeWidth: 1 }}
                                activeDot={{ r: 5, fill: '#69b1ff', stroke: '#fff', strokeWidth: 1.5 }}
                                isAnimationActive={false}
                              />
                            </LineChart>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                }
              >
                <span className="xtsql-msg-hitrate">
                  缓存命中率：
                  {/* ★ 2026-08-21：缓存命中率小饼图（14×14 灰色系：深灰命中 / 浅灰未命中） */}
                  <span
                    className="xtsql-msg-hitrate-pie"
                    style={{
                      background: `conic-gradient(#4a4a4a 0% ${hitRateInfo.hitRate}%, #d9d9d9 ${hitRateInfo.hitRate}% 100%)`,
                    }}
                  />
                </span>
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
                {/* ★ 2026-08-24：仅 SELECT 类语句才显示"复制并执行"
                    非 SELECT（INSERT/UPDATE/DELETE/DDL 等）执行风险高（误改/误删数据），
                    只允许复制到 SQL 查询 tab 由用户手动确认后再执行 */}
                {isSelectLikeSql(sql) && (
                  <Tooltip
                    // ★ 2026-08-24 多会话并行：另一会话 LLM 流在跑时禁用此按钮
                    //   复制并执行本身只走 SQL 查询（非 LLM 流），技术上不会冲突；
                    //   但用户在 A 流式输出时点 B 的"复制并执行"会分散注意力，
                    //   等价于触发"并行操作"，违反"一页面同一时间只有一个流式输出"的设计原则
                    title={globalStreaming ? '另一会话正在生成中，请等待或先停止' : undefined}
                  >
                    <Button
                      className="xtsql-action-btn primary"
                      icon={<ThunderboltOutlined />}
                      // 即便 disabled 也要包 Tooltip 触发 hover，所以用 disabled prop 而非不渲染
                      disabled={globalStreaming}
                      onClick={() => onCopyAndExecute && onCopyAndExecute(sql)}
                    >
                      复制并执行
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        )}
        {/* ★ 2026-08-25 A8：图片点击放大预览
            - 自实现全屏覆盖层（z-index: 9999）确保在 antd Modal 之上
            - 遮罩 click 关闭；图片区 click stopPropagation 防止误关
            - ESC 关闭（上面 useEffect 监听）
            - 下载：blob URL 用 <a download>；dataURL 先转 Blob 再下（部分浏览器对 dataURL+download 不友好） */}
        {preview && (
          <div
            className="xtsql-img-preview-mask"
            onClick={closePreview}
            role="dialog"
            aria-modal="true"
          >
            <div className="xtsql-img-preview-toolbar" onClick={(e) => e.stopPropagation()}>
              <div className="xtsql-img-preview-title">
                <ZoomInOutlined />
                <span title={preview.filename || preview.fid}>
                  {preview.filename || preview.fid}
                </span>
                {preview.fid && (
                  <small className="xtsql-img-preview-fid">· {preview.fid}</small>
                )}
              </div>
              <div className="xtsql-img-preview-actions">
                <Tooltip title="下载图片">
                  <a
                    className="xtsql-img-preview-btn"
                    href={preview.isDataUrl ? '#' : preview.src}
                    download={preview.filename || (preview.fid ? `${preview.fid}.png` : 'image')}
                    onClick={handleDownload}
                  >
                    <DownloadOutlined />
                  </a>
                </Tooltip>
                <Tooltip title="关闭（ESC）">
                  <button
                    className="xtsql-img-preview-btn"
                    onClick={closePreview}
                  >
                    <CloseOutlined />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div className="xtsql-img-preview-body" onClick={(e) => e.stopPropagation()}>
              <img
                src={preview.src}
                alt={preview.filename || preview.fid}
                className="xtsql-img-preview-img"
                draggable={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;

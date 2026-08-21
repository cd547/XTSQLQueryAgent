import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { Layout, Input, Button, Spin, Drawer, ConfigProvider, Popconfirm, Tabs, Collapse, Tree, Modal, Dropdown, Tooltip, theme, Segmented, Space, App as AntdApp } from 'antd';
import 'react-resizable/css/styles.css';
import './App.css';
const { Panel } = Collapse;

import ConfirmDialog from './components/ConfirmDialog';
import UserChoiceDialog from './components/UserChoiceDialog';
import ChatInput from './components/ChatInput';
import ChatPanel from './components/ChatPanel';
import SqlPanel from './components/SqlPanel';
import SkillDrawer from './components/SkillDrawer';
import Sider from './components/Sider';
import ConfigPanel from './components/ConfigPanel';
import LoginPage from './components/LoginPage';
import SessionMessagesModal from './components/modals/SessionMessagesModal.jsx';
import ChangePasswordModal from './components/modals/ChangePasswordModal.jsx';
import AddTableModal from './components/modals/AddTableModal.jsx';
import ExplainAnalyzeModal from './components/modals/ExplainAnalyzeModal.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { useTheme } from './context/ThemeContext.jsx';
import * as api from './api/index.js';
import { CloseOutlined, MenuOutlined, CheckOutlined, SendOutlined, LoadingOutlined, BulbOutlined, BulbFilled, ClockCircleOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';
import './utils/monacoEnv';
import { readSSEStream } from './utils/sseStream';
import { sqliteUtcToIso, formatSqliteUtcLocal } from './utils/formatTime';
import { exportToExcel } from './utils/excel';
import { extractToolName } from './utils/toolName';
import { closeableMessage } from './utils/message.jsx';
import { SESSIONS_PAGE_SIZE } from './utils/constants.js';
import { groupMessagesByRound } from './utils/groupMessages';
import { hydrateLoadedMessages } from './utils/messageHistory';
import { useSessionList } from './hooks/useSessionList.js';
import { useFavorites } from './hooks/useFavorites.js';
import { useTagConfirmation } from './hooks/useTagConfirmation.js';
import { useUserChoice } from './hooks/useUserChoice.js';
import { useAppConfig } from './hooks/useAppConfig.js';
import { queryExecute, getSessions, createSession, getSessionMessages, saveSessionMessage, deleteSession, getSkillsList, readSkillFile, saveSkillFile, getSessionTokens, explainQuery, updateSession, summarizeSession, addTagToTable, getQueryMessages } from './api';

const { TextArea } = Input;
const { Content } = Layout;
const { defaultAlgorithm, darkAlgorithm } = theme;

function App() {
  const { isAuthenticated, bootstrapping, user, logout } = useAuth();

  // 未登录：渲染登录页（带启动校验 loading 态）
  if (bootstrapping) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Spin size="large" />
        <div style={{ color: 'var(--xtsql-text-secondary, #666)' }}>正在校验登录状态...</div>
      </div>
    );
  }
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedApp user={user} logout={logout} />;
}

// 鉴权通过后的主体组件，保持原 App 业务逻辑不变
function AuthenticatedApp({ user, logout }) {
  const { theme, toggleTheme } = useTheme();
  // ★ antd AntdApp.useApp()：获取与 <AntdApp> 上下文绑定的 message API
  //   替代静态 `import { message } from 'antd'`，消除
  //   "[antd: message] Static function can not consume context like dynamic theme." 警告
  //   注意：必须先于任何条件 return 调用（hook 规则）
  //   antd 的 App 与本文件默认导出的 App 同名，import 时用 as 别名避坑
  const { message: messageApi } = AntdApp.useApp();
  const {
    sessions, sessionsTotal, hasMoreSessions, loadingMoreSessions,
    setSessions, setSessionsTotal, setHasMoreSessions,
    addSession, removeSession, updateSessionName,
    loadMoreSessions, handleSiderScroll, sessionsLoadingRef,
  } = useSessionList();
  const {
    favoriteStates, handleFavorite, hydrateFavoriteStates, clearFavoriteStates,
    chatSuggestions, refetchSuggestions,
  } = useFavorites({ messageApi });
  const {
    currentModel, tokenWarningLevel, loadCurrentModel, loadAgentConfig, applyAgentConfig,
  } = useAppConfig();
  const {
    confirmTagAdd, openTagConfirmation,
    handleConfirmTagAdd, handleCancelTagAdd,
  } = useTagConfirmation({ messageApi });
  // useUserChoice 需要调 handleSend 触发新一轮 → 用 ref 注入避免 hook 顺序耦合
  // (useUserChoice 必须在组件顶层调用,但 handleSend 在它下面定义,所以通过 ref 间接调用)
  const handleSendRef = useRef(null);
  const onSubmitCombined = useCallback((text) => {
    handleSendRef.current?.(text);
  }, []);
  const {
    userChoiceRequest, openUserChoiceRequest,
    handleSubmitUserChoice, handlePrevUserChoice, handleCancelUserChoice,
  } = useUserChoice({ onSubmitCombined });
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [schemaMode, setSchemaMode] = useState('stream');
  const [isStreaming, setIsStreaming] = useState(false);
  const [results, setResults] = useState([]);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [rowCount, setRowCount] = useState(0);
  const [queryTime, setQueryTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillTree, setSkillTree] = useState([]);
  const [skillFileContent, setSkillFileContent] = useState('');
  const [skillFileLanguage, setSkillFileLanguage] = useState('plaintext');
  const [skillSelectedFile, setSkillSelectedFile] = useState(null);
  const [tabs, setTabs] = useState({ 'chat': { title: '聊天' } });
  const [activeTabKey, setActiveTabKey] = useState('chat');
  const [currentSessionName, setCurrentSessionName] = useState('聊天');
  const [sqlInput, setSqlInput] = useState('');
  const [sqlEditorInst, setSqlEditorInst] = useState(null);
  const [sqlKey, setSqlKey] = useState(['sql']);
  const [resultKey, setResultKey] = useState(['result']);
  const [columnWidths, setColumnWidths] = useState({});
  const [inputHeight, setInputHeight] = useState(80);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [currentTokens, setCurrentTokens] = useState(0);
  // ★ 用户控件：思考模式
  //   默认 high（与后端 history 行为一致，老用户感知差异最小）
  //   持久化到 localStorage，避免每次刷新重置
  const [reasoningEnabled, setReasoningEnabled] = useState(() => {
    try {
      const v = localStorage.getItem('xtsql.reasoning.enabled');
      return v === null ? true : v === 'true';
    } catch (e) { return true; }
  });
  const [reasoningEffort, setReasoningEffort] = useState(() => {
    try {
      const v = localStorage.getItem('xtsql.reasoning.effort');
      return ['low', 'medium', 'high'].includes(v) ? v : 'high';
    } catch (e) { return 'high'; }
  });
  useEffect(() => { try { localStorage.setItem('xtsql.reasoning.enabled', String(reasoningEnabled)); } catch (e) {} }, [reasoningEnabled]);
  useEffect(() => { try { localStorage.setItem('xtsql.reasoning.effort', reasoningEffort); } catch (e) {} }, [reasoningEffort]);
  const [skillLocked, setSkillLocked] = useState(true);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillOriginalContent, setSkillOriginalContent] = useState('');
  const [addTableModalOpen, setAddTableModalOpen] = useState(false);
  const [explainAnalyzeModalOpen, setExplainAnalyzeModalOpen] = useState(false);
  const [explainAnalysisContent, setExplainAnalysisContent] = useState('');
  const [explainAnalysisLoading, setExplainAnalysisLoading] = useState(false);
  const [isExplainResult, setIsExplainResult] = useState(false);
  const [explainResults, setExplainResults] = useState([]);
  const [explainPanelOpen, setExplainPanelOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [sessionMessagesContent, setSessionMessagesContent] = useState('');
  const [sessionMessagesTokens, setSessionMessagesTokens] = useState(0);
  const [chatScrollTop, setChatScrollTop] = useState(0);
  const contentRef = useRef('');
  const messageCountRef = useRef(0);
  const messagesEndRef = useRef(null);
  // ★ 修复：用户是否停留在聊天区底部附近（阈值 100px）。
  //   流式输出时仅当用户贴近底部才自动跟随滚动；用户上翻查看历史时不得被实时输出拉回底部。
  //   初始为 true：进入会话时自动滚到最新消息。
  const isNearBottomRef = useRef(true);
  // 记录上一次自动滚动的会话 id，用于区分"切换会话"与"同会话流式增长"
  const lastScrollSessionRef = useRef(null);
  // Per-session scrollTop 记忆：sessionId -> scrollTop。
  // 用 ref 而非 state，避免 onScroll 频繁触发重渲染。
  // 切换会话时优先恢复该会话上次的位置；无记忆时回退到"滚到最新消息"。
  const sessionScrollTopsRef = useRef(new Map());
  const inputResizerRef = useRef(null);
  const initialLoadRef = useRef(false);
  const abortControllerRef = useRef(null);
  // ★ F4 修复：handleExplainAnalyze 专用的 AbortController ref。
  //   不能复用 abortControllerRef —— handleSend 在用户点"停止"时会 abort 它，
  //   但 explain-analyze 是 Modal 关闭触发的，混用会让用户点错按钮互相影响。
  //   独立 ref 也让"切会话只 abort handleSend，不影响 modal 内正在跑的 analysis"成为可能。
  const explainAbortControllerRef = useRef(null);
  const chatContentRef = useRef(null);
  // 流式响应期间用于 rAF 节流的滚动句柄（避免每 chunk 触发 scrollIntoView）
  const streamingScrollRafRef = useRef(0);
  // 客户端消息 id 计数器：保证新创建的每条消息都有稳定唯一 key
  // DB 加载的消息用 `db-<row_id>` 命名空间，与客户端 `c-N` 互不冲突
  const clientMsgIdRef = useRef(0);
  // 异步加载去重 ref：用 useRef 跨 render 持久化标志位，
  // 替代原先 "loadXxx.loading = ..." 这种挂函数对象属性的反模式
  // - model: 加载当前模型（boolean）
  // - sessions: 首次加载会话列表（boolean）
  // - sessionsMore: 滚动加载更多会话（boolean）
  // - messagesId: 加载某 sessionId 的消息（sessionId 或 null）
  // - messagesVersion: F2 修复，每次 loadMessages 入口自增，用于丢弃过期响应
  const loadingRef = useRef({ model: false, messagesId: null, messagesVersion: 0 });
  // ★ F2 修复：SSE 流式请求版本号。handleSessionClick 切会话时 abort 并自增，
  //   in-flight 的 readSSEStream onEvent 回调顶部比对，失效则丢弃写入。
  const streamRequestIdRef = useRef(0);
  // ★ v5.16：缓存本轮 SSE usage 数据，done 事件时挂到当前 assistant 消息
  //   数据结构：{ [round]: { prompt_tokens, completion_tokens, total_tokens, cached_tokens } }
  //   用途：在 ChatMessage 耗时左边展示"缓存命中率"
  const roundUsagesRef = useRef({});
  
  // 保存 chat 页滚动位置：仅在当前是 chat 页时才需要保存。
  // 抽出来供「复制并执行」「复制到SQL查询」「新增SQL页」等直接 setActiveTabKey 的入口复用，
  // 避免绕开 handleTabChange 导致 scrollTop 没保存、切回时跳回顶部。
  const saveChatScrollTop = () => {
    if (activeTabKey === 'chat' && chatContentRef.current) {
      setChatScrollTop(chatContentRef.current.scrollTop);
    }
  };

  const handleTabChange = (key) => {
    saveChatScrollTop();
    setActiveTabKey(key);
  };

  // 切回 chat 时恢复滚动位置。
  // 用 useLayoutEffect 而非 useEffect：必须在浏览器绘制前同步完成，
  // 否则用户会看到"先滚回顶部，再滚到目标位置"的动画。
  // 同时临时覆盖 scroll-behavior: smooth（来自全局 CSS），
  // 避免 scrollTop 赋值触发平滑滚动动画。
  useLayoutEffect(() => {
    if (activeTabKey === 'chat' && chatContentRef.current) {
      const el = chatContentRef.current;
      const prev = el.style.scrollBehavior;
      el.style.scrollBehavior = 'auto';
      el.scrollTop = chatScrollTop;
      // 下一帧恢复内联样式（让用户后续手动滚动仍走 smooth 行为）
      requestAnimationFrame(() => {
        el.style.scrollBehavior = prev;
      });
    }
  }, [activeTabKey, chatScrollTop]);
  
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    loadSessions();
    loadCurrentModel();
    loadAgentConfig();
  }, []);

  useEffect(() => {
    if (activeTabKey !== 'chat' && tabs[activeTabKey]?.sql !== undefined) {
      setSqlInput(tabs[activeTabKey].sql || '');
    }
  }, [activeTabKey, tabs]);

  const handleSqlChange = (value) => {
    setSqlInput(value || '');
    if (activeTabKey !== 'chat') {
      setTabs(prev => ({
        ...prev,
        [activeTabKey]: { ...prev[activeTabKey], sql: value || '' }
      }));
    }
  };

  // 首次加载会话列表（分页第一页）
  //   数据层走 useSessionList hook；本函数只保留"加载后自动选第一会话"的副作用
  //   （需 setCurrentSessionId / setCurrentTokens / setCurrentSessionName 等跨切关注点）
  const loadSessions = async () => {
    if (sessionsLoadingRef.current.sessions) return;
    sessionsLoadingRef.current.sessions = true;
    try {
      const data = await getSessions({ limit: SESSIONS_PAGE_SIZE, offset: 0 });
      const list = data.sessions || [];
      setSessions(list);
      setSessionsTotal(typeof data.total === 'number' ? data.total : list.length);
      setHasMoreSessions(!!data.hasMore);
      if (list.length > 0 && !currentSessionId) {
        const firstSession = list[0];
        setCurrentSessionId(firstSession.id);
        setCurrentTokens(firstSession.total_tokens || 0);
        setCurrentSessionName(firstSession.name ? `${firstSession.name}#${firstSession.id}` : '聊天');
        // 加载消息token数据用于进度条显示
        try {
          const msgData = await getQueryMessages(firstSession.id);
          if (msgData.success) {
            setSessionMessagesTokens(msgData.messageTokens || 0);
          }
        } catch (e) {
          console.debug('获取消息token失败:', e.message);
        }
        // 加载Agent配置获取token警告阈值
        await loadAgentConfig();
      }
    } catch (e) {
      console.error('加载会话失败:', e);
    } finally {
      sessionsLoadingRef.current.sessions = false;
    }
  };

  /**
   * 把扁平 messages 列表按 round 分组，输出渲染层直接消费的"组"列表。
   * 纯函数逻辑在 utils/groupMessages.js，本处只保留 useMemo 缓存。
   *   - 历史回看：loadMessages 加载后的 messages 数组
   *   - 实时流式：handleSend 6 个 SSE 分支 setMessages 累积的 messages 数组
   * 用 useMemo 包裹避免每次 render 都重算（流式期间 setMessages 频繁触发 render）
   */
  const groupedMessages = useMemo(
    () => groupMessagesByRound(messages),
    [messages]
  );

  const loadMessages = async (sessionId) => {
    if (loadingRef.current.messagesId === sessionId) return;
    // ★ F2 修复：每次加载登记一个版本号。await 之后若已被新加载覆盖，
    //   过期响应直接丢弃，避免"先点 A 再点 B，A 慢回包覆盖 B 界面"
    const myVersion = ++loadingRef.current.messagesVersion;
    loadingRef.current.messagesId = sessionId;
    try {
      const data = await getSessionMessages(sessionId);
      if (loadingRef.current.messagesVersion !== myVersion) return; // 已被新请求覆盖，丢弃
      if (data.messages) {
        // ★ 修复：空会话（0 条消息）直接清空返回。
        //   原逻辑在下方"按问题分段"的第二遍扫描里会访问 data.messages[0] → undefined.role 抛错，
        //   导致 setMessages(loaded) 永远不执行，切回空会话时残留上一个会话的消息。
        if (data.messages.length === 0) {
          setMessages([]);
          clearFavoriteStates();
          return;
        }
        // 历史回放核心转换（4 步流水线）：
        //   1. 过滤 usage 行
        //   2. 两遍扫描累积 assistantUsages（v5.19b 修复：按问题边界分桶）
        //   3. filtered.map：归一化 role / 加 db- id / 转 ISO 时间 / 抽 toolName
        //   4. 老数据 elapsedMs 回填（相邻 user→assistant 配对）
        // 全部在 utils/messageHistory.js 内完成，App.jsx 只负责拿到 loaded 后做 setState 副作用
        const loaded = hydrateLoadedMessages(data.messages);
        setMessages(loaded);
        // 切换会话时清空旧 favorites 状态再回显本会话的
        clearFavoriteStates();
        hydrateFavoriteStates(loaded);
      }
    } catch (e) {
      // 过期请求的报错不刷控制台（避免误报当前会话有问题）
      if (loadingRef.current.messagesVersion !== myVersion) return;
      console.error('加载消息失败:', e);
    } finally {
      // 只有"自己仍是最新"才清空 messagesId，避免误清覆盖中的新请求
      if (loadingRef.current.messagesVersion === myVersion) {
        loadingRef.current.messagesId = null;
      }
    }
  };
  
  useEffect(() => {
    if (messages.length > messageCountRef.current && currentSessionId) {
      const saved = sessionScrollTopsRef.current.get(currentSessionId);
      messageCountRef.current = messages.length;
      // 区分"切换会话"（恢复该会话浏览位置）与"同会话流式增长"（仅在贴近底部时跟随）
      const sessionChanged = lastScrollSessionRef.current !== currentSessionId;
      lastScrollSessionRef.current = currentSessionId;
      // rAF 等 DOM 更新完成再操作 scrollTop，避免消息尚未渲染时 scrollHeight 还是旧值
      requestAnimationFrame(() => {
        if (!chatContentRef.current) return;
        if (sessionChanged) {
          // 切换会话：有记忆则恢复该会话上次浏览位置，无记忆则滚到最新消息
          if (saved !== undefined) {
            chatContentRef.current.scrollTop = saved;
          } else {
            messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
          }
        } else if (isNearBottomRef.current) {
          // 同会话流式增长：仅当用户贴近底部时跟随输出
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
        }
        // 用户已上翻查看历史（!isNearBottomRef.current）：保持当前位置，不滚动
      });
    }
  }, [messages.length, currentSessionId]);

  // onScroll 实时记录当前会话的 scrollTop
  // 同时更新"是否贴近底部"标记，供流式自动滚动判断
  // 用 ref.set 不触发重渲染，性能开销可忽略
  const handleChatScroll = useCallback(() => {
    if (currentSessionId && chatContentRef.current) {
      const el = chatContentRef.current;
      sessionScrollTopsRef.current.set(currentSessionId, el.scrollTop);
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    }
  }, [currentSessionId]);
  
  const handleNewSession = async () => {
    try {
      const data = await createSession('新对话');
      const sessionName = data.name || '新对话';
      const newSession = {
        id: data.id,
        name: sessionName,
        created_at: new Date().toISOString(),
        total_tokens: 0
      };
      // 新会话插到列表最前，分页计数 +1
      addSession(newSession);
      setCurrentSessionId(data.id);
      setCurrentSessionName(`${sessionName}#${data.id}`);
      setCurrentTokens(0);
      setMessages([]);
      setResults([]);
      setShowResults(false);
      messageCountRef.current = 0;
      // 拉取新会话建议（用户决策：点新建对话时重新拉）
      refetchSuggestions();
    } catch (e) {
      messageApi.error('创建会话失败');
    }
  };
  
  const handleSessionClick = async (session) => {
    // ★ F2 修复：切会话前先 abort 进行中的 SSE 流 + 提版本号，
    //   防止旧会话的 chunk/log 继续被写进新会话消息数组，
    //   并防止 catch 块把"已中断"文案写到新会话里。
    // 注意：handleStop（用户主动中断）走的是 abort 但不 bump，
    //   让"已中断"消息照常写进当前会话；只有切会话才 bump。
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    streamRequestIdRef.current++;
    loadingRef.current.messagesVersion++;

    setCurrentSessionId(session.id);
    setActiveTabKey('chat');
    const newName = session.name ? `${session.name}#${session.id}` : '聊天';
    setCurrentSessionName(newName);
    messageCountRef.current = 0;
    // 先重置查看消息按钮颜色为默认色（同步，避免并行请求延迟导致旧色残留）
    setSessionMessagesTokens(0);
    // 3 个独立 API 串行 → 并行（PERF-4 修复），切换会话快 ~2 倍
    const [tokensResult, configResult, messagesResult] = await Promise.allSettled([
      getSessionTokens(session.id),
      api.getAgentConfig(),
      getQueryMessages(session.id),
    ]);
    if (tokensResult.status === 'fulfilled') {
      // getSessionTokens 内部已 .then(r => r.data) 解包，value 即为 data
      setCurrentTokens(tokensResult.value.total_tokens || 0);
    } else {
      setCurrentTokens(0);
    }
    if (configResult.status === 'fulfilled') {
      // api.getAgentConfig 内部也已解包
      applyAgentConfig(configResult.value);
    } else {
      console.debug('获取Agent配置失败:', configResult.reason?.message);
    }
    if (messagesResult.status === 'fulfilled') {
      // getQueryMessages 未解包，value 仍是 { success, messageTokens }
      const msgData = messagesResult.value;
      if (msgData.success) {
        setSessionMessagesTokens(msgData.messageTokens || 0);
      }
    } else {
      console.debug('获取消息token失败:', messagesResult.reason?.message);
    }
  };
  
  const handleViewMessages = async () => {
    if (!currentSessionId) return;
    try {
      const data = await getQueryMessages(currentSessionId);
      if (data.success) {
        setSessionMessagesContent(JSON.stringify(data.messages, null, 2));
        setSessionMessagesTokens(data.messageTokens || 0);
        setShowMessagesModal(true);
      } else {
        messageApi.info(data.message || '暂无消息数据');
      }
    } catch (e) {
      messageApi.error('获取消息失败: ' + e.message);
    }
  };
  
  const handleDeleteSession = async (sessionId) => {
    Modal.confirm({
      title: '确定删除此对话？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteSession(sessionId);
          // 本地移除并同步分页计数
          removeSession(sessionId);
          if (currentSessionId === sessionId) {
            setCurrentSessionId(null);
            setMessages([]);
          }
          messageApi.success('对话已删除');
        } catch (e) {
          messageApi.error('删除失败');
        }
      }
    });
  };

  const handleRenameSession = async (sessionId) => {
    if (!editingSessionName.trim()) return;
    try {
      await updateSession(sessionId, editingSessionName.trim());
      updateSessionName(sessionId, editingSessionName.trim());
      if (currentSessionId === sessionId) {
        setCurrentSessionName(`${editingSessionName.trim()}#${sessionId}`);
      }
      setEditingSessionId(null);
      messageApi.success('重命名成功');
    } catch (e) {
      messageApi.error('重命名失败');
    }
  };

  const handleStartRename = (session) => {
    setEditingSessionId(session.id);
    setEditingSessionName(session.name || '');
  };

  const handleSummarizeSession = async (sessionId) => {
    try {
      messageApi.loading({ content: '正在总结聊天记录...', key: 'summarize' });
      const res = await summarizeSession(sessionId);
      if (res.error) {
        messageApi.error({ content: res.error, key: 'summarize' });
      } else {
        updateSessionName(sessionId, res.name);
        if (currentSessionId === sessionId) {
          setCurrentSessionName(`${res.name}#${sessionId}`);
        }
        messageApi.success({ content: '总结完成', key: 'summarize' });
      }
    } catch (e) {
      messageApi.error({ content: '总结失败', key: 'summarize' });
    }
  };

  const handleAddTab = () => {
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql: '', results: [], rowCount: 0 } }));
    setActiveTabKey(newKey);
    setSqlInput('');
    setResults([]);
    setColumnWidths({});
    setExplainResults([]);
  };
  
  const handleDeleteTab = (key) => {
    if (key === 'chat') return;
    setTabs(prev => {
      const newTabs = { ...prev };
      delete newTabs[key];
      return newTabs;
    });
    if (activeTabKey === key) {
      setActiveTabKey('chat');
      setResults([]);
      setColumnWidths({});
    }
  };
  
  const handleOpenSqlTab = (sql) => {
    saveChatScrollTop();
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql, results: [], rowCount: 0 } }));
    setActiveTabKey(newKey);
    setSqlInput(sql || '');
    setResults([]);
    setColumnWidths({});
    setExplainResults([]);
  };

  const handleCopyAndExecute = async (sql) => {
    saveChatScrollTop();
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql, results: [], rowCount: 0 } }));
    setActiveTabKey(newKey);
    setSqlInput(sql || '');
    setResults([]);
    setColumnWidths({});
    setExplainResults([]);
    await handleExecute(sql, newKey);
  };

  const handleToggleCollapse = useCallback((msgId) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, collapsed: !(m.collapsed ?? true) } : m));
  }, []);

  const handleSend = async (overrideText = null) => {
    // 兼容 onClick={handleSend} 情况：React 会注入 SyntheticEvent 作为第一个参数
    // 这里把非 string 参数当 null 处理，强制走 input 分支
    const textArg = typeof overrideText === 'string' ? overrideText : null;
    const userMessage = (textArg !== null ? textArg : String(input || '')).trim();
    if (!userMessage || loading) return;

    // 清空 input 框（仅当是从 input 触发的）
    if (textArg === null) setInput('');

    const now = new Date().toISOString();
    const startTime = Date.now();
    const newMessages = [...messages,
      { id: `c-${++clientMsgIdRef.current}`, role: 'user', content: userMessage, timestamp: now },
      { id: `c-${++clientMsgIdRef.current}`, role: 'assistant', content: '', isStreaming: true, timestamp: now, startTime }
    ];
    setMessages(newMessages);

    setLoading(true);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    // ★ F2 修复：本轮 SSE 流的"版本号"。handleSessionClick 切会话时会自增 streamRequestIdRef
    //   并 abort 旧流；in-flight 的 readSSEStream 回调顶部比对，失效则丢弃写入
    const myStreamVersion = ++streamRequestIdRef.current;

    try {
      const response = await api.queryGenerateStream({
        question: userMessage,
        schemaMode: 'stream',
        sessionId: currentSessionId,
        // ★ 用户控件：思考模式（每次请求透传当前 UI 选择）
        reasoning: { enabled: reasoningEnabled, effort: reasoningEffort },
      }, abortController.signal);

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const reader = response.body.getReader();
      let fullContent = '';

      // ★ 2026-07-29 修复 F1：抽到 utils/sseStream.js 处理
      //   ① TextDecoder.decode(value, { stream: true }) 避免中文多字节跨 chunk 切 U+FFFD
      //   ② buf 半截行缓冲，避免 SSE 行跨 chunk 时 JSON.parse 抛错
      //   ③ 流结束 flush decoder + 处理 buf 末尾（覆盖"最后一帧无 \n 结尾"场景）
      await readSSEStream(reader, (data) => {
        // ★ F2 修复：会话切换后版本号已自增，过期回调直接丢弃
        //   否则旧会话的 chunk/log 会继续被写进新会话消息数组
        if (streamRequestIdRef.current !== myStreamVersion) return;
        // ★ F9 修复：流首事件 meta 携带后端权威 sessionId。
        //   之前只在 done 事件里取 → 用户主动 stop / 5min OVERALL_TIMEOUT /
        //   网络断连 三个路径下 done 永远不到达，currentSessionId 持续为 null，
        //   下一条消息又以 null 调 /generate，后端再建一个新 session → 上下文断裂
        //   + 数据库多个孤儿 session（每条带一条孤儿 user message）。
        //   meta 是后端在 flushHeaders 后立即 res.write 的第一个事件，时序可预期。
        if (data.type === 'meta') {
          if (data.sessionId && data.sessionId !== currentSessionId) {
            const newId = data.sessionId;
            setCurrentSessionId(newId);
            // 把新 session 插到左侧列表（避免下次刷新才看到）。
            // 幂等：若已存在（同会话切回/重复 meta）则直接跳过。
            setSessions(prev => {
              if (prev.some(s => s.id === newId)) return prev;
              return [{
                id: newId,
                name: '新对话',
                created_at: new Date().toISOString(),
                total_tokens: 0
              }, ...prev];
            });
            setSessionsTotal(prev => prev + 1);
          }
          return;  // meta 不参与消息体渲染
        }
        if (data.type === 'chunk') {
          fullContent += data.content;
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
            if (lastAssistantIdx !== -1) {
              newMsgs[lastAssistantIdx] = { ...newMsgs[lastAssistantIdx], content: fullContent };
            }
            return newMsgs;
          });
          // 流式 chunk 不改变 messages.length，原 useEffect 不会触发滚动；
          // 这里用 rAF 节流：同一帧多次 chunk 只滚动一次
          if (!streamingScrollRafRef.current) {
            streamingScrollRafRef.current = requestAnimationFrame(() => {
              streamingScrollRafRef.current = 0;
              // ★ 修复：仅当用户贴近底部时才跟随实时输出；上翻查看历史时保持当前位置
              if (isNearBottomRef.current) {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }
            });
          }
        } else if (data.type === 'LLM' || data.type === 'tool' || data.type === 'tool_return') {
          const logContent = data.log || '';

          // 检测 request_tag_confirmation 工具调用
          if (data.type === 'tool' && logContent.includes('request_tag_confirmation')) {
            const paramMatch = logContent.match(/参数:\s*(\{[^}]+\})/);
            if (paramMatch) {
              try {
                const params = JSON.parse(paramMatch[1]);
                const term = Array.isArray(params.term) ? params.term : [params.term || ''];
                openTagConfirmation({
                  term: term.filter(t => t),
                  table: params.table || '',
                  description: params.description || ''
                });
              } catch (e) {
                console.warn('Parse tool params failed:', e);
              }
            }
          }

          let logType = 'call';
          if (data.type === 'LLM') logType = 'llm';
          else if (data.type === 'tool_return') logType = 'return';

          setMessages(prev => {
            const newMsgs = [...prev];
            const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
            if (lastAssistantIdx !== -1) {
              const logMsg = {
                id: `c-${++clientMsgIdRef.current}`,
                role: 'log',
                content: logContent,
                timestamp: new Date().toISOString(),
                collapsed: true,
                logType: logType,
                // ★ 2026-08-17：透传工具名（仅 tool 类型有值）
                //   前端 ChatMessage 用它拼接 title "工具调用 {toolName} {date}"
                //   来源：后端 llm.js:1627 yield { type: "tool", toolName, ... }
                // F23 v3: tool_return 也透传 toolName — 用于前端 ChatMessage 隐藏 get_call_history 的返回
                //   优先 data.toolName（新后端会 yield toolName），未传时用 regex 兜底（兼容旧后端/历史回看）
                // 统一抽到 utils/toolName.js，App.jsx 历史回看 + 实时 SSE 共用
                toolName: extractToolName(data.log, { role: data.type, preferToolName: data.toolName }),
                // ★ LLM 工具调用轮次编号（用于前端"数轴式"轮次展示）
                //   后端 llm.js 在每个 yield 时附带 round 字段
                //   同 assistant 消息内多条 log 可能共享同一 round（思考→调用→返回属于同一轮）
                round: typeof data.round === 'number' ? data.round : 0,
              };
              newMsgs.splice(lastAssistantIdx, 0, logMsg);
            }
            return newMsgs;
          });
        } else if (data.type === 'reasoning_chunk') {
          // 实时流式思考过程：找到/创建 llm log 消息，累加 content
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
            if (lastAssistantIdx === -1) return newMsgs;

            // 当前轮 = 最后一个 user 消息之后的所有消息
            // 关键：必须按"轮"隔离 llm log 查找范围，
            // 否则上一轮的 llm log 会被错误复用，导致第二轮的思考被追加到第一轮
            const lastUserIdx = newMsgs.findLastIndex(m => m.role === 'user');
            const currentRoundStart = lastUserIdx === -1 ? 0 : lastUserIdx + 1;

            let lastLlmLogIdx = -1;
            let lastLogIdx = -1;
            for (let i = newMsgs.length - 1; i >= currentRoundStart; i--) {
              const m = newMsgs[i];
              if (m.role === 'log') {
                if (lastLogIdx === -1) lastLogIdx = i;
                if (m.logType === 'llm' && lastLlmLogIdx === -1) lastLlmLogIdx = i;
              }
            }
            const isCurrentRound = lastLlmLogIdx !== -1 && lastLlmLogIdx === lastLogIdx;

            if (isCurrentRound) {
              // ★ 累加内容时保留用户已选的 collapsed 状态（不再强制 true）
              //   背景：之前每 chunk 都重置 collapsed=true，导致用户无法在流式期间展开查看
              newMsgs[lastLlmLogIdx] = {
                ...newMsgs[lastLlmLogIdx],
                content: (newMsgs[lastLlmLogIdx].content || '') + data.content,
                // ★ 同步 round（防止 round 边界判断异常时遗漏）
                round: typeof data.round === 'number' ? data.round : (newMsgs[lastLlmLogIdx].round ?? 0),
              };
            } else {
              const logMsg = {
                id: `c-${++clientMsgIdRef.current}`,
                role: 'log',
                content: '💭 LLM思考过程:\n' + data.content,
                timestamp: new Date().toISOString(),
                collapsed: true,  // ★ 仅新建时设默认折叠
                logType: 'llm',
                // ★ LLM 工具调用轮次编号（用于前端"数轴式"轮次展示）
                round: typeof data.round === 'number' ? data.round : 0,
              };
              newMsgs.splice(lastAssistantIdx, 0, logMsg);
            }
            return newMsgs;
          });
          // 流式 chunk 滚动到底部（rAF 节流）
          if (!streamingScrollRafRef.current) {
            streamingScrollRafRef.current = requestAnimationFrame(() => {
              streamingScrollRafRef.current = 0;
              // ★ 修复：仅当用户贴近底部时才跟随实时输出；上翻查看历史时保持当前位置
              if (isNearBottomRef.current) {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
              }
            });
          }
        } else if (data.type === 'usage') {
          // ★ v5.18 真正修复：把本轮 usage 存到 roundUsagesRef
          //   根因：v5.16 第一版 + v5.16b + v5.16c + v5.17 全部没真正工作！
          //   后端 SSE `type: "usage"` 事件（[responsesApi.js:238-251](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/responsesApi.js#L238-L251)）
          //   yield 出来后**没有**任何 else if 分支处理它 → 静默丢弃
          //   → roundUsagesRef.current 永远 {} → done 累积 null → `usage: undefined` → 不显示
          //   切走再回来能看：走历史回看路径，roundUsages 重新从 DB 构造（与 ref 无关）
          //   修法：在 chunk 之后 / reasoning_done 之前加 `else if (data.type === 'usage')`
          if (data.usage) {
            const r = typeof data.round === 'number' ? data.round : 0;
            // ★ 健壮性：同 round 累加而非覆盖，与历史回看路径（loadMessages 的 segmentUsages `+=`）
            //   及 DB（每条 usage 事件落一行）保持一致。
            //   当前每轮恰好一条 usage（一次 LLM 调用一条），覆盖/累加结果相同，行为无变化；
            //   若未来同轮出现多条 usage（如重试/多次计费事件），累加才能保证"流式显示 == 刷新后回看"。
            if (!roundUsagesRef.current[r]) {
              roundUsagesRef.current[r] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
            }
            roundUsagesRef.current[r].prompt_tokens += data.usage.prompt_tokens || 0;
            roundUsagesRef.current[r].completion_tokens += data.usage.completion_tokens || 0;
            roundUsagesRef.current[r].total_tokens += data.usage.total_tokens || 0;
            roundUsagesRef.current[r].cached_tokens += data.usage.cached_tokens || 0;
            // ★ v5.18 调试开关：默认开启；用户可手动注释
            if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
              console.log('[v5.18 debug] usage 事件 round=' + r + ':', JSON.stringify(roundUsagesRef.current[r]));
            }
          }
        } else if (data.type === 'reasoning_done') {
          // ★ 思考过程结束：保留用户已选的 collapsed 状态（之前强制 true 会把用户展开的内容又折叠回去）
          setMessages(prev => prev);
          return;
        } else if (data.type === 'message_final') {
          // 后处理：剥离 LLM 误倒进 content 的 thinking 后，用清理后的 content 替换 assistant 消息
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
            if (lastAssistantIdx !== -1) {
              newMsgs[lastAssistantIdx] = { ...newMsgs[lastAssistantIdx], content: data.content };
            }
            return newMsgs;
          });
        } else if (data.type === 'error') {
          // ★ 2026-07-29：用后端透传的 interrupted 字段代替硬编码字符串"请求已被用户中断"
          //   - interrupted=true → 用户主动中断 / 网络断连 / 超时 → 不弹红框 + 追加"已中断"标记
          //   - interrupted=false(缺失) → 真实错误 → 弹红框 + 显示错误内容
          // 优势：后端多场景(overll timeout / fetch abort / 用户主动 stop)统一走 interrupted 字段
          //   不再依赖 llm.js:1867 那个特定 yield 文案(原硬编码检查其实很少匹配上)
          const isInterrupted = data.interrupted === true;
          if (!isInterrupted) {
            messageApi.error(data.content);
          }
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
            if (lastIdx !== -1) {
              const startTime = newMsgs[lastIdx].startTime || Date.now();
              const elapsedMs = Date.now() - startTime;
              newMsgs[lastIdx] = {
                ...newMsgs[lastIdx],
                content: isInterrupted
                  ? (newMsgs[lastIdx].content || '')
                  : '错误: ' + data.content,
                isStreaming: false,
                elapsedMs,
                interrupted: isInterrupted  // ★ 在消息对象上记一下，ChatMessage 据此渲染 badge
              };
            }
            return newMsgs;
          });
        } else if (data.type === 'done') {
          // ★ v5.16c 修复：同步捕获 lastRoundUsage 到本地变量
          //   根因：setMessages(prev => ...) 的 prev 回调是 React 18 batched 异步执行，
          //   如果在 setMessages 之后**立即** `roundUsagesRef.current = {}`，等 React flush 闭包时
          //   ref 已经被清空 → 闭包内读 `roundUsagesRef.current[lastRound]` 拿到 undefined
          //   → `usage: undefined` → 命中率不显示
          //   切走再回来能看：走历史回看路径，roundUsages 重新从 DB 构造（与 ref 无关）
          //   修法：① setMessages **前**同步读 ref 到本地变量 ② setMessages 闭包内用本地变量
          //   ③ 清空 ref 放在 setMessages **之后**（已存在，顺序正确）
          // ★ v5.17 修复：累积 0..lastRound 的所有 round usage（之前只取最后 round）
          //   公式：sum_cached(0..R) / sum_prompt(0..R) * 100
          //   理由：单看当前 round 命中率有失偏颇；多轮对话下整轮累计命中率更能反映 prefix cache 效果
          const _roundKeys = Object.keys(roundUsagesRef.current);
          const _lastRound = _roundKeys.length > 0
            ? Math.max(..._roundKeys.map(Number).filter(n => !Number.isNaN(n)))
            : null;
          let _lastRoundUsage = null;
          if (_lastRound !== null) {
            // 累积 0.._lastRound 之间的所有 round usage
            let _sumCached = 0, _sumPrompt = 0, _sumCompletion = 0, _sumTotal = 0;
            let _hasAny = false;
            // ★ 每轮命中率明细（round → {prompt/completion/total/cached}），供 tooltip 按轮展示
            const _rounds = {};
            for (let r = 0; r <= _lastRound; r++) {
              const u = roundUsagesRef.current[r];
              if (u) {
                _sumCached += u.cached_tokens || 0;
                _sumPrompt += u.prompt_tokens || 0;
                _sumCompletion += u.completion_tokens || 0;
                _sumTotal += u.total_tokens || 0;
                _hasAny = true;
                _rounds[r] = {
                  prompt_tokens: u.prompt_tokens || 0,
                  completion_tokens: u.completion_tokens || 0,
                  total_tokens: u.total_tokens || 0,
                  cached_tokens: u.cached_tokens || 0,
                };
              }
            }
            if (_hasAny) {
              _lastRoundUsage = {
                prompt_tokens: _sumPrompt,
                completion_tokens: _sumCompletion,
                total_tokens: _sumTotal,
                cached_tokens: _sumCached,
                rounds: _rounds,
              };
            }
          }
          // ★ v5.18 调试开关：dev 模式才打印（user 可以打开后端 debug 看到完整链路）
          if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
            console.log('[v5.18 debug] done event: data.message.len=', (data.message || '').length, ', data.usage=', data.usage, ', data.round=', data.round, ', roundUsagesRef.current=', JSON.stringify(roundUsagesRef.current));
          }
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
            if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
              console.log('[v5.18 debug] setMessages: lastIdx=', lastIdx, ', _lastRoundUsage=', JSON.stringify(_lastRoundUsage));
            }
            if (lastIdx !== -1) {
              const startTime = newMsgs[lastIdx].startTime || Date.now();
              // 优先用后端权威耗时（含网络/工具调用），fallback 到前端本地计时
              const elapsedMs = (typeof data.elapsedMs === 'number' && data.elapsedMs >= 0)
                ? data.elapsedMs
                : Date.now() - startTime;
              newMsgs[lastIdx] = {
                ...newMsgs[lastIdx],
                content: data.message || '',
                sql: data.sql || '',
                isStreaming: false,
                elapsedMs,
                // ★ v5.17：用闭包外同步捕获的累积 _lastRoundUsage
                usage: _lastRoundUsage || undefined,
              };
            }
            return newMsgs;
          });
          // done 后清空本轮 usage 缓存（避免下一轮污染）
          roundUsagesRef.current = {};
          // 更新 token 显示
          if (data.totalTokens) {
            setCurrentTokens(prev => prev + data.totalTokens);
          }
          // ★ v5.18：删掉 done 块末尾的 `if (data.usage)` 兜底
          //   原因：后端 yield done 不带 data.usage 字段（[responsesApi.js:682](file:///d:/Ai_Program_Files/XTSQLQueryAgent/backend/src/services/responsesApi.js#L682)）
          //   兜底块永远不进，纯粹是无效死代码
          //   真正的 usage 处理已搬到 L1011-1028 的 `else if (data.type === 'usage')` 分支
          // ★ 兜底：done 事件也带 sessionId，做最后一层防御。
          //   正常路径 meta 已先到，currentSessionId 已被回写，
          //   这里的 if 短路为 false（React 闭包拿到的是 meta 之前的旧值，
          //   但 setCurrentSessionId 同值不重渲，setSessions 幂等跳过）。
          //   唯一会真正生效的场景：后端协议回退到不带 meta 的老版本（不会发生）。
          // ★ F9 修复：sessions 插列表 + sessionsTotal 自增已搬到 meta 事件，
          //   done 这里只做 currentSessionId 兜底回写，避免双计。
          if (data.sessionId && data.sessionId !== currentSessionId) {
            setCurrentSessionId(data.sessionId);
          }
          // ★ 检测 user_choice_request 弹窗（来自 llm.js 终止分支）
          // v2 链式弹窗：后端 yield 的是数组（1-3 个问题）；兼容旧版单值 fallback
          if (data.user_choice_request) {
            const rawReqs = Array.isArray(data.user_choice_request)
              ? data.user_choice_request
              : [data.user_choice_request];
            // 归一化每个元素为 {id, question, options, multiSelect, header}
            const reqs = rawReqs.map(r => ({
              id: r.id || '',
              question: r.question || '',
              options: Array.isArray(r.options) ? r.options : [],
              multiSelect: !!r.multi_select,
              header: r.header || ''
            }));
            openUserChoiceRequest({ requests: reqs });
          }
        }
      });
    } catch (error) {
      // ★ F2 修复：会话切换触发的 abort 不应污染新会话消息
      //   - handleStop（用户主动中断）走 abort 但不 bump → 版本号一致，catch 照常追加"已中断"到当前会话
      //   - handleSessionClick（切会话）abort + bump → 版本号不一致，catch 直接 bail，新会话消息保持干净
      if (streamRequestIdRef.current !== myStreamVersion) return;
      if (error.name !== 'AbortError') {
        messageApi.error(error.message);
      }
      setMessages(prev => {
        const newMsgs = [...prev];
        const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
        if (lastIdx !== -1) {
          const startTime = newMsgs[lastIdx].startTime || Date.now();
          const elapsedMs = Date.now() - startTime;
          newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: error.name === 'AbortError' ? (newMsgs[lastIdx].content || '') + '\n\n*[已中断]*' : '错误: ' + error.message, isStreaming: false, elapsedMs };
        }
        return newMsgs;
      });
    } finally {
      setLoading(false);
      setIsStreaming(false);
      // 只有"自己仍是最新流"才清空 abortControllerRef，避免误清覆盖中的新流
      if (streamRequestIdRef.current === myStreamVersion) {
        abortControllerRef.current = null;
      }
    }
  };

  // ★ useUserChoice 通过 handleSendRef 间接调用 handleSend 触发新一轮
  //   每次 render 都同步最新 handleSend 到 ref(useUserChoice 内部 setTimeout 0 异步触发,此时 ref 已就绪)
  //   必须放在 handleSend 声明之后,否则依赖数组 [handleSend] 求值时触发 TDZ
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const getSelectedSql = () => {
    if (sqlEditorInst) {
      const selection = sqlEditorInst.getSelection();
      const model = sqlEditorInst.getModel();
      if (selection && model) {
        const hasSelection = selection.startLineNumber !== selection.endLineNumber || selection.startColumn !== selection.endColumn;
        if (hasSelection) {
          const selectedText = model.getValueInRange(selection).trim();
          if (selectedText) return selectedText;
        }
      }
    }
    return sqlInput;
  };

  const handleExecute = async (sql, targetTabKey) => {
    setLoading(true);
    setSqlKey(['sql', 'result']);
    setResultKey(['sql', 'result']);
    setExplainPanelOpen(false);
    const startTime = Date.now();
    try {
      const res = await queryExecute({ sql });
      const elapsed = Date.now() - startTime;
      if (res.error) {
        messageApi.error(res.error);
      } else {
        const newResults = res.results || [];
        setColumnWidths({});
        setResults(newResults);
        setRowCount(res.rowCount || 0);
        setQueryTime(elapsed);
        setIsExplainResult(false);
        const resultTabKey = targetTabKey || activeTabKey;
        setTabs(prev => ({
          ...prev,
          [resultTabKey]: {
            ...(prev[resultTabKey] || { title: 'SQL查询', sql: resultTabKey }),
            results: newResults,
            rowCount: res.rowCount || 0,
            queryTime: elapsed
          }
        }));
        closeableMessage(messageApi, 'success', `查询成功，${res.rowCount} 条结果，耗时 ${elapsed}ms`);
      }
    } finally {
      setLoading(false);
    }
  };

const handleExplain = async (sql) => {
  if (!sql) return;
  setLoading(true);
  setSqlKey(['sql', 'explain']);
  setExplainPanelOpen(true);
  const startTime = Date.now();
  try {
    const res = await explainQuery({ sql });
    const elapsed = Date.now() - startTime;
    if (res.error) {
      messageApi.error(res.error);
    } else {
      const newResults = res.results || [];
      setColumnWidths({});
      setExplainResults(newResults);
      setExplainPanelOpen(true);
      setIsExplainResult(true);
      closeableMessage(messageApi, 'success', `EXPLAIN 完成，${res.rowCount} 行，耗时 ${elapsed}ms`);
    }
  } finally {
    setLoading(false);
  }
};

  const handleExplainAnalyze = async () => {
    if (!sqlInput || explainResults.length === 0) return;

    setExplainAnalyzeModalOpen(true);
    contentRef.current = '';
    setExplainAnalysisContent('');
    setExplainAnalysisLoading(true);

    // ★ F4 修复：建独立 AbortController，存到 explainAbortControllerRef。
    //   onClose / 卸载 / auth-expired 都会 abort 这个 ref。
    //   复用 handleSend 的 abortControllerRef 不可行：用户点"停止"会误关掉分析流。
    const abortController = new AbortController();
    explainAbortControllerRef.current = abortController;

    try {
      const response = await api.explainAnalyze(getSelectedSql(), explainResults, abortController.signal);

      if (!response.ok) {
        messageApi.error('请求失败');
        setExplainAnalysisLoading(false);
        return;
      }

      const reader = response.body.getReader();

      // ★ 2026-07-29 修复 F1：与 handleSend 共用 readSSEStream，
      //   解决 ① UTF-8 跨 chunk 切乱码 ② SSE 行跨 chunk parse 抛错 ③ 异常静默吞
      await readSSEStream(reader, (data) => {
        // ★ F4 修复：abort 之后 reader 仍可能吐出几帧迟到 chunk（race window），
        //   顶部守卫丢弃，避免对已卸载的 modal 组件 setState
        if (abortController.signal.aborted) return;
        if (data.type === 'chunk' && data.content) {
          contentRef.current += data.content;
          setExplainAnalysisContent(contentRef.current);
        } else if (data.type === 'error') {
          messageApi.error(data.content);
          setExplainAnalysisLoading(false);
        } else if (data.type === 'done') {
          setExplainAnalysisLoading(false);
        }
      });
    } catch (error) {
      // ★ F4 修复：用户主动中断（modal 关闭/卸载/auth-expired）时不弹错误 toast
      if (error.name === 'AbortError') return;
      messageApi.error(error.message);
      setExplainAnalysisLoading(false);
    } finally {
      // 只有"自己仍是最新流"才清空 ref，防止新流被旧流覆盖
      if (explainAbortControllerRef.current === abortController) {
        explainAbortControllerRef.current = null;
      }
    }
  };

  // ★ F4 修复：handleExplainAnalyze 的中断入口，绑给 modal 的 onClose + 卸载 + auth-expired
  const handleStopExplainAnalyze = () => {
    if (explainAbortControllerRef.current) {
      explainAbortControllerRef.current.abort();
      explainAbortControllerRef.current = null;
    }
    setExplainAnalysisLoading(false);
  };

  const loadSkillsList = async () => {
    try {
      const data = await getSkillsList();
      if (data.success) {
        setSkillTree(data.tree || []);
      }
    } catch (e) {
      console.error('加载skills失败:', e);
    }
  };

  const handleSkillFileSelect = async (filePath) => {
    if (!filePath) return;
    setSkillSelectedFile(filePath);
    try {
      const data = await readSkillFile(filePath);
      if (data.success) {
        setSkillFileContent(data.content || '');
        setSkillOriginalContent(data.content || '');
        setSkillFileLanguage(data.language || 'plaintext');
      } else {
        messageApi.error(data.message || '读取失败');
      }
    } catch (e) {
      console.error('读取文件失败:', e);
    }
  };

  const handleSkillSave = async () => {
    if (skillLocked || !skillSelectedFile || !skillFileContent) return;
    setSkillSaving(true);
    try {
      const data = await saveSkillFile(skillSelectedFile, skillFileContent);
      if (data.success) {
        messageApi.success(`保存成功，备份于 ${data.backupFolder}`);
      } else {
        messageApi.error(data.message || '保存失败');
      }
    } catch (e) {
      messageApi.error('保存失败: ' + e.message);
    } finally {
      setSkillSaving(false);
    }
  };

// 获取当前tab的结果
const currentResults = activeTabKey !== 'chat' && tabs[activeTabKey]?.results ? tabs[activeTabKey].results : results;
const currentRowCount = activeTabKey !== 'chat' && tabs[activeTabKey]?.rowCount ? tabs[activeTabKey].rowCount : rowCount;
const currentQueryTime = activeTabKey !== 'chat' && tabs[activeTabKey]?.queryTime ? tabs[activeTabKey].queryTime : queryTime;

const handleResize = (columnKey) => (e, { size }) => {
  setColumnWidths(prev => ({ ...prev, [columnKey]: size.width }));
};

const columns = useMemo(() => currentResults.length > 0
? Object.keys(currentResults[0]).map((key, idx) => ({
    title: <span style={{ fontSize: 12 }}>{key}</span>,
    dataIndex: key,
    key: `col-${idx}`,
    ellipsis: true,
    width: Math.min(300, Math.max(80, columnWidths[key] || 150)),
    onHeaderCell: () => ({
      width: columnWidths[key] || 150,
      onResize: handleResize(key),
    }),
  }))
: [], [currentResults, columnWidths]);

const explainColumns = useMemo(() => explainResults.length > 0
? Object.keys(explainResults[0]).map((key, idx) => ({
    title: <span style={{ fontSize: 12 }}>{key}</span>,
    dataIndex: key,
    key: `col-${idx}`,
    ellipsis: true,
    width: Math.min(300, Math.max(80, columnWidths[key] || 150)),
    onHeaderCell: () => ({
      width: columnWidths[key] || 150,
      onResize: handleResize(key),
    }),
  }))
: [], [explainResults, columnWidths]);
  
  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    }
  }, [currentSessionId]);

  // ★ F4 修复：组件卸载时 abort in-flight explain-analyze SSE 流。
  //   场景：用户在 modal 打开期间通过路由切换或父组件卸载触发本组件卸载，
  //   若不显式 abort，reader + 后端 LLM 仍在跑 → 浪费 token + React "state update on unmounted" 警告
  useEffect(() => {
    return () => {
      if (explainAbortControllerRef.current) {
        explainAbortControllerRef.current.abort();
        explainAbortControllerRef.current = null;
      }
    };
  }, []);

  // ★ F4 修复：登录态失效（401）时也 abort 正在进行的分析流。
  //   auth-expired 通常意味着即将被踢回登录页，未 abort 的流会持有过期 cookie 继续请求，
  //   也会被 setStoredUser(null) 触发的组件重渲染打断
  useEffect(() => {
    const onAuthExpired = () => {
      if (explainAbortControllerRef.current) {
        explainAbortControllerRef.current.abort();
        explainAbortControllerRef.current = null;
      }
    };
    window.addEventListener('xtsql:auth-expired', onAuthExpired);
    return () => window.removeEventListener('xtsql:auth-expired', onAuthExpired);
  }, []);

  return (
    <ConfigProvider theme={{ algorithm: theme === 'dark' ? darkAlgorithm : defaultAlgorithm, token: { borderRadius: 10, colorPrimary: '#1677ff' } }}>
      <div className="xtsql-app-bg" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Layout style={{ flex: 1, background: 'transparent', overflow: 'hidden' }}>
          <Sider
            sessions={sessions}
            sessionsTotal={sessionsTotal}
            hasMoreSessions={hasMoreSessions}
            loadingMoreSessions={loadingMoreSessions}
            currentSessionId={currentSessionId}
            editingSessionId={editingSessionId}
            editingSessionName={editingSessionName}
            user={user}
            collapsed={siderCollapsed}
            setEditingSessionName={setEditingSessionName}
            onNewSession={handleNewSession}
            onSessionClick={handleSessionClick}
            onDeleteSession={handleDeleteSession}
            onStartRename={handleStartRename}
            onRenameSession={handleRenameSession}
            onSummarizeSession={handleSummarizeSession}
            onSiderScroll={handleSiderScroll}
            onConfigClick={() => setConfigOpen(true)}
            onSkillClick={() => { if (skillTree.length === 0) loadSkillsList(); setSkillOpen(true); }}
            onChangePasswordClick={() => setChangePwdOpen(true)}
            onLogout={logout}
          />

        <Layout>
          <Content className="xtsql-content">
            <div className="xtsql-content-header">
              <Button
                type="text"
                className="xtsql-menu-btn"
                icon={<MenuOutlined />}
                onClick={() => setSiderCollapsed(!siderCollapsed)}
                title={siderCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
              />
              {(() => {
                const currentChatLabel = '聊天' + (currentSessionName !== '聊天' ? ` (${currentSessionName})` : '');
                return (
                  <Tabs
                    className="xtsql-tabs"
                    activeKey={activeTabKey}
                    onChange={handleTabChange}
                    type="editable-card"
                    size="small"
                    style={{ flex: 1, minWidth: 0 }}
                    hideAdd={false}
                    onEdit={(targetKey, action) => {
                      if (action === 'add') {
                        handleAddTab();
                      } else if (action === 'remove') {
                        handleDeleteTab(targetKey);
                      }
                    }}
                    items={Object.keys(tabs).map(key => ({
                      key,
                      closable: key !== 'chat',
                      label: (
                        <span>
                          {key === 'chat' ? currentChatLabel : (tabs[key].title || 'SQL查询')}
                        </span>
                      )
                    }))}
                  />
                );
              })()}
              <Tooltip title={theme === 'dark' ? '切换为亮色主题' : '切换为暗色主题'}>
                <button className="xtsql-theme-toggle" onClick={toggleTheme} aria-label="toggle theme">
                  {theme === 'dark' ? <BulbFilled /> : <BulbOutlined />}
                </button>
              </Tooltip>
            </div>

            <div ref={chatContentRef} className="xtsql-chat-area" onScroll={handleChatScroll}>
              {activeTabKey === 'chat' ? (
                <ChatPanel
                  messages={messages}
                  chatSuggestions={chatSuggestions}
                  groupedMessages={groupedMessages}
                  favoriteStates={favoriteStates}
                  user={user}
                  setInput={setInput}
                  onToggleCollapse={handleToggleCollapse}
                  onFavorite={handleFavorite}
                  onOpenSqlTab={handleOpenSqlTab}
                  onCopyAndExecute={handleCopyAndExecute}
                />
              ) : (
                <SqlPanel
                  sqlInput={sqlInput}
                  sqlKey={sqlKey}
                  setSqlKey={setSqlKey}
                  resultKey={resultKey}
                  setResultKey={setResultKey}
                  currentResults={currentResults}
                  columns={columns}
                  currentRowCount={currentRowCount}
                  currentQueryTime={currentQueryTime}
                  explainResults={explainResults}
                  explainColumns={explainColumns}
                  setSqlEditorInst={setSqlEditorInst}
                  getSelectedSql={getSelectedSql}
                  onSqlChange={handleSqlChange}
                  onExecute={handleExecute}
                  onExplain={handleExplain}
                  onExplainAnalyze={handleExplainAnalyze}
                  onExportExcel={() => exportToExcel(currentResults, columns, messageApi)}
                />
              )}
              {activeTabKey === 'chat' && <div ref={messagesEndRef} />}
              
              {activeTabKey === 'chat' && confirmTagAdd.visible && (
                <ConfirmDialog
                  visible={true}
                  term={confirmTagAdd.term}
                  table={confirmTagAdd.table}
                  description={confirmTagAdd.description}
                  onConfirm={handleConfirmTagAdd}
                  onCancel={handleCancelTagAdd}
                />
              )}

              {/* ★ request_user_choice 弹窗（v2 链式：单卡片按问题数切换"下一个/完成"） */}
              {activeTabKey === 'chat' && userChoiceRequest.visible && userChoiceRequest.requests.length > 0 && (
                <UserChoiceDialog
                  visible={true}
                  request={userChoiceRequest.requests[userChoiceRequest.currentIndex] || {}}
                  currentIndex={userChoiceRequest.currentIndex}
                  totalCount={userChoiceRequest.requests.length}
                  // v3: 传当前题已保存的答案（让"上一步"切回时能回显用户原答案）
                  previousAnswer={userChoiceRequest.answers[userChoiceRequest.currentIndex] || { selected: [], text: '' }}
                  // v3: 多问题且非首题时显示"上一步"按钮
                  canGoPrev={userChoiceRequest.requests.length > 1 && userChoiceRequest.currentIndex > 0}
                  inputHeight={inputHeight}
                  onSubmit={handleSubmitUserChoice}
                  onPrev={handlePrevUserChoice}
                  onCancel={handleCancelUserChoice}
                />
              )}
              
              <SessionMessagesModal
                open={showMessagesModal}
                onClose={() => setShowMessagesModal(false)}
                content={sessionMessagesContent}
                tokens={sessionMessagesTokens}
              />
            </div>
            
            {activeTabKey === 'chat' && (
              <ChatInput
                // 拖拽条
                inputResizerRef={inputResizerRef}
                inputHeight={inputHeight}
                setInputHeight={setInputHeight}
                // 文本输入
                input={input}
                setInput={setInput}
                onSend={handleSend}
                onStop={handleStop}
                loading={loading}
                disabled={userChoiceRequest.visible}
                // 状态显示
                currentModel={currentModel}
                currentTokens={currentTokens}
                sessionMessagesTokens={sessionMessagesTokens}
                tokenWarningLevel={tokenWarningLevel}
                onViewMessages={handleViewMessages}
                // 思考模式
                reasoningEnabled={reasoningEnabled}
                reasoningEffort={reasoningEffort}
                setReasoningEnabled={setReasoningEnabled}
                setReasoningEffort={setReasoningEffort}
              />
            )}
          </Content>
        </Layout>
        </Layout>
        </div>

        <Drawer
          className="xtsql-drawer"
          title="配置"
          placement="right"
          width={400}
          onClose={() => setConfigOpen(false)}
          open={configOpen}
        >
          <div className="config-drawer" style={{ padding: '0 10px' }}>
            <ConfigPanel compact />
          </div>
        </Drawer>

        <SkillDrawer
          skillOpen={skillOpen}
          setSkillOpen={setSkillOpen}
          skillLocked={skillLocked}
          setSkillLocked={setSkillLocked}
          skillTree={skillTree}
          skillFileLanguage={skillFileLanguage}
          skillSelectedFile={skillSelectedFile}
          skillFileContent={skillFileContent}
          skillOriginalContent={skillOriginalContent}
          skillSaving={skillSaving}
          setSkillFileContent={setSkillFileContent}
          setAddTableModalOpen={setAddTableModalOpen}
          loadSkillsList={loadSkillsList}
          handleSkillFileSelect={handleSkillFileSelect}
          handleSkillSave={handleSkillSave}
        />
        
        <AddTableModal
          open={addTableModalOpen}
          onClose={() => setAddTableModalOpen(false)}
          onCreated={loadSkillsList}
        />

        <ChangePasswordModal open={changePwdOpen} onClose={() => setChangePwdOpen(false)} onChanged={() => { setChangePwdOpen(false); logout(); }} />
        
        <ExplainAnalyzeModal
          open={explainAnalyzeModalOpen}
          // ★ F4 修复：关闭弹窗时先 abort in-flight SSE 流，再关 visible。
          //   旧逻辑只关弹窗，reader 仍在后台读 + setState（浪费 token + React 警告）
          onClose={() => {
            handleStopExplainAnalyze();
            setExplainAnalyzeModalOpen(false);
          }}
          content={explainAnalysisContent}
          loading={explainAnalysisLoading}
          isDarkTheme={theme === 'dark'}
        />
    </ConfigProvider>
  );
}

export default App;

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Layout, Input, Button, Table, message, Select, Spin, Empty, Drawer, List, ConfigProvider, Popconfirm, Tabs, Collapse, Tree, InputNumber, Modal, Steps, Space, Dropdown, Avatar, Tooltip, Form, theme } from 'antd';
import 'react-resizable/css/styles.css';
import './App.css';
const { Panel } = Collapse;

import ConfirmDialog from './components/ConfirmDialog';
import ResizableTitle from './components/ResizableTitle';
import ChatMessage from './components/ChatMessage';
import ConfigPanel from './components/ConfigPanel';
import LoginPage from './components/LoginPage';
import AppIcon from './components/AppIcon.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { useTheme } from './context/ThemeContext.jsx';
import * as api from './api/index.js';
import { SettingOutlined, CloseOutlined, PlusOutlined, MenuOutlined, FolderOutlined, FileTextOutlined, FolderOpenOutlined, CaretRightOutlined, DownOutlined, LockOutlined, UnlockOutlined, CheckOutlined, EditOutlined, TableOutlined, SendOutlined, SelectOutlined, MoreOutlined, DeleteOutlined, LoadingOutlined, LogoutOutlined, UserOutlined, BulbOutlined, BulbFilled } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';
import './utils/monacoEnv';
import { createMarkdownRenderers } from './components/markdownRenderers.jsx';
import { queryExecute, getSessions, createSession, getSessionMessages, saveSessionMessage, deleteSession, getSkillsList, readSkillFile, saveSkillFile, getSessionTokens, checkTableExists, fetchTableDDL, createTableFiles, getDomains, explainQuery, updateSession, summarizeSession, addTagToTable, getQueryMessages, saveFavoriteQuery, checkFavorites, unfavoriteQuery, getFavoriteSuggestions } from './api';

const { TextArea } = Input;
const { Sider, Content } = Layout;
const { defaultAlgorithm, darkAlgorithm } = theme;

function App() {
  const { isAuthenticated, bootstrapping, user, logout } = useAuth();

  // 未登录：渲染登录页（带启动校验 loading 态）
  if (bootstrapping) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在校验登录状态..." />
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
  const [sessions, setSessions] = useState([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
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
  const [skillDrawerWidth, setSkillDrawerWidth] = useState(480);
  const [tabs, setTabs] = useState({ 'chat': { title: '聊天' } });
  const [activeTabKey, setActiveTabKey] = useState('chat');
  const [currentSessionName, setCurrentSessionName] = useState('聊天');
  const [sqlInput, setSqlInput] = useState('');
  const [sqlEditorInst, setSqlEditorInst] = useState(null);
  const [sqlKey, setSqlKey] = useState(['sql']);
  const [resultKey, setResultKey] = useState(['result']);
  const [pageSize, setPageSize] = useState(20);
  const [columnWidths, setColumnWidths] = useState({});
  const [inputHeight, setInputHeight] = useState(80);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [sqlPreviewHeight, setSqlPreviewHeight] = useState(200);
  const [resultTableHeight, setResultTableHeight] = useState(800);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [skillTreeCollapsed, setSkillTreeCollapsed] = useState(false);
  const [skillContentCollapsed, setSkillContentCollapsed] = useState(false);
  const [skillLocked, setSkillLocked] = useState(true);
  const [skillSaving, setSkillSaving] = useState(false);
  const [skillOriginalContent, setSkillOriginalContent] = useState('');
  const [skillTreeHeight, setSkillTreeHeight] = useState(200);
  const [skillEditorHeight, setSkillEditorHeight] = useState(300);
  const [skillTreeActionsVisible, setSkillTreeActionsVisible] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const [addTableModalOpen, setAddTableModalOpen] = useState(false);
  const [addTableStep, setAddTableStep] = useState(1);
  const [addTableName, setAddTableName] = useState('');
  const [addTableChecking, setAddTableChecking] = useState(false);
  const [addTableExists, setAddTableExists] = useState(false);
  const [addTableDDL, setAddTableDDL] = useState('');
  const [addTableDescription, setAddTableDescription] = useState('');
  const [addTableDomains, setAddTableDomains] = useState([]);
  const [addTableSelectedDomains, setAddTableSelectedDomains] = useState([]);
  const [addTableDomainsLoading, setAddTableDomainsLoading] = useState(false);
  const [addTableRelatedTables, setAddTableRelatedTables] = useState([]);
  const [addTableCreating, setAddTableCreating] = useState(false);
  const [explainAnalyzeModalOpen, setExplainAnalyzeModalOpen] = useState(false);
  const [explainAnalysisContent, setExplainAnalysisContent] = useState('');
  const [explainAnalysisLoading, setExplainAnalysisLoading] = useState(false);
  const [confirmTagAdd, setConfirmTagAdd] = useState({
    visible: false,
    term: [],
    table: '',
    description: ''
  });
  const [isExplainResult, setIsExplainResult] = useState(false);
  const [explainResults, setExplainResults] = useState([]);
  const [explainPanelOpen, setExplainPanelOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [sessionMessagesContent, setSessionMessagesContent] = useState('');
  const [sessionMessagesTokens, setSessionMessagesTokens] = useState(0);
  const [tokenWarningLevel, setTokenWarningLevel] = useState(30000);
  const [chatScrollTop, setChatScrollTop] = useState(0);
  const contentRef = useRef('');
  const messageCountRef = useRef(0);
  const messagesEndRef = useRef(null);
  // Per-session scrollTop 记忆：sessionId -> scrollTop。
  // 用 ref 而非 state，避免 onScroll 频繁触发重渲染。
  // 切换会话时优先恢复该会话上次的位置；无记忆时回退到"滚到最新消息"。
  const sessionScrollTopsRef = useRef(new Map());
  const inputResizerRef = useRef(null);
  const resizerRef = useRef(null);
  const initialLoadRef = useRef(false);
  const abortControllerRef = useRef(null);
  const chatContentRef = useRef(null);
  // Monaco hover 隐藏定时器 ref：跨 render 持久化 timer id，
  // 避免 React 重新挂载时旧 setInterval 残留（导致内存泄漏 + 多次 hide 调用）
  const hoverIntervalRef = useRef(null);
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
  const loadingRef = useRef({ model: false, sessions: false, sessionsMore: false, messagesId: null });
  const siderListRef = useRef(null);
  
  const handleTabChange = (key) => {
    if (activeTabKey === 'chat' && chatContentRef.current) {
      setChatScrollTop(chatContentRef.current.scrollTop);
    }
    setActiveTabKey(key);
  };
  
  useEffect(() => {
    if (activeTabKey === 'chat' && chatContentRef.current) {
      chatContentRef.current.scrollTop = chatScrollTop;
    }
  }, [activeTabKey, chatScrollTop]);
  
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    loadSessions();
    loadCurrentModel();
    loadAgentConfig();
  }, []);

  const loadCurrentModel = async () => {
    if (loadingRef.current.model) return;
    loadingRef.current.model = true;
    try {
      const data = await api.getLlMConfig();
      setCurrentModel(data.model || '');
    } catch (e) {} finally {
      loadingRef.current.model = false;
    }
  };

  const loadAgentConfig = async () => {
    try {
      const data = await api.getAgentConfig();
      if (data) {
        setTokenWarningLevel(parseInt(data.agent_token_warning_level) || 30000);
      }
    } catch (e) {
      console.debug('获取Agent配置失败:', e.message);
    }
  };

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

  const SESSIONS_PAGE_SIZE = 20;

  // 首次加载会话列表（分页第一页）
  const loadSessions = async () => {
    if (loadingRef.current.sessions) return;
    loadingRef.current.sessions = true;
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
        try {
          const config = await api.getAgentConfig();
          setTokenWarningLevel(parseInt(config.agent_token_warning_level) || 30000);
        } catch (e) {
          console.debug('获取Agent配置失败:', e.message);
        }
      }
    } catch (e) {
      console.error('加载会话失败:', e);
    } finally {
      loadingRef.current.sessions = false;
    }
  };

  // 滚动触底：加载下一页会话
  const loadMoreSessions = async () => {
    if (loadingRef.current.sessionsMore) return;
    if (!hasMoreSessions) return;
    loadingRef.current.sessionsMore = true;
    setLoadingMoreSessions(true);
    try {
      const data = await getSessions({ limit: SESSIONS_PAGE_SIZE, offset: sessions.length });
      const list = data.sessions || [];
      // 去重防御：相同 id 不重复入列
      setSessions(prev => {
        const seen = new Set(prev.map(s => s.id));
        return [...prev, ...list.filter(s => !seen.has(s.id))];
      });
      setSessionsTotal(typeof data.total === 'number' ? data.total : sessions.length + list.length);
      setHasMoreSessions(!!data.hasMore);
    } catch (e) {
      console.error('加载更多会话失败:', e);
    } finally {
      loadingRef.current.sessionsMore = false;
      setLoadingMoreSessions(false);
    }
  };

  // 侧边栏列表滚动监听：距底 80px 内触发加载更多
  const handleSiderScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      loadMoreSessions();
    }
  }, [hasMoreSessions, sessions.length]);
  
  const loadMessages = async (sessionId) => {
    if (loadingRef.current.messagesId === sessionId) return;
    loadingRef.current.messagesId = sessionId;
    try {
      const data = await getSessionMessages(sessionId);
      if (data.messages) {
        const loaded = data.messages
          .filter(m => m.role !== 'usage')
          .map(m => ({
            id: `db-${m.id}`,
            role: m.role,
            content: m.content || m.sql || '',
            sql: m.sql || '',
            timestamp: m.created_at,
            logType: m.role === 'LLM' ? 'llm' : m.role === 'tool_return' ? 'return' : 'call'
          }));
        setMessages(loaded);
        // 切换会话时清空旧 favorites 状态再回显本会话的
        setFavoriteStates({});
        hydrateFavoriteStates(loaded);
      }
    } catch (e) {
      console.error('加载消息失败:', e);
    } finally {
      loadingRef.current.messagesId = null;
    }
  };
  
  useEffect(() => {
    if (messages.length > messageCountRef.current && currentSessionId) {
      const saved = sessionScrollTopsRef.current.get(currentSessionId);
      messageCountRef.current = messages.length;
      // rAF 等 DOM 更新完成再操作 scrollTop，避免消息尚未渲染时 scrollHeight 还是旧值
      requestAnimationFrame(() => {
        if (!chatContentRef.current) return;
        if (saved !== undefined) {
          // 有记忆：恢复该会话上次浏览的位置（用户可能在中间/顶部/底部）
          chatContentRef.current.scrollTop = saved;
        } else {
          // 无记忆（首次访问该会话）：滚到最新消息位置
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
        }
      });
    }
  }, [messages.length, currentSessionId]);

  // onScroll 实时记录当前会话的 scrollTop
  // 用 ref.set 不触发重渲染，性能开销可忽略
  const handleChatScroll = useCallback(() => {
    if (currentSessionId && chatContentRef.current) {
      sessionScrollTopsRef.current.set(currentSessionId, chatContentRef.current.scrollTop);
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
      setSessions(prev => [newSession, ...prev]);
      setSessionsTotal(prev => prev + 1);
      setCurrentSessionId(data.id);
      setCurrentSessionName(`${sessionName}#${data.id}`);
      setCurrentTokens(0);
      setMessages([]);
      setResults([]);
      setShowResults(false);
      messageCountRef.current = 0;
      // 拉取新会话建议（用户决策：点新建对话时重新拉）
      fetchChatSuggestions();
    } catch (e) {
      message.error('创建会话失败');
    }
  };
  
  const handleSessionClick = async (session) => {
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
      setTokenWarningLevel(parseInt(configResult.value.agent_token_warning_level) || 30000);
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
        message.info(data.message || '暂无消息数据');
      }
    } catch (e) {
      message.error('获取消息失败: ' + e.message);
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
          setSessions(prev => prev.filter(s => s.id !== sessionId));
          setSessionsTotal(prev => Math.max(0, prev - 1));
          if (currentSessionId === sessionId) {
            setCurrentSessionId(null);
            setMessages([]);
          }
          message.success('对话已删除');
        } catch (e) {
          message.error('删除失败');
        }
      }
    });
  };

  const handleRenameSession = async (sessionId) => {
    if (!editingSessionName.trim()) return;
    try {
      await updateSession(sessionId, editingSessionName.trim());
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: editingSessionName.trim() } : s));
      if (currentSessionId === sessionId) {
        setCurrentSessionName(`${editingSessionName.trim()}#${sessionId}`);
      }
      setEditingSessionId(null);
      message.success('重命名成功');
    } catch (e) {
      message.error('重命名失败');
    }
  };

  const handleStartRename = (session) => {
    setEditingSessionId(session.id);
    setEditingSessionName(session.name || '');
  };

  const handleSummarizeSession = async (sessionId) => {
    try {
      message.loading({ content: '正在总结聊天记录...', key: 'summarize' });
      const res = await summarizeSession(sessionId);
      if (res.error) {
        message.error({ content: res.error, key: 'summarize' });
      } else {
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: res.name } : s));
        if (currentSessionId === sessionId) {
          setCurrentSessionName(`${res.name}#${sessionId}`);
        }
        message.success({ content: '总结完成', key: 'summarize' });
      }
    } catch (e) {
      message.error({ content: '总结失败', key: 'summarize' });
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
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql, results: [], rowCount: 0 } }));
    setActiveTabKey(newKey);
    setSqlInput(sql || '');
    setResults([]);
    setColumnWidths({});
    setExplainResults([]);
  };

  const handleCopyAndExecute = async (sql) => {
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql, results: [], rowCount: 0 } }));
    setActiveTabKey(newKey);
    setSqlInput(sql || '');
    setResults([]);
    setColumnWidths({});
    setExplainResults([]);
    await handleExecute(sql, newKey);
  };

  // 收藏为常用 SQL：按 msgId 维护每条消息的收藏状态（支持 toggle 取消）
  const [favoriteStates, setFavoriteStates] = useState({});
  const handleFavorite = useCallback(async ({ msgId, userQuestion, sqlOutput }) => {
    if (!msgId || !userQuestion || !sqlOutput) return;
    if (favoriteStates[msgId] === 'loading') return;
    // toggle：已收藏 → 取消；未收藏 → 收藏
    if (favoriteStates[msgId] === 'done') {
      setFavoriteStates(prev => ({ ...prev, [msgId]: 'loading' }));
      try {
        const res = await unfavoriteQuery(sqlOutput);
        if (res?.success) {
          setFavoriteStates(prev => ({ ...prev, [msgId]: 'idle' }));
          message.success('已取消收藏');
        } else {
          setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' }));
          message.error(res?.message || '取消收藏失败');
        }
      } catch (e) {
        setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' }));
        const apiMsg = e?.response?.data?.message;
        message.error(apiMsg || `取消收藏失败: ${e.message}`);
      }
      return;
    }
    setFavoriteStates(prev => ({ ...prev, [msgId]: 'loading' }));
    try {
      const res = await saveFavoriteQuery({ userQuestion, sqlOutput });
      if (res?.success) {
        setFavoriteStates(prev => ({ ...prev, [msgId]: 'done' }));
        message.success(`已收藏：${res.optimizedQuestion || userQuestion}`);
      } else {
        setFavoriteStates(prev => ({ ...prev, [msgId]: 'idle' }));
        message.error(res?.message || '收藏失败');
      }
    } catch (e) {
      setFavoriteStates(prev => ({ ...prev, [msgId]: 'idle' }));
      // 后端 500 时附带的 message 字段更具体
      const apiMsg = e?.response?.data?.message;
      message.error(apiMsg || `收藏失败: ${e.message}`);
    }
  }, [favoriteStates]);

  // 加载消息完成后，批量查询哪些 SQL 已被收藏，把对应 msgId 标为 done
  const hydrateFavoriteStates = useCallback(async (msgs) => {
    if (!Array.isArray(msgs) || msgs.length === 0) return;
    const sqlItems = [];
    const sqlToMsgIds = new Map();   // sql -> msgId（取第一个匹配）
    msgs.forEach(m => {
      if (m.role === 'assistant' && m.sql && m.sql.trim()) {
        const sql = m.sql.trim();
        if (!sqlToMsgIds.has(sql)) {
          sqlToMsgIds.set(sql, m.id);
          sqlItems.push({ sqlOutput: sql });
        }
      }
    });
    if (sqlItems.length === 0) return;
    try {
      const res = await checkFavorites(sqlItems);
      const matched = (res?.items || []).filter(it => it.matched);
      if (matched.length === 0) return;
      setFavoriteStates(prev => {
        const next = { ...prev };
        matched.forEach(it => {
          const msgId = sqlToMsgIds.get(it.sqlOutput);
          if (msgId && next[msgId] !== 'loading') next[msgId] = 'done';
        });
        return next;
      });
    } catch (e) {
      console.error('回显收藏状态失败:', e);
    }
  }, []);

  const handleToggleCollapse = useCallback((msgId) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, collapsed: !(m.collapsed ?? true) } : m));
  }, []);

  // 新会话建议：从用户自己的收藏（admin 跨用户）随机抽 4 条
  // 不足 4 条时返回几条就显几个；接口失败/未登录时显示空数组，由渲染层 fallback 到写死
  const [chatSuggestions, setChatSuggestions] = useState([]);
  const fetchChatSuggestions = useCallback(async () => {
    try {
      const res = await getFavoriteSuggestions(4);
      setChatSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
    } catch (e) {
      console.error('获取建议失败:', e);
      setChatSuggestions([]);
    }
  }, []);

  // 首次进入/刷新页面：立即拉一次建议（解决"刷新后还显示写死"的问题）
  useEffect(() => {
    fetchChatSuggestions();
  }, [fetchChatSuggestions]);
  
  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');

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

    try {
      const response = await api.queryGenerateStream({ question: userMessage, schemaMode: 'stream', sessionId: currentSessionId }, abortController.signal);
      
      if (!response.ok) {
        throw new Error('请求失败');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
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
                    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
                      setConfirmTagAdd({
                        visible: true,
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
                      logType: logType
                    };
                    newMsgs.splice(lastAssistantIdx, 0, logMsg);
                  }
                  return newMsgs;
                });
              } else if (data.type === 'error') {
                if (data.content !== '请求已被用户中断') {
                  message.error(data.content);
                }
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastIdx !== -1) {
                    const startTime = newMsgs[lastIdx].startTime || Date.now();
                    const elapsedMs = Date.now() - startTime;
                    newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: data.content === '请求已被用户中断' ? (newMsgs[lastIdx].content || '') + '\n\n*[已中断]*' : '错误: ' + data.content, isStreaming: false, elapsedMs };
                  }
                  return newMsgs;
                });
              } else if (data.type === 'done') {
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastIdx !== -1) {
                    const startTime = newMsgs[lastIdx].startTime || Date.now();
                    const elapsedMs = Date.now() - startTime;
                    newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: data.message || '', sql: data.sql || '', isStreaming: false, elapsedMs };
                  }
                  return newMsgs;
                });
                // 更新 token 显示
                if (data.totalTokens) {
                  setCurrentTokens(prev => prev + data.totalTokens);
                }
              }
            } catch (e) {
              console.warn('Parse SSE error:', e);
            }
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        message.error(error.message);
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
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleConfirmTagAdd = async () => {
    const { table, term } = confirmTagAdd;
    try {
      await addTagToTable(table, term);
      const termStr = Array.isArray(term) ? term.join(', ') : term;
      message.success(`已将 "${termStr}" 添加到 ${table} 的标签`);
    } catch (e) {
      message.error('添加标签失败: ' + e.message);
    }
    setConfirmTagAdd(prev => ({ ...prev, visible: false }));
  };

  const handleCancelTagAdd = () => {
    setConfirmTagAdd(prev => ({ ...prev, visible: false }));
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
        message.error(res.error);
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
        message.success(`查询成功，${res.rowCount} 条结果，耗时 ${elapsed}ms`);
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
      message.error(res.error);
    } else {
      const newResults = res.results || [];
      setColumnWidths({});
      setExplainResults(newResults);
      setExplainPanelOpen(true);
      setIsExplainResult(true);
      message.success(`EXPLAIN 完成，${res.rowCount} 行，耗时 ${elapsed}ms`);
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
    
    try {
      const response = await api.explainAnalyze(getSelectedSql(), explainResults);
      
      if (!response.ok) {
        message.error('请求失败');
        setExplainAnalysisLoading(false);
        return;
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk' && data.content) {
                contentRef.current += data.content;
                setExplainAnalysisContent(contentRef.current);
              } else if (data.type === 'error') {
                message.error(data.content);
                setExplainAnalysisLoading(false);
              } else if (data.type === 'done') {
                setExplainAnalysisLoading(false);
              }
            } catch (e) {
              console.warn('Parse SSE error:', e);
            }
          }
        }
      }
    } catch (error) {
      message.error(error.message);
      setExplainAnalysisLoading(false);
    }
  };
  
const exportToExcel = async (data, cols) => {
    try {
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '查询结果');
      XLSX.writeFile(workbook, `查询结果_${Date.now()}.xlsx`);
      message.success('导出成功');
    } catch (e) {
      // Fallback to CSV
      const headers = cols.map(c => c.title).join(',');
      const rows = data.map(row => cols.map(c => row[c.dataIndex] ?? '').join(','));
      const csv = [headers, ...rows].join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `查询结果_${Date.now()}.csv`;
      a.click();
      message.success('导出CSV成功');
    }
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
        message.error(data.message || '读取失败');
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
        message.success(`保存成功，备份于 ${data.backupFolder}`);
      } else {
        message.error(data.message || '保存失败');
      }
    } catch (e) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSkillSaving(false);
    }
  };

  const handleAddTableStep1 = async () => {
    if (!addTableName.trim()) return;
    setAddTableChecking(true);
    try {
      const data = await checkTableExists(addTableName.trim());
      setAddTableExists(data.exists);
      if (data.exists) {
        setAddTableStep(1.5);
      } else {
        setAddTableStep(2);
        setAddTableDescription(data.tableComment || '');
      }
    } catch (e) {
      message.error('检查失败: ' + e.message);
    } finally {
      setAddTableChecking(false);
    }
  };

  const handleAddTableStep2 = async () => {
    setAddTableChecking(true);
    try {
      const data = await fetchTableDDL(addTableName.trim());
      if (data.success) {
        setAddTableDDL(data.ddl);
        setAddTableDescription(data.tableComment || addTableDescription);
        setAddTableRelatedTables(data.relatedTables || []);
        setAddTableStep(3);
      } else {
        message.error(data.message || '获取DDL失败');
      }
    } catch (e) {
      message.error('获取DDL失败: ' + e.message);
    } finally {
      setAddTableChecking(false);
    }
  };

  const handleAddTableStep3 = async () => {
    setAddTableCreating(true);
    try {
      const data = await createTableFiles(addTableName.trim(), addTableDDL, addTableDescription, addTableSelectedDomains);
      if (data.success) {
        message.success(data.existed ? 'DDL文件已覆盖' : '表格文件创建成功');
        setAddTableModalOpen(false);
        loadSkillsList();
        resetAddTableForm();
      } else {
        message.error(data.message || '创建失败');
      }
    } catch (e) {
      message.error('创建失败: ' + e.message);
    } finally {
      setAddTableCreating(false);
    }
  };

  const resetAddTableForm = () => {
    setAddTableStep(1);
    setAddTableName('');
    setAddTableDDL('');
    setAddTableDescription('');
    setAddTableRelatedTables([]);
    setAddTableExists(false);
    setAddTableSelectedDomains([]);
  };

  const handleAddTableModalClose = () => {
    setAddTableModalOpen(false);
    resetAddTableForm();
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
    title: (props) => (
      <ResizableTitle width={columnWidths[key] || 150} onResize={handleResize(key)}>
        <span style={{ fontSize: 12 }}>{key}</span>
      </ResizableTitle>
    ),
    dataIndex: key,
    key: `col-${idx}`,
    ellipsis: true,
    width: Math.min(300, Math.max(80, columnWidths[key] || 150))
  }))
: [], [currentResults, columnWidths]);

const explainColumns = useMemo(() => explainResults.length > 0
? Object.keys(explainResults[0]).map((key, idx) => ({
    title: (props) => (
      <ResizableTitle width={columnWidths[key] || 150} onResize={handleResize(key)}>
        <span style={{ fontSize: 12 }}>{key}</span>
      </ResizableTitle>
    ),
    dataIndex: key,
    key: `col-${idx}`,
    ellipsis: true,
    width: Math.min(300, Math.max(80, columnWidths[key] || 150))
  }))
: [], [explainResults, columnWidths]);
  
  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    }
  }, [currentSessionId]);

  // 业务域：进入 step 3 时拉取一次
  useEffect(() => {
    if (addTableStep === 3 && addTableDomains.length === 0 && !addTableDomainsLoading) {
      setAddTableDomainsLoading(true);
      getDomains()
        .then(d => {
          if (d.success) setAddTableDomains(d.domains || []);
          else message.error(d.message || '加载业务域失败');
        })
        .catch(e => message.error('加载业务域失败: ' + (e.message || e)))
        .finally(() => setAddTableDomainsLoading(false));
    }
  }, [addTableStep]);

  // 组件卸载时清理 Monaco hover 隐藏定时器，覆盖 editor.onDidDispose 未触发的边界场景
  // （如 React 卸载先于 Monaco 异步销毁、Strict Mode 二次挂载等）
  useEffect(() => {
    return () => {
      if (hoverIntervalRef.current) {
        clearInterval(hoverIntervalRef.current);
        hoverIntervalRef.current = null;
      }
    };
  }, []);

  return (
    <ConfigProvider theme={{ algorithm: theme === 'dark' ? darkAlgorithm : defaultAlgorithm, token: { borderRadius: 10, colorPrimary: '#1677ff' } }}>
      <div className="xtsql-app-bg" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Layout style={{ flex: 1, background: 'transparent', overflow: 'hidden' }}>
          <Sider
            width={260}
            className="xtsql-sider"
            style={{ background: 'var(--xtsql-bg-sider)', borderRight: '1px solid var(--xtsql-border)' }}
            collapsed={siderCollapsed}
            collapsible
            collapsedWidth={0}
            trigger={null}
          >
          <div className="xtsql-sider-inner">
            <div className="xtsql-sider-header">
              <Button className="xtsql-new-chat-btn" icon={<PlusOutlined />} onClick={handleNewSession}>
                新建对话
              </Button>
            </div>
            <div className="xtsql-sider-list" ref={siderListRef} onScroll={handleSiderScroll}>
              <div className="xtsql-sider-section">
                <span>最近对话</span>
                <span style={{ color: 'var(--xtsql-text-tertiary)' }}>{sessionsTotal || sessions.length}</span>
              </div>
              {sessions.length === 0 ? (
                <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 12, color: 'var(--xtsql-text-tertiary)' }}>
                  暂无对话
                </div>
              ) : (
                <>
                  {sessions.map(item => (
                    <div
                      key={item.id}
                      className={`xtsql-session-item ${currentSessionId === item.id ? 'active' : ''}`}
                      onClick={() => handleSessionClick(item)}
                    >
                      <div className="xtsql-session-meta">
                        {editingSessionId === item.id ? (
                          <Input
                            size="small"
                            value={editingSessionName}
                            onChange={(e) => setEditingSessionName(e.target.value)}
                            onPressEnter={() => handleRenameSession(item.id)}
                            onBlur={() => handleRenameSession(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="xtsql-session-name">{item.name}</div>
                            <div className="xtsql-session-desc">
                              {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                            </div>
                          </>
                        )}
                      </div>
                      <div className="xtsql-session-actions" onClick={(e) => e.stopPropagation()}>
                        <Dropdown
                          menu={{
                            items: [
                              { key: 'summarize', label: '总结聊天', icon: <FileTextOutlined style={{ fontSize: 13 }} />, onClick: () => handleSummarizeSession(item.id) },
                              { key: 'rename', label: '重命名', icon: <EditOutlined style={{ fontSize: 13 }} />, onClick: () => handleStartRename(item) },
                              { key: 'delete', label: '删除', icon: <DeleteOutlined style={{ fontSize: 13 }} />, danger: true, onClick: () => handleDeleteSession(item.id) }
                            ]
                          }}
                          trigger={['click']}
                        >
                          <button className="xtsql-icon-btn" title="更多操作">
                            <MoreOutlined />
                          </button>
                        </Dropdown>
                      </div>
                    </div>
                  ))}
                  {loadingMoreSessions && (
                    <div className="xtsql-sider-loading">加载中...</div>
                  )}
                  {!hasMoreSessions && sessions.length > 0 && sessions.length >= sessionsTotal && sessionsTotal > 0 && (
                    <div className="xtsql-sider-end">— 已显示全部 {sessionsTotal} 条对话 —</div>
                  )}
                </>
              )}
            </div>
            <div className="xtsql-sider-footer">
              <div className="xtsql-sider-actions">
                {user?.role === 'admin' && (
                  <Button icon={<SettingOutlined />} onClick={() => setConfigOpen(true)}>配置</Button>
                )}
                <Button icon={<FolderOutlined />} onClick={() => { if (skillTree.length === 0) loadSkillsList(); setSkillOpen(true); }}>Skill</Button>
              </div>
              <div className="xtsql-user-card">
                <div className="xtsql-user-avatar">
                  {(user?.display_name || user?.username || 'U').slice(0, 1).toUpperCase()}
                </div>
                <div className="xtsql-user-info">
                  <div className="xtsql-user-name">{user?.display_name || user?.username || '用户'}</div>
                  <div className="xtsql-user-role">{user?.role === 'admin' ? '管理员' : '普通用户'}</div>
                </div>
                <Tooltip title="修改密码">
                  <Button type="text" size="small" icon={<LockOutlined />} onClick={() => setChangePwdOpen(true)} style={{ color: 'var(--xtsql-text-tertiary)' }} />
                </Tooltip>
                <Tooltip title="退出登录">
                  <Button
                    type="text"
                    size="small"
                    icon={<LogoutOutlined />}
                    onClick={() => {
                      Modal.confirm({
                        title: '确认退出登录？',
                        content: '退出后需要重新登录才能使用。',
                        okText: '退出',
                        cancelText: '取消',
                        onOk: () => logout()
                      });
                    }}
                    style={{ color: 'var(--xtsql-text-tertiary)' }}
                  />
                </Tooltip>
              </div>
            </div>
          </div>
        </Sider>

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
                messages.length === 0 ? (
                  <div className="xtsql-empty">
                    <div className="xtsql-empty-icon"><AppIcon size={64} circle /></div>
                    <div className="xtsql-empty-title">开始新对话</div>
                    <div className="xtsql-empty-desc">用自然语言描述你想要的查询，AI 会自动生成 SQL 并执行</div>
                    <div className="xtsql-suggestion-list">
                      {(chatSuggestions.length > 0
                        ? chatSuggestions
                        : ['查询2024年的销售额', '统计每个分类的商品数量', '查找销售额最高的10个客户', '分析最近30天的订单趋势']
                      ).map(s => (
                        <div key={s} className="xtsql-suggestion" onClick={() => setInput(s)}>
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="xtsql-chat-inner">
                    {messages.map((msg, idx) => {
                      // 找到本条 assistant 消息前最近一条 user 提问（中间可有 log）
                      let userQuestion = null;
                      if (msg.role === 'assistant') {
                        for (let i = idx - 1; i >= 0; i--) {
                          const m = messages[i];
                          if (m.role === 'user') { userQuestion = m.content; break; }
                          if (m.role === 'assistant') break; // 遇到上一轮 assistant 终止
                        }
                      }
                      return (
                        <ChatMessage
                          key={msg.id}
                          msgId={msg.id}
                          role={msg.role}
                          content={msg.content}
                          isStreaming={msg.isStreaming}
                          timestamp={msg.timestamp}
                          collapsed={msg.collapsed !== undefined ? msg.collapsed : true}
                          onToggleCollapse={handleToggleCollapse}
                          logType={msg.logType}
                          sql={msg.sql}
                          startTime={msg.startTime}
                          elapsedMs={msg.elapsedMs}
                          onOpenSqlTab={handleOpenSqlTab}
                          onCopyAndExecute={handleCopyAndExecute}
                          userQuestion={userQuestion}
                          favoriteState={favoriteStates[msg.id]}
                          onFavorite={userQuestion ? ({ userQuestion: uq, sqlOutput }) => handleFavorite({ msgId: msg.id, userQuestion: uq, sqlOutput }) : undefined}
                        />
                      );
                    })}
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Collapse
                    activeKey={sqlKey}
                    onChange={(key) => {
                      const k = Array.isArray(key) ? key : [key];
                      setSqlKey(k);
                      setResultKey(k);
                    }}
                    style={{ flex: 1, overflow: 'auto' }}
                    className="custom-collapse"
items={[
                      {
                    key: 'sql',
                        label: <span style={{ fontWeight: 500, fontSize: 12 }}>SQL预览</span>,
                        children: (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} ref={resizerRef}>
                            <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, position: 'relative' }}>
<Editor
                                onMount={(editor, monaco) => {
                                  setSqlEditorInst(editor);
                                  
                                  const styleId = 'monaco-tooltip-disable-style';
                                  if (!document.getElementById(styleId)) {
                                    const style = document.createElement('style');
                                    style.id = styleId;
                                    style.textContent = `
                                      .monaco-hover, 
                                      .monaco-editor-hover, 
                                      .workbench-hover,
                                      .find-widget .monaco-tooltip {
                                        display: none !important;
                                        visibility: hidden !important;
                                      }
                                      .find-widget .monaco-action-bar .action-label::before,
                                      .find-widget .monaco-action-bar .action-label::after {
                                        display: none !important;
                                      }
                                    `;
                                    document.head.appendChild(style);
                                  }
                                  
                                  const hideHoverWidgets = () => {
                                    const widgets = document.querySelectorAll('.monaco-hover, .monaco-editor-hover, .workbench-hover, .monaco-tooltip');
                                    widgets.forEach(w => {
                                      if (w.style.display !== 'none') {
                                        w.style.display = 'none';
                                      }
                                    });
                                  };

                                  // 清理旧 timer：处理 Editor 重新挂载场景（如 SQL 输入切换 / Strict Mode 二次挂载）
                                  if (hoverIntervalRef.current) {
                                    clearInterval(hoverIntervalRef.current);
                                    hoverIntervalRef.current = null;
                                  }
                                  hoverIntervalRef.current = setInterval(hideHoverWidgets, 100);
                                  // 编辑器销毁时清理定时器，避免内存泄漏
                                  const disposeDisposable = editor.onDidDispose(() => {
                                    if (hoverIntervalRef.current) {
                                      clearInterval(hoverIntervalRef.current);
                                      hoverIntervalRef.current = null;
                                    }
                                    disposeDisposable?.dispose();
                                  });
                                }}
                                height={sqlPreviewHeight}
                                defaultLanguage="sql"
                                value={sqlInput}
                                onChange={handleSqlChange}
                                theme="vs-dark"
                                options={{
                                  minimap: { enabled: false },
                                  fontSize: 11,
                                  lineNumbers: 'on',
                                  scrollBeyondLastLine: false,
                                  automaticLayout: true,
                                  wordWrap: 'on',
                                  folding: false,
                                  glyphMargin: false,
                                  renderLineHighlight: 'none',
                                  hover: { enabled: false },
                                  quickSuggestions: false,
                                  parameterHints: { enabled: false },
                                  suggestOnTriggerCharacters: false,
                                  acceptSuggestionOnEnter: 'off',
                                  tabCompletion: 'off',
                                  wordBasedSuggestions: 'off'
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  height: 6,
                                  cursor: 'ns-resize',
                                  background: 'transparent',
                                  zIndex: 10
                                }}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  const startY = e.clientY;
                                  const startHeight = sqlPreviewHeight;
                                  let raf = 0;
                                  const handleMove = (moveEvent) => {
                                    const delta = moveEvent.clientY - startY;
                                    const newHeight = Math.max(100, Math.min(500, startHeight + delta));
                                    if (raf) cancelAnimationFrame(raf);
                                    raf = requestAnimationFrame(() => {
                                      setSqlPreviewHeight(newHeight);
                                    });
                                  };
                                  const handleUp = () => {
                                    document.removeEventListener('mousemove', handleMove);
                                    document.removeEventListener('mouseup', handleUp);
                                    if (raf) cancelAnimationFrame(raf);
                                  };
                                  document.addEventListener('mousemove', handleMove);
                                  document.addEventListener('mouseup', handleUp);
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              <Button 
                                size="small" 
                                icon={<SelectOutlined />}
                                disabled={!sqlInput.trim() && !getSelectedSql()}
                                onClick={() => handleExplain(getSelectedSql())}
                              >EXPLAIN</Button>
                              
                              <Button type="primary" size="small" disabled={!sqlInput.trim() && !getSelectedSql()} onClick={() => handleExecute(getSelectedSql())}>查询</Button>
                            </div>
                          </div>
                        )
                      },
{
                    key: 'result',
                        label: <span style={{ fontWeight: 500, fontSize: 12 }}>查询结果 ({currentRowCount} 条{currentQueryTime ? `, ${currentQueryTime}ms` : ''})</span>,
children: currentResults.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                height: 6,
                                cursor: 'ns-resize',
                                zIndex: 10
                              }}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                const startY = e.clientY;
                                const startHeight = resultTableHeight;
                                let raf = 0;
                                const handleMove = (moveEvent) => {
                                  const delta = startY - moveEvent.clientY;
                                  const newHeight = Math.max(100, Math.min(600, startHeight + delta));
                                  if (raf) cancelAnimationFrame(raf);
                                  raf = requestAnimationFrame(() => {
                                    setResultTableHeight(newHeight);
                                  });
                                };
                                const handleUp = () => {
                                  document.removeEventListener('mousemove', handleMove);
                                  document.removeEventListener('mouseup', handleUp);
                                  if (raf) cancelAnimationFrame(raf);
                                };
                                document.addEventListener('mousemove', handleMove);
                                document.addEventListener('mouseup', handleUp);
                              }}
                            />
                            <div style={{ marginBottom: 8, marginTop: 6, flexShrink: 0, display: 'flex', gap: 8 }}>
                              <Button size="small" onClick={() => exportToExcel(currentResults, columns)}>导出Excel</Button>

                            </div>
                            <div style={{ height: resultTableHeight, overflow: 'visible' }}>
                              <Table
                                dataSource={currentResults}
                                columns={columns}
                                components={{ header: { cell: ResizableTitle } }}
                                pagination={{
                                  pageSize: pageSize,
                                  showSizeChanger: true,
                                  pageSizeOptions: ['10', '20', '50', '100'],
                                  onShowSizeChange: (_, size) => setPageSize(size)
                                }}
                                scroll={{ x: 'max-content' }}
                                size="small"
                                className="sql-result-table"
                                style={{ fontSize: 10 }}
                                rootClassName="sticky-table-header"
                              />
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: '#999' }}>暂无结果</div>
                        )
                      },
                      ...(explainResults.length > 0 ? [{
                        key: 'explain',
                        label: <span style={{ fontWeight: 500, fontSize: 12 }}>执行计划</span>,
                        children: (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                              <Button size="small" icon={<AppIcon size={18} />} onClick={handleExplainAnalyze}>AI分析</Button>
                            </div>
                            <Table
                              dataSource={explainResults}
                              columns={explainColumns}
                              pagination={{
                                pageSize: pageSize,
                                showSizeChanger: true,
                                pageSizeOptions: ['10', '20', '50', '100'],
                                onShowSizeChange: (_, size) => setPageSize(size)
                              }}
                              scroll={{ x: 'max-content' }}
                              size="small"
                              className="sql-result-table"
                              style={{ fontSize: 10 }}
                              rootClassName="sticky-table-header"
                            />
                          </div>
                        )
                      }] : [])
                    ]}
                  />
                </div>
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
              
              <Modal
                title="会话消息详情"
                open={showMessagesModal}
                onCancel={() => setShowMessagesModal(false)}
                footer={null}
                width={800}
                styles={{ body: { padding: 0 } }}
              >
                <div style={{ padding: '12px 16px', background: 'var(--xtsql-hover)', borderBottom: '1px solid var(--xtsql-border)', fontSize: 12 }}>
                  <span style={{ color: '#666' }}>消息上下文长度：</span>
                  <span style={{ color: '#1890ff', fontWeight: 500, marginLeft: 4 }}>{sessionMessagesTokens}</span>
                  <span style={{ color: '#666', marginLeft: 2 }}>tokens</span>
                </div>
                <div style={{ height: 480, borderTop: '1px solid var(--xtsql-border)' }}>
                  <Editor
                    height={480}
                    defaultLanguage="json"
                    value={sessionMessagesContent}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 11,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      wordWrap: 'on',
                      folding: true,
                      readOnly: true
                    }}
                  />
                </div>
              </Modal>
            </div>
            
            {activeTabKey === 'chat' && (
              <div className="xtsql-input-wrap">
                <div
                  ref={inputResizerRef}
                  className="xtsql-input-inner"
                  style={{ minHeight: inputHeight }}
                >
                  <div
                    className="xtsql-input-resizer"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const startY = e.clientY;
                      const startHeight = inputHeight;
                      const handleMove = (moveEvent) => {
                        const delta = moveEvent.clientY - startY;
                        const newHeight = Math.max(60, Math.min(300, startHeight - delta));
                        setInputHeight(newHeight);
                      };
                      const handleUp = () => {
                        document.removeEventListener('mousemove', handleMove);
                        document.removeEventListener('mouseup', handleUp);
                      };
                      document.addEventListener('mousemove', handleMove);
                      document.addEventListener('mouseup', handleUp);
                    }}
                  />
                  <div className="xtsql-input-grip" />
                  <TextArea
                    className="xtsql-input-textarea"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="输入自然语言查询，按Enter发送，Shift+Enter换行"
                    autoSize={{ minRows: 1, maxRows: 10 }}
                    style={{ height: inputHeight - 44 }}
                  />
                  <div className="xtsql-input-footer">
                    <div className="xtsql-input-meta">
                      {currentModel && <span className="xtsql-input-model-tag">{currentModel}</span>}
                      {currentTokens > 0 && <span>{currentTokens} tokens</span>}
                      <div
                        className="xtsql-token-bar"
                        onClick={handleViewMessages}
                        title="查看消息详情"
                      >
                        <div
                          className="xtsql-token-bar-fill"
                          style={{
                            width: `${Math.min((sessionMessagesTokens / tokenWarningLevel) * 100, 100)}%`,
                            backgroundColor: sessionMessagesTokens > tokenWarningLevel ? 'var(--xtsql-danger)' : 'var(--xtsql-accent)'
                          }}
                        />
                      </div>
                    </div>
                    {loading ? (
                      <Button
                        className="xtsql-send-btn danger"
                        onClick={handleStop}
                        icon={<LoadingOutlined spin />}
                      />
                    ) : (
                      <Button
                        className="xtsql-send-btn"
                        onClick={handleSend}
                        disabled={!input.trim()}
                        icon={<SendOutlined />}
                      />
                    )}
                  </div>
                </div>
              </div>
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

        <Drawer
          className="xtsql-drawer"
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Skill查看器</span>
              <Button
                type="text"
                size="small"
                icon={skillLocked ? <LockOutlined /> : <UnlockOutlined />}
                onClick={() => setSkillLocked(!skillLocked)}
                title={skillLocked ? '点击解锁编辑权限' : '点击锁定编辑权限'}
                style={{ color: skillLocked ? 'var(--xtsql-text-tertiary)' : 'var(--xtsql-success)' }}
              />
            </div>
          }
          placement="right"
          width={skillDrawerWidth}
          onClose={() => setSkillOpen(false)}
          open={skillOpen}
          onOpen={() => { if (skillTree.length === 0) loadSkillsList(); }}
          styles={{ body: { padding: '0 16px', position: 'relative' } }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 8,
              cursor: 'ew-resize',
              zIndex: 10
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = skillDrawerWidth;
              let raf = 0;
              const handleMove = (moveEvent) => {
                const delta = startX - moveEvent.clientX;
                const newWidth = Math.max(300, Math.min(800, startWidth + delta));
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => {
                  setSkillDrawerWidth(newWidth);
                });
              };
              const handleUp = () => {
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseup', handleUp);
                if (raf) cancelAnimationFrame(raf);
              };
              document.addEventListener('mousemove', handleMove);
              document.addEventListener('mouseup', handleUp);
            }}
          />
          <div className="skill-drawer-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 6, overflow: 'hidden', paddingTop: 5 }}>
            <div style={{display:'flex',alignItems:'center',cursor:'pointer',marginBottom:4}} onClick={()=>setSkillTreeCollapsed(!skillTreeCollapsed)}>
              {skillTreeCollapsed?<CaretRightOutlined style={{marginRight:4,fontSize:10}}/>:<DownOutlined style={{marginRight:4,fontSize:10}}/>}
              <span style={{fontSize:12,fontWeight:500}}>目录结构</span>
            </div>
{!skillLocked && !skillTreeCollapsed && (
              <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                <Button 
                  size="small" 
                  icon={<TableOutlined style={{ color: '#1890ff' }} />} 
                  style={{ fontSize: 11, color: '#1890ff' }}
                  title="添加表格"
                  onClick={() => setAddTableModalOpen(true)}
                >添加</Button>
              </div>
            )}
            {!skillTreeCollapsed && <div style={{ height: skillTreeHeight, overflow: 'auto', borderBottom: '1px solid var(--xtsql-border)', marginBottom: 8, padding: 8, background: 'var(--xtsql-hover)', borderRadius: 4, position: 'relative' }} className="skill-drawer-scroll">
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 6,
                  cursor: 'ns-resize',
                  zIndex: 10
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startHeight = skillTreeHeight;
                  const handleMove = (moveEvent) => {
                    const delta = moveEvent.clientY - startY;
                    const newHeight = Math.max(80, Math.min(400, startHeight + delta));
                    setSkillTreeHeight(newHeight);
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                }}
              />
              <div style={{ height: '100%' }} className="skill-drawer-scroll">
                <div>
                  {skillTree.length > 0 ? (
                    <Tree
                      treeData={skillTree}
                      showIcon={true}
                      onSelect={(selectedKeys, { node }) => {
                        if (!node.isFolder) {
                          handleSkillFileSelect(node.key);
                        }
                      }}
                      style={{ fontSize: 12, padding: '4px 0' }}
                      icon={(node) => node.isFolder ? <FolderOpenOutlined style={{ color: '#faad14' }} /> : <FileTextOutlined style={{ color: '#1890ff' }} />}
                    />
                  ) : (
                    <div style={{ color: '#999', fontSize: 12 }}>暂无内容</div>
                  )}
                </div>
              </div>
            </div>}
            <div style={{display:'flex',alignItems:'center',cursor:'pointer',marginBottom:4}} onClick={()=>setSkillContentCollapsed(!skillContentCollapsed)}>
              {skillContentCollapsed?<CaretRightOutlined style={{marginRight:4,fontSize:10}}/>:<DownOutlined style={{marginRight:4,fontSize:10}}/>}
              <span style={{fontSize:12,fontWeight:500}}>文件内容</span>
            </div>
            {!skillContentCollapsed && <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginBottom: 10, position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 6,
                  cursor: 'ns-resize',
                  zIndex: 10
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startY = e.clientY;
                  const startHeight = skillEditorHeight;
                  let raf = 0;
                  const handleMove = (moveEvent) => {
                    const delta = moveEvent.clientY - startY;
                    const newHeight = Math.max(100, Math.min(500, startHeight - delta));
                    if (raf) cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(() => {
                      setSkillEditorHeight(newHeight);
                    });
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
                    if (raf) cancelAnimationFrame(raf);
                  };
                  document.addEventListener('mousemove', handleMove);
                  document.addEventListener('mouseup', handleUp);
                }}
              />
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{skillSelectedFile ? `文件: ${skillSelectedFile}` : '文件内容'}</span>
                {!skillLocked && skillSelectedFile && skillFileContent !== skillOriginalContent && (
                  <Button 
                    type="text" 
                    size="small" 
                    loading={skillSaving}
                    onClick={handleSkillSave}
                    style={{ padding: 2, height: 20, minWidth: 20 }}
                    icon={<EditOutlined style={{ fontSize: 12 }} />}
                  />
                )}
              </div>
              <div style={{ flex: 1, border: '1px solid #444', borderRadius: 4, overflow: 'hidden', position: 'relative', background: '#1e1e1e' }}>
                <Editor
                  height="100%"
                  language={skillFileLanguage}
                  value={skillSelectedFile ? skillFileContent : '请选择文件查看内容'}
                  onChange={(value) => setSkillFileContent(value || '')}
                  theme="vs-dark"
                  options={{
                    readOnly: skillLocked,
                    minimap: { enabled: false },
                    fontSize: 11,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: 'on',
                    hover: { enabled: false }
                  }}
                />
              </div>
            </div>}
          </div>
        </Drawer>
        
        <Modal
          title="添加表格"
          open={addTableModalOpen}
          onCancel={handleAddTableModalClose}
          footer={null}
          width={600}
        >
          <Steps current={addTableStep === 1.5 ? 1 : addTableStep - 1} style={{ marginBottom: 24 }}>
            <Steps.Step title="输入表名" />
            <Steps.Step title="获取DDL" />
            <Steps.Step title="生成文件" />
          </Steps>
          
          {addTableStep === 1 && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <Input 
                  placeholder="请输入要添加的表名" 
                  value={addTableName}
                  onChange={e => setAddTableName(e.target.value)}
                  onPressEnter={handleAddTableStep1}
                />
              </div>
              <div style={{ textAlign: 'right' }}>
                <Button type="primary" onClick={handleAddTableStep1} loading={addTableChecking} disabled={!addTableName.trim()}>
                  下一步
                </Button>
              </div>
            </div>
          )}
          
          {addTableStep === 1.5 && (
            <div>
              <div style={{ marginBottom: 16, padding: 16, background: 'var(--xtsql-warning-bg)', border: '1px solid var(--xtsql-warning-border)', borderRadius: 4 }}>
                表 <strong>{addTableName}</strong> 已存在，继续则仅覆盖 DDL 文件，table_index 和 field_config 不会修改
              </div>
              <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button onClick={handleAddTableModalClose}>取消</Button>
                <Button onClick={() => { setAddTableStep(2); }}>继续</Button>
              </div>
            </div>
          )}
          
          {addTableStep === 2 && (
            <div>
              {addTableChecking ? (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <Spin tip="正在查询数据库获取DDL..." />
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: 16, padding: 16, background: 'var(--xtsql-code-bg)', borderRadius: 4 }}>
                    正在获取表 <strong>{addTableName}</strong> 的DDL...
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button onClick={() => setAddTableStep(1)}>上一步</Button>
                    <Button type="primary" onClick={handleAddTableStep2}>获取DDL</Button>
                  </div>
                </div>
              )}
            </div>
          )}
          
          {addTableStep === 3 && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>表名: {addTableName}</div>
                {!addTableExists && (
                  <>
                    <div style={{ marginBottom: 8 }}>描述: <Input value={addTableDescription} onChange={e => setAddTableDescription(e.target.value)} placeholder="请输入表描述（可选）" /></div>
                    {addTableRelatedTables.length > 0 && (
                      <div style={{ marginBottom: 8 }}>关联表: {addTableRelatedTables.join(', ')}</div>
                    )}
                  </>
                )}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ marginBottom: 4, fontSize: 12 }}>
                    业务域 <span style={{ color: '#ff4d4f' }}>*</span>
                    <span style={{ color: '#999', marginLeft: 8, fontSize: 11 }}>
                      悬停查看说明，至少选 1 个
                    </span>
                  </div>
                  <Select
                    mode="multiple"
                    placeholder="请选择业务域"
                    value={addTableSelectedDomains}
                    onChange={setAddTableSelectedDomains}
                    loading={addTableDomainsLoading}
                    style={{ width: '100%' }}
                    optionLabelProp="label"
                    size="small"
                  >
                    {addTableDomains.map(d => (
                      <Select.Option key={d.id} value={d.id} label={d.name}>
                        <Tooltip title={d.description} placement="right">
                          <span style={{ cursor: 'help' }}>{d.name}</span>
                        </Tooltip>
                      </Select.Option>
                    ))}
                  </Select>
                </div>
              </div>
              <div style={{ marginBottom: 16, maxHeight: 200, overflow: 'auto', background: 'var(--xtsql-code-bg)', padding: 8, borderRadius: 4, fontSize: 11 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{addTableDDL}</pre>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button onClick={() => setAddTableStep(2)} disabled={addTableCreating}>上一步</Button>
                <Button
                  type="primary"
                  onClick={handleAddTableStep3}
                  loading={addTableCreating}
                  disabled={addTableSelectedDomains.length === 0}
                >
                  {addTableExists ? '覆盖DDL' : '生成文件'}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <ChangePasswordModal open={changePwdOpen} onClose={() => setChangePwdOpen(false)} onChanged={() => { setChangePwdOpen(false); logout(); }} />
        
        <Modal
          title="AI 分析 EXPLAIN 结果"
          open={explainAnalyzeModalOpen}
          onCancel={() => setExplainAnalyzeModalOpen(false)}
          footer={null}
          width={700}
          style={{ top: 20 }}
        >
          <div style={{
            maxHeight: '70vh',
            overflow: 'auto',
            padding: '8px 12px',
            background: 'var(--xtsql-code-bg)',
            borderRadius: 4
          }}>
            {explainAnalysisLoading && !explainAnalysisContent ? (
              <><Spin /> 正在分析...</>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({node, ...props}) => <p style={{fontSize: 12, marginTop: 0, marginBottom: 8}} {...props} />,
                  h1: ({node, ...props}) => <h1 style={{fontSize: 16, marginTop: 12, marginBottom: 8}} {...props} />,
                  h2: ({node, ...props}) => <h2 style={{fontSize: 14, marginTop: 10, marginBottom: 6}} {...props} />,
                  h3: ({node, ...props}) => <h3 style={{fontSize: 13, marginTop: 8, marginBottom: 6}} {...props} />,
                  ul: ({node, ...props}) => <ul style={{fontSize: 12, paddingLeft: 20, marginTop: 4, marginBottom: 8}} {...props} />,
                  li: ({node, ...props}) => <li style={{fontSize: 12, marginBottom: 4}} {...props} />,
                  ...createMarkdownRenderers(theme === 'dark', { fontSize: 11 }),
                }}
              >{explainAnalysisContent || (explainAnalysisLoading ? '正在分析...' : '')}</ReactMarkdown>
            )}
          </div>
        </Modal>
    </ConfigProvider>
  );
}

// 修改密码弹窗
function ChangePasswordModal({ open, onClose, onChanged }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 关闭时清空表单
  useEffect(() => {
    if (!open) form.resetFields();
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await api.changePasswordApi({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      });
      message.success('密码已修改，请重新登录');
      // 改密会吊销 token_version，前端必须退出登录态
      onChanged && onChanged();
    } catch (e) {
      if (e?.errorFields) {
        // antd 表单校验失败，不报错
        return;
      }
      const msg = e?.response?.data?.error || e?.message || '修改失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="修改密码"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="确认修改"
      cancelText="取消"
      destroyOnClose
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="请输入当前密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码长度不能少于 6 位' }
          ]}
          hasFeedback
        >
          <Input.Password prefix={<LockOutlined />} placeholder="新密码（至少 6 位）" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          hasFeedback
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              }
            })
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default App;

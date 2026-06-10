import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Layout, Input, Button, Table, message, Select, Spin, Empty, Drawer, List, ConfigProvider, Popconfirm, Tabs, Collapse, Tree, InputNumber, Modal, Steps, Space, Dropdown } from 'antd';
import 'react-resizable/css/styles.css';
import './App.css';
const { Panel } = Collapse;

import ConfirmDialog from './components/ConfirmDialog';
import ResizableTitle from './components/ResizableTitle';
import ChatMessage from './components/ChatMessage';
import ConfigPanel from './components/ConfigPanel';
import * as api from './api/index.js';
import { SettingOutlined, CloseOutlined, PlusOutlined, MenuOutlined, FolderOutlined, FileTextOutlined, FolderOpenOutlined, CaretRightOutlined, DownOutlined, LockOutlined, UnlockOutlined, CheckOutlined, EditOutlined, TableOutlined, SendOutlined, SelectOutlined, RobotOutlined, MoreOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';
import './utils/monacoEnv';
import { queryExecute, getSessions, createSession, getSessionMessages, saveSessionMessage, deleteSession, getSkillsList, readSkillFile, saveSkillFile, getSessionTokens, checkTableExists, fetchTableDDL, createTableFiles, explainQuery, updateSession, summarizeSession, addTagToTable, getQueryMessages } from './api';

const { TextArea } = Input;
const { Sider, Content } = Layout;

function App() {
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [schemaMode, setSchemaMode] = useState('stream');
  const [isStreaming, setIsStreaming] = useState(false);
  const [results, setResults] = useState([]);
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
  const inputResizerRef = useRef(null);
  const resizerRef = useRef(null);
  const initialLoadRef = useRef(false);
  const abortControllerRef = useRef(null);
  const chatContentRef = useRef(null);
  // 流式响应期间用于 rAF 节流的滚动句柄（避免每 chunk 触发 scrollIntoView）
  const streamingScrollRafRef = useRef(0);
  // 客户端消息 id 计数器：保证新创建的每条消息都有稳定唯一 key
  // DB 加载的消息用 `db-<row_id>` 命名空间，与客户端 `c-N` 互不冲突
  const clientMsgIdRef = useRef(0);
  
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
    if (loadCurrentModel.loading) return;
    loadCurrentModel.loading = true;
    try {
      const data = await api.getLlMConfig();
      setCurrentModel(data.model || '');
    } catch (e) {} finally {
      loadCurrentModel.loading = false;
    }
  };
  loadCurrentModel.loading = false;

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

  const loadSessions = async () => {
    if (loadSessions.loading) return;
    loadSessions.loading = true;
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
      if (data.sessions && data.sessions.length > 0 && !currentSessionId) {
        const firstSession = data.sessions[0];
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
      loadSessions.loading = false;
    }
  };
  loadSessions.loading = false;
  
  const loadMessages = async (sessionId) => {
    if (loadMessages.loading === sessionId) return;
    loadMessages.loading = sessionId;
    try {
      const data = await getSessionMessages(sessionId);
      if (data.messages) {
        setMessages(data.messages
          .filter(m => m.role !== 'usage')
          .map(m => ({
            id: `db-${m.id}`,
            role: m.role,
            content: m.content || m.sql || '',
            sql: m.sql || '',
            timestamp: m.created_at,
            logType: m.role === 'LLM' ? 'llm' : m.role === 'tool_return' ? 'return' : 'call'
          })));
      }
    } catch (e) {
      console.error('加载消息失败:', e);
    } finally {
      loadMessages.loading = null;
    }
  };
  loadMessages.loading = null;
  
  useEffect(() => {
    if (messages.length > messageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      messageCountRef.current = messages.length;
    }
  }, [messages.length]);
  
  const handleNewSession = async () => {
    try {
      const data = await createSession('新对话');
      const sessionName = data.name || '新对话';
      const newSession = { 
        id: data.id, 
        name: sessionName, 
        created_at: new Date().toISOString() 
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(data.id);
      setCurrentSessionName(`${sessionName}#${data.id}`);
      setCurrentTokens(0);
      setMessages([]);
      setResults([]);
      setShowResults(false);
      messageCountRef.current = 0;
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
    // 获取当前会话的token消耗
    try {
      const data = await getSessionTokens(session.id);
      setCurrentTokens(data.total_tokens || 0);
    } catch (e) {
      setCurrentTokens(0);
    }
    // 先重置查看消息按钮颜色为默认色
    setSessionMessagesTokens(0);
    // 获取最新的token警告阈值配置
    try {
      const config = await api.getAgentConfig();
      setTokenWarningLevel(parseInt(config.agent_token_warning_level) || 30000);
    } catch (e) {
      console.debug('获取Agent配置失败:', e.message);
    }
    // 然后查询消息接口，更新token数用于判断按钮颜色
    try {
      const msgData = await getQueryMessages(session.id);
      if (msgData.success) {
        setSessionMessagesTokens(msgData.messageTokens || 0);
      }
    } catch (e) {
      console.debug('获取消息token失败:', e.message);
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
          setSessions(prev => prev.filter(s => s.id !== sessionId));
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

  const handleToggleCollapse = useCallback((msgId) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, collapsed: !(m.collapsed ?? true) } : m));
  }, []);
  
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMessage = input.trim();
    setInput('');
    
    const now = new Date().toISOString();
    const newMessages = [...messages,
      { id: `c-${++clientMsgIdRef.current}`, role: 'user', content: userMessage, timestamp: now },
      { id: `c-${++clientMsgIdRef.current}`, role: 'assistant', content: '', isStreaming: true, timestamp: now }
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
                    newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: data.content === '请求已被用户中断' ? (newMsgs[lastIdx].content || '') + '\n\n*[已中断]*' : '错误: ' + data.content, isStreaming: false };
                  }
                  return newMsgs;
                });
              } else if (data.type === 'done') {
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastIdx !== -1) {
                    newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: data.message || '', sql: data.sql || '', isStreaming: false };
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
          newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: error.name === 'AbortError' ? (newMsgs[lastIdx].content || '') + '\n\n*[已中断]*' : '错误: ' + error.message, isStreaming: false };
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
      const data = await createTableFiles(addTableName.trim(), addTableDDL, addTableDescription);
      if (data.success) {
        message.success('表格文件创建成功');
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
  
  return (
    <ConfigProvider>
      <Layout style={{ height: '100vh', background: '#fff', overflow: 'hidden' }}>
        <Sider 
          width={260} 
          style={{ background: '#fafafa', borderRight: '1px solid #e8e8e8' }} 
          collapsed={siderCollapsed}
          collapsible 
          collapsedWidth={0}
          trigger={null}
        >
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 8, borderBottom: '1px solid #e8e8e8' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={handleNewSession} size="small" style={{ width: '100%' }}>
                新对话
              </Button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <List
                dataSource={sessions}
                renderItem={item => (
                  <List.Item
                    key={item.id}
                    style={{ padding: '4px 8px', cursor: 'pointer', background: currentSessionId === item.id ? '#e6f7ff' : 'transparent', borderLeft: currentSessionId === item.id ? '3px solid #1890ff' : '3px solid transparent' }}
                    onClick={() => handleSessionClick(item)}
                    actions={[
                      <Dropdown
                        key="more"
                        menu={{
                          items: [
                            { key: 'summarize', label: '总结聊天', icon: <FileTextOutlined style={{ fontSize: 14 }} />, onClick: () => handleSummarizeSession(item.id) },
                            { key: 'rename', label: '重命名', icon: <EditOutlined style={{ fontSize: 14 }} />, onClick: () => handleStartRename(item) },
                            { key: 'delete', label: '删除', icon: <DeleteOutlined style={{ fontSize: 14 }} />, danger: true, onClick: () => handleDeleteSession(item.id) }
                          ]
                        }}
                        trigger={['click']}
                      >
                        <span 
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4, borderRadius: 4 }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#1890ff'; e.currentTarget.style.background = '#e6f7ff'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#999'; e.currentTarget.style.background = 'transparent'; }}
                        >
                          <MoreOutlined style={{ color: '#999', cursor: 'pointer', fontSize: 14 }} />
                        </span>
                      </Dropdown>
                    ]}
                  >
                    <List.Item.Meta
                      title={editingSessionId === item.id ? (
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
                        <span style={{ fontSize: 11 }}>{item.name} <span style={{ color: '#999' }}>#{item.id}</span></span>
                      )}
                      description={<span style={{ fontSize: 9, color: '#999' }}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</span>}
                    />
                  </List.Item>
                )}
              />
            </div>
            <div style={{ padding: '8px', borderTop: '1px solid #e8e8e8', display: 'flex', gap: 8 }}>
              <Button icon={<SettingOutlined />} onClick={() => setConfigOpen(true)} size="small" style={{ flex: 1 }}>
                配置
              </Button>
              <Button icon={<FolderOutlined />} onClick={() => { if (skillTree.length === 0) loadSkillsList(); setSkillOpen(true); }} size="small" style={{ flex: 1 }}>
                Skill
              </Button>
            </div>
          </div>
        </Sider>
        
        <Layout>
          <Content style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
<div style={{ padding: '8px 16px 0', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
  <Button
    type="text"
    icon={<MenuOutlined />}
    onClick={() => setSiderCollapsed(!siderCollapsed)}
    title={siderCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
    style={{ marginBottom: 2 }}
  />
              {(() => {
                const currentChatLabel = '聊天' + (currentSessionName !== '聊天' ? ` (${currentSessionName})` : '');
                return (
<Tabs
        activeKey={activeTabKey}
        onChange={handleTabChange}
        type="editable-card"
        size="small"
        style={{ flex: 1 }}
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
            </div>
            
            <div ref={chatContentRef} style={{ flex: 1, overflow: 'auto', padding: '20px 24px', background: '#fff' }}>
              {activeTabKey === 'chat' ? (
                messages.length === 0 ? (
                  <Empty description="开始新对话吧" style={{ marginTop: 100 }}>
                    <div style={{ color: '#999', fontSize: 14 }}>例如: "查询2024年的课程销售额"</div>
                  </Empty>
                ) : (
                  messages.map((msg) => (
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
                      onOpenSqlTab={handleOpenSqlTab}
                      onCopyAndExecute={handleCopyAndExecute}
                    />
                  ))
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

                                  const hoverClearInterval = setInterval(hideHoverWidgets, 100);
                                  // 编辑器销毁时清理定时器，避免内存泄漏
                                  const disposeDisposable = editor.onDidDispose(() => {
                                    clearInterval(hoverClearInterval);
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
                              <Button size="small" icon={<RobotOutlined />} onClick={handleExplainAnalyze}>AI分析</Button>
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
                <div style={{ padding: '12px 16px', background: '#f5f5f5', borderBottom: '1px solid #e8e8e8', fontSize: 12 }}>
                  <span style={{ color: '#666' }}>消息上下文长度：</span>
                  <span style={{ color: '#1890ff', fontWeight: 500, marginLeft: 4 }}>{sessionMessagesTokens}</span>
                  <span style={{ color: '#666', marginLeft: 2 }}>tokens</span>
                </div>
                <div style={{ height: 480, borderTop: '1px solid #e8e8e8' }}>
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
              <>
                <div
                  ref={inputResizerRef}
                  style={{ minHeight: inputHeight, background: '#fff', position: 'relative', display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 16px rgba(0, 0, 0, 0.1), 0 -4px 8px rgba(0, 0, 0, 0.08)' }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 10,
                      cursor: 'ns-resize',
                      zIndex: 20,
                      pointerEvents: 'auto'
                    }}
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
                  <div style={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', width: 40, height: 4, background: '#d9d9d9', borderRadius: 2, cursor: 'ns-resize', pointerEvents: 'none', zIndex: 15 }} />
                  <div style={{ flex: 1, padding: '8px 24px 0' }}>
                    <TextArea
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      placeholder="输入自然语言查询，按Enter发送，Shift+Enter换行"
                      style={{ resize: 'none', width: '100%', border: 'none', boxShadow: 'none' }}
                      autoSize={{ minRows: 1, maxRows: 10 }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 24px 8px' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#1890ff', display: 'flex', gap: 8, alignItems: 'center' }}>
                      {currentModel && <span>{currentModel}</span>}
                      {currentTokens > 0 && <span style={{ color: '#999', fontWeight: 'normal' }}>{currentTokens} tokens</span>}
                      <div
                        onClick={handleViewMessages}
                        style={{ 
                          width: '60px', 
                          height: '8px',
                          cursor: 'pointer',
                          backgroundColor: '#e8e8e8',
                          borderRadius: '4px',
                          overflow: 'hidden'
                        }}
                      >
                        <div 
                          style={{ 
                            height: '100%', 
                            width: `${Math.min((sessionMessagesTokens / tokenWarningLevel) * 100, 100)}%`,
                            backgroundColor: sessionMessagesTokens > tokenWarningLevel ? '#ff4d4f' : '#52c41a',
                            borderRadius: '4px',
                            transition: 'width 0.3s ease'
                          }} 
                        />
                      </div>
                    </div>
                    {loading ? (
                      <Button
                        size="small"
                        danger
                        onClick={handleStop}
                        style={{ fontSize: 11, padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        icon={<Spin size="small" indicator={<LoadingOutlined style={{ fontSize: 11, color: '#ff4d4f' }} spin />} />}
                      />
                    ) : (
                      <Button
                        size="small"
                        type="primary"
                        onClick={handleSend}
                        disabled={!input.trim()}
                        icon={<SendOutlined />}
                        loading={loading}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </Content>
        </Layout>
        
        <Drawer title="配置" placement="right" width={400} onClose={() => setConfigOpen(false)} open={configOpen}>
          <div className="config-drawer" style={{ padding: '0 10px' }}>
            <ConfigPanel compact />
          </div>
        </Drawer>
        
        <Drawer 
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Skill查看器</span>
              <Button 
                type="text" 
                size="small" 
                icon={skillLocked ? <LockOutlined /> : <UnlockOutlined />} 
                onClick={() => setSkillLocked(!skillLocked)}
                title={skillLocked ? '点击解锁编辑权限' : '点击锁定编辑权限'}
                style={{ color: skillLocked ? '#999' : '#52c41a' }}
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
            {!skillTreeCollapsed && <div style={{ height: skillTreeHeight, overflow: 'auto', borderBottom: '1px solid #e8e8e8', marginBottom: 8, padding: 8, background: '#fafafa', borderRadius: 4, position: 'relative' }} className="skill-drawer-scroll">
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
              <div style={{ marginBottom: 16, padding: 16, background: '#fff7e6', border: '1px solid #faad14', borderRadius: 4 }}>
                表 <strong>{addTableName}</strong> 已存在于 table_index.json 中，是否仍要继续？（可能覆盖已有信息）
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
                  <div style={{ marginBottom: 16, padding: 16, background: '#f5f5f5', borderRadius: 4 }}>
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
                <div style={{ marginBottom: 8 }}>描述: <Input value={addTableDescription} onChange={e => setAddTableDescription(e.target.value)} placeholder="请输入表描述（可选）" /></div>
                {addTableRelatedTables.length > 0 && (
                  <div style={{ marginBottom: 8 }}>关联表: {addTableRelatedTables.join(', ')}</div>
                )}
              </div>
              <div style={{ marginBottom: 16, maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 11 }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{addTableDDL}</pre>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button onClick={() => setAddTableStep(2)} disabled={addTableCreating}>上一步</Button>
                <Button type="primary" onClick={handleAddTableStep3} loading={addTableCreating}>生成文件</Button>
              </div>
            </div>
          )}
        </Modal>
        
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
            background: '#f5f5f5',
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
                  code: ({node, ...props}) => <code style={{fontSize: 11, background: '#eee', padding: '1px 4px', borderRadius: 3}} {...props} />,
                  pre: ({node, ...props}) => <pre style={{fontSize: 11, background: '#eee', padding: 8, borderRadius: 4, overflow: 'auto'}} {...props} />
                }}
              >{explainAnalysisContent || (explainAnalysisLoading ? '正在分析...' : '')}</ReactMarkdown>
            )}
          </div>
        </Modal>
      </Layout>
    </ConfigProvider>
  );
}

export default App;

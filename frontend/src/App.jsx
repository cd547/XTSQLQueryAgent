import React, { useState, useRef, useEffect } from 'react';
import { Layout, Input, Button, Table, Card, message, Select, Spin, Empty, Drawer, List, ConfigProvider, Popconfirm, Tabs, Collapse, Tree, InputNumber, Modal, Steps, Space } from 'antd';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';
const { Panel } = Collapse;

function ResizableTitle(props) {
  const { onResize, width, children, ...restProps } = props;
  if (!width) return <th {...restProps}>{children}</th>;
  return (
    <Resizable width={width} height={0} onResize={onResize} axis="x">
      <th {...restProps}>{children}</th>
    </Resizable>
  );
}
import { SettingOutlined, CloseOutlined, PlusOutlined, MenuOutlined, FolderOutlined, FileTextOutlined, FolderOpenOutlined, CaretRightOutlined, DownOutlined, LockOutlined, UnlockOutlined, CheckOutlined, EditOutlined, TableOutlined, SendOutlined, SelectOutlined, RobotOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor, { loader } from '@monaco-editor/react';

window.MonacoEnvironment = {
  getWorkerUrl: function (moduleId, label) {
    if (label === 'json') {
      return './node_modules/monaco-editor/min/vs/language/json/json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './node_modules/monaco-editor/min/vs/language/css/css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './node_modules/monaco-editor/min/vs/language/html/html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return './node_modules/monaco-editor/min/vs/language/typescript/ts.worker.js';
    }
    return './node_modules/monaco-editor/min/vs/editor/editor.worker.js';
  }
};

loader.config({
  paths: {
    vs: './node_modules/monaco-editor/min/vs'
  }
});
import { queryExecute, getSessions, createSession, getSessionMessages, saveSessionMessage, deleteSession, getSkillsList, readSkillFile, saveSkillFile, getSessionTokens, checkTableExists, fetchTableDDL, createTableFiles, explainQuery } from './api';

const { TextArea } = Input;
const { Sider, Content } = Layout;

const deleteIconStyle = {
  color: '#999',
  cursor: 'pointer',
  fontSize: 12,
  marginLeft: 8,
  transition: 'color 0.2s'
};

function DeleteIcon({ onClick, style }) {
  const [hover, setHover] = useState(false);
  return (
    <CloseOutlined 
      style={{ ...style, color: hover ? '#ff4d4f' : style.color }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    />
  );
}

function ChatMessage({ role, content, isStreaming, onExecute, timestamp, collapsed, onToggleCollapse, logType, sql, onOpenSqlTab }) {
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
                <ReactMarkdown>{messageText}</ReactMarkdown>
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
                  onClick={() => onOpenSqlTab && onOpenSqlTab(sql)}
                >
                  复制到SQL查询
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [isExplainResult, setIsExplainResult] = useState(false);
  const [explainResults, setExplainResults] = useState([]);
  const [explainPanelOpen, setExplainPanelOpen] = useState(false);
  const contentRef = useRef('');
  const messageCountRef = useRef(0);
  const messagesEndRef = useRef(null);
  const inputResizerRef = useRef(null);
  const resizerRef = useRef(null);
  
  useEffect(() => {
    loadSessions();
    loadCurrentModel();
  }, []);

  const loadCurrentModel = async () => {
    try {
      const data = await fetch('http://localhost:5002/api/config/llm').then(r => r.json());
      setCurrentModel(data.model || '');
    } catch (e) {}
  };

  useEffect(() => {
    if (activeTabKey !== 'chat' && tabs[activeTabKey]?.sql !== undefined) {
      setSqlInput(tabs[activeTabKey].sql || '');
    }
  }, [activeTabKey, tabs]);

  useEffect(() => {
    // 使表头固定在Collapse面板顶部
    const style = document.createElement('style');
    style.textContent = `
      /* 表头固定 */
      .sql-result-table .ant-table-thead > tr > th {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background: white !important;
      }
      /* 表头行固定 */
      .sql-result-table .ant-table-thead {
        position: sticky !important;
        top: 0 !important;
        z-index: 10 !important;
        background: white !important;
      }
      /* 防止数据穿透 */
      .sql-result-table .ant-table-tbody > tr > td {
        background: white !important;
      }
      /* 隐藏表格内部滚动条 */
      .sql-result-table .ant-table-body {
        overflow: visible !important;
      }
      .sql-result-table .ant-table-scroll {
        overflow: visible !important;
      }
      .sql-result-table .ant-table-scroll > .ant-table-body {
        overflow: visible !important;
      }
      .sql-result-table .ant-table-content {
        overflow: visible !important;
      }
      /* 列宽调整手柄 */
      .sql-result-table .ant-table-thead > tr > th.react-resizable .react-resizable-handle {
        position: absolute !important;
        right: 0 !important;
        top: 0 !important;
        height: 100% !important;
        width: 15px !important;
        z-index: 20 !important;
        cursor: col-resize !important;
      }
      /* 确保表格宽度正确 */
      .sql-result-table .ant-table {
        width: 100% !important;
        table-layout: fixed !important;
      }
      /* 配置面板字体 */
      .config-drawer {
        font-size: 12px !important;
      }
      .config-drawer .ant-input,
      .config-drawer .ant-select-selector,
      .config-drawer .ant-btn,
      .config-drawer .ant-input-number,
      .config-drawer h3,
      .config-drawer label {
        font-size: 12px !important;
      }
      .config-drawer .ant-input-group-addon {
        font-size: 12px !important;
      }
      /* 隐藏滚动条但可滚动 */
      .skill-drawer-scroll::-webkit-scrollbar {
        display: none;
      }
      .skill-drawer-scroll {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

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
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
      if (data.sessions && data.sessions.length > 0 && !currentSessionId) {
        const firstSession = data.sessions[0];
        setCurrentSessionId(firstSession.id);
        setCurrentTokens(firstSession.total_tokens || 0);
        setCurrentSessionName(firstSession.name ? `${firstSession.name}#${firstSession.id}` : '聊天');
        loadMessages(firstSession.id);
      }
    } catch (e) {
      console.error('加载会话失败:', e);
    }
  };
  
  const loadMessages = async (sessionId) => {
    try {
      const data = await getSessionMessages(sessionId);
      if (data.messages) {
        setMessages(data.messages
          .filter(m => m.role !== 'usage')
          .map(m => ({
            role: m.role,
            content: m.content || m.sql || '',
            sql: m.sql || '',
            timestamp: m.created_at,
            logType: m.role === 'LLM' ? 'llm' : m.role === 'tool_return' ? 'return' : 'call'
          })));
      }
    } catch (e) {
      console.error('加载消息失败:', e);
    }
  };
  
  useEffect(() => {
    if (messages.length > messageCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      messageCountRef.current = messages.length;
    }
  }, [messages.length]);
  
  const handleNewSession = async () => {
    try {
      const data = await createSession('新对话');
      const newSession = { 
        id: data.id, 
        name: data.name || '新对话', 
        created_at: new Date().toISOString() 
      };
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(data.id);
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
    const newName = session.name ? `${session.name}#${session.id}` : '聊天';
    setCurrentSessionName(newName);
    loadMessages(session.id);
    messageCountRef.current = 0;
    // 获取当前会话的token消耗
    try {
      const data = await getSessionTokens(session.id);
      setCurrentTokens(data.total_tokens || 0);
    } catch (e) {
      setCurrentTokens(0);
    }
  };
  
  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
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
  };
  
  const handleAddTab = () => {
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql: '', results: [], rowCount: 0 } }));
    setActiveTabKey(newKey);
    setSqlInput('');
    setResults([]);
    setColumnWidths({});
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
  };
  
  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMessage = input.trim();
    setInput('');
    
    const now = new Date().toISOString();
    const newMessages = [...messages, 
      { role: 'user', content: userMessage, timestamp: now }, 
      { role: 'assistant', content: '', isStreaming: true, timestamp: now }
    ];
    setMessages(newMessages);
    
    setLoading(true);
    setIsStreaming(true);
    
    try {
      const response = await fetch('http://localhost:5002/api/query/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage, schemaMode: 'stream', sessionId: currentSessionId })
      });
      
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
              } else if (data.type === 'LLM' || data.type === 'tool' || data.type === 'tool_return') {
                const logContent = data.log || '';
                let logType = 'call';
                if (data.type === 'LLM') logType = 'llm';
                else if (data.type === 'tool_return') logType = 'return';
                
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastAssistantIdx !== -1) {
                    const logMsg = { 
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
                message.error(data.content);
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastIdx !== -1) {
                    newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: '错误: ' + data.content, isStreaming: false };
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
      message.error(error.message);
      setMessages(prev => {
        const newMsgs = [...prev];
        const lastIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
        if (lastIdx !== -1) {
          newMsgs[lastIdx] = { ...newMsgs[lastIdx], content: '错误: ' + error.message, isStreaming: false };
        }
        return newMsgs;
      });
    } finally {
      setLoading(false);
      setIsStreaming(false);
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

  const handleExecute = async (sql) => {
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
        setIsExplainResult(false);
        setTabs(prev => ({
          ...prev,
          [activeTabKey]: {
            ...prev[activeTabKey],
            results: newResults,
            rowCount: res.rowCount || 0
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
  setSqlKey(['sql', 'result']);
  setResultKey(['sql', 'result', 'explain']);
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
      const response = await fetch('http://localhost:5002/api/query/explain-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: getSelectedSql(), explainResults: explainResults })
      });
      
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

const handleResize = (columnKey) => (e, { size }) => {
  setColumnWidths(prev => ({ ...prev, [columnKey]: size.width }));
};

const columns = currentResults.length > 0
? Object.keys(currentResults[0]).map((key, idx) => ({ 
    title: (props) => (
      <ResizableTitle width={columnWidths[key] || 150} onResize={handleResize(key)}>
        <span style={{ fontSize: 12 }}>{key}</span>
      </ResizableTitle>
    ),
    dataIndex: key, 
    key: `col-${idx}`,
    ellipsis: true,
    width: columnWidths[key] || 150
  }))
: [];

const explainColumns = explainResults.length > 0
? Object.keys(explainResults[0]).map((key, idx) => ({ 
    title: (props) => (
      <ResizableTitle width={columnWidths[key] || 150} onResize={handleResize(key)}>
        <span style={{ fontSize: 12 }}>{key}</span>
      </ResizableTitle>
    ),
    dataIndex: key, 
    key: `col-${idx}`,
    ellipsis: true,
    width: columnWidths[key] || 150
  }))
: [];
  
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
                      <Popconfirm
                        key="delete"
                        title="确定删除此对话？"
                        onConfirm={(e) => handleDeleteSession(item.id, e)}
                        okText="确定"
                        cancelText="取消"
                      >
                        <DeleteIcon style={deleteIconStyle} />
                      </Popconfirm>
                    ]}
                  >
                    <List.Item.Meta
                      title={<span style={{ fontSize: 11 }}>{item.name} <span style={{ color: '#999' }}>#{item.id}</span></span>}
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
        onChange={setActiveTabKey}
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
            
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', background: '#fff' }}>
              {activeTabKey === 'chat' ? (
                messages.length === 0 ? (
                  <Empty description="开始新对话吧" style={{ marginTop: 100 }}>
                    <div style={{ color: '#999', fontSize: 14 }}>例如: "查询2024年的课程销售额"</div>
                  </Empty>
                ) : (
                  messages.map((msg, idx) => (
                    <ChatMessage 
                      key={idx}
                      role={msg.role}
                      content={msg.content}
                      isStreaming={msg.isStreaming}
                      onExecute={handleExecute}
                      timestamp={msg.timestamp}
                      collapsed={msg.collapsed !== undefined ? msg.collapsed : true}
                      onToggleCollapse={() => {
                        setMessages(prev => {
                          const newMsgs = [...prev];
                          const current = newMsgs[idx]?.collapsed ?? true;
                          const newCollapsed = !current;
                          newMsgs[idx] = { ...newMsgs[idx], collapsed: newCollapsed };
                          return newMsgs;
                        });
                      }}
                      logType={msg.logType}
                      sql={msg.sql}
                      onOpenSqlTab={handleOpenSqlTab}
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
                                onMount={(editor) => setSqlEditorInst(editor)}
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
                                  renderLineHighlight: 'none'
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
                                  const handleMove = (moveEvent) => {
                                    const delta = moveEvent.clientY - startY;
                                    const newHeight = Math.max(100, Math.min(500, startHeight + delta));
                                    setSqlPreviewHeight(newHeight);
                                  };
                                  const handleUp = () => {
                                    document.removeEventListener('mousemove', handleMove);
                                    document.removeEventListener('mouseup', handleUp);
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
                        label: <span style={{ fontWeight: 500, fontSize: 12 }}>查询结果 ({currentRowCount} 条)</span>,
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
                                const handleMove = (moveEvent) => {
                                  const delta = startY - moveEvent.clientY;
                                  const newHeight = Math.max(100, Math.min(600, startHeight + delta));
                                  setResultTableHeight(newHeight);
                                };
                                const handleUp = () => {
                                  document.removeEventListener('mousemove', handleMove);
                                  document.removeEventListener('mouseup', handleUp);
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
            </div>
            
            {activeTabKey === 'chat' && (
              <>
                <div
                  ref={inputResizerRef}
                  style={{ minHeight: inputHeight, borderTop: '1px solid #e8e8e8', background: '#fff', position: 'relative', display: 'flex', flexDirection: 'column' }}
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
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#1890ff', display: 'flex', gap: 8 }}>
                      {currentModel && <span>{currentModel}</span>}
                      {currentTokens > 0 && <span style={{ color: '#999', fontWeight: 'normal' }}>{currentTokens} tokens</span>}
                    </div>
                    <Button 
                    size="small" 
                    type="primary" 
                    onClick={handleSend} 
                    loading={loading} 
                    disabled={!input.trim()} 
                    icon={<SendOutlined />}
                    style={{ fontSize: 11, padding: '4px 8px' }} 
                  />
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
              const handleMove = (moveEvent) => {
                const delta = startX - moveEvent.clientX;
                const newWidth = Math.max(300, Math.min(800, startWidth + delta));
                setSkillDrawerWidth(newWidth);
              };
              const handleUp = () => {
                document.removeEventListener('mousemove', handleMove);
                document.removeEventListener('mouseup', handleUp);
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
                      defaultExpandAll
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
                  const handleMove = (moveEvent) => {
                    const delta = moveEvent.clientY - startY;
                    const newHeight = Math.max(100, Math.min(500, startHeight - delta));
                    setSkillEditorHeight(newHeight);
                  };
                  const handleUp = () => {
                    document.removeEventListener('mousemove', handleMove);
                    document.removeEventListener('mouseup', handleUp);
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
                    wordWrap: 'on'
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

function ConfigPanel({ compact }) {
  const [dbConfig, setDbConfig] = useState({ host: 'localhost', port: 3306, user: 'root', password: '', database: '' });
  const [llmConfig, setLlmConfig] = useState({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat' });
  const [agentConfig, setAgentConfig] = useState({ max_tool_calls: '30', timeout_ms: '60000' });
  const [testing, setTesting] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);

  useEffect(() => {
    fetch('http://localhost:5002/api/config/agent').then(r => r.json()).then(data => {
      setAgentConfig({
        max_tool_calls: data.agent_max_tool_calls || '30',
        timeout_ms: data.agent_timeout_ms || '60000'
      });
    });
  }, []);
  
  const testDb = async () => {
    setTesting(true);
    try {
      const res = await fetch('http://localhost:5002/api/config/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dbConfig) });
      const data = await res.json();
      message[data.success ? 'success' : 'error'](data.message);
    } catch (e) { message.error('连接失败'); }
    finally { setTesting(false); }
  };
  
  const saveDb = async () => {
    setTesting(true);
    try {
      const res = await fetch('http://localhost:5002/api/config/db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dbConfig) });
      const data = await res.json();
      message[data.success ? 'success' : 'error'](data.success ? '数据库配置已保存' : '保存失败');
    } catch (e) { message.error('保存失败'); }
    finally { setTesting(false); }
  };
  
  const saveLlm = async () => {
    setTestingLlm(true);
    try {
      const res = await fetch('http://localhost:5002/api/config/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(llmConfig) });
      const data = await res.json();
      message[data.success ? 'success' : 'error'](data.success ? '保存成功' : '保存失败');
    } catch (e) { message.error('保存失败'); }
    finally { setTestingLlm(false); }
  };

  const saveAgent = async () => {
    setSavingAgent(true);
    try {
      await fetch('http://localhost:5002/api/config/agent/max_tool_calls', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: agentConfig.max_tool_calls }) });
      await fetch('http://localhost:5002/api/config/agent/timeout_ms', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: agentConfig.timeout_ms }) });
      message.success('Agent配置已保存');
    } catch (e) { message.error('保存失败'); }
    finally { setSavingAgent(false); }
  };
  
  return (
    <div style={{ fontSize: 12 }}>
      <h3 style={{ marginBottom: 16, fontSize: 14 }}>数据库配置</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Space>
          <span style={{ width: 70 }}>Host</span>
          <Input value={dbConfig.host} onChange={e => setDbConfig({...dbConfig, host: e.target.value})} style={{ fontSize: 12 }} />
        </Space>
        <Space>
          <span style={{ width: 70 }}>Port</span>
          <Input value={dbConfig.port} onChange={e => setDbConfig({...dbConfig, port: parseInt(e.target.value)})} style={{ fontSize: 12 }} />
        </Space>
        <Space>
          <span style={{ width: 70 }}>User</span>
          <Input value={dbConfig.user} onChange={e => setDbConfig({...dbConfig, user: e.target.value})} style={{ fontSize: 12 }} />
        </Space>
        <Space>
          <span style={{ width: 70 }}>Password</span>
          <Input.Password value={dbConfig.password} onChange={e => setDbConfig({...dbConfig, password: e.target.value})} style={{ fontSize: 12 }} />
        </Space>
        <Space>
          <span style={{ width: 70 }}>Database</span>
          <Input value={dbConfig.database} onChange={e => setDbConfig({...dbConfig, database: e.target.value})} style={{ fontSize: 12 }} />
        </Space>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={testDb} loading={testing} style={{ fontSize: 12 }}>测试连接</Button>
          <Button type="primary" onClick={saveDb} style={{ fontSize: 12 }}>保存</Button>
        </div>
      </div>
      
      <h3 style={{ marginTop: 24, marginBottom: 16, fontSize: 14 }}>LLM 配置</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select value={llmConfig.provider} onChange={v => setLlmConfig({...llmConfig, provider: v})} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'openai', label: 'OpenAI' }, { value: 'minimax', label: 'MiniMax' }]} style={{ fontSize: 12 }} />
        <Input.Password placeholder="API Key" value={llmConfig.apiKey} onChange={e => setLlmConfig({...llmConfig, apiKey: e.target.value})} style={{ fontSize: 12 }} />
        <Input placeholder="模型名称" value={llmConfig.model} onChange={e => setLlmConfig({...llmConfig, model: e.target.value})} style={{ fontSize: 12 }} />
        <Button onClick={saveLlm} loading={testingLlm} style={{ fontSize: 12 }}>保存LLM配置</Button>
      </div>

      <h3 style={{ marginTop: 24, marginBottom: 16, fontSize: 14 }}>Agent 配置</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Space>
          <span style={{ width: 100 }}>最大工具调用次数</span>
          <InputNumber value={parseInt(agentConfig.max_tool_calls)} onChange={v => setAgentConfig({...agentConfig, max_tool_calls: String(v || 30)})} min={1} max={100} style={{ fontSize: 12 }} />
        </Space>
        <Space>
          <span style={{ width: 100 }}>超时时间(ms)</span>
          <InputNumber value={parseInt(agentConfig.timeout_ms)} onChange={v => setAgentConfig({...agentConfig, timeout_ms: String(v || 60000)})} min={1000} max={300000} style={{ fontSize: 12 }} />
        </Space>
        <Button onClick={saveAgent} loading={savingAgent} style={{ fontSize: 12 }}>保存Agent配置</Button>
      </div>
    </div>
  );
}

export default App;

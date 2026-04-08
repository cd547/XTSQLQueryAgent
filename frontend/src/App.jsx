import React, { useState, useRef, useEffect } from 'react';
import { Layout, Input, Button, Table, Card, message, Select, Spin, Empty, Drawer, List, ConfigProvider, Popconfirm, Tabs, Collapse } from 'antd';
const { Panel } = Collapse;
import { SettingOutlined, CloseOutlined, PlusOutlined, MenuOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Editor from '@monaco-editor/react';
import { queryExecute, getSessions, createSession, getSessionMessages, saveSessionMessage, deleteSession } from './api';

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
    const typeLabel = logType === 'return' ? '工具返回' : logType === 'llm' ? 'LLM思考' : '工具调用';
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
            <span style={{ marginRight: 4 }}>
              {collapsed ? '▶' : '▼'}
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
  const [tabs, setTabs] = useState({ 'chat': { title: '聊天' } });
  const [activeTabKey, setActiveTabKey] = useState('chat');
  const [currentSessionName, setCurrentSessionName] = useState('聊天');
  const [sqlInput, setSqlInput] = useState('');
  const [sqlKey, setSqlKey] = useState(['sql']);
  const [resultKey, setResultKey] = useState(['result']);
  const [pageSize, setPageSize] = useState(20);
  const [inputHeight, setInputHeight] = useState(80);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [sqlPreviewHeight, setSqlPreviewHeight] = useState(200);
  const [resultTableHeight, setResultTableHeight] = useState(300);
  const messageCountRef = useRef(0);
  const messagesEndRef = useRef(null);
  const inputResizerRef = useRef(null);
  const resizerRef = useRef(null);
  
  useEffect(() => {
    loadSessions();
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

  const loadSessions = async () => {
    try {
      const data = await getSessions();
      setSessions(data.sessions || []);
      if (data.sessions && data.sessions.length > 0 && !currentSessionId) {
        const firstSession = data.sessions[0];
        setCurrentSessionId(firstSession.id);
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
        setMessages(data.messages.map(m => ({
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
      setMessages([]);
      setResults([]);
      setShowResults(false);
      messageCountRef.current = 0;
    } catch (e) {
      message.error('创建会话失败');
    }
  };
  
  const handleSessionClick = (session) => {
    setCurrentSessionId(session.id);
    const newName = session.name ? `${session.name}#${session.id}` : '聊天';
    setCurrentSessionName(newName);
    loadMessages(session.id);
    messageCountRef.current = 0;
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
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql: '' } }));
    setActiveTabKey(newKey);
    setSqlInput('');
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
    }
  };
  
  const handleOpenSqlTab = (sql) => {
    const newKey = `sql-${Date.now()}`;
    setTabs(prev => ({ ...prev, [newKey]: { title: 'SQL查询', sql } }));
    setActiveTabKey(newKey);
    setSqlInput(sql || '');
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
                else logType = 'call';
                
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
  
  const handleExecute = async (sql) => {
    setLoading(true);
    setSqlKey(['sql', 'result']);
    setResultKey(['sql', 'result']);
    try {
      const res = await queryExecute({ sql });
      if (res.error) {
        message.error(res.error);
      } else {
        setTabs(prev => ({
          ...prev,
          [activeTabKey]: {
            ...prev[activeTabKey],
            results: res.results || [],
            rowCount: res.rowCount || 0
          }
        }));
        message.success(`查询成功，${res.rowCount} 条结果`);
      }
    } finally {
      setLoading(false);
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
  
  // 获取当前tab的结果
  const currentResults = activeTabKey !== 'chat' && tabs[activeTabKey]?.results ? tabs[activeTabKey].results : results;
  const currentRowCount = activeTabKey !== 'chat' && tabs[activeTabKey]?.rowCount ? tabs[activeTabKey].rowCount : rowCount;
  
  const columns = currentResults.length > 0
    ? Object.keys(currentResults[0]).map(key => ({ 
      title: key, 
      dataIndex: key, 
      key,
      ellipsis: true,
      style: { fontSize: 8 }
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
          <div style={{ padding: 16, borderBottom: '1px solid #e8e8e8' }}>
            <Button type="primary" onClick={handleNewSession} style={{ width: '100%', marginBottom: 12 }}>
              新对话
            </Button>
            <Button icon={<SettingOutlined />} onClick={() => setConfigOpen(true)} style={{ width: '100%' }}>
              配置
            </Button>
          </div>
          <div style={{ height: 'calc(100vh - 104px)', overflow: 'auto' }}>
            <List
              dataSource={sessions}
              renderItem={item => (
                <List.Item
                  key={item.id}
                  style={{ padding: '8px 12px', cursor: 'pointer', background: currentSessionId === item.id ? '#e6f7ff' : 'transparent', borderLeft: currentSessionId === item.id ? '3px solid #1890ff' : '3px solid transparent' }}
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
                    title={<span style={{ fontSize: 12 }}>{item.name} <span style={{ color: '#999' }}>#{item.id}</span></span>}
                    description={<span style={{ fontSize: 10, color: '#999' }}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</span>}
                  />
                </List.Item>
              )}
            />
          </div>
        </Sider>
        
        <Layout>
          <Content style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
            <div style={{ padding: '8px 16px 0', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Button 
                type="text" 
                icon={<MenuOutlined />} 
                onClick={() => setSiderCollapsed(!siderCollapsed)}
                title={siderCollapsed ? '显示侧边栏' : '隐藏侧边栏'}
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
                        console.log('toggle idx:', idx, 'current collapsed:', messages[idx]?.collapsed);
                        setMessages(prev => {
                          const newMsgs = [...prev];
                          const current = newMsgs[idx]?.collapsed ?? true;
                          const newCollapsed = !current;
                          console.log('setting collapsed to:', newCollapsed);
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
                      setSqlKey(key);
                      setResultKey(key);
                    }}
                    items={[
                      {
key: 'sql',
                        label: <span style={{ fontWeight: 500, fontSize: 12 }}>SQL预览</span>,
                        children: (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} ref={resizerRef}>
                            <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, position: 'relative' }}>
                              <Editor
                                height={sqlPreviewHeight}
                                defaultLanguage="sql"
                                value={sqlInput}
                                onChange={handleSqlChange}
                                options={{
                                  minimap: { enabled: false },
                                  fontSize: 12,
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
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button type="primary" disabled={!sqlInput.trim()} onClick={() => handleExecute(sqlInput)}>查询</Button>
                            </div>
                          </div>
                        )
                      },
                      {
key: 'result',
                        label: <span style={{ fontWeight: 500, fontSize: 12 }}>查询结果 ({currentRowCount} 条)</span>,
                        children: currentResults.length > 0 ? (
                          <div style={{ position: 'relative' }}>
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
                            <div style={{ marginBottom: 4, marginTop: 6 }}>
                              <Button size="small" onClick={() => exportToExcel(currentResults, columns)}>导出Excel</Button>
                            </div>
                            <Table
                              dataSource={currentResults}
                              columns={columns}
                              pagination={{
                                pageSize: pageSize,
                                showSizeChanger: true,
                                pageSizeOptions: ['10', '20', '50', '100'],
                                onShowSizeChange: (_, size) => setPageSize(size)
                              }}
                              scroll={{ x: 'max-content', y: resultTableHeight }}
                              size="small"
                              sticky
                              className="sql-result-table"
                              style={{ fontSize: 8 }}
                            />
                          </div>
                        ) : (
                          <div style={{ color: '#999' }}>暂无结果</div>
                        )
                      }
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
                  style={{ minHeight: inputHeight, borderTop: '1px solid #e8e8e8', background: '#fff', position: 'relative' }}
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
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', height: '100%', padding: '8px 24px' }}>
                    <Select value={schemaMode} onChange={setSchemaMode} style={{ width: 100 }} options={[{ value: 'stream', label: '流式' }]} />
                    <TextArea
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      placeholder="输入自然语言查询，按Enter发送，Shift+Enter换行"
                      style={{ flex: 1, resize: 'none', height: '100%' }}
                    />
                    <Button type="primary" onClick={handleSend} loading={loading} disabled={!input.trim()}>发送</Button>
                  </div>
                </div>
              </>
            )}
          </Content>
        </Layout>
        
        <Drawer title="配置" placement="right" width={400} onClose={() => setConfigOpen(false)} open={configOpen}>
          <div style={{ padding: '0 10px' }}>
            <ConfigPanel compact />
          </div>
        </Drawer>
      </Layout>
    </ConfigProvider>
  );
}

function ConfigPanel({ compact }) {
  const [dbConfig, setDbConfig] = useState({ host: 'localhost', port: 3306, user: 'root', password: '', database: '' });
  const [llmConfig, setLlmConfig] = useState({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat' });
  const [testing, setTesting] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  
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
  
  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>数据库配置</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input addonBefore="Host" value={dbConfig.host} onChange={e => setDbConfig({...dbConfig, host: e.target.value})} />
        <Input addonBefore="Port" value={dbConfig.port} onChange={e => setDbConfig({...dbConfig, port: parseInt(e.target.value)})} />
        <Input addonBefore="User" value={dbConfig.user} onChange={e => setDbConfig({...dbConfig, user: e.target.value})} />
        <Input.Password addonBefore="Password" value={dbConfig.password} onChange={e => setDbConfig({...dbConfig, password: e.target.value})} />
        <Input addonBefore="Database" value={dbConfig.database} onChange={e => setDbConfig({...dbConfig, database: e.target.value})} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={testDb} loading={testing}>测试连接</Button>
          <Button type="primary" onClick={saveDb}>保存</Button>
        </div>
      </div>
      
      <h3 style={{ marginTop: 24, marginBottom: 16 }}>LLM 配置</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select value={llmConfig.provider} onChange={v => setLlmConfig({...llmConfig, provider: v})} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'openai', label: 'OpenAI' }, { value: 'minimax', label: 'MiniMax' }]} />
        <Input.Password placeholder="API Key" value={llmConfig.apiKey} onChange={e => setLlmConfig({...llmConfig, apiKey: e.target.value})} />
        <Input placeholder="模型名称" value={llmConfig.model} onChange={e => setLlmConfig({...llmConfig, model: e.target.value})} />
        <Button onClick={saveLlm} loading={testingLlm}>保存LLM配置</Button>
      </div>
    </div>
  );
}

export default App;

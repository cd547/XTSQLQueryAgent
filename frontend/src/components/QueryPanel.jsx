import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Table, Space, Card, message, Select, Spin, Empty } from 'antd';
import ReactMarkdown from 'react-markdown';
import { queryExecute } from '../api';
import ConfirmDialog from './ConfirmDialog';

const { TextArea } = Input;
const API_BASE = '/api';

function ChatMessage({ role, content, isStreaming, onExecute }) {
  const isUser = role === 'user';
  
  let sql = '';
  let messageText = '';
  
  // 流式输出时直接显示完整内容
  if (!isUser && content) {
    // 只有流式结束后才尝试解析JSON
    if (!isStreaming) {
      try {
        // 尝试匹配 ```json ``` 包裹的 JSON
        const codeBlockMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          const parsed = JSON.parse(codeBlockMatch[1]);
          sql = parsed.sql || '';
          messageText = parsed.message || '';
        } 
        // 尝试直接匹配 JSON 对象
        else if (content.includes('"sql"') || content.includes('"message"')) {
          const match = content.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            sql = parsed.sql || '';
            messageText = parsed.message || '';
          }
        }
      } catch (e) {
        console.warn('JSON解析失败:', e);
        // 解析失败直接显示内容
        sql = content;
      }
      
      // 如果 sql 和 message 都为空，直接显示内容
      if (!sql && !messageText) {
        sql = content;
      }
    } else {
      // 流式输出中，直接显示所有内容
      sql = content;
    }
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 16,
      padding: '0 16px'
    }}>
      <div style={{
        maxWidth: '70%',
        padding: '12px 16px',
        borderRadius: 12,
        background: isUser ? '#1890ff' : '#f0f0f0',
        color: isUser ? '#fff' : '#333'
      }}>
        {isUser ? (
          <div>{content}</div>
        ) : (
          <div>
            {messageText && (
              <div style={{ marginBottom: 8 }}>
                <ReactMarkdown>{messageText}</ReactMarkdown>
              </div>
            )}
            {(sql || content) && !messageText && (
              <div>
                <div style={{ 
                  background: '#1e1e1e', 
                  color: '#d4d4d4', 
                  padding: '8px 12px', 
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 200,
                  overflow: 'auto'
                }}>
                  {sql || content}
                </div>
                {!isStreaming && sql && (
                  <Button 
                    type="primary" 
                    size="small" 
                    style={{ marginTop: 8 }}
                    onClick={() => onExecute(sql)}
                  >
                    执行SQL
                  </Button>
                )}
              </div>
            )}
            {isStreaming && (
              <Spin size="small" style={{ marginTop: 8 }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function QueryPanel() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [schemaMode, setSchemaMode] = useState('stream');
  const [isStreaming, setIsStreaming] = useState(false);
  const [results, setResults] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [queryTime, setQueryTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [confirmTagAdd, setConfirmTagAdd] = useState({
    visible: false,
    term: '',
    table: '',
    description: ''
  });
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMessage = input.trim();
    setInput('');
    
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);
    setLoading(true);
    setIsStreaming(true);

    try {
      const response = await fetch(`${API_BASE}/query/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage, schemaMode: 'stream' })
      });

      if (!response.ok) {
        throw new Error('请求失败');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let lastMsgIndex = messages.length; // 保存当前消息的索引

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        console.log('收到 SSE 数据:', text.substring(0, 200));
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                fullContent += data.content;
                setMessages(prev => {
                  const newMsgs = [...prev];
                  // 找到最后一条助手消息并更新
                  const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastAssistantIdx !== -1) {
                    newMsgs[lastAssistantIdx] = {
                      ...newMsgs[lastAssistantIdx],
                      content: fullContent
                    };
                  }
                  return newMsgs;
                });
              } else if (data.type === 'error') {
                message.error(data.content);
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastAssistantIdx !== -1) {
                    newMsgs[lastAssistantIdx] = {
                      ...newMsgs[lastAssistantIdx],
                      content: '错误: ' + data.content,
                      isStreaming: false
                    };
                  }
                  return newMsgs;
                });
              } else if (data.type === 'done') {
                // 检查是否有 confirm_tag_add
                if (data.confirm_tag_add) {
                  setConfirmTagAdd({
                    visible: true,
                    term: data.confirm_tag_add.term,
                    table: data.confirm_tag_add.table,
                    description: data.confirm_tag_add.description || ''
                  });
                }
                setMessages(prev => {
                  const newMsgs = [...prev];
                  const lastAssistantIdx = newMsgs.findLastIndex(m => m.role === 'assistant');
                  if (lastAssistantIdx !== -1) {
                    // 移除 confirm_tag_add 标记，只显示实际消息
                    const cleanMessage = (data.message || data.sql || fullContent)
                      .replace(/<!--confirm_tag_add:\{[^}]+\}-->/g, '');
                    newMsgs[lastAssistantIdx] = {
                      ...newMsgs[lastAssistantIdx],
                      content: cleanMessage,
                      isStreaming: false
                    };
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
        newMsgs[newMsgs.length - 1].content = '错误: ' + error.message;
        newMsgs[newMsgs.length - 1].isStreaming = false;
        return newMsgs;
      });
    } finally {
      setLoading(false);
      setIsStreaming(false);
    }
  };

  const handleExecute = async (sql) => {
    const startTime = Date.now();
    setLoading(true);
    try {
      const res = await queryExecute({ sql });
      if (res.error) {
        message.error(res.error);
      } else {
        setResults(res.results || []);
        setRowCount(res.rowCount || 0);
        setQueryTime(res.queryTime || Date.now() - startTime);
        setShowResults(true);
        message.success(`查询成功，${res.rowCount} 条结果`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmTagAdd = async () => {
    const { table, term } = confirmTagAdd;
    try {
      const res = await fetch(`${API_BASE}/skills/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: 'skills/sql-creator-skill-v2/table_index.json',
          action: 'add_tag',
          tableName: table,
          tag: term
        })
      });
      if (res.ok) {
        message.success(`已将 "${term}" 添加到 ${table} 的标签`);
      } else {
        message.error('添加标签失败');
      }
    } catch (e) {
      message.error('添加标签失败: ' + e.message);
    }
    setConfirmTagAdd(prev => ({ ...prev, visible: false }));
  };

  const handleCancelTagAdd = () => {
    setConfirmTagAdd(prev => ({ ...prev, visible: false }));
  };

  const columns = results.length > 0
    ? Object.keys(results[0]).map(key => ({ title: key, dataIndex: key, key }))
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
      <Card 
        title="SQL智能助手" 
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        extra={
          <Select 
            value={schemaMode} 
            onChange={setSchemaMode} 
            style={{ width: 120 }}
            options={[
              { value: 'stream', label: '流式' },
              { value: 'langchain', label: 'LangChain' },
              { value: 'skill', label: 'Skill静态' },
              { value: 'manual', label: '本地存储' },
              { value: 'auto', label: '自动获取' },
            ]}
          />
        }
      >
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px 0',
          background: '#fff'
        }}>
          {messages.length === 0 ? (
            <Empty description="开始对话吧，描述你想要查询的数据">
              <div style={{ color: '#999', fontSize: 14 }}>
                例如: "查询2024年的课程销售额"
              </div>
            </Empty>
          ) : (
            messages.map((msg, idx) => (
              <ChatMessage 
                key={idx}
                role={msg.role}
                content={msg.content}
                isStreaming={msg.isStreaming}
                onExecute={handleExecute}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <ConfirmDialog
          visible={confirmTagAdd.visible}
          term={confirmTagAdd.term}
          table={confirmTagAdd.table}
          description={confirmTagAdd.description}
          onConfirm={handleConfirmTagAdd}
          onCancel={handleCancelTagAdd}
        />

        <div style={{ 
          display: 'flex', 
          gap: 8, 
          padding: '16px 0 0',
          borderTop: '1px solid #f0f0f0'
        }}>
          <TextArea
            value={input}
            onChange={e => setInput(e.target.value)}
            onPressEnter={e => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入自然语言查询，按Enter发送，Shift+Enter换行"
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ flex: 1 }}
          />
          <Button 
            type="primary" 
            onClick={handleSend}
            loading={loading}
            disabled={!input.trim()}
          >
            发送
          </Button>
        </div>
      </Card>

      {showResults && results.length > 0 && (
        <Card 
          title={`查询结果 (${rowCount} 条 耗时: ${queryTime}ms)`} 
          size="small"
          style={{ marginTop: 16 }}
          extra={
            <Button size="small" onClick={() => setShowResults(false)}>关闭</Button>
          }
        >
          <Table
            dataSource={results}
            columns={columns}
            pagination={{ pageSize: 50 }}
            scroll={{ x: 'max-content' }}
            size="small"
          />
        </Card>
      )}
    </div>
  );
}

export default QueryPanel;
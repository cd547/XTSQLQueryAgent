import React, { useState } from 'react';
import { Form, Input, Button, Table, Space, Card, Modal, message, Select, Tooltip } from 'antd';
import ReactMarkdown from 'react-markdown';
import { queryGenerate, queryExecute } from '../api';

function QueryPanel() {
  const [loading, setLoading] = useState(false);
  const [sql, setSql] = useState('');
  const [results, setResults] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [schemaMode, setSchemaMode] = useState('langchain');
  const [question, setQuestion] = useState('');
  const [currentSql, setCurrentSql] = useState('');
  const [currentMessage, setCurrentMessage] = useState('');

  const handleGenerate = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await queryGenerate({ question, schemaMode });
      if (res.error) {
        message.error(res.error);
      } else {
        let finalSql = res.sql || '';
        let finalMessage = res.message || '';

        // 解析嵌套 JSON（如果存在）
        if (finalSql.includes('```json')) {
          const jsonMatch = finalSql.match(/```json\s*(\{[\s\S]*?\})\s*```/);
          if (jsonMatch) {
            try {
              const nested = JSON.parse(jsonMatch[1]);
              finalSql = nested.sql || finalSql;
              finalMessage = nested.message || finalMessage;
            } catch (e) {
              console.warn('解析嵌套 JSON 失败:', e);
            }
          }
        }

        setCurrentSql(finalSql);
        setCurrentMessage(finalMessage);
        setShowSqlModal(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setShowSqlModal(false);
    try {
      const res = await queryExecute({ sql: currentSql });
      if (res.error) {
        message.error(res.error);
      } else {
        setResults(res.results || []);
        setRowCount(res.rowCount || 0);
        message.success(`查询成功，${res.rowCount} 条结果`);
      }
    } finally {
      setLoading(false);
    }
  };

  const columns = results.length > 0
    ? Object.keys(results[0]).map(key => ({ title: key, dataIndex: key, key }))
    : [];

  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Tooltip title="LangChain: LLM动态调用skill获取表结构（推荐）| Skill静态: 注入所有匹配表 | 本地存储: SQLite中的表结构 | 自动获取: 实时连接数据库">
            <Select value={schemaMode} onChange={setSchemaMode} style={{ width: 150 }}>
              <Select.Option value="langchain">LangChain (推荐)</Select.Option>
              <Select.Option value="skill">Skill静态</Select.Option>
              <Select.Option value="manual">本地存储</Select.Option>
              <Select.Option value="auto">自动获取</Select.Option>
            </Select>
          </Tooltip>
          <Input.Search
            placeholder="输入自然语言查询，如：查询2024年销售额"
            enterButton="生成SQL"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onSearch={handleGenerate}
            loading={loading}
            style={{ width: 500 }}
          />
        </Space>

        {rowCount > 0 && (
          <Table
            dataSource={results}
            columns={columns}
            pagination={{ pageSize: 100 }}
            scroll={{ x: 'max-content' }}
            size="small"
          />
        )}
      </Space>

      <Modal
        title="生成的SQL"
        open={showSqlModal}
        onOk={handleExecute}
        onCancel={() => setShowSqlModal(false)}
        width={800}
      >
        <div>
          <h3>说明：</h3>
          <ReactMarkdown>{currentMessage}</ReactMarkdown>
          <h3>SQL：</h3>
          <ReactMarkdown>{`\`\`\`sql\n${currentSql}\n\`\`\``}</ReactMarkdown>
        </div>
      </Modal>
    </Card>
  );
}

export default QueryPanel;
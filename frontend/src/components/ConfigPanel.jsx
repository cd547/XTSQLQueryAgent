import React, { useState, useEffect } from 'react';
import { Input, Button, Select, InputNumber, Space, message } from 'antd';
import * as api from '../api';

function ConfigPanel() {
  const [dbConfig, setDbConfig] = useState({ host: 'localhost', port: 3306, user: 'root', password: '', database: '' });
  const [llmConfig, setLlmConfig] = useState({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat' });
  const [agentConfig, setAgentConfig] = useState({ max_tool_calls: '30', timeout_ms: '60000' });
  const [testing, setTesting] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);

  useEffect(() => {
    api.getAgentConfig().then(data => {
      setAgentConfig({
        max_tool_calls: data.agent_max_tool_calls || '30',
        timeout_ms: data.agent_timeout_ms || '60000'
      });
    });
  }, []);
  
  const testDb = async () => {
    setTesting(true);
    try {
      const data = await api.testConnection(dbConfig);
      message[data.success ? 'success' : 'error'](data.message);
    } catch (e) { message.error('连接失败'); }
    finally { setTesting(false); }
  };
  
  const saveDb = async () => {
    setTesting(true);
    try {
      const data = await api.saveDbConfig(dbConfig);
      message[data.success ? 'success' : 'error'](data.success ? '数据库配置已保存' : '保存失败');
    } catch (e) { message.error('保存失败'); }
    finally { setTesting(false); }
  };
  
  const saveLlm = async () => {
    setTestingLlm(true);
    try {
      const data = await api.saveLlMConfig(llmConfig);
      message[data.success ? 'success' : 'error'](data.success ? '保存成功' : '保存失败');
    } catch (e) { message.error('保存失败'); }
    finally { setTestingLlm(false); }
  };

  const saveAgent = async () => {
    setSavingAgent(true);
    try {
      await api.updateAgentConfig('max_tool_calls', agentConfig.max_tool_calls);
      await api.updateAgentConfig('timeout_ms', agentConfig.timeout_ms);
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

export default ConfigPanel;
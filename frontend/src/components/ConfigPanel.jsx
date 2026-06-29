import React, { useState, useEffect } from 'react';
import { Input, Button, Select, InputNumber, Space, message } from 'antd';
import * as api from '../api';

function ConfigPanel() {
  const [dbConfig, setDbConfig] = useState({ host: 'localhost', port: 3306, user: 'root', password: '', database: '' });
  const [llmConfig, setLlmConfig] = useState({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat' });
  const [agentConfig, setAgentConfig] = useState({ max_tool_calls: '30', timeout_ms: '60000', token_warning_level: '30000' });
  const [testing, setTesting] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    api.getAgentConfig().then(data => {
      setAgentConfig({
        max_tool_calls: data.agent_max_tool_calls || '30',
        timeout_ms: data.agent_timeout_ms || '60000',
        token_warning_level: data.agent_token_warning_level || '30000'
      });
    });
    api.getLlMConfig().then(data => {
      if (data.provider) {
        setLlmConfig({
          provider: data.provider,
          apiKey: data.apiKey || '',
          model: data.model || ''
        });
        if (data.hasApiKey) {
          fetchModels();
        }
      }
    });
  }, []);

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const data = await api.getDeepseekModels();
      if (data.success && data.models) {
        setAvailableModels(data.models.map(m => ({ value: m.id, label: m.name })));
      } else {
        message.error(data.message || '获取模型列表失败');
      }
    } catch (e) {
      message.error('获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleApiKeyChange = (e) => {
    const apiKey = e.target.value;
    setLlmConfig({ ...llmConfig, apiKey, model: '' });
  };
  
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
      const data = await api.saveLlMConfig({ ...llmConfig, provider: 'deepseek' });
      if (data.success) {
        message.success('保存成功');
        if (llmConfig.apiKey) {
          fetchModels();
        }
      } else {
        message.error('保存失败');
      }
    } catch (e) { message.error('保存失败'); }
    finally { setTestingLlm(false); }
  };

  const saveAgent = async () => {
    setSavingAgent(true);
    try {
      await api.updateAgentConfig('max_tool_calls', agentConfig.max_tool_calls);
      await api.updateAgentConfig('timeout_ms', agentConfig.timeout_ms);
      await api.updateAgentConfig('token_warning_level', agentConfig.token_warning_level);
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
        <Space>
          <span style={{ width: 70 }}>Provider</span>
          <span style={{ fontSize: 12 }}>DeepSeek</span>
        </Space>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 70, fontSize: 12 }}>API Key</span>
          <Input.Password placeholder="API Key" value={llmConfig.apiKey} onChange={handleApiKeyChange} style={{ fontSize: 12, flex: 1 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 70, fontSize: 12 }}>模型</span>
          <Select
            value={llmConfig.model || undefined}
            onChange={v => setLlmConfig({ ...llmConfig, model: v })}
            options={availableModels}
            loading={loadingModels}
            placeholder="请先输入API Key"
            style={{ fontSize: 12, flex: 1, minWidth: 200 }}
            showSearch
            allowClear
          />
        </div>
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
        <Space>
          <span style={{ width: 100 }}>token警告上限</span>
          <InputNumber value={parseInt(agentConfig.token_warning_level)} onChange={v => setAgentConfig({...agentConfig, token_warning_level: String(v || 30000)})} min={1000} max={300000} style={{ fontSize: 12 }} />
        </Space>
        <Button onClick={saveAgent} loading={savingAgent} style={{ fontSize: 12 }}>保存Agent配置</Button>
      </div>
    </div>
  );
}

export default ConfigPanel;
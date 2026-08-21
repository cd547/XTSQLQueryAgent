import React, { useState, useEffect } from 'react';
import { Input, Button, Select, InputNumber, Space, App as AntdApp } from 'antd';
import * as api from '../api';

function ConfigPanel() {
  // ★ antd AntdApp.useApp()：让 message 走动态主题上下文，消除静态 message 警告
  const { message: messageApi } = AntdApp.useApp();
  const [dbConfig, setDbConfig] = useState({ host: 'localhost', port: 3306, user: 'root', password: '', database: '' });
  const [llmConfig, setLlmConfig] = useState({ provider: 'deepseek', apiKey: '', model: 'deepseek-chat', apiMode: 'chat_completions' });
  const [agentConfig, setAgentConfig] = useState({ max_tool_calls: '30', timeout_ms: '60000', token_warning_level: '30000' });
  const [testing, setTesting] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  // ★ 2026-08-17：DeepSeek 账户余额状态
  //   loading: 拉取中；data: { is_available, balance_infos }；error: { message }
  const [balance, setBalance] = useState({ loading: false, data: null, error: null });

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
          // ★ F3 修复：用后端返回的掩码占位，绝不把明文 key 写进 React state
          //   旧的 apiKey: data.apiKey || '' 写法把明文放在 JS 内存里，
          //   React DevTools / 浏览器扩展 / XSS 都能读到 → 等于把鉴权升级
          //   后的 LLM 密钥白白下发给前端，前功尽弃。
          apiKey: data.maskedKey || '',
          // ★ 新增：apiKeyTouched 标记用户是否真实改动过。
          //   saveLlm 仅在 touched=true 时才把 apiKey 提交给后端，
          //   这样既支持"不改 key 也保存 model"的场景，又防止"保存未改动表单"
          //   误传空字符串（虽然后端已兜底保留旧值，但前端不该发脏数据）。
          apiKeyTouched: false,
          model: data.model || '',
          // ★ apiMode：后端 GET 兜底 chat_completions（旧配置兼容）
          apiMode: data.apiMode || 'chat_completions'
        });
        if (data.hasApiKey) {
          fetchModels();
        }
        // ★ 2026-08-17：每次 Drawer 打开都拉一次最新余额（不论是否有 apiKey，
        //   无 key 时后端会返回 success:false 提示用户"请先配置 API Key"）
        fetchBalance();
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
        messageApi.error(data.message || '获取模型列表失败');
      }
    } catch (e) {
      messageApi.error('获取模型列表失败');
    } finally {
      setLoadingModels(false);
    }
  };

  // ★ 2026-08-17：拉取 DeepSeek 账户余额
  //   触发：useEffect 初始化时（Drawer 打开首次渲染）+ 保存 LLM 配置后
  //   状态：loading / data / error
  const fetchBalance = async () => {
    setBalance({ loading: true, data: null, error: null });
    try {
      const data = await api.getDeepseekBalance();
      if (data.success) {
        setBalance({ loading: false, data, error: null });
      } else {
        setBalance({ loading: false, data: null, error: { message: data.message || '获取余额失败' } });
      }
    } catch (e) {
      setBalance({ loading: false, data: null, error: { message: e.message || '网络错误' } });
    }
  };

  const handleApiKeyChange = (e) => {
    const apiKey = e.target.value;
    setLlmConfig({ ...llmConfig, apiKey, apiKeyTouched: true, model: '' });
  };
  
  const testDb = async () => {
    setTesting(true);
    try {
      const data = await api.testConnection(dbConfig);
      message[data.success ? 'success' : 'error'](data.message);
    } catch (e) { messageApi.error('连接失败'); }
    finally { setTesting(false); }
  };
  
  const saveDb = async () => {
    setTesting(true);
    try {
      const data = await api.saveDbConfig(dbConfig);
      message[data.success ? 'success' : 'error'](data.success ? '数据库配置已保存' : '保存失败');
    } catch (e) { messageApi.error('保存失败'); }
    finally { setTesting(false); }
  };
  
  const saveLlm = async () => {
    setTestingLlm(true);
    try {
      // ★ F3 修复：仅在用户真实改动过 apiKey 时才提交。
      //   旧逻辑把 llmConfig.apiKey（可能为空字符串）无条件提交，
      //   会导致"打开页面 → 不动任何东西 → 点保存"反而把 DB 里的 key 覆盖成空。
      //   现在前端过滤 + 后端兜底（POST /config/llm 收到空也保留旧值）双保险。
      const payload = { provider: 'deepseek', model: llmConfig.model, apiMode: llmConfig.apiMode };
      if (llmConfig.apiKeyTouched && llmConfig.apiKey) {
        payload.apiKey = llmConfig.apiKey;
      }
      const data = await api.saveLlMConfig(payload);
      if (data.success) {
        messageApi.success('保存成功');
        // 重新拉取最新掩码，更新 UI；user 即使输入了新 key 也会被掩码覆盖
        const fresh = await api.getLlMConfig();
        if (fresh.provider) {
          setLlmConfig({
            provider: fresh.provider,
            apiKey: fresh.maskedKey || '',
            apiKeyTouched: false,
            model: fresh.model || '',
            // ★ apiMode：保存后用后端归一化后的值（防御非法值被前端自动修成默认）
            apiMode: fresh.apiMode || 'chat_completions'
          });
        }
        if (fresh.hasApiKey) {
          fetchModels();
        }
        // ★ 2026-08-17：apiKey 可能改了 → 重新拉一次余额
        fetchBalance();
      } else {
        messageApi.error('保存失败');
      }
    } catch (e) { messageApi.error('保存失败'); }
    finally { setTestingLlm(false); }
  };

  const saveAgent = async () => {
    setSavingAgent(true);
    try {
      await api.updateAgentConfig('max_tool_calls', agentConfig.max_tool_calls);
      await api.updateAgentConfig('timeout_ms', agentConfig.timeout_ms);
      await api.updateAgentConfig('token_warning_level', agentConfig.token_warning_level);
      messageApi.success('Agent配置已保存');
    } catch (e) { messageApi.error('保存失败'); }
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
        {/* ★ 2026-08-17：DeepSeek 账户余额显示（Provider 下面）
            状态：
              loading  → "加载中..."
              success  → "CNY 110.00（赠金 10.00 / 充值 100.00）" + 账户状态 ✓/✗
              error    → "获取失败: {msg}"（点重试按钮可重拉）
            currency: CNY / USD
        */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
          <span style={{ width: 70, fontSize: 12 }}>余额</span>
          {balance.loading && (
            <span style={{ fontSize: 12, color: '#999' }}>加载中...</span>
          )}
          {!balance.loading && balance.data && (
            <span style={{ fontSize: 12 }}>
              {balance.data.balance_infos && balance.data.balance_infos.length > 0 ? (
                balance.data.balance_infos.map((b, i) => (
                  <span key={i} style={{ marginRight: 12 }}>
                    <strong>{b.currency}</strong>{' '}
                    {parseFloat(b.total_balance).toFixed(2)}
                    <span style={{ color: '#888', fontSize: 11, marginLeft: 4 }}>
                      （赠金 {parseFloat(b.granted_balance).toFixed(2)} / 充值 {parseFloat(b.topped_up_balance).toFixed(2)}）
                    </span>
                  </span>
                ))
              ) : (
                <span style={{ color: '#999' }}>无余额信息</span>
              )}
              <span style={{
                marginLeft: 8,
                color: balance.data.is_available ? '#52c41a' : '#ff4d4f',
                fontSize: 12
              }}>
                {balance.data.is_available ? '✓ 可用' : '✗ 不可用'}
              </span>
            </span>
          )}
          {!balance.loading && balance.error && (
            <span style={{ fontSize: 12, color: '#ff4d4f' }}>
              {balance.error.message}
            </span>
          )}
          <Button
            size="small"
            onClick={fetchBalance}
            loading={balance.loading}
            style={{ fontSize: 11, marginLeft: 'auto' }}
          >
            刷新
          </Button>
        </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 70, fontSize: 12 }}>API 名称</span>
          <Select
            value={llmConfig.apiMode}
            onChange={v => setLlmConfig({ ...llmConfig, apiMode: v })}
            style={{ fontSize: 12, flex: 1, minWidth: 200 }}
            options={[
              { value: 'chat_completions', label: 'Chat Completions API（推荐）' },
              { value: 'responses_api', label: 'Responses API（Beta，暂未启用）' }
            ]}
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
import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Select, Card, Space, message, Divider } from 'antd';
import { testConnection, saveDbConfig, getDbConfig, saveLlMConfig, getLlMConfig } from '../api';

function ConfigPanel() {
  const [form] = Form.useForm();
  const [llmForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [dbConfig, setDbConfig] = useState({});
  const [llmConfig, setLlmConfig] = useState({});

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const [db, llm] = await Promise.all([getDbConfig(), getLlMConfig()]);
      setDbConfig(db || {});
      setLlmConfig(llm || {});
      form.setFieldsValue(db || {});
      llmForm.setFieldsValue(llm || {});
    } catch (e) {
      console.error('加载配置失败', e);
    }
  };

  const handleTest = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const res = await testConnection(values);
      if (res.success) {
        message.success('数据库连接成功');
      } else {
        message.error(res.message || '连接失败');
      }
    } catch (e) {
      message.error(e.message || '连接失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDb = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      await saveDbConfig(values);
      setDbConfig(values);
      message.success('数据库配置已保存');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLlm = async () => {
    const values = await llmForm.validateFields();
    setLoading(true);
    try {
      await saveLlMConfig(values);
      setLlmConfig(values);
      message.success('LLM配置已保存');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="配置" style={{ marginBottom: 16, fontSize: 12 }}>
      <Form form={form} layout="vertical" style={{ fontSize: 12 }}>
        <Divider orientation="left" style={{ fontSize: 12 }}>数据库配置</Divider>
        <Space size="large" wrap>
          <Form.Item label="Host" name="host" rules={[{ required: true }]} style={{ width: 150 }}>
            <Input placeholder="localhost" style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item label="端口" name="port" initialValue={3306} style={{ width: 80 }}>
            <Input type="number" style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item label="用户名" name="user" rules={[{ required: true }]} style={{ width: 100 }}>
            <Input style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item label="密码" name="password" style={{ width: 120 }}>
            <Input.Password style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item label="数据库名" name="database" rules={[{ required: true }]} style={{ width: 120 }}>
            <Input style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item style={{ marginTop: 30 }}>
            <Space>
              <Button onClick={handleTest} loading={loading} style={{ fontSize: 12 }}>测试连接</Button>
              <Button type="primary" onClick={handleSaveDb} style={{ fontSize: 12 }}>保存</Button>
            </Space>
          </Form.Item>
        </Space>
      </Form>

      <Form form={llmForm} layout="vertical" style={{ fontSize: 12 }}>
        <Divider orientation="left" style={{ fontSize: 12 }}>LLM 配置</Divider>
        <Space size="large" wrap>
          <Form.Item label="Provider" name="provider" rules={[{ required: true }]} style={{ width: 130 }}>
            <Select style={{ fontSize: 12 }}>
              <Select.Option value="openai">OpenAI</Select.Option>
              <Select.Option value="deepseek">DeepSeek</Select.Option>
              <Select.Option value="minimax">MiniMax</Select.Option>
              <Select.Option value="ollama">Ollama (本地)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="API Key" name="apiKey" rules={[{ required: true }]} style={{ width: 250 }}>
            <Input.Password placeholder="API Key 或 Ollama 地址" style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item label="模型" name="model" style={{ width: 180 }}>
            <Input placeholder="如: gpt-4o, deepseek-chat" style={{ fontSize: 12 }} />
          </Form.Item>
          <Form.Item style={{ marginTop: 30 }}>
            <Button type="primary" onClick={handleSaveLlm} loading={loading} style={{ fontSize: 12 }}>保存LLM配置</Button>
          </Form.Item>
        </Space>
      </Form>
    </Card>
  );
}

export default ConfigPanel;
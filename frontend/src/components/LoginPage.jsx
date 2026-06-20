import React, { useState } from 'react';
import { Form, Input, Button, Tabs, Alert, Typography, Space } from 'antd';
import { UserOutlined, LockOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext.jsx';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (values) => {
    setLoading(true);
    setError('');
    try {
      await login(values.username.trim(), values.password);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || '登录失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values) => {
    if (values.password !== values.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await register({
        username: values.username.trim(),
        password: values.password,
        displayName: (values.displayName || values.username).trim()
      });
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || '注册失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <Space direction="vertical" size={8} style={{ width: '100%', textAlign: 'center', marginBottom: 12 }}>
          <ThunderboltOutlined style={{ fontSize: 36, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>XTSQL Query Agent</Title>
          <Text type="secondary">登录后开启你的多用户 AI 问数工作台</Text>
        </Space>

        <Tabs
          activeKey={mode}
          onChange={(k) => { setMode(k); setError(''); }}
          centered
          items={[
            { key: 'login', label: '登录' },
            { key: 'register', label: '注册' }
          ]}
        />

        {error && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
        )}

        {mode === 'login' ? (
          <Form layout="vertical" onFinish={handleLogin} disabled={loading} initialValues={{ username: 'admin' }}>
            <Form.Item
              name="username"
              label="用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                登录
              </Button>
            </Form.Item>
            <div style={styles.hint}>
              首次使用？默认账号 <b>admin / admin123</b>，登录后请尽快修改密码。
            </div>
          </Form>
        ) : (
          <Form layout="vertical" onFinish={handleRegister} disabled={loading}>
            <Form.Item
              name="username"
              label="用户名"
              rules={[
                { required: true, message: '请输入用户名' },
                { pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/, message: '2-32 位，字母/数字/下划线/中文' }
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="字母/数字/下划线/中文" autoComplete="username" />
            </Form.Item>
            <Form.Item name="displayName" label="昵称（可选）">
              <Input prefix={<UserOutlined />} placeholder="显示用，不填默认同用户名" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少 6 位' }
              ]}
              hasFeedback
            >
              <Input.Password prefix={<LockOutlined />} placeholder="至少 6 位" autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmPassword"
              label="确认密码"
              dependencies={['password']}
              rules={[
                { required: true, message: '请再次输入密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  }
                })
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="再输入一次" autoComplete="new-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={loading} block>
                注册并登录
              </Button>
            </Form.Item>
          </Form>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #e3f2fd 0%, #f3e5f5 100%)'
  },
  card: {
    width: 420,
    maxWidth: '92vw',
    padding: '28px 28px 20px',
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)'
  },
  hint: {
    marginTop: 12,
    color: '#999',
    fontSize: 12,
    textAlign: 'center'
  }
};

import React, { useState } from 'react';
import { ConfigProvider, theme, Typography, Space, Button, Alert } from 'antd';
import { CloudServerOutlined, ApiOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext.jsx';
import { applyServerAddress, getStoredServer, testServerConnection } from '../api/index.js';

const { Title, Text } = Typography;
const { defaultAlgorithm, darkAlgorithm } = theme;

/**
 * 服务器地址设置（仅鸿蒙平板壳模式使用，web / electron 不渲染本组件）。
 * - 首次启动未配置：作为全屏引导页（无 onCancel，必须配置后才能进入登录）
 * - 后续修改：由 LoginPage 角落按钮唤起，传入 onCancel 可返回
 * 保存时 applyServerAddress 会清理旧服务器登录态并广播 server-changed 事件。
 */
export default function ServerSetup({ onCancel }) {
  const { theme: themeMode } = useTheme();
  const [address, setAddress] = useState(getStoredServer());
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, status } | null

  const trimmed = String(address || '').trim().replace(/\/+$/, '');
  const valid = /^https?:\/\/[^\s/$.?#].[^\s]*$/.test(trimmed);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testServerConnection(trimmed);
      setTestResult(result);
    } catch (e) {
      setTestResult({ ok: false, status: 0 });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 先测一次连通性，避免保存一个不可达地址后卡在登录页
      const result = await testServerConnection(trimmed);
      if (!result.ok) {
        setTestResult(result);
        setSaving(false);
        return;
      }
      applyServerAddress(trimmed);
    } catch (e) {
      setTestResult({ ok: false, status: 0 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfigProvider theme={{ algorithm: themeMode === 'dark' ? darkAlgorithm : defaultAlgorithm }}>
      <div style={styles.page}>
        <div style={styles.card}>
          <Space direction="vertical" size={6} style={{ width: '100%', textAlign: 'center', marginBottom: 20 }}>
            <CloudServerOutlined style={{ fontSize: 40, color: '#1677ff' }} />
            <Title level={3} style={{ margin: 0 }}>服务器设置</Title>
            <Text type="secondary">填写部署了 XTSQLQueryAgent 后端的服务器地址</Text>
          </Space>

          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text strong>后端接口地址</Text>
            <input
              style={styles.input}
              value={address}
              onChange={(e) => { setAddress(e.target.value); setTestResult(null); }}
              placeholder="例如 http://192.168.1.100:5002"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              通常是内网服务器 IP + 端口 5002，需与平板在同一网络
            </Text>
          </Space>

          {testResult !== null && (
            <Alert
              style={{ marginTop: 16 }}
              type={testResult.ok ? 'success' : 'error'}
              showIcon={false}
              message={
                <Space>
                  {testResult.ok
                    ? <CheckCircleFilled style={{ color: '#52c41a' }} />
                    : <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                  <span style={{ fontSize: 13 }}>
                    {testResult.ok ? '连接成功，服务运行中' : '无法连接，请检查地址、网络与防火墙'}
                  </span>
                </Space>
              }
            />
          )}

          <Space style={{ marginTop: 24, width: '100%', justifyContent: 'center' }} size={12}>
            <Button size="large" icon={<ApiOutlined />} onClick={handleTest} loading={testing} disabled={!valid}>
              测试连接
            </Button>
            <Button size="large" type="primary" onClick={handleSave} loading={saving} disabled={!valid}>
              保存并进入
            </Button>
            {onCancel && (
              <Button size="large" type="text" onClick={onCancel}>
                返回
              </Button>
            )}
          </Space>
        </div>
      </div>
    </ConfigProvider>
  );
}

const styles = {
  page: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f0f5ff 0%, #e6f4ff 100%)',
    padding: 24,
    zIndex: 1000
  },
  card: {
    width: '100%',
    maxWidth: 460,
    background: '#fff',
    borderRadius: 16,
    padding: '32px 32px 28px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.10)'
  },
  input: {
    width: '100%',
    height: 44,
    fontSize: 15,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid #d9d9d9',
    outline: 'none',
    boxSizing: 'border-box',
    background: '#fff',
    color: '#333'
  }
};

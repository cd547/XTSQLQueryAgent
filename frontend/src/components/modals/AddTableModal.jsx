import React, { useState, useEffect } from 'react';
import { Modal, Steps, Input, Button, Spin, Select, Tooltip, message } from 'antd';
import { checkTableExists, fetchTableDDL, createTableFiles, getDomains } from '../../api';

/**
 * 添加表格 Modal
 *
 * 之前内联在 App.jsx，3 步流程 + 11 个 state + 1 个 useEffect。
 * 所有 state 已下放到本组件，父组件只需控制 open + 监听 onCreated。
 *
 * Props:
 *   open:        boolean   - 控制显示
 *   onClose:     () => void - 关闭（自动 reset）
 *   onCreated:   () => void - 创建成功后回调（父组件用于刷新列表）
 */
export default function AddTableModal({ open, onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [exists, setExists] = useState(false);
  const [ddl, setDdl] = useState('');
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState([]);
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [relatedTables, setRelatedTables] = useState([]);
  const [creating, setCreating] = useState(false);

  // 业务域：进入 step 3 时拉取一次
  useEffect(() => {
    if (step === 3 && domains.length === 0 && !domainsLoading) {
      setDomainsLoading(true);
      getDomains()
        .then(d => {
          if (d.success) setDomains(d.domains || []);
          else message.error(d.message || '加载业务域失败');
        })
        .catch(e => message.error('加载业务域失败: ' + (e.message || e)))
        .finally(() => setDomainsLoading(false));
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStep1 = async () => {
    if (!name.trim()) return;
    setChecking(true);
    try {
      const data = await checkTableExists(name.trim());
      setExists(data.exists);
      if (data.exists) {
        setStep(1.5);
      } else {
        setStep(2);
        setDescription(data.tableComment || '');
      }
    } catch (e) {
      message.error('检查失败: ' + e.message);
    } finally {
      setChecking(false);
    }
  };

  const handleStep2 = async () => {
    setChecking(true);
    try {
      const data = await fetchTableDDL(name.trim());
      if (data.success) {
        setDdl(data.ddl);
        setDescription(data.tableComment || description);
        setRelatedTables(data.relatedTables || []);
        setStep(3);
      } else {
        message.error(data.message || '获取DDL失败');
      }
    } catch (e) {
      message.error('获取DDL失败: ' + e.message);
    } finally {
      setChecking(false);
    }
  };

  const handleStep3 = async () => {
    setCreating(true);
    try {
      const data = await createTableFiles(name.trim(), ddl, description, selectedDomains);
      if (data.success) {
        messageApi.success(data.existed ? 'DDL文件已覆盖' : '表格文件创建成功');
        onClose();
        onCreated && onCreated();
      } else {
        message.error(data.message || '创建失败');
      }
    } catch (e) {
      message.error('创建失败: ' + e.message);
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setName('');
    setDdl('');
    setDescription('');
    setRelatedTables([]);
    setExists(false);
    setSelectedDomains([]);
  };

  const handleClose = () => {
    onClose();
    resetForm();
  };

  return (
    <Modal
      title="添加表格"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={600}
    >
      <Steps current={step === 1.5 ? 1 : step - 1} style={{ marginBottom: 24 }}>
        <Steps.Step title="输入表名" />
        <Steps.Step title="获取DDL" />
        <Steps.Step title="生成文件" />
      </Steps>

      {step === 1 && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <Input
              placeholder="请输入要添加的表名"
              value={name}
              onChange={e => setName(e.target.value)}
              onPressEnter={handleStep1}
            />
          </div>
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" onClick={handleStep1} loading={checking} disabled={!name.trim()}>
              下一步
            </Button>
          </div>
        </div>
      )}

      {step === 1.5 && (
        <div>
          <div style={{ marginBottom: 16, padding: 16, background: 'var(--xtsql-warning-bg)', border: '1px solid var(--xtsql-warning-border)', borderRadius: 4 }}>
            表 <strong>{name}</strong> 已存在，继续则仅覆盖 DDL 文件，table_index 和 field_config 不会修改
          </div>
          <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={handleClose}>取消</Button>
            <Button onClick={() => { setStep(2); }}>继续</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          {checking ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Spin />
              <div style={{ marginTop: 12, color: 'var(--xtsql-text-secondary, #666)' }}>正在查询数据库获取DDL...</div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 16, padding: 16, background: 'var(--xtsql-code-bg)', borderRadius: 4 }}>
                正在获取表 <strong>{name}</strong> 的DDL...
              </div>
              <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button onClick={() => setStep(1)}>上一步</Button>
                <Button type="primary" onClick={handleStep2}>获取DDL</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>表名: {name}</div>
            {!exists && (
              <>
                <div style={{ marginBottom: 8 }}>描述: <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="请输入表描述（可选）" /></div>
                {relatedTables.length > 0 && (
                  <div style={{ marginBottom: 8 }}>关联表: {relatedTables.join(', ')}</div>
                )}
              </>
            )}
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, fontSize: 12 }}>
                业务域 <span style={{ color: '#ff4d4f' }}>*</span>
                <span style={{ color: '#999', marginLeft: 8, fontSize: 11 }}>
                  悬停查看说明，至少选 1 个
                </span>
              </div>
              <Select
                mode="multiple"
                placeholder="请选择业务域"
                value={selectedDomains}
                onChange={setSelectedDomains}
                loading={domainsLoading}
                style={{ width: '100%' }}
                optionLabelProp="label"
                size="small"
              >
                {domains.map(d => (
                  <Select.Option key={d.id} value={d.id} label={d.name}>
                    <Tooltip title={d.description} placement="right">
                      <span style={{ cursor: 'help' }}>{d.name}</span>
                    </Tooltip>
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
          <div style={{ marginBottom: 16, maxHeight: 200, overflow: 'auto', background: 'var(--xtsql-code-bg)', padding: 8, borderRadius: 4, fontSize: 11 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{ddl}</pre>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setStep(2)} disabled={creating}>上一步</Button>
            <Button
              type="primary"
              onClick={handleStep3}
              loading={creating}
              disabled={selectedDomains.length === 0}
            >
              {exists ? '覆盖DDL' : '生成文件'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

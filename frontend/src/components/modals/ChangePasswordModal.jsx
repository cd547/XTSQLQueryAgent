import React, { useState, useRef, useEffect } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import * as api from '../../api/index.js';

/**
 * 修改密码弹窗
 *
 * 行为完全等价于 App.jsx 中的内联版本：
 * - Form.useForm 管理表单
 * - 关闭时清空（避免 Form 未挂载的初始化警告）
 * - 改密成功后回调 onChanged（父组件负责登出 + 跳登录）
 */
export default function ChangePasswordModal({ open, onClose, onChanged }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 关闭时清空表单 —— 仅在 open 从 true → false 时 reset，
  // 避免 open=false 初始化阶段（Form 还未挂载）调用 resetFields() 报
  // "Instance created by useForm is not connected to any Form element" 警告
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) {
      form.resetFields();
    }
    prevOpenRef.current = open;
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await api.changePasswordApi({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword
      });
      message.success('密码已修改，请重新登录');
      // 改密会吊销 token_version，前端必须退出登录态
      onChanged && onChanged();
    } catch (e) {
      if (e?.errorFields) {
        // antd 表单校验失败，不报错
        return;
      }
      const msg = e?.response?.data?.error || e?.message || '修改失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="修改密码"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="确认修改"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" autoComplete="off">
        <Form.Item
          name="oldPassword"
          label="当前密码"
          rules={[{ required: true, message: '请输入当前密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="请输入当前密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '新密码长度不能少于 6 位' }
          ]}
          hasFeedback
        >
          <Input.Password prefix={<LockOutlined />} placeholder="新密码（至少 6 位）" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          hasFeedback
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的密码不一致'));
              }
            })
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="再次输入新密码" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

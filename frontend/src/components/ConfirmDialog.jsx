import React from 'react';
import { Modal, Button, Space } from 'antd';

function ConfirmDialog({ visible, term, table, description, onConfirm, onCancel }) {
  return (
    <Modal
      open={visible}
      title="添加标签确认"
      footer={
        <Space>
          <Button onClick={onCancel}>否</Button>
          <Button type="primary" onClick={onConfirm}>是</Button>
        </Space>
      }
      onCancel={onCancel}
      closable={false}
      maskClosable={false}
    >
      <p>是否将 <strong>"{term}"</strong> 添加到表 <strong>{table}</strong> ({description}) 的标签字段中？</p>
      <p style={{ color: '#999', fontSize: 12 }}>
        添加后，下次查询时 Agent 可以通过"{term}"直接匹配到 {table} 表
      </p>
    </Modal>
  );
}

export default ConfirmDialog;
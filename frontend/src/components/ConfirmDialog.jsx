import React from 'react';
import { Button, Space } from 'antd';

function ConfirmDialog({ visible, term, table, description, onConfirm, onCancel }) {
  if (!visible) return null;
  
  const termList = Array.isArray(term) ? term : [term];
  const termStr = termList.join('", "');
  const termDisplay = termList.length > 1 ? `["${termStr}"]` : `"${termStr}"`;
  
  return (
    <div style={{
      margin: '12px 24px',
      padding: '12px 16px',
      background: '#fffbe6',
      border: '1px solid #ffe58f',
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
    }}>
      <div style={{ marginBottom: 8 }}>
        是否将 <strong>{termDisplay}</strong> 添加到表 <strong>{table}</strong> ({description}) 的标签字段中？
      </div>
      <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
        添加后，下次查询时 Agent 可以通过这些术语直接匹配到 {table} 表
      </div>
      <Space>
        <Button size="small" onClick={onConfirm}>是</Button>
        <Button size="small" onClick={onCancel}>否</Button>
      </Space>
    </div>
  );
}

export default ConfirmDialog;
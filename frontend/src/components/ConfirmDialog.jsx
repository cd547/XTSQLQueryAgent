import React from 'react';
import { Button, Space } from 'antd';
import { useTheme } from '../context/ThemeContext.jsx';

function ConfirmDialog({ visible, term, table, description, onConfirm, onCancel }) {
  const { theme: themeMode } = useTheme();
  if (!visible) return null;

  const termList = Array.isArray(term) ? term : [term];
  const termStr = termList.join('", "');
  const termDisplay = termList.length > 1 ? `["${termStr}"]` : `"${termStr}"`;

  // 暗色主题：换成琥珀色低透明度 + 暗色文字；保持与 antd darkAlgorithm 一致的色系
  const isDark = themeMode === 'dark';
  const containerStyle = isDark
    ? {
        background: 'rgba(250, 173, 20, 0.12)',
        border: '1px solid rgba(250, 173, 20, 0.35)',
        color: 'rgba(255, 255, 255, 0.88)',
      }
    : {
        background: '#fffbe6',
        border: '1px solid #ffe58f',
        color: 'inherit',
      };
  const descColor = isDark ? 'rgba(255, 255, 255, 0.55)' : '#999';

  return (
    <div style={{
      margin: '12px 24px',
      padding: '12px 16px',
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      ...containerStyle,
    }}>
      <div style={{ marginBottom: 8 }}>
        是否将 <strong>{termDisplay}</strong> 添加到表 <strong>{table}</strong> ({description}) 的标签字段中？
      </div>
      <div style={{ fontSize: 12, color: descColor, marginBottom: 8 }}>
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
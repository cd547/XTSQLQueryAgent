/**
 * useTagConfirmation Hook
 *
 * 封装"标签添加确认"弹窗的状态与回调：
 *  - state: { visible, term, table, description }
 *  - openTagConfirmation(payload): 由 SSE tool 'request_tag_confirmation' 事件触发
 *  - handleConfirmTagAdd: 调 addTagToTable API，成功/失败提示后关弹窗
 *  - handleCancelTagAdd: 仅关弹窗
 *
 * 设计决策：
 *  - 把 setter 内部化(不暴露 setConfirmTagAdd),App.jsx 通过 openTagConfirmation(payload) 打开
 *    → 避免外部直接修改 state 导致内部状态被绕过
 *  - 接受 messageApi 作参数(由 AntdApp.useApp() 提供),消除静态 message 警告
 */
import { useState, useCallback } from 'react';
import { addTagToTable } from '../api/index.js';

export function useTagConfirmation({ messageApi }) {
  const [confirmTagAdd, setConfirmTagAdd] = useState({
    visible: false,
    term: [],
    table: '',
    description: ''
  });

  /**
   * 打开确认弹窗(由 SSE 工具事件触发)
   * @param {{ term: string|string[], table: string, description: string }} payload
   */
  const openTagConfirmation = useCallback((payload) => {
    setConfirmTagAdd({
      visible: true,
      term: payload.term || [],
      table: payload.table || '',
      description: payload.description || ''
    });
  }, []);

  /**
   * 确认添加标签 → 调 addTagToTable API
   */
  const handleConfirmTagAdd = useCallback(async () => {
    const { table, term } = confirmTagAdd;
    try {
      await addTagToTable(table, term);
      const termStr = Array.isArray(term) ? term.join(', ') : term;
      messageApi.success(`已将 "${termStr}" 添加到 ${table} 的标签`);
    } catch (e) {
      messageApi.error('添加标签失败: ' + e.message);
    }
    setConfirmTagAdd(prev => ({ ...prev, visible: false }));
  }, [confirmTagAdd, messageApi]);

  /**
   * 取消添加 → 仅关弹窗
   */
  const handleCancelTagAdd = useCallback(() => {
    setConfirmTagAdd(prev => ({ ...prev, visible: false }));
  }, []);

  return {
    confirmTagAdd,
    openTagConfirmation,
    handleConfirmTagAdd,
    handleCancelTagAdd,
  };
}

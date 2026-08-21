/**
 * useUserChoice Hook
 *
 * 封装"request_user_choice 链式弹窗"的状态与回调（v2 链式：1-3 个问题串联）：
 *  - state: { visible, requests, currentIndex, answers }
 *  - openUserChoiceRequest(payload): 由 SSE done 事件的 user_choice_request 字段触发
 *  - handleSubmitUserChoice: 非最后一题 → 保存 + currentIndex++; 最后一题 → 保存 + 合成 combined + 调 onSubmitCombined
 *  - handlePrevUserChoice: currentIndex--，让"上一步"能回显用户原答案
 *  - handleCancelUserChoice: 关闭弹窗 + 调 onSubmitCombined("用户取消了选择...")
 *
 * 设计决策：
 *  - 把 setter 内部化,App.jsx 通过 openUserChoiceRequest(payload) 打开
 *  - 接受 onSubmitCombined 作参数(由 App.jsx 注入 handleSend),hook 内部不调 handleSend
 *    → 解除 hook 与 SSE 主流程的耦合,handleSend 仍是 App.jsx 的核心函数
 *  - onSubmitCombined 用 useRef 固定:每次 render 写入最新 ref 但 callback 不重建
 *    → 避免 handleSubmitUserChoice 引用变化导致下游子组件重渲染
 *  - setTimeout(0) 保留(避免 setUserChoiceRequest 的 reducer 中嵌套 setState 触发 React 警告)
 *  - 综合消息格式: "label=answer; label=answer; ..."(label 优先用 header,缺失时退化为"问题N")
 *  - v2 改进(2026-07-27): 跳过的题不再用 `（无）` 占位(LLM 易把"无"理解为 SQL 关键字)
 *    → 分两部分: 已答的进 "label=answer; ..."; 跳过的额外追加一行明确标记
 */
import { useState, useCallback, useRef, useEffect } from 'react';

export function useUserChoice({ onSubmitCombined }) {
  const [userChoiceRequest, setUserChoiceRequest] = useState({
    visible: false,
    requests: [],
    currentIndex: 0,
    answers: []
  });

  // 用 ref 固定 onSubmitCombined,callback 重建不依赖它
  const submitRef = useRef(onSubmitCombined);
  useEffect(() => { submitRef.current = onSubmitCombined; }, [onSubmitCombined]);

  /**
   * 打开链式弹窗(由 SSE done 事件触发)
   * @param {{ requests: Array<{id, question, options, multiSelect, header}> }} payload
   */
  const openUserChoiceRequest = useCallback((payload) => {
    const reqs = Array.isArray(payload.requests) ? payload.requests : [];
    setUserChoiceRequest({
      visible: true,
      requests: reqs,
      currentIndex: 0,
      answers: reqs.map(() => ({ selected: [], text: '' }))
    });
  }, []);

  /**
   * 提交答案（v2 链式）
   * @param {string[]} selected - 用户选中的 option labels
   * @param {string} text - 用户填写的自由文本
   */
  const handleSubmitUserChoice = useCallback((selected, text) => {
    setUserChoiceRequest(prev => {
      if (!prev.visible || prev.requests.length === 0) return prev;
      const newAnswers = [...prev.answers];
      newAnswers[prev.currentIndex] = { selected: selected || [], text: text || '' };
      const isLast = prev.currentIndex >= prev.requests.length - 1;
      if (!isLast) {
        // 链式：保存当前答案 + 进入下一个问题
        return { ...prev, currentIndex: prev.currentIndex + 1, answers: newAnswers };
      }
      // 最后一个：合成综合 user 消息
      const answeredParts = [];
      const skippedLabels = [];
      newAnswers.forEach((a, i) => {
        const req = prev.requests[i] || {};
        const label = (req.header && String(req.header).trim()) || `问题${i + 1}`;
        const sel = Array.isArray(a.selected) && a.selected.length > 0 ? a.selected.join(', ') : '';
        const txt = (a.text || '').trim();
        const isAnswered = sel !== '' || txt !== '';
        if (isAnswered) {
          const ans = [sel, txt].filter(Boolean).join(' + ');
          answeredParts.push(`${label}=${ans}`);
        } else {
          skippedLabels.push(label);
        }
      });
      let combined = answeredParts.join('; ');
      if (skippedLabels.length > 0) {
        const skipNote = `（用户跳过了 ${skippedLabels.length} 个问题：${skippedLabels.join('、')}）`;
        combined = combined ? `${combined}\n${skipNote}` : skipNote;
      }
      // 关闭弹窗 + 触发新一轮（setTimeout 0 避免在 reducer 中嵌套 setState）
      setTimeout(() => {
        submitRef.current?.(combined || '用户未回答');
      }, 0);
      return { visible: false, requests: [], currentIndex: 0, answers: [] };
    });
  }, []);

  /**
   * v3 "上一步"：让用户回到上题修改答案
   * 边界：currentIndex === 0 时按 noop 处理
   */
  const handlePrevUserChoice = useCallback(() => {
    setUserChoiceRequest(prev => {
      if (prev.currentIndex <= 0) return prev;
      return { ...prev, currentIndex: prev.currentIndex - 1 };
    });
  }, []);

  /**
   * 取消处理：合成 "用户取消了选择" 消息,提交新一轮
   */
  const handleCancelUserChoice = useCallback(() => {
    setUserChoiceRequest(prev => ({ ...prev, visible: false }));
    setTimeout(() => {
      submitRef.current?.('用户取消了选择，请基于已有信息继续');
    }, 0);
  }, []);

  return {
    userChoiceRequest,
    openUserChoiceRequest,
    handleSubmitUserChoice,
    handlePrevUserChoice,
    handleCancelUserChoice,
  };
}

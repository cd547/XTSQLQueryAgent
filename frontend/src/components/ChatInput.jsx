/**
 * ChatInput 组件
 *
 * 聊天区底部的输入区 + 拖拽条 + 状态栏 + 发送按钮。
 *
 * 设计决策：
 *  - 状态（input / inputHeight / loading / reasoning / tokens 等）保留在 AuthenticatedApp
 *    通过 props 传入，不下沉。原因：handleSend 也要读 input，handleStop 也要 setLoading，
 *    共享状态过深下层会导致回调路径复杂。
 *  - inputHeight 是 ChatInput 内部的拖拽条状态，但因为 UserChoiceDialog 需要它来定位弹框位置
 *    （bottom = inputHeight + 24），所以也保留在父组件持有，本组件只读 + 通过 setInputHeight 改。
 *  - 不使用 useCallback 包裹内部 lambdas，与原 inline 风格保持一致。
 *  - 不做 React.memo，避免 props 引用稳定性问题（state setter 已稳定，但 callbacks 在父组件
 *    是新创建的，memo 会失效）。
 *
 * 父组件需要传入的 props（详见 propTypes）：
 *  - 拖拽条：inputResizerRef, inputHeight, setInputHeight
 *  - 文本输入：input, setInput, onSend, onStop, loading, disabled
 *  - 状态显示：currentModel, currentTokens, sessionMessagesTokens, tokenWarningLevel, onViewMessages
 *  - 思考模式：reasoningEnabled, reasoningEffort, setReasoningEnabled, setReasoningEffort
 */
import React from 'react';
import { Input, Button, Space, Tooltip, Segmented } from 'antd';
import {
  ClockCircleOutlined,
  SendOutlined,
  LoadingOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

export default function ChatInput({
  // ===== 拖拽条（输入区高度）=====
  inputResizerRef,         // ref, 绑到 .xtsql-input-inner
  inputHeight,             // number, 当前高度（60~300 区间）
  setInputHeight,          // (n) => void

  // ===== 文本输入 =====
  input,                   // string, TextArea 受控值
  setInput,                // (s) => void
  onSend,                  // () => void, Enter 或点发送
  onStop,                  // () => void, 加载中点停止
  loading,                 // boolean, 正在流式生成
  disabled,                // boolean, 例：userChoiceRequest.visible 时禁输入

  // ===== 状态显示（footer meta）=====
  currentModel,            // string, 当前模型名（null/undefined 时不显示）
  currentTokens,           // number, 该会话累计 token
  sessionMessagesTokens,   // number, 当前上下文 token
  tokenWarningLevel,       // number, token 警告阈值
  onViewMessages,          // () => void, 点击 token 条查看消息详情

  // ===== 思考模式（4 档：关/低/中/高）=====
  reasoningEnabled,        // boolean
  reasoningEffort,         // 'low' | 'medium' | 'high'
  setReasoningEnabled,     // (b) => void
  setReasoningEffort,      // (s) => void
}) {
  // 拖拽条 mousedown 闭包（捕获 startHeight/handleMove/handleUp）
  const handleResizerMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = inputHeight;
    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(60, Math.min(300, startHeight - delta));
      setInputHeight(newHeight);
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // 思考模式 onChange：'off' 关，其余切档
  const handleReasoningChange = (v) => {
    if (v === 'off') {
      setReasoningEnabled(false);
    } else {
      setReasoningEnabled(true);
      setReasoningEffort(v);
    }
  };

  return (
    <div className="xtsql-input-wrap">
      <div
        ref={inputResizerRef}
        className="xtsql-input-inner"
        style={{ minHeight: inputHeight }}
      >
        <div
          className="xtsql-input-resizer"
          onMouseDown={handleResizerMouseDown}
        />
        <div className="xtsql-input-grip" />

        <TextArea
          className="xtsql-input-textarea"
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder={disabled ? "请先完成弹窗中的选择" : "输入自然语言查询，按Enter发送，Shift+Enter换行"}
          disabled={disabled}
          // ★ 由 .xtsql-input-inner 的 flex 布局控制高度（flex: 1 填中间空间）
          //   不再写死 style.height，避免拉高容器时把 footer 顶下去
          //   autoSize 也移除（flex 高度优先；内容超出走内部滚动）
        />

        <div className="xtsql-input-footer">
          <div className="xtsql-input-meta">
            {currentModel && <span className="xtsql-input-model-tag">{currentModel}</span>}

            {/* ★ 用户控件：思考模式
                - 位置：模型名称 与 累计 tokens 之间
                - 持久化：localStorage（刷新后保留）
                - Segmented 单控件表达「关/低/中/高」4 档，比 Switch+Select 更紧凑
                - Chat Completions 模式下强度选择无效（API 不支持），仅开关生效
                - label + Segmented 用 Space size=2 收紧（meta 容器 gap:10px 太大） */}
            <Space size={2}>
              <span className="xtsql-input-meta-label">思考模式：</span>
              <Tooltip title="思考模式：高=深度推理（耗 token），低=轻度推理，关=不推理">
                <Segmented
                  size="small"
                  className="xtsql-reasoning-segmented"
                  value={reasoningEnabled ? reasoningEffort : 'off'}
                  onChange={handleReasoningChange}
                  options={[
                    { value: 'off', label: '关' },
                    { value: 'low', label: '低' },
                    { value: 'medium', label: '中' },
                    { value: 'high', label: '高' },
                  ]}
                />
              </Tooltip>
            </Space>

            {currentTokens > 0 && (
              <Tooltip title="该会话累计消耗的 token（含输出，按 API usage 计）">
                <span className="xtsql-input-tokens">
                  <ClockCircleOutlined style={{ fontSize: 11, marginRight: 4 }} />
                  {currentTokens.toLocaleString()} tokens
                </span>
              </Tooltip>
            )}

            <Tooltip title={`当前上下文 ${sessionMessagesTokens.toLocaleString()} tokens / 警告阈值 ${tokenWarningLevel.toLocaleString()}（点击查看详情）`}>
              <div
                className="xtsql-token-bar"
                onClick={onViewMessages}
              >
                <div
                  className="xtsql-token-bar-fill"
                  style={{
                    width: `${Math.min((sessionMessagesTokens / tokenWarningLevel) * 100, 100)}%`,
                    backgroundColor: sessionMessagesTokens > tokenWarningLevel ? 'var(--xtsql-danger)' : 'var(--xtsql-accent)'
                  }}
                />
              </div>
            </Tooltip>
          </div>

          {loading ? (
            <Button
              className="xtsql-send-btn danger"
              onClick={onStop}
              icon={<LoadingOutlined spin />}
            />
          ) : (
            <Button
              className="xtsql-send-btn"
              onClick={onSend}
              disabled={!input.trim()}
              icon={<SendOutlined />}
            />
          )}
        </div>
      </div>
    </div>
  );
}

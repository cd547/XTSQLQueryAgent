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
import React, { useRef } from 'react';
import { Input, Button, Space, Tooltip, Segmented, Progress, Tag } from 'antd';
import {
  ClockCircleOutlined,
  SendOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  CloseOutlined,
  FileImageOutlined,
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
  // ★ 2026-08-24 多会话并行流式：拆分"当前会话在流"和"其他会话在流"两个 prop
  //   - 修前用 loading（全 局流状态）→ A 在流时 B 也显示停止按钮，用户点错就误杀 A
  //   - 修后用 isCurrentSessionStreaming：只有当前会话真在流才显示停止按钮
  //   - otherSessionStreaming：其他会话在流时显示发送按钮但 disabled
  isCurrentSessionStreaming, // boolean, 当前会话（currentSessionId === streamingSessionId）
  otherSessionStreaming,    // boolean, 任何 LLM 流在跑但不是当前会话
  disabled,                // boolean, 例：userChoiceRequest.visible 时禁输入

  // ===== 状态显示（footer meta）=====
  currentModel,            // string, 当前模型名（null/undefined 时不显示）
  currentTokens,           // number, 该会话累计 token
  sessionMessagesTokens,   // number, 当前上下文 token
  tokenWarningLevel,       // number, token 警告阈值
  onViewMessages,          // () => void, 点击 token 条查看消息详情

  // ===== 思考模式（v5.20d 3 档：低/中/高）=====
  //   移除 reasoningEnabled prop（始终为 true，App.jsx 硬编码）
  reasoningEffort,         // 'low' | 'medium' | 'high'
  setReasoningEffort,      // (s) => void

  // ===== 附件（★ 2026-08-24 新增：DeepSeek Files API）=====
  filesConfig,             // { allowedTypes: string[], maxSizeMiB: number, expiresAfterSeconds: number|null }
  uploadedFiles,           // Array<{ id, filename, bytes, created_at, expires_at? }>（全局已上传文件，跨会话共享）
  uploadingFiles,          // Array<{ tempId, name, size, progress, controller }>（上传中任务，含进度与可取消）
  onUploadFile,            // (file: File) => void
  onRemoveFile,            // (fileId: string) => void
  onCancelUpload,          // (tempId: string) => void
}) {
  const fileInputRef = useRef(null);
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

  // 思考模式 onChange：v5.20d 恢复 3 档（低/中/高），enabled 永远 true
  const handleReasoningChange = (v) => {
    setReasoningEffort(v);
  };

  // 把后端的 allowedTypes（如 image/jpeg）映射到 <input type="file" accept> 字符串（image/jpeg,image/png,...）
  const acceptAttr = (Array.isArray(filesConfig?.allowedTypes) ? filesConfig.allowedTypes : []).join(',');

  // 点 paperclip 按钮 → 触发隐藏的 <input type="file"> 点击
  const handlePaperclipClick = () => {
    if (isCurrentSessionStreaming || otherSessionStreaming || disabled) return;
    fileInputRef.current?.click();
  };

  // 文件选择：每次只传一个（多文件选第一个且只读第一个，避免 batch upload 复杂度）
  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) onUploadFile?.(file);
    // 清 value：让下次选同一文件也能触发 change
    e.target.value = '';
  };

  return (
    <div className="xtsql-input-wrap">
      {/* ★ 2026-08-24 附件：上传进度条
            - 位置：聊天对话框的上方（紧贴 input 容器上沿）
            - 仅在 uploadingFiles.length > 0 时显示
            - 每条任务 = 1 行 Progress + 文件名 + 取消按钮 */}
      {uploadingFiles && uploadingFiles.length > 0 && (
        <div className="xtsql-file-uploads">
          {uploadingFiles.map((u) => (
            <div key={u.tempId} className="xtsql-file-upload-row">
              <FileImageOutlined style={{ fontSize: 12, color: 'var(--xtsql-text-secondary, #888)' }} />
              <span className="xtsql-file-upload-name" title={u.name}>{u.name}</span>
              <Progress
                percent={u.progress}
                size="small"
                showInfo
                style={{ flex: 1, margin: '0 8px' }}
                strokeColor={{ '0%': '#69b1ff', '100%': '#1677ff' }}
              />
              <Tooltip title="取消上传">
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => onCancelUpload?.(u.tempId)}
                />
              </Tooltip>
            </div>
          ))}
        </div>
      )}

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

        {/* ★ 2026-08-24 附件：已上传文件 chip 列表
              - 位置：TextArea 之上、resizer 之下（输入框内顶部）
              - 全局已上传文件展示在此；每个 chip 有一个 × 按钮触发 removeFile
              - 暂不支持 chip 排序/拖拽；为空时不渲染（不占行高） */}
        {uploadedFiles && uploadedFiles.length > 0 && (
          <div className="xtsql-file-chip-list">
            {uploadedFiles.map((f) => (
              <Tag
                key={f.id}
                className="xtsql-file-chip"
                icon={<FileImageOutlined />}
                closable
                onClose={(e) => { e.preventDefault(); onRemoveFile?.(f.id); }}
                title={`file_id: ${f.id}\nfilename: ${f.filename}\nsize: ${(f.bytes / 1024).toFixed(1)} KiB`}
              >
                <span className="xtsql-file-chip-name">{f.filename}</span>
              </Tag>
            ))}
          </div>
        )}

        {/* ★ 2026-08-24 附件：隐藏 file input + paperclip 按钮触发
              accept 同步后端 allowlist；filesConfig 未加载时给个保守默认 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptAttr || 'image/jpeg,image/png,image/gif,image/webp'}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <TextArea
          className="xtsql-input-textarea"
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); onSend(); } }}
          // ★ 2026-08-24 多会话并行流式：3 种禁用场景
          //   - disabled: 弹窗阻塞（userChoiceRequest.visible）
          //   - isCurrentSessionStreaming: 当前会话在流 → 不可改 prompt
          //   - otherSessionStreaming: 其他会话在流 → 全局只 1 个流，不能开新流
          //   三者任一为真都要禁用 TextArea
          disabled={disabled || isCurrentSessionStreaming || otherSessionStreaming}
          placeholder={
            disabled
              ? "请先完成弹窗中的选择"
              : isCurrentSessionStreaming
              ? "当前会话正在生成中，点右侧停止按钮中断"
              : otherSessionStreaming
              ? "另一会话正在生成中，请等待其结束"
              : "输入自然语言查询，按Enter发送，Shift+Enter换行"
          }
          // ★ 由 .xtsql-input-inner 的 flex 布局控制高度（flex: 1 填中间空间）
          //   不再写死 style.height，避免拉高容器时把 footer 顶下去
          //   autoSize 也移除（flex 高度优先；内容超出走内部滚动）
        />

        <div className="xtsql-input-footer">
          <div className="xtsql-input-meta">
            {/* ★ 2026-08-24 附件按钮：放在最左侧（模型的"左侧"）
                  - icon=PaperClipOutlined
                  - 提示：上传文件（当前支持 JPEG/PNG/GIF/WebP）
                  - 流式 / 弹窗阻塞 / disabled 时一并禁用（避免误点） */}
            <Tooltip title={
              isCurrentSessionStreaming || otherSessionStreaming
                ? '生成中无法上传'
                : `上传附件${filesConfig?.maxSizeMiB ? `（≤ ${filesConfig.maxSizeMiB} MiB）` : ''}`
            }>
              <Button
                size="small"
                type="text"
                className="xtsql-paperclip-btn"
                icon={<PaperClipOutlined />}
                onClick={handlePaperclipClick}
                disabled={isCurrentSessionStreaming || otherSessionStreaming || disabled}
              />
            </Tooltip>

            {currentModel && <span className="xtsql-input-model-tag">{currentModel}</span>}

            {/* ★ 用户控件：思考模式
                - 位置：模型名称 与 累计 tokens 之间
                - 持久化：localStorage（刷新后保留）
                - v5.20a 移除"关"档：deepseek-v4-flash effort=0 下易循环
                - v5.20b 移除"低"档 → v5.20d 恢复（误判 low 无 reasoning_content，根因是 buildThinking 嵌套 bug，已修）
                - v5.20c 移除 reasoningEnabled 状态：始终为 true，App.jsx 硬编码
                - 默认选中"中"（medium）
                - Segmented 单控件表达「低/中/高」3 档
                - label + Segmented 用 Space size=2 收紧（meta 容器 gap:10px 太大） */}
            <Space size={2}>
              <span className="xtsql-input-meta-label">思考模式：</span>
              <Tooltip title="思考模式：高=深度推理（耗 token），中=适度推理，低=轻量推理">
                <Segmented
                  size="small"
                  className="xtsql-reasoning-segmented"
                  value={reasoningEffort}
                  onChange={handleReasoningChange}
                  options={[
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

          {isCurrentSessionStreaming ? (
            // ★ 2026-08-24 多会话并行流式：只有当前会话在流时才显示"停止"按钮
            //   修前：loading=true 就显示停止按钮 → A 在流时切到 B，B 顶部按钮是停止
            //     → 用户点停止会误杀 A（虽然 abort 行为是正确的，但 UX 违反直觉）
            //   修后：isCurrentSessionStreaming=true 才显示停止 → 按钮的语义 = 中断"当前会话的流"
            <Button
              className="xtsql-send-btn danger"
              onClick={onStop}
              icon={<LoadingOutlined spin />}
            />
          ) : (
            <Button
              className="xtsql-send-btn"
              onClick={onSend}
              // ★ 禁用条件：input 为空 / 弹窗阻塞 / 其他会话在流
              //   - otherSessionStreaming 时虽然按钮显示为"发送"语义，但实际点了也无效
              //     所以 disabled 掉 + placeholder 已经提示
              disabled={!input.trim() || disabled || otherSessionStreaming}
              icon={<SendOutlined />}
            />
          )}
        </div>
      </div>
    </div>
  );
}

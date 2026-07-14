import React, { useState, useEffect } from 'react';
import { Modal, Button, Space, Radio, Checkbox, Input, Tag, Tooltip } from 'antd';
import { MinusOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons';

/**
 * UserChoiceDialog - 与 LLM 交互的选项 + 自由文本输入弹窗
 *
 * 数据来源：SSE done 事件的 user_choice_request 字段（来自 llm.js 终止分支）
 * 行为：用户提交/取消后，App.jsx 合成新 user message 调 /generate 触发新一轮
 *
 * Props:
 *   - visible: bool
 *   - question: string（必填）
 *   - options: string[]（必填，1-8 个）
 *   - multiSelect: bool（true=多选/false=单选）
 *   - header: string（≤12 字短标题）
 *   - inputHeight: number（聊天输入框当前高度，用于把弹框定位在输入框正上方）
 *   - onSubmit(selected: string[], text: string): 用户点提交
 *   - onCancel(): 用户点取消
 */
function UserChoiceDialog({ visible, question, options, multiSelect, header, inputHeight = 100, onSubmit, onCancel }) {
  const [selected, setSelected] = useState(multiSelect ? [] : '');
  const [text, setText] = useState('');
  // 折叠态：用户最小化时只显示标题条，主体内容隐藏，不影响查看上方对话
  const [minimized, setMinimized] = useState(false);

  // visible 变化时重置 state（防止上次提交残留）
  useEffect(() => {
    if (visible) {
      setSelected(multiSelect ? [] : '');
      setText('');
      setMinimized(false);
    }
  }, [visible, multiSelect]);

  const safeOptions = Array.isArray(options) ? options : [];
  const safeQuestion = String(question || '请选择');

  const handleSubmit = () => {
    const selectedArr = multiSelect
      ? (Array.isArray(selected) ? selected : [])
      : (selected ? [selected] : []);
    onSubmit(selectedArr, text || '');
  };

  // 文本框按 Enter 提交（Shift+Enter 换行）
  const handleTextPressEnter = (e) => {
    if (!e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Modal
      open={visible}
      footer={null}
      width={600}
      closable={false}
      // 折叠时不显示遮罩，用户可继续浏览上方对话；展开时显示遮罩聚焦
      mask={!minimized}
      maskClosable={false}
      keyboard={false}
      destroyOnHidden
      // 渲染到主内容区（.xtsql-content）内而不是 body，
      // 这样 wrap 容器 absolute 定位能相对 Content 区域。
      // Content 已在 App.css 加 position: relative。
      getContainer={() => document.querySelector('.xtsql-content') || document.body}
      // 定位：贴 Content 底部悬浮在聊天输入框正上方
      // bottom = inputHeight(输入框高度) + 24(下间距)
      // absolute 而非 fixed，确保只浮在 Content 区域、不覆盖左侧 Sider
      style={{
        position: 'absolute',
        top: 'auto',
        bottom: inputHeight + 24,
        left: 0,
        right: 0,
        margin: '0 auto',
        padding: 0,
      }}
      // 主题：通过 CSS 变量（var(--xtsql-*)）跟随当前亮/暗主题
      // 亮色默认值作为兜底，暗色下 .xtsql-dark 自动覆盖
      styles={{
        content: {
          background: 'var(--xtsql-bg-elevated, #ffffff)',
          border: '1px solid var(--xtsql-border, #e5e7eb)',
          boxShadow: minimized
            ? '0 -2px 12px rgba(0, 0, 0, 0.10)'
            : '0 -8px 28px rgba(0, 0, 0, 0.18)',
          padding: 0,
          borderRadius: 8,
        },
        mask: { backgroundColor: 'rgba(0, 0, 0, 0.35)' },
        body: {
          padding: minimized ? 0 : '14px 18px',
          maxHeight: minimized ? 'none' : '45vh',
          overflow: 'auto',
        },
      }}
    >
      {/* 标题栏：始终显示，含 header / 折叠按钮 / 关闭按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: minimized ? '8px 18px' : '0 0 10px 0',
          borderBottom: minimized
            ? 'none'
            : '1px solid var(--xtsql-border, #e5e7eb)',
          marginBottom: minimized ? 0 : 12,
        }}
      >
        <Space size={8} align="center">
          {header && (
            <Tag color="blue" style={{ margin: 0, fontSize: 12 }}>
              📋 {header}
            </Tag>
          )}
          {minimized && (
            <span
              style={{
                color: 'var(--xtsql-text, #1f2937)',
                fontSize: 13,
                fontWeight: 500,
                maxWidth: 420,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {safeQuestion}
            </span>
          )}
        </Space>
        <Space size={2}>
          <Tooltip title={minimized ? '展开' : '折叠（不影响查看对话）'}>
            <Button
              type="text"
              size="small"
              icon={minimized ? <PlusOutlined /> : <MinusOutlined />}
              onClick={() => setMinimized(m => !m)}
              aria-label={minimized ? 'expand' : 'collapse'}
            />
          </Tooltip>
          <Tooltip title="关闭（取消）">
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={onCancel}
              aria-label="close"
            />
          </Tooltip>
        </Space>
      </div>

      {/* 主体：折叠时隐藏 */}
      {!minimized && (
        <>
          <div
            style={{
              marginBottom: 12,
              fontSize: 14,
              color: 'var(--xtsql-text, #1f2937)',
              lineHeight: 1.5,
            }}
          >
            {safeQuestion}
          </div>

          {safeOptions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {multiSelect ? (
                <Checkbox.Group
                  value={selected}
                  onChange={setSelected}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {safeOptions.map((opt, i) => (
                    <Checkbox key={i} value={opt}>{opt}</Checkbox>
                  ))}
                </Checkbox.Group>
              ) : (
                <Radio.Group
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {safeOptions.map((opt, i) => (
                    <Radio key={i} value={opt}>{opt}</Radio>
                  ))}
                </Radio.Group>
              )}
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <Input.TextArea
              value={text}
              onChange={e => setText(e.target.value)}
              onPressEnter={handleTextPressEnter}
              placeholder="如果选项未涵盖您的情况或需要补充说明（Enter 提交，Shift+Enter 换行）"
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={500}
            />
          </div>

          <Space>
            <Button type="primary" size="small" onClick={handleSubmit}>
              提交
            </Button>
            <Button size="small" onClick={onCancel}>
              取消
            </Button>
          </Space>
        </>
      )}
    </Modal>
  );
}

export default UserChoiceDialog;

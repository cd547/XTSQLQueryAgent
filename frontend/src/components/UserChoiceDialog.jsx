import React, { useState, useEffect } from 'react';
import { Modal, Button, Space, Radio, Checkbox, Input, Tag, Tooltip } from 'antd';
import { MinusOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons';

/**
 * UserChoiceDialog - v2 链式弹窗
 *
 * 数据来源：SSE done 事件的 user_choice_request 字段（来自 llm.js 终止分支）
 * 行为：用户提交/取消后，App.jsx 合成新 user message 调 /generate 触发新一轮
 *
 * v2 链式：单次 LLM 推理可问 1-3 个问题，前端按 currentIndex 顺序展示
 *   - 单问题：按钮显示"完成"
 *   - 多问题：按钮显示"下一个"，最后一题"完成"
 *   - 弹窗不关闭（直到最后一题"完成"或"取消"）
 *   - v3 (2026-07-16) 新增"上一步"：用户可回到上题修改答案
 *
 * Props:
 *   - visible: bool（控制整张卡片的显隐）
 *   - request: {id, question, options, multiSelect, header}（当前问题）
 *   - currentIndex: number（0-based，当前问题索引）
 *   - totalCount: number（总问题数）
 *   - previousAnswer: {selected: string[], text: string}（当前问题已保存的答案；用于切回上题时回显）
 *   - canGoPrev: bool（是否可以回到上一题；多问题时才显示上一步按钮）
 *   - inputHeight: number（聊天输入框当前高度，用于把弹框定位在输入框正上方）
 *   - onSubmit(selected: string[], text: string): 用户点"下一个"或"完成"
 *   - onPrev(): 用户点"上一步"
 *   - onCancel(): 用户点"取消"
 */
function UserChoiceDialog({ visible, request, currentIndex = 0, totalCount = 1, previousAnswer, canGoPrev = false, inputHeight = 100, onSubmit, onPrev, onCancel }) {
  const { question, options, multiSelect, header } = request || {};
  const [selected, setSelected] = useState(multiSelect ? [] : '');
  const [text, setText] = useState('');
  // 折叠态：用户最小化时只显示标题条，主体内容隐藏，不影响查看上方对话
  const [minimized, setMinimized] = useState(false);

  // 问题切换时初始化 state（防止上次选择残留；链式弹窗切题时触发）
  // ★ 优先用 previousAnswer（已答过此题的答案），用于"上一步"切回时回显
  useEffect(() => {
    const pa = previousAnswer || {};
    const savedSelected = Array.isArray(pa.selected) ? pa.selected : [];
    if (multiSelect) {
      setSelected(savedSelected);
    } else {
      // 单选：取数组第一个；没有则空串
      setSelected(savedSelected.length > 0 ? savedSelected[0] : '');
    }
    setText(pa.text || '');
    setMinimized(false);
    // 仅依赖 currentIndex/visible，避免父组件重渲染导致本地答案被覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, visible]);

  const safeOptions = Array.isArray(options) ? options : [];
  const safeQuestion = String(question || '请选择');
  const isLast = currentIndex >= totalCount - 1;

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
          overflow: minimized ? 'hidden' : 'auto',
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
        <Space
          size={8}
          align="center"
          style={{ minWidth: 0, overflow: 'hidden', flex: 1 }}
        >
          {header && (
            <Tag color="blue" style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>
              📋 {header}
            </Tag>
          )}
          {/* v2: 多问题进度指示（仅 totalCount > 1 时显示） */}
          {totalCount > 1 && (
            <Tag color="purple" style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>
              问题 {currentIndex + 1} / {totalCount}
            </Tag>
          )}
          {minimized && (
            <span
              style={{
                color: 'var(--xtsql-text, #1f2937)',
                fontSize: 11,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                minWidth: 0,
              }}
            >
              {safeQuestion}
            </span>
          )}
        </Space>
        <Space size={2} style={{ flexShrink: 0 }}>
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
              fontSize: 12,
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
                    <Checkbox key={i} value={opt} style={{ fontSize: 12 }}>{opt}</Checkbox>
                  ))}
                </Checkbox.Group>
              ) : (
                <Radio.Group
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {safeOptions.map((opt, i) => (
                    <Radio key={i} value={opt} style={{ fontSize: 12 }}>{opt}</Radio>
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
            {/* v3: 多问题 + 非首题时显示「上一步」，让用户能切回修改上题答案 */}
            {canGoPrev && (
              <Button size="small" onClick={() => onPrev && onPrev()}>
                上一步
              </Button>
            )}
            {/* v2: 单问题显示"完成"，多问题非最后一题显示"下一个"，最后一题显示"完成" */}
            <Button type="primary" size="small" onClick={handleSubmit}>
              {isLast ? '完成' : '下一个'}
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

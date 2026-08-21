import { CloseOutlined } from '@ant-design/icons';

/**
 * 可关闭的消息内容组件
 * 配合 messageApi.open({ content: <CloseableMessage ... /> }) 使用
 * 渲染: 文本 + 右侧 X 按钮(点 X 触发 onClose)
 * @param {object} props
 * @param {string|ReactNode} props.text - 提示正文
 * @param {() => void} props.onClose - 点 X 时的回调(由父级调 messageApi.destroy(key))
 */
export default function CloseableMessage({ text, onClose }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span>{text}</span>
      <span
        onClick={onClose}
        role="button"
        aria-label="关闭提示"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose?.(); }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          marginLeft: 8,
          cursor: 'pointer',
          borderRadius: 4,
          color: 'inherit',
          opacity: 0.45,
          pointerEvents: 'auto',
          transition: 'opacity 0.2s, background-color 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.45';
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <CloseOutlined style={{ fontSize: 12 }} />
      </span>
    </span>
  );
}

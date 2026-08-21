import CloseableMessage from '../components/CloseableMessage';

let keySeq = 0;

/**
 * 弹出可手动关闭的成功/信息/警告类消息
 * 与 messageApi.success() 相比,右侧多一个 X 按钮,点击立即关闭
 * 实际渲染委托给 <CloseableMessage /> 组件
 * @param {object} messageApi - AntdApp.useApp() 返回的 message 实例
 * @param {'success'|'info'|'warning'} type - 消息类型
 * @param {string|ReactNode} text - 提示正文
 * @param {number} [duration=3] - 自动消失秒数
 * @returns {string} message key
 */
export function closeableMessage(messageApi, type, text, duration = 3) {
  const key = `xtsql-msg-${++keySeq}`;
  messageApi.open({
    key,
    type,
    duration,
    content: (
      <CloseableMessage
        text={text}
        onClose={() => messageApi.destroy(key)}
      />
    ),
  });
  return key;
}

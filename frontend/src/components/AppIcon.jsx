import React from 'react';
// 用 Vite 的 import 方式：Vite 会把 PNG 打包为 asset，自动处理路径
// 资源放在 src/assets/ 下，确保 Vite dev server 和 Electron 加载本地文件都能正常工作
import icon16  from '../assets/app-icon-16.png';
import icon32  from '../assets/app-icon-32.png';
import icon64  from '../assets/app-icon-64.png';
import icon256 from '../assets/app-icon-256.png';

const ICON_MAP = { 16: icon16, 32: icon32, 64: icon64, 256: icon256 };
const SIZES = [16, 32, 64, 256];

function pickSize(size) {
  // 选择能提供最佳清晰度且 >= size 的源尺寸
  for (const s of SIZES) {
    if (s >= size) return s;
  }
  return SIZES[SIZES.length - 1];
}

// 用 background-image 而非 <img>，配合 background-size: 100% 自然尺寸
// 注意：100% 不放大，PNG 自带的透明 padding 会显示为容器的内边距；
// 之前 120% 是为了"抵消 padding"强行填满，但在 48px 对话框头像里会溢出圆角容器，
// 视觉上反而显得不居中。100% 是更稳的默认值，按需通过 prop 临时放大。
const AppIcon = ({ size = 18, circle = false, className = '', style = {} }) => {
  const srcSize = pickSize(size);
  const radius = circle ? '50%' : '20%';
  return (
    <span
      role="img"
      aria-label="XTSQL Agent"
      className={`xtsql-app-icon ${className}`}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: radius,
        backgroundImage: `url(${ICON_MAP[srcSize]})`,
        backgroundSize: '100%',            // 改为 100% 自然显示，不强行放大
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style,
      }}
    />
  );
};

export default AppIcon;

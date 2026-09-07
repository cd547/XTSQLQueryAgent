import { loader } from '@monaco-editor/react';

const isElectron = window.location.protocol === 'file:';

let monacoPath = '/monaco/vs';
if (isElectron) {
  const path = window.location.pathname;
  const basePath = path.substring(0, path.lastIndexOf('/') + 1);
  monacoPath = basePath + 'monaco/vs';
}

window.MonacoEnvironment = {
  getWorkerUrl: function (moduleId, label) {
    if (label === 'json') {
      return monacoPath + '/language/json/json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return monacoPath + '/language/css/css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return monacoPath + '/language/html/html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return monacoPath + '/language/typescript/ts.worker.js';
    }
    return monacoPath + '/editor/editor.worker.js';
  }
};

loader.config({
  paths: {
    vs: monacoPath
  }
});

/**
 * 全局 Monaco hover 提示框抑制
 *
 * 问题:
 *  Monaco 编辑器在以下场景会弹自己的 HTML 提示框(不是浏览器原生 title):
 *    1. 鼠标悬停在代码上 → 弹函数/变量说明(.monaco-editor-hover / .workbench-hover)
 *    2. 鼠标悬停在 find widget 关闭按钮上 → 弹"Close Find Widget (Escape)"提示(.find-widget .monaco-tooltip)
 *    3. 其他场景(.monaco-hover)
 *  这些提示框会遮挡关闭按钮、影响阅读、用户体验差
 *  涉及 3 个 Monaco 使用点:SqlPanel / SkillDrawer / SessionMessagesModal
 *
 * 修复:
 *  1. 全局 CSS 隐藏 Monaco hover widget(display:none + visibility:hidden 双重保险)
 *  2. 100ms setInterval 兜底(Monaco 会持续创建/销毁 hover widget,CSS 注入到 .find-widget 重新挂载可能延迟)
 *
 * 注意:monacoEnv.js 是顶层 module,Vite HMR 不会重新执行顶层副作用,修改后必须**硬刷浏览器**才生效
 *
 * 范围:所有 Monaco 实例加载前已就绪,3 个组件自动覆盖,零代码侵入
 *      之前 SqlPanel 局部 useEffect + setInterval 可统一用此全局方案替代
 */
function applyMonacoHoverFix() {
  if (document.getElementById('monaco-hover-fix-style')) return;

  // 1. CSS 全局隐藏 Monaco hover widget
  const style = document.createElement('style');
  style.id = 'monaco-hover-fix-style';
  style.textContent = `
    /* 抑制 Monaco 内部所有 hover 提示框(包括 find widget 关闭按钮) */
    .monaco-hover,
    .monaco-editor-hover,
    .workbench-hover,
    .monaco-hover-content,
    .monaco-tooltip,
    .find-widget .monaco-tooltip {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* 去掉关闭按钮的 focus outline,让视觉更干净 */
    .monaco-editor .find-widget .monaco-action-bar .action-item:focus,
    .monaco-editor .find-widget .monaco-action-bar .action-item:focus-visible {
      outline: none !important;
    }
  `;
  document.head.appendChild(style);

  // 2. 100ms setInterval 兜底(覆盖 Monaco 持续创建 hover widget 的场景)
  //     CSS 通常足够,但 Monaco 在某些场景(如 find widget 重新渲染)可能延迟应用
  const hideHoverWidgets = () => {
    // 仅隐藏 Monaco hover widget,不影响页面其他元素
    document
      .querySelectorAll(
        '.monaco-hover:not([style*="display: none"]),' +
        '.monaco-editor-hover:not([style*="display: none"]),' +
        '.workbench-hover:not([style*="display: none"]),' +
        '.monaco-hover-content:not([style*="display: none"]),' +
        '.monaco-tooltip:not([style*="display: none"]),' +
        '.find-widget .monaco-tooltip:not([style*="display: none"])'
      )
      .forEach((w) => {
        w.style.display = 'none';
        w.style.visibility = 'hidden';
      });
  };
  setInterval(hideHoverWidgets, 100);
  // 初始跑一次
  hideHoverWidgets();
}

// 模块顶层副作用:document 已就绪
if (typeof document !== 'undefined') {
  applyMonacoHoverFix();
}

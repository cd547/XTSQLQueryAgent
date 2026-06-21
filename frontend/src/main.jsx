import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import 'antd/dist/reset.css';

// 在 React 挂载前同步读取 localStorage 并应用 dark class，避免页面闪烁
(function preApplyTheme() {
  try {
    if (localStorage.getItem('xtsql_theme') === 'dark') {
      document.documentElement.classList.add('xtsql-dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch { /* localStorage 不可用时忽略 */ }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);


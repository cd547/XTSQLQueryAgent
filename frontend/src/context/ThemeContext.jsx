import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeContext = createContext(null);
const STORAGE_KEY = 'xtsql_theme';

// localStorage 可能在某些环境（隐私模式/异常）抛异常，包一层 try/catch
function readStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* 忽略 */ }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const stored = readStoredTheme();
    return stored === 'dark' ? 'dark' : 'light';
  });

  // 同步主题到 <html> 根节点与 body，方便纯 CSS 选择器统一作用
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('xtsql-dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('xtsql-dark');
      root.removeAttribute('data-theme');
    }
    writeStoredTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setThemeMode = useCallback((mode) => {
    setTheme(mode === 'dark' ? 'dark' : 'light');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // 在 ThemeProvider 之外使用时回退到 light，避免页面崩溃
    return { theme: 'light', toggleTheme: () => {}, setThemeMode: () => {} };
  }
  return ctx;
}

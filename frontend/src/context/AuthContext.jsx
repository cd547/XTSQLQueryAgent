import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getToken, setToken, getStoredUser, setStoredUser, loginApi, registerApi, getMeApi, logoutApi } from '../api/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [bootstrapping, setBootstrapping] = useState(true);
  const [authError, setAuthError] = useState(null);

  // 启动时调一次 /auth/me 校验 cookie 是否有效
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const data = await getMeApi();
        if (!cancelled) {
          setUser(data.user);
          setStoredUser(data.user);
        }
      } catch (e) {
        // 401 / 网络异常都视为未登录
        if (!cancelled) {
          setUser(null);
          setStoredUser(null);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }
    bootstrap();
    return () => { cancelled = true; };
  }, []);

  // 监听 401 触发的事件，强制回到登录页
  useEffect(() => {
    const handler = () => {
      setUser(null);
      setStoredUser(null);
    };
    window.addEventListener('xtsql:auth-expired', handler);
    return () => window.removeEventListener('xtsql:auth-expired', handler);
  }, []);

  const login = useCallback(async (username, password) => {
    setAuthError(null);
    const data = await loginApi({ username, password });
    if (!data || !data.user) {
      throw new Error(data?.error || '登录失败');
    }
    setStoredUser(data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    setAuthError(null);
    const data = await registerApi(payload);
    if (!data || !data.user) {
      throw new Error(data?.error || '注册失败');
    }
    setStoredUser(data.user);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await logoutApi(); } catch (e) { /* 即便服务端失败也要清本地 */ }
    // 把所有可能残留的鉴权信息全部清掉，确保彻底走新流程
    setToken('');
    setStoredUser(null);
    setUser(null);
  }, []);

  const value = {
    user,
    bootstrapping,
    authError,
    isAuthenticated: !!user,
    login,
    register,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  }
  return ctx;
}

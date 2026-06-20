import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getToken, setToken, getStoredUser, setStoredUser, loginApi, registerApi, getMeApi } from '../api/index.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [token, setTokenState] = useState(() => getToken());
  const [bootstrapping, setBootstrapping] = useState(!!getToken());
  const [authError, setAuthError] = useState(null);

  // 启动时如有 token，调一次 /auth/me 校验有效性
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!getToken()) {
        setBootstrapping(false);
        return;
      }
      try {
        const data = await getMeApi();
        if (!cancelled) {
          setUser(data.user);
          setStoredUser(data.user);
          setTokenState(getToken());
        }
      } catch (e) {
        if (!cancelled) {
          // token 无效或后端异常都视为未登录
          setUser(null);
          setToken('');
          setStoredUser(null);
          setTokenState('');
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
      setTokenState('');
    };
    window.addEventListener('xtsql:auth-expired', handler);
    return () => window.removeEventListener('xtsql:auth-expired', handler);
  }, []);

  const login = useCallback(async (username, password) => {
    setAuthError(null);
    const data = await loginApi({ username, password });
    if (!data || !data.token) {
      throw new Error(data?.error || '登录失败');
    }
    setToken(data.token);
    setStoredUser(data.user);
    setTokenState(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    setAuthError(null);
    const data = await registerApi(payload);
    if (!data || !data.token) {
      throw new Error(data?.error || '注册失败');
    }
    setToken(data.token);
    setStoredUser(data.user);
    setTokenState(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setStoredUser(null);
    setUser(null);
    setTokenState('');
  }, []);

  const value = {
    user,
    token,
    bootstrapping,
    authError,
    isAuthenticated: !!user && !!token,
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

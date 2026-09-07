/**
 * useAppConfig Hook
 *
 * 封装应用配置相关的 state + 加载逻辑：
 *  - currentModel: 当前选中的 LLM 模型名（首屏 / 刷新时从后端拉取）
 *  - tokenWarningLevel: token 警告阈值（> 该值触发黄色提示）
 *  - loadCurrentModel: 首次进入 / 手动刷新时调
 *  - loadAgentConfig: 首次进入 / loadSessions 时调
 *  - applyAgentConfig: 已有 config 数据时复用（如 handleViewMessages 用 Promise.allSettled 并行 fetch）
 *
 * 设计决策：
 *  - loadingRef 内化(防重入),App.jsx 不用关心并发请求
 *  - 错误统一 console.debug / 静默(配置加载失败不影响主功能)
 *  - applyAgentConfig + loadAgentConfig 两个 API:
 *    - loadAgentConfig: 触发 fetch(适用于"我需要最新配置"的场景,如首次 / loadSessions)
 *    - applyAgentConfig: 已有 config 数据(适用于"已经在并行 fetch 里拿了 config"的场景,如 handleViewMessages)
 *    避免 handleViewMessages 改成串行失去并行优化
 */
import { useState, useCallback, useRef } from 'react';
import * as api from '../api/index.js';

export function useAppConfig() {
  const [currentModel, setCurrentModel] = useState('');
  const [tokenWarningLevel, setTokenWarningLevel] = useState(30000);
  // 防重入:避免短时间内重复请求 getLlMConfig
  const loadingRef = useRef({ model: false });

  /**
   * 加载当前 LLM 模型
   */
  const loadCurrentModel = useCallback(async () => {
    if (loadingRef.current.model) return;
    loadingRef.current.model = true;
    try {
      const data = await api.getLlMConfig();
      setCurrentModel(data.model || '');
    } catch (e) {
      // 静默失败：配置加载失败不影响主功能
    } finally {
      loadingRef.current.model = false;
    }
  }, []);

  /**
   * 直接应用已有 config 数据(不触发 fetch)
   * 适用于已经在并行 fetch 中拿到 config 的场景
   */
  const applyAgentConfig = useCallback((config) => {
    if (config && config.agent_token_warning_level != null) {
      setTokenWarningLevel(parseInt(config.agent_token_warning_level) || 30000);
    }
  }, []);

  /**
   * 加载 Agent 配置 → 更新 token 警告阈值
   */
  const loadAgentConfig = useCallback(async () => {
    try {
      const data = await api.getAgentConfig();
      applyAgentConfig(data);
    } catch (e) {
      console.debug('获取Agent配置失败:', e.message);
    }
  }, [applyAgentConfig]);

  return {
    currentModel,
    tokenWarningLevel,
    loadCurrentModel,
    loadAgentConfig,
    applyAgentConfig,
  };
}

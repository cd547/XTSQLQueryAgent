import { sqliteUtcToIso } from './formatTime';
import { extractToolName } from './toolName';

/**
 * hydrateLoadedMessages
 *
 * 把后端 /sessions/:id/messages 返回的原始 DB 行，转换成渲染层可直接消费的前端消息对象。
 *
 * 包含 4 个独立子步骤：
 *  1. 过滤 usage 行（不在 UI 渲染）
 *  2. 两遍扫描累积 assistantUsages（v5.19b）：
 *     - 第一遍：按 user 切分 segments + 段内累积 round usage
 *     - 第二遍：每条 assistant 用本段 segmentUsages 算 0..mRound 累积
 *  3. filtered.map：归一化 role / 加 db- id 前缀 / created_at 转 ISO / 抽 toolName
 *  4. 老数据 elapsedMs 回填：相邻 user→assistant 配对，差值作为 elapsedMs
 *
 * 设计决策：
 *   - 纯函数，无副作用，无 setState 调用；调用方拿到 loaded 后自行 setMessages / setFavoriteStates
 *   - 抽离后保留所有 ★ 注释（业务背景、F2/F9/v5.17/v5.18/v5.19 等历史 bug 修复依据）
 *   - 不抽 `data.messages.length === 0` 的早返回分支：调用方在 setMessages 之前还有额外副作用
 *     （setFavoriteStates({})），跟 hydrateLoadedMessages 无关
 *   - 不抽 `loadingRef.current.messagesVersion` 版本号管理：那是 loadMessages 的副作用关注点
 *
 * @param {Array} rawMessages - 后端 messages 表原始行 [{ id, role, content, sql, created_at, round, elapsed_ms, cached_tokens, prompt_tokens, completion_tokens, total_tokens, interrupted, ... }]
 * @returns {Array} loaded - 前端渲染层用的消息对象数组
 */
export function hydrateLoadedMessages(rawMessages) {
  // 步骤 1: 过滤 usage 行（DB 仍写入用于审计/缓存命中率分析，仅 UI 隐藏）
  const filtered = rawMessages.filter(m => m.role !== 'usage');

  // 步骤 2: 两遍扫描累积 assistantUsages
  // ★ v5.19 修复：按"问题边界"分桶 — 每条 assistant 消息只算自己问题段的 round 0..mRound
  //   之前全局 roundUsages + 覆盖式：3 个问题都 round 0 → Q3 覆盖 Q1/Q2 → asst1 显示 Q3 命中率
  //   现在 segmentUsages 在 user 消息时重置，每条 assistant 用自己段的 segmentUsages 累积
  //
  // ★ v5.19b 修复：assistant 消息在 DB 顺序里**在** usage 消息**之前**（流式期间**只**创建一条 assistant，usage 是 LLM 调用结束 yield 追加的）
  //   → 第一遍扫到 assistant 时 segmentUsages 还是空 → assistantUsages[id] = undefined
  //   修法：两遍扫描：① 切分 segments + 段内累积 usage；② 每条 assistant 用本段 segmentUsages 算累积
  // 第一遍：按 user 切分 segments + 段内累积 usage
  const segments = [];
  let currentSeg = { start: 0, end: 0, usages: {} };
  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    if (!m) continue; // 防御：跳过异常/空元素
    if (m.role === 'user' && i > 0) {
      segments.push(currentSeg);
      currentSeg = { start: i, end: i, usages: {} };
    } else if (m.role === 'usage') {
      const r = typeof m.round === 'number' ? m.round : 0;
      if (!currentSeg.usages[r]) {
        currentSeg.usages[r] = { cached: 0, prompt: 0, completion: 0, total: 0 };
      }
      currentSeg.usages[r].cached += m.cached_tokens || 0;
      currentSeg.usages[r].prompt += m.prompt_tokens || 0;
      currentSeg.usages[r].completion += m.completion_tokens || 0;
      currentSeg.usages[r].total += m.total_tokens || 0;
    }
    currentSeg.end = i;
  }
  segments.push(currentSeg);
  // 第二遍：每条 assistant 用本段 segmentUsages 算累积
  const assistantUsages = {};
  for (const seg of segments) {
    for (let i = seg.start; i <= seg.end; i++) {
      const m = rawMessages[i];
      if (!m) continue; // 防御：跳过异常/空元素
      if (m.role === 'assistant') {
        const mRound = typeof m.round === 'number' ? m.round : 0;
        let sumCached = 0, sumPrompt = 0, sumCompletion = 0, sumTotal = 0;
        let hasAny = false;
        // ★ 每轮命中率明细（round → {prompt/completion/total/cached}），供 tooltip 按轮展示
        const rounds = {};
        for (let r = 0; r <= mRound; r++) {
          const u = seg.usages[r];
          if (u) {
            sumCached += u.cached;
            sumPrompt += u.prompt;
            sumCompletion += u.completion;
            sumTotal += u.total;
            hasAny = true;
            rounds[r] = {
              prompt_tokens: u.prompt,
              completion_tokens: u.completion,
              total_tokens: u.total,
              cached_tokens: u.cached,
            };
          }
        }
        if (hasAny) {
          assistantUsages[m.id] = {
            prompt_tokens: sumPrompt,
            completion_tokens: sumCompletion,
            total_tokens: sumTotal,
            cached_tokens: sumCached,
            rounds,
          };
        }
      }
    }
  }

  // 步骤 3: filtered.map → 渲染层消息对象
  // 老数据兜底：没有 elapsed_ms 时按 user/assistant 成对消息的 created_at 差值补算
  // 一次性扫描，按"相邻 user/assistant 配对"得到回显耗时
  // 过滤 checklist 汇总行（content 以 "🔁 已调用:" 开头）
  //   DB 仍写入（用于后续审计 / 缓存命中率分析），仅在历史 UI 中隐藏
  //   旧数据 "🚫 冻结工具清单" 也用同一前缀判断一并隐藏
  const loaded = filtered
    .filter(m => !(m.content || '').startsWith('🔁 已调用:'))
    .map(m => {
      let elapsedMs = m.elapsed_ms || null;
      // 历史 DB 行的 role 是 LLM/tool/tool_return，与流式 SSE 实时态的 'log' role 不同
      // 这里统一归一化为 'log'，否则 groupMessagesByRound 不会把它们当 log 分组
      // → 历史会话回看时无法渲染轮次轴
      const normalizedRole = ['LLM', 'tool', 'tool_return'].includes(m.role) ? 'log' : m.role;
      // ★ v5.17 修复：累积 0..mRound 的所有 round usage（之前只取当前 round）
      //   公式：sum_cached(0..R) / sum_prompt(0..R) * 100
      //   理由：单看当前 round 命中率有失偏颇；多轮对话下整轮累计命中率更能反映 prefix cache 效果
      //   与 SSE 流式 done 事件路径一致（v5.17 同样的累积公式）
      // ★ v5.19：直接查 assistantUsages（按问题边界分桶后的累积结果）
      //   跨段 round 编号不互相影响（之前是全局 map 覆盖 → 同 round 互相覆盖）
      //   asst1 看到的永远是"本问题"内 round 0..mRound 累积，不会被后续问题覆盖
      const usage = normalizedRole === 'assistant' ? assistantUsages[m.id] : undefined;
      return {
        id: `db-${m.id}`,
        role: normalizedRole,
        content: m.content || m.sql || '',
        sql: m.sql || '',
        // ★ 2026-08-21：历史回显的时间来自 SQLite CURRENT_TIMESTAMP（UTC 无时区字符串），
        //   前端 new Date() 会按本地时区错解析（少 8 小时），
        //   此处加 replace(' ','T')+'Z' 显式标记为 UTC ISO 格式，让 ChatMessage 正确显示本地时区
        timestamp: sqliteUtcToIso(m.created_at),
        logType: m.role === 'LLM' ? 'llm' : m.role === 'tool_return' ? 'return' : 'call',
        // ★ 2026-08-17：历史回看抽取 toolName
        //   老数据：m.content 含 "🔧 调用工具: {toolName}\n参数: ..." → regex 抽
        //   新数据：m.content 只含 "参数: ..."（无"🔧 调用工具"行）→ regex 抽不到，toolName=null
        //     历史回看新数据 title 退化为"工具调用"（无工具名），可接受
        //   实时流式不受影响（新数据通过 data.toolName 字段传入，逻辑在 L1000-1015 logMsg 构段）
        // F23 v3: tool_return 也需要抽 toolName（用于隐藏 get_call_history）
        //   tool_return 的 content 格式有 4 种（参考后端 llm.js / responsesApi.js yield）：
        //     ① "📋 工具 {name} 返回: ..."
        //     ② "🚫 拦截重复调用: {name}\n..."
        //     ③ "🚫 {errLabel}: {name}\n..."
        //     ④ "✅ {name} 参数已自动修复..."
        // 统一抽到 utils/toolName.js，App.jsx 与 ChatMessage.jsx 共用
        toolName: extractToolName(m.content, { role: m.role }),
        // 历史回看：所有日志类型（LLM思考 / 工具调用 / 工具返回）默认折叠，
        // 与流式实时态（collapsed: true）保持一致，避免历史消息全展开
        collapsed: ['LLM', 'tool', 'tool_return'].includes(m.role),
        elapsedMs,
        // ★ LLM 工具调用轮次编号（用于历史回显的"轮次轴"展示）
        //   后端 messages 表新增的 round 列，老数据默认 0
        //   老数据（无 round 信息）会全归到 round 0 组里，仍然会显示 round 轴（数字 0）
        //   如果想老数据不显示 round 轴，可加判断：只有 round > 0 时才走 roundGroup
        round: typeof m.round === 'number' ? m.round : 0,
        // ★ 2026-07-29：透传 interrupted 字段，用于渲染"已中断" badge
        //   老数据（无 interrupted 列）默认 0/false，行为兼容
        interrupted: m.interrupted === 1 || m.interrupted === true,
        // ★ v5.17：挂 usage（仅 assistant 消息，0..mRound 累积），用于渲染"缓存命中率" Tooltip
        usage,
      };
    });

  // 步骤 4: 老数据回填 — 相邻 user → assistant 配对，差值作为 elapsedMs
  for (let i = 0; i < loaded.length; i++) {
    if (loaded[i].role === 'assistant' && (loaded[i].elapsedMs == null || loaded[i].elapsedMs === 0)) {
      // 向前找最近的 user 消息
      for (let j = i - 1; j >= 0; j--) {
        if (loaded[j].role === 'user') {
          const u = new Date(loaded[j].timestamp).getTime();
          const a = new Date(loaded[i].timestamp).getTime();
          if (Number.isFinite(u) && Number.isFinite(a) && a > u) {
            loaded[i].elapsedMs = a - u;
          }
          break;
        }
        if (loaded[j].role === 'assistant') break; // 遇到上一轮 assistant 终止
      }
    }
  }

  return loaded;
}

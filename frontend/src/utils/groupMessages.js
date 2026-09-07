/**
 * groupMessagesByRound
 *
 * 把扁平 messages 列表按 round 分组，输出渲染层直接消费的"组"列表。
 *
 * 输出元素有两种类型：
 *   - { type: 'single', msg, userQuestion? }       单条消息（user / assistant / 单条 log）
 *   - { type: 'roundGroup', id, round, logs, userQuestion? }  同一 round 内的多条 log
 *
 * 同时预算好 userQuestion（供"收藏为常用SQL"按钮 / 收藏态显示用）：
 *   - 顺序向前找最近一条 user 消息即为本组的 userQuestion
 *   - 遇到 assistant 时停止（同会话内上一个 assistant 之前属于不同问题）
 *
 * 设计决策：
 *   - 纯函数，无副作用，无闭包依赖；调用方需自行用 useMemo 缓存结果
 *     （流式期间 setMessages 频繁触发 render，useMemo 不可丢）
 *   - 适用场景：流式累积 messages + 历史回看 loaded 都会走
 *
 * @param {Array} messages - 扁平消息数组 [{ id, role, round, content, ... }, ...]
 * @returns {Array} groups - 分组后的渲染层结构
 */
export function groupMessagesByRound(messages) {
  const groups = [];
  let currentRound = null;
  let currentLogs = null;
  let currentRoundId = null;
  let lastUserQ = null;  // 当前 assistant 周期内最近一条 user 提问
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'log') {
      const round = typeof m.round === 'number' ? m.round : 0;
      if (round !== currentRound || currentLogs === null) {
        // 收尾上一轮
        if (currentLogs !== null) {
          groups.push({
            type: 'roundGroup',
            id: currentRoundId,
            round: currentRound,
            logs: currentLogs,
            userQuestion: lastUserQ,
          });
        }
        currentRound = round;
        currentLogs = [m];
        currentRoundId = `rg-${m.id}`;
      } else {
        currentLogs.push(m);
      }
    } else {
      // 收尾上一轮
      if (currentLogs !== null) {
        groups.push({
          type: 'roundGroup',
          id: currentRoundId,
          round: currentRound,
          logs: currentLogs,
          userQuestion: lastUserQ,
        });
        currentLogs = null;
        currentRound = null;
        currentRoundId = null;
      }
      if (m.role === 'user') {
        lastUserQ = m.content;
      } else if (m.role === 'assistant') {
        // 切到下一轮前，lastUserQ 保留（同一 user 问题可能触发多 assistant
        // 但实际架构里 assistant 之后就是新 user 或 done）
      }
      groups.push({ type: 'single', msg: m, userQuestion: lastUserQ });
    }
  }
  // 收尾最后一轮
  if (currentLogs !== null) {
    groups.push({
      type: 'roundGroup',
      id: currentRoundId,
      round: currentRound,
      logs: currentLogs,
      userQuestion: lastUserQ,
    });
  }
  return groups;
}

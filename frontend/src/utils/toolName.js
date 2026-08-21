/**
 * 工具调用名提取工具。
 *
 * 背景：前端要在 log 消息的 title 里展示被调用的工具名（如 "工具调用 validate_sql_fields"），
 *   数据源有 3 类：
 *     ① 后端 SSE yield 的 data.toolName 字段（新数据，实时流式）
 *     ② DB 历史消息的 m.content 字符串（按 m.role 区分 tool / tool_return）
 *     ③ 旧数据 content 里嵌入的格式前缀（regex 兜底）
 *
 * 各角色的 content 格式：
 *   - tool:        "🔧 调用工具: {name}\n参数: ..."
 *   - tool_return: 4 种前缀格式
 *                     ① "📋 工具 {name} 返回: ..."
 *                     ② "🚫 拦截重复调用: {name}\n..."
 *                     ③ "🚫 {errLabel}: {name}\n..."
 *                     ④ "✅ {name} 参数已自动修复..."
 *
 * @param {string} content - 消息 content（SSE 走 data.log，DB 走 m.content）
 * @param {{role: string, preferToolName?: string|null}} options
 *   - role: 消息角色（SSE 走 data.type，DB 走 m.role），仅 'tool' / 'tool_return' 会被处理
 *   - preferToolName: 后端 yield 的 toolName 字段（仅实时 SSE 路径有值，DB 路径为 null/undefined）
 * @returns {string|null} 提取到的工具名，未匹配返回 null
 */
export function extractToolName(content, { role, preferToolName = null } = {}) {
  // 优先用后端 yield 的 toolName 字段（新数据，实时 SSE 路径）
  if (preferToolName) return preferToolName;

  const c = content || '';
  if (role === 'tool') {
    // 工具调用：🔧 调用工具: {name}\n参数: ...
    const match = c.match(/🔧 调用工具:\s*(\S+)/);
    return match ? match[1] : null;
  }
  if (role === 'tool_return') {
    // 工具返回：①/②/③/④ 多种前缀格式，按出现顺序匹配
    let match = c.match(/📋 工具 (\S+) 返回/);
    if (match) return match[1];
    match = c.match(/✅ (\S+) 参数已自动修复/);
    if (match) return match[1];
    match = c.match(/🚫 (?:拦截重复调用:|[^:\n]+:)\s*(\S+)/);
    if (match) return match[1];
    return null;
  }
  return null;
}

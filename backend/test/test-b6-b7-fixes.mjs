// B6/B7 修复验证（2026-09-07）
// 运行：node backend/test/test-b6-b7-fixes.mjs
// B6 实测导出的 withTimeout；B7 因函数未导出，复制实现做逻辑等价验证（与 llm.js 同步维护）

import { withTimeout } from "../src/services/llm.js";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

// ===== B6: signal 注册监听前已 aborted =====
console.log("B6 withTimeout:");
{
  // 场景1：外部 signal 在调用前已 aborted → 返回的 signal 应立即 aborted
  const ext = new AbortController();
  ext.abort(new Error("user stopped"));
  const t = withTimeout(ext.signal, 60_000, "test");
  check("预中止的 signal → 返回 signal 立即 aborted", t.signal.aborted);
  check("预中止的 signal → reason 透传", t.signal.reason?.message === "user stopped");
  t.cancel();
}
{
  // 场景2：正常路径未破坏 —— 调用后外部 abort 仍生效
  const ext = new AbortController();
  const t = withTimeout(ext.signal, 60_000, "test");
  ext.abort(new Error("later stop"));
  check("调用后外部 abort 仍生效", t.signal.aborted && t.signal.reason?.message === "later stop");
  check("isExternalAbort() = true", t.isExternalAbort() === true);
  t.cancel();
}
{
  // 场景3：不传 signal → 仅超时能力，不报错
  const t = withTimeout(null, 60_000, "test");
  check("不传 signal → signal 未 aborted", !t.signal.aborted);
  t.cancel();
}

// ===== B7: sanitizeMessagesForLLM 逻辑等价验证 =====
console.log("B7 sanitizeMessagesForLLM（复制实现）:");
const SYNTHETIC = "[用户中断,工具未完成,调用未返回结果]";
function sanitizeMessagesForLLM(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const sanitized = [];
  let changed = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    sanitized.push(m);
    if (m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const responded = new Set();
      let j = i + 1;
      while (j < messages.length && messages[j]?.role === "tool") {
        sanitized.push(messages[j]);
        if (messages[j].tool_call_id) responded.add(messages[j].tool_call_id);
        j++;
      }
      const unresponded = m.tool_calls.filter((tc) => tc.id && !responded.has(tc.id));
      if (unresponded.length > 0) {
        changed = true;
        for (const tc of unresponded) {
          sanitized.push({ role: "tool", tool_call_id: tc.id, content: SYNTHETIC });
        }
      }
      i = j - 1;
    }
  }
  return changed ? sanitized : messages;
}
const asst = (id, extra = {}) => ({ role: "assistant", tool_calls: [{ id, type: "function", function: { name: "x", arguments: "{}" } }], ...extra });
const tool = (id) => ({ role: "tool", tool_call_id: id, content: "ok" });
const user = (t) => ({ role: "user", content: t });

{
  // 场景1：合法数组 → 原样返回（引用相同）
  const msgs = [user("q1"), asst("t1"), tool("t1")];
  const out = sanitizeMessagesForLLM(msgs);
  check("合法数组 → 返回原引用", out === msgs);
}
{
  // 场景2：单个破损尾部（旧行为场景）→ 补 synthetic
  const msgs = [user("q1"), asst("t1")];
  const out = sanitizeMessagesForLLM(msgs);
  check("破损尾部 → 长度 3", out.length === 3);
  check("破损尾部 → 补 synthetic tool", out[2]?.role === "tool" && out[2]?.tool_call_id === "t1" && out[2]?.content === SYNTHETIC);
}
{
  // 场景3：两处破损（B7 核心）→ 全部补齐
  const msgs = [user("q1"), asst("t1"), user("q2"), asst("t2"), asst("t3")];
  const out = sanitizeMessagesForLLM(msgs);
  const synth = out.filter((m) => m.role === "tool" && m.content === SYNTHETIC).map((m) => m.tool_call_id);
  check("双破损 → 补齐 t1/t2/t3", synth.join() === "t1,t2,t3");
  check("双破损 → 全部消息保留", out.filter((m) => m.role === "user").length === 2);
  // 契约顺序：每个 assistant 的（已有+补齐）tool 响应必须紧随其后、先于下一条非 tool 消息
  let okOrder = true;
  for (let i = 0; i < out.length; i++) {
    if (out[i].role === "assistant" && out[i].tool_calls?.length) {
      const need = new Set(out[i].tool_calls.map((tc) => tc.id));
      for (let j = i + 1; j < out.length && need.size > 0; j++) {
        if (out[j].role === "tool" && need.has(out[j].tool_call_id)) need.delete(out[j].tool_call_id);
        else if (out[j].role !== "tool") { okOrder = false; break; }
      }
      if (need.size > 0) okOrder = false;
    }
  }
  check("双破损 → 每个assistant的tool响应紧随其后（API契约）", okOrder);
}
{
  // 场景4：破损 assistant 之后有 user 消息 → user 保留（旧代码会丢弃）
  const msgs = [user("q1"), asst("t1"), tool("t1"), user("q2")];
  const out = sanitizeMessagesForLLM(msgs);
  check("已有响应+后续user → 原引用返回（无破损）", out === msgs);
}
{
  // 场景5：部分响应 → 只补缺失项，且插在已有响应之后
  const msgs = [asst("t1", { tool_calls: [{ id: "t1" }, { id: "t2" }] }), tool("t1")];
  const out = sanitizeMessagesForLLM(msgs);
  check("部分响应 → 长度 3", out.length === 3);
  check("部分响应 → synthetic 在已有响应后", out[2]?.tool_call_id === "t2");
}
{
  // 场景6：assistant 无 tool_calls 不受影响；空数组安全
  check("空数组 → 原样返回", sanitizeMessagesForLLM([]) .length === 0);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);

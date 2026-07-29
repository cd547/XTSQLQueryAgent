/**
 * 通用 SSE（Server-Sent Events）流式解析器。
 *
 * 修复点（F1）：原 App.jsx 两处 SSE 解析（handleSend / handleExplainAnalyze）存在 3 个 bug：
 *  1. TextDecoder.decode(value) 缺 { stream: true }，
 *     UTF-8 多字节字符（中文）跨 TCP chunk 时被切成 U+FFFD 乱码。
 *  2. text.split('\n') 后无半截行缓冲，SSE 的 `data: {...}` 行跨 chunk 到达时
 *     JSON.parse 必抛 SyntaxError。
 *  3. 异常被 console.warn 静默吞掉——该 chunk 的流式内容永久丢失。
 *
 * 本函数统一处理：
 *  - 始终用 stream:true 增量 decode，避免多字节字符跨 chunk 截断；
 *  - 用 buf 暂存跨 chunk 的半截行（半截行不进 onEvent 回调，也不会被 JSON.parse）；
 *  - 流结束时 flush decoder 残留字节 + 处理 buf 末尾（覆盖"最后一帧无 \n 结尾"场景）；
 *  - 仅对"完整 data: 行"做 JSON.parse，失败时保留 console.warn 报警（用于发现协议变更）。
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader - fetch 响应的 body.getReader()
 * @param {(data: any) => void | Promise<void>} onEvent - 每条解析后的 SSE 事件回调
 * @returns {Promise<void>} 流读取完成时 resolve
 */
export async function readSSEStream(reader, onEvent) {
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  // 单条 data: 行处理：仅对"完整行"做 JSON.parse
  const handleLine = (line) => {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6);
    if (payload.length === 0) return; // SSE 空事件：心跳/分隔行，忽略
    try {
      const data = JSON.parse(payload);
      // 允许 onEvent 返回 Promise；不 await，保持原同步 setState 时序
      Promise.resolve(onEvent(data)).catch((e) => {
        console.warn('SSE onEvent handler error:', e);
      });
    } catch (e) {
      // 半截行已被 buf 拦截，能进 handleLine 的都是完整行；此处报错通常是协议变更
      console.warn('Parse SSE error:', e, 'line=', JSON.stringify(payload.slice(0, 200)));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // 收尾：flush decoder 残留字节（不传 stream 即 { stream: false }），
      // 并处理 buf 最后一段（覆盖"最后一帧无 \n 结尾"场景）
      buf += decoder.decode();
      if (buf.length > 0) {
        handleLine(buf);
        buf = '';
      }
      break;
    }
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    // 最后一截可能是半截行，留在 buf 留给下一 chunk
    buf = lines.pop();
    for (const line of lines) {
      handleLine(line);
    }
  }
}

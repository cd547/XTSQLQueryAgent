/**
 * DeepSeek 视觉模型兼容判断（后端权威版）
 *
 * 文档：https://api-docs.deepseek.com/zh-cn/guides/vision
 * 截至 2026-08-24：仅 deepseek-v4-flash-vision-exp 支持视觉输入
 *
 * 镜像前端 frontend/src/constants/vision.js，修改时必须两边同步。
 * 用途：runSqlAgent / responsesApi 在收到 fileIds 时做权威检查，
 *      非 vision 模型时静默丢弃 fileIds 并 log warn（前端已给 UX 提示，二次确认已放过）。
 */
const VISION_COMPATIBLE = new Set(['deepseek-v4-flash-vision-exp']);

export function isVisionModel(model) {
  return typeof model === 'string' && VISION_COMPATIBLE.has(model.trim());
}

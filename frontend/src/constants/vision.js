/**
 * DeepSeek 视觉模型常量
 *
 * 文档：https://api-docs.deepseek.com/zh-cn/guides/vision
 * 截至 2026-08-24：仅 deepseek-v4-flash-vision-exp 支持视觉输入（file / image_url 块）
 *
 * 设计要点：
 *  - VISION_MODEL: 单一权威模型字符串，与 admin 配置面板可选模型一致
 *  - VISION_COMPATIBLE: Set 形式用于热路径查表（每次 send 都查）
 *  - isVisionModel(): 兼容 null / undefined / 含前后空白的输入
 *
 * 后端镜像：backend/src/services/vision.js 必须与本文件保持 1:1 同步
 * （前端做 UX 提示，后端做权威判断）
 */
export const VISION_MODEL = 'deepseek-v4-flash-vision-exp';

const VISION_COMPATIBLE = new Set([VISION_MODEL]);

export function isVisionModel(model) {
  return typeof model === 'string' && VISION_COMPATIBLE.has(model.trim());
}

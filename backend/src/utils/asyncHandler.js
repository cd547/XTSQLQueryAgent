/**
 * 包装 async Express 路由处理器，自动捕获异常。
 *
 * 背景：Express 4 不自动捕获 async 函数返回的 rejected promise，
 *   Node 15+ 默认 unhandledRejection 会终止进程。
 *   任何 async 路由如果不显式 try/catch 都会触发此问题。
 *
 * 用法：
 *   import asyncHandler from '../utils/asyncHandler';
 *   router.get('/path', asyncHandler(async (req, res) => {
 *     // 不再需要 try/catch
 *   }));
 *
 * 错误传播：捕获的异常会通过 next(err) 传给 Express 错误处理链。
 *   需要在 app.js/index.js 注册 4 参数错误中间件才能生效：
 *     app.use((err, req, res, next) => { ... });
 *
 * @param {(req: any, res: any, next: any) => Promise<any>} fn
 * @returns {(req: any, res: any, next: any) => void}
 */
export default function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

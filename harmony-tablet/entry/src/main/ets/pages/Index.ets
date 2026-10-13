import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const LOG_DOMAIN = 0x0011;
const LOG_TAG = 'XTSQLWeb';

/**
 * XTSQL Query Agent 平板壳（ArkWeb）
 * - 前端打包在 resources/resfile/web/（resfile 原样打包，运行期映射到沙箱路径）
 * - ArkWeb 禁止 resource/file 协议跨域（origin 为 null 会拦截 ES module 与在线请求），
 *   故采用官方方案：onControllerAttached 中 setPathAllowingUniversalAccess 放开
 *   resfile/web 目录的跨域限制，再用 file:// 协议加载（同时允许访问在线后端接口）
 * - javaScriptOnDocumentStart 注入 __XTSQL_TABLET__ 标记，前端 api 层据此启用
 *   "服务器地址可配置 + Bearer 鉴权"旁路分支
 * - onConsole / onErrorReceive 把 WebView 内的 JS 与资源错误转发到 hilog
 */
@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @State injectScripts: Array<ScriptItem> = [
    { script: 'window.__XTSQL_TABLET__ = true;', scriptRules: ['*'] }
  ];

  build() {
    Column() {
      Web({ src: '', controller: this.controller })
        .onControllerAttached(() => {
          const ctx = this.getUIContext().getHostContext();
          if (ctx === undefined) {
            hilog.error(LOG_DOMAIN, LOG_TAG, 'getHostContext failed');
            return;
          }
          const resDir: string = ctx.resourceDir;
          try {
            // 放开 resfile/web 目录的跨域访问限制（本地资源 + 在线接口）
            this.controller.setPathAllowingUniversalAccess([resDir + '/web']);
            this.controller.loadUrl('file://' + resDir + '/web/index.html');
          } catch (error) {
            const err = error as BusinessError;
            hilog.error(LOG_DOMAIN, LOG_TAG, 'loadUrl failed, code=%{public}d msg=%{public}s',
              err.code, err.message);
          }
        })
        .javaScriptOnDocumentStart(this.injectScripts)
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .onConsole((event: OnConsoleEvent): boolean => {
          const msg: ConsoleMessage = event.message;
          hilog.info(LOG_DOMAIN, LOG_TAG, '[H5 lv=%{public}d] %{public}s (line %{public}d, src %{public}s)',
            msg.getMessageLevel(), msg.getMessage(), msg.getLineNumber(), msg.getSourceId());
          return true;
        })
        .onErrorReceive((event) => {
          if (!event) {
            return;
          }
          hilog.error(LOG_DOMAIN, LOG_TAG, '[H5-ERR] resource load failed: %{public}s',
            event.request.getRequestUrl());
        })
        .onPageEnd(() => {
          hilog.info(LOG_DOMAIN, LOG_TAG, 'page loaded: %{public}s', this.controller.getUrl());
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
  }
}

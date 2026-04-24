import { loader } from '@monaco-editor/react';

window.MonacoEnvironment = {
  getWorkerUrl: function (moduleId, label) {
    if (label === 'json') {
      return '/monaco/vs/language/json/json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return '/monaco/vs/language/css/css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return '/monaco/vs/language/html/html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return '/monaco/vs/language/typescript/ts.worker.js';
    }
    return '/monaco/vs/editor/editor.worker.js';
  }
};

loader.config({
  paths: {
    vs: '/monaco/vs'
  }
});
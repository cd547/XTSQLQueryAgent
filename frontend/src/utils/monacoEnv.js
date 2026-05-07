import { loader } from '@monaco-editor/react';

const isElectron = window.location.protocol === 'file:';

let monacoPath = '/monaco/vs';
if (isElectron) {
  const path = window.location.pathname;
  const basePath = path.substring(0, path.lastIndexOf('/') + 1);
  monacoPath = basePath + 'monaco/vs';
}

window.MonacoEnvironment = {
  getWorkerUrl: function (moduleId, label) {
    if (label === 'json') {
      return monacoPath + '/language/json/json.worker.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return monacoPath + '/language/css/css.worker.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return monacoPath + '/language/html/html.worker.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return monacoPath + '/language/typescript/ts.worker.js';
    }
    return monacoPath + '/editor/editor.worker.js';
  }
};

loader.config({
  paths: {
    vs: monacoPath
  }
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// monaco-editor ≥0.56 exports map `monaco-editor/<path>` → `esm/vs/<path>`
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import { App } from './App';
import './styles/global.css';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    // Do not load monaco's ts.worker — it has no filesystem / node_modules and
    // paints false "Cannot find module" on every import. Real diagnostics come
    // from main-process tsserver (see tsserverLanguageService.ts).
    return new editorWorker();
  },
};

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

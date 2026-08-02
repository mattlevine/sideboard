import type * as monacoEditor from 'monaco-editor';

/** Turn off Monaco's in-browser TS worker diagnostics (no disk / node_modules). */
export function disableMonacoTsDiagnostics(monaco: typeof monacoEditor): void {
  const ts = monaco.languages.typescript;
  if (!ts?.typescriptDefaults) return;
  const opts: monacoEditor.languages.typescript.DiagnosticsOptions = {
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  };
  ts.typescriptDefaults.setDiagnosticsOptions(opts);
  ts.javascriptDefaults.setDiagnosticsOptions(opts);
}

/** Clear leftover worker markers on a model. */
export function clearMonacoWorkerMarkers(
  monaco: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
): void {
  monaco.editor.setModelMarkers(model, 'typescript', []);
  monaco.editor.setModelMarkers(model, 'javascript', []);
}

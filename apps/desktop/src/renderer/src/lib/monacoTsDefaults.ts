import type * as monacoEditor from 'monaco-editor';

const MARKER_OWNERS = ['typescript', 'javascript', 'tsserver'] as const;

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

/** Clear diagnostic markers on a model (Monaco worker + tsserver). */
export function clearMonacoWorkerMarkers(
  monaco: typeof monacoEditor,
  model: monacoEditor.editor.ITextModel,
): void {
  for (const owner of MARKER_OWNERS) {
    monaco.editor.setModelMarkers(model, owner, []);
  }
}

/** Clear diagnostics on every open Monaco model. */
export function clearAllMonacoDiagnostics(monaco: typeof monacoEditor): void {
  for (const model of monaco.editor.getModels()) {
    clearMonacoWorkerMarkers(monaco, model);
  }
}

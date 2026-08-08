import { useEffect, useRef } from 'react';
import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { detectLanguage } from '../lib/language';
import {
  clearAllMonacoDiagnostics,
  clearMonacoWorkerMarkers,
  disableMonacoTsDiagnostics,
} from '../lib/monacoTsDefaults';
import { joinWorktreePath, shutdownTsDiagnostics } from '../lib/tsserverLanguageService';
import { PanePreloader } from './PanePreloader';

loader.config({ monaco });
// Disable worker diagnostics before any model is created.
disableMonacoTsDiagnostics(monaco);
// Drop any leftover tsserver session from a previous HMR / session.
void shutdownTsDiagnostics();

interface Props {
  path: string;
  value: string;
  /** Absolute worktree root (reserved; import resolution is currently off). */
  worktreePath?: string;
  className?: string;
  readOnly?: boolean;
  /**
   * Extra URI segment so this editor doesn’t share a Monaco model with another
   * view of the same file (e.g. chat preview vs file tab).
   */
  modelNonce?: string;
  /** CSS height for the Monaco host (default 100%). */
  height?: string | number;
  /** 1-based line to scroll into view (and highlight with highlightEndLine). */
  revealLine?: number;
  /** Inclusive 1-based end line for highlight range (defaults to revealLine). */
  highlightEndLine?: number;
  onChange?: (value: string) => void;
}

export function CodeView({
  path,
  value,
  worktreePath,
  className,
  readOnly = false,
  modelNonce,
  height = '100%',
  revealLine,
  highlightEndLine,
  onChange,
}: Props) {
  const language = detectLanguage(path);
  const absPath =
    worktreePath && path ? joinWorktreePath(worktreePath, path) : path;
  // Unique model URI — never use `#` (Monaco treats it as a URI fragment and
  // drops the nonce, so previews collide / render empty).
  const modelPath = modelNonce
    ? `inmemory://sideboard/${encodeURIComponent(modelNonce)}/${absPath.replace(/^[/\\]+/, '')}`
    : absPath;

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    disableMonacoTsDiagnostics(monaco);
    clearAllMonacoDiagnostics(monaco);
    void shutdownTsDiagnostics();
  }, []);

  const handleBeforeMount: BeforeMount = (monacoApi) => {
    disableMonacoTsDiagnostics(monacoApi);
  };

  const handleMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor;
    disableMonacoTsDiagnostics(monacoApi);
    clearAllMonacoDiagnostics(monacoApi);

    const model = editor.getModel();
    if (model) clearMonacoWorkerMarkers(monacoApi, model);

    // Modal / nested flex hosts often measure 0 on first paint.
    requestAnimationFrame(() => {
      editor.layout();
      if (revealLine != null && revealLine > 0) {
        const start = revealLine;
        const end = Math.max(start, highlightEndLine ?? start);
        editor.revealLineInCenter(start);
        editor.setSelection({
          startLineNumber: start,
          startColumn: 1,
          endLineNumber: end,
          endColumn: 1,
        });
        editor.createDecorationsCollection([
          {
            range: {
              startLineNumber: start,
              startColumn: 1,
              endLineNumber: end,
              endColumn: 1,
            },
            options: {
              isWholeLine: true,
              className: 'code-view-line-highlight',
            },
          },
        ]);
      }
    });
  };

  return (
    <div className={className ?? 'code-view'}>
      <Editor
        path={modelPath}
        language={language}
        value={value}
        height={height}
        theme="vs-dark"
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={(next) => {
          if (next != null) onChange?.(next);
        }}
        loading={<PanePreloader label="Loading editor" />}
        options={{
          readOnly,
          domReadOnly: readOnly,
          wordWrap: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          lineNumbers: 'on',
          renderLineHighlight: readOnly ? 'none' : 'line',
          // Import resolution / diagnostics are intentionally off.
          renderValidationDecorations: 'off',
          folding: true,
          contextmenu: !readOnly,
          automaticLayout: true,
          padding: { top: 8, bottom: 8 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
    </div>
  );
}

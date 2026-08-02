import { useEffect, useRef } from 'react';
import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { detectLanguage } from '../lib/language';
import {
  clearMonacoWorkerMarkers,
  disableMonacoTsDiagnostics,
} from '../lib/monacoTsDefaults';
import {
  closeTsFile,
  initializeTsServer,
  isScriptPath,
  joinWorktreePath,
  openTsFile,
  updateTsFile,
} from '../lib/tsserverLanguageService';

loader.config({ monaco });
// Disable worker diagnostics before any model is created.
disableMonacoTsDiagnostics(monaco);

interface Props {
  path: string;
  value: string;
  /** Absolute worktree root — enables real tsserver import resolution. */
  worktreePath?: string;
  className?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

export function CodeView({
  path,
  value,
  worktreePath,
  className,
  readOnly = false,
  onChange,
}: Props) {
  const language = detectLanguage(path);
  const absPath =
    worktreePath && path ? joinWorktreePath(worktreePath, path) : path;
  const useTs = Boolean(worktreePath && isScriptPath(path));

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monaco | null>(null);
  const openAbsRef = useRef<string | null>(null);

  useEffect(() => {
    if (!useTs || !worktreePath) return;

    let cancelled = false;

    void (async () => {
      const editor = editorRef.current;
      const monacoApi = monacoRef.current;
      if (!editor || !monacoApi) return;

      try {
        await initializeTsServer(monacoApi, worktreePath);
        if (cancelled) return;

        const model = editor.getModel();
        if (!model) return;
        clearMonacoWorkerMarkers(monacoApi, model);

        if (openAbsRef.current && openAbsRef.current !== absPath) {
          await closeTsFile(openAbsRef.current);
        }
        await openTsFile(absPath, model.getValue(), model);
        openAbsRef.current = absPath;
      } catch (err) {
        console.error('[CodeView] tsserver open failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [absPath, useTs, worktreePath]);

  useEffect(() => {
    return () => {
      if (openAbsRef.current) {
        void closeTsFile(openAbsRef.current);
        openAbsRef.current = null;
      }
    };
  }, []);

  const handleBeforeMount: BeforeMount = (monacoApi) => {
    disableMonacoTsDiagnostics(monacoApi);
  };

  const handleMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor;
    monacoRef.current = monacoApi;
    disableMonacoTsDiagnostics(monacoApi);

    const model = editor.getModel();
    if (model) clearMonacoWorkerMarkers(monacoApi, model);

    if (!useTs || !worktreePath) return;

    void (async () => {
      try {
        await initializeTsServer(monacoApi, worktreePath);
        const m = editor.getModel();
        if (!m) return;
        clearMonacoWorkerMarkers(monacoApi, m);
        await openTsFile(absPath, m.getValue(), m);
        openAbsRef.current = absPath;

        editor.onDidChangeModelContent(() => {
          const current = openAbsRef.current;
          if (!current) return;
          void updateTsFile(current, editor.getValue());
        });
      } catch (err) {
        console.error('[CodeView] tsserver init failed:', err);
      }
    })();
  };

  return (
    <div className={className ?? 'code-view'}>
      <Editor
        path={absPath}
        language={language}
        value={value}
        theme="vs-dark"
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        onChange={(next) => {
          if (next != null) onChange?.(next);
        }}
        loading={<div className="empty">Loading editor…</div>}
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

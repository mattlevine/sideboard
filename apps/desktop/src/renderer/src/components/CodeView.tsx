import { useEffect, useRef, useState } from 'react';
import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import * as monaco from 'monaco-editor';
import { normalizeCodeSelection } from '@sideboard/code-ref';
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
  /** When set, selecting code shows “Add reference to chat”. */
  onAddReference?: (sel: { startLine: number; endLine: number; text: string }) => void;
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
  onAddReference,
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onAddReferenceRef = useRef(onAddReference);
  onAddReferenceRef.current = onAddReference;
  const [refAction, setRefAction] = useState<{
    startLine: number;
    endLine: number;
    text: string;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    disableMonacoTsDiagnostics(monaco);
    clearAllMonacoDiagnostics(monaco);
    void shutdownTsDiagnostics();
  }, []);

  useEffect(() => {
    setRefAction(null);
  }, [path]);

  useEffect(() => {
    if (!refAction) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        const editor = editorRef.current;
        const sel = editor?.getSelection();
        if (editor && sel) {
          editor.setPosition({
            lineNumber: sel.positionLineNumber,
            column: sel.positionColumn,
          });
        }
        setRefAction(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refAction]);

  const handleBeforeMount: BeforeMount = (monacoApi) => {
    disableMonacoTsDiagnostics(monacoApi);
  };

  const handleMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor;
    disableMonacoTsDiagnostics(monacoApi);
    clearAllMonacoDiagnostics(monacoApi);

    const model = editor.getModel();
    if (model) clearMonacoWorkerMarkers(monacoApi, model);

    const syncReferenceAction = (show: boolean) => {
      if (!onAddReferenceRef.current) {
        setRefAction(null);
        return;
      }
      const sel = editor.getSelection();
      const current = editor.getModel();
      if (!sel || !current || sel.isEmpty()) {
        setRefAction(null);
        return;
      }
      const range = normalizeCodeSelection(
        sel.startLineNumber,
        sel.startColumn,
        sel.endLineNumber,
        sel.endColumn,
      );
      const text = current.getValueInRange(sel).replace(/\n$/, '');
      if (!range || !text.trim()) {
        setRefAction(null);
        return;
      }
      if (!show) return;
      const pos = editor.getScrolledVisiblePosition({
        lineNumber: sel.positionLineNumber,
        column: sel.positionColumn,
      });
      const host = hostRef.current;
      if (!pos || !host) {
        setRefAction(null);
        return;
      }
      const maxLeft = Math.max(16, host.clientWidth - 16);
      const maxTop = Math.max(16, host.clientHeight - 16);
      setRefAction({
        startLine: range.startLine,
        endLine: range.endLine,
        text,
        top: Math.min(Math.max(8, pos.top + pos.height), maxTop),
        left: Math.min(Math.max(16, pos.left), maxLeft),
      });
    };

    editor.onDidChangeCursorSelection((e) => {
      if (e.selection.isEmpty()) {
        setRefAction(null);
        return;
      }
      if (e.source !== 'mouse' && e.source !== 'api') syncReferenceAction(true);
    });
    editor.onMouseUp(() => syncReferenceAction(true));
    editor.onDidScrollChange(() => syncReferenceAction(true));
    editor.addAction({
      id: 'sideboard.add-reference-to-chat',
      label: 'Add reference to chat',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0.5,
      run: () => {
        const add = onAddReferenceRef.current;
        if (!add) return;
        const sel = editor.getSelection();
        const current = editor.getModel();
        if (!sel || !current || sel.isEmpty()) return;
        const range = normalizeCodeSelection(
          sel.startLineNumber,
          sel.startColumn,
          sel.endLineNumber,
          sel.endColumn,
        );
        const text = current.getValueInRange(sel).replace(/\n$/, '');
        if (!range || !text.trim()) return;
        add({ startLine: range.startLine, endLine: range.endLine, text });
        editor.setPosition({
          lineNumber: sel.positionLineNumber,
          column: sel.positionColumn,
        });
        setRefAction(null);
      },
    });

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

  function addCurrentReference() {
    if (!refAction || !onAddReference) return;
    onAddReference({
      startLine: refAction.startLine,
      endLine: refAction.endLine,
      text: refAction.text,
    });
    const editor = editorRef.current;
    const sel = editor?.getSelection();
    if (editor && sel) {
      editor.setPosition({
        lineNumber: sel.positionLineNumber,
        column: sel.positionColumn,
      });
    }
    setRefAction(null);
  }

  return (
    <div ref={hostRef} className={className ?? 'code-view'}>
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
          contextmenu: !readOnly || Boolean(onAddReference),
          automaticLayout: true,
          padding: { top: 8, bottom: 8 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
      />
      {onAddReference && refAction && (
        <button
          type="button"
          className="code-ref-action"
          style={{ top: refAction.top, left: refAction.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={addCurrentReference}
        >
          Add reference to chat
          <span className="code-ref-action-range">
            {refAction.startLine === refAction.endLine
              ? `L${refAction.startLine}`
              : `L${refAction.startLine}–${refAction.endLine}`}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Renderer client for main-process tsserver — diagnostics / import resolution only.
 */

import type { Monaco } from '@monaco-editor/react';
import type * as monacoEditor from 'monaco-editor';
import { disableMonacoTsDiagnostics } from './monacoTsDefaults';

export { disableMonacoTsDiagnostics } from './monacoTsDefaults';

interface TsServerDiagnostic {
  start?: { line: number; offset: number };
  end?: { line: number; offset: number };
  startLocation?: { line: number; offset: number };
  endLocation?: { line: number; offset: number };
  text?: string;
  message?: string;
  code?: number;
  category?: string | number;
}

interface TsServerMessage {
  type: 'response' | 'event';
  command?: string;
  event?: string;
  request_seq?: number;
  success?: boolean;
  body?: unknown;
  message?: string;
}

const MARKER_OWNER = 'tsserver';
const SCRIPT_EXTS = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i;

let monacoInstance: Monaco | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;
let activeWorktree: string | null = null;

const fileModels = new Map<string, monacoEditor.editor.ITextModel>();
const openFiles = new Set<string>();
const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Accumulate syntax + semantic markers per file until both arrive. */
const pendingMarkers = new Map<
  string,
  { syntax?: monacoEditor.editor.IMarkerData[]; semantic?: monacoEditor.editor.IMarkerData[] }
>();

export function isScriptPath(path: string): boolean {
  return SCRIPT_EXTS.test(path);
}

export function joinWorktreePath(worktreePath: string, relativePath: string): string {
  const root = worktreePath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '');
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}${rel.split('/').join(sep)}`;
}

function normalizeFsPath(p: string): string {
  return p.replace(/^file:\/\//, '').replace(/\\/g, '/');
}

function modelForPath(filePath: string): monacoEditor.editor.ITextModel | undefined {
  const direct = fileModels.get(filePath);
  if (direct) return direct;
  const norm = normalizeFsPath(filePath);
  for (const [key, model] of fileModels) {
    if (normalizeFsPath(key) === norm) return model;
  }
  return undefined;
}

function severityFor(
  monaco: Monaco,
  category: string | number | undefined,
): monacoEditor.MarkerSeverity {
  const s = String(category ?? '').toLowerCase();
  if (s === 'error' || s === '1') return monaco.MarkerSeverity.Error;
  if (s === 'warning' || s === '0') return monaco.MarkerSeverity.Warning;
  if (s === 'suggestion' || s === '2') return monaco.MarkerSeverity.Hint;
  if (s === 'message' || s === '3') return monaco.MarkerSeverity.Info;
  return monaco.MarkerSeverity.Error;
}

function convertDiagnostics(
  monaco: Monaco,
  diagnostics: TsServerDiagnostic[],
): monacoEditor.editor.IMarkerData[] {
  return diagnostics.map((d) => {
    const start = d.start ?? d.startLocation ?? { line: 1, offset: 1 };
    const end = d.end ?? d.endLocation ?? start;
    return {
      severity: severityFor(monaco, d.category),
      message: d.text ?? d.message ?? 'TypeScript error',
      startLineNumber: start.line,
      startColumn: start.offset,
      endLineNumber: end.line,
      endColumn: end.offset,
      code: d.code != null ? String(d.code) : undefined,
    };
  });
}

function applyCombinedMarkers(filePath: string): void {
  if (!monacoInstance) return;
  const model = modelForPath(filePath);
  if (!model) return;
  const key = normalizeFsPath(filePath);
  const pending = pendingMarkers.get(key) ?? pendingMarkers.get(filePath);
  const markers = [...(pending?.syntax ?? []), ...(pending?.semantic ?? [])];
  monacoInstance.editor.setModelMarkers(model, MARKER_OWNER, markers);
}

function handleMessage(message: TsServerMessage): void {
  if (!monacoInstance) return;

  if (message.type === 'event') {
    if (message.event === 'semanticDiag' || message.event === 'syntaxDiag') {
      const body = message.body as
        | { file?: string; diagnostics?: TsServerDiagnostic[] }
        | undefined;
      const filePath = body?.file;
      if (!filePath || !modelForPath(filePath)) return;
      const key = normalizeFsPath(filePath);
      const markers = convertDiagnostics(monacoInstance, body.diagnostics ?? []);
      const pending = pendingMarkers.get(key) ?? {};
      if (message.event === 'syntaxDiag') pending.syntax = markers;
      else pending.semantic = markers;
      pendingMarkers.set(key, pending);
      applyCombinedMarkers(filePath);
    }
    return;
  }

  if (message.type === 'response' && message.success) {
    const diags = Array.isArray(message.body) ? (message.body as TsServerDiagnostic[]) : null;
    if (!diags) return;
    // Sync responses omit file path; apply when a single model is open.
    // Prefer geterr semanticDiag/syntaxDiag events when multiple files are tracked.
    if (fileModels.size !== 1) return;
    const entry = fileModels.entries().next().value as
      | [string, monacoEditor.editor.ITextModel]
      | undefined;
    if (!entry) return;
    const [filePath] = entry;
    const pending = pendingMarkers.get(filePath) ?? {};
    if (message.command === 'syntacticDiagnosticsSync') {
      pending.syntax = convertDiagnostics(monacoInstance, diags);
    }
    if (message.command === 'semanticDiagnosticsSync') {
      pending.semantic = convertDiagnostics(monacoInstance, diags);
    }
    pendingMarkers.set(filePath, pending);
    applyCombinedMarkers(filePath);
  }
}

export async function initializeTsServer(monaco: Monaco, worktreePath?: string): Promise<void> {
  monacoInstance = monaco;
  disableMonacoTsDiagnostics(monaco);

  if (!initPromise) {
    initPromise = (async () => {
      const result = await window.sideboard.tsserver.start(worktreePath);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to start tsserver');
      }
      activeWorktree = worktreePath ?? null;
      unsubscribe = window.sideboard.tsserver.onMessage((msg) => {
        handleMessage(msg as TsServerMessage);
      });
      initialized = true;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }

  await initPromise;

  if (worktreePath && worktreePath !== activeWorktree) {
    const result = await window.sideboard.tsserver.start(worktreePath);
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to restart tsserver for worktree');
    }
    activeWorktree = worktreePath;
  }
}

function scheduleDiagnostics(filePath: string, delayMs = 250): void {
  const prev = diagnosticTimers.get(filePath);
  if (prev) clearTimeout(prev);
  diagnosticTimers.set(
    filePath,
    setTimeout(() => {
      diagnosticTimers.delete(filePath);
      pendingMarkers.delete(filePath);
      void window.sideboard.tsserver.diagnostics(filePath);
    }, delayMs),
  );
}

export async function openTsFile(
  absPath: string,
  content: string,
  model: monacoEditor.editor.ITextModel,
): Promise<void> {
  if (!initialized) return;
  fileModels.set(absPath, model);
  pendingMarkers.delete(absPath);

  if (openFiles.has(absPath)) {
    await window.sideboard.tsserver.updateFile(absPath, content);
  } else {
    const result = await window.sideboard.tsserver.openFile(absPath, content);
    if (!result.success) {
      console.error('[tsserver] openFile failed:', result.error);
      return;
    }
    openFiles.add(absPath);
  }
  // Wait for project load (pnpm + tsconfig extends) before geterr.
  scheduleDiagnostics(absPath, 900);
}

export async function updateTsFile(absPath: string, content: string): Promise<void> {
  if (!initialized || !openFiles.has(absPath)) return;
  await window.sideboard.tsserver.updateFile(absPath, content);
  scheduleDiagnostics(absPath, 300);
}

export async function closeTsFile(absPath: string): Promise<void> {
  const timer = diagnosticTimers.get(absPath);
  if (timer) clearTimeout(timer);
  diagnosticTimers.delete(absPath);
  pendingMarkers.delete(absPath);

  if (monacoInstance) {
    const model = fileModels.get(absPath);
    if (model) monacoInstance.editor.setModelMarkers(model, MARKER_OWNER, []);
  }
  fileModels.delete(absPath);

  if (!openFiles.has(absPath)) return;
  openFiles.delete(absPath);
  await window.sideboard.tsserver.closeFile(absPath);
}

/** Tear down tsserver client + markers. Safe to call when resolution is disabled. */
export async function shutdownTsDiagnostics(): Promise<void> {
  for (const timer of diagnosticTimers.values()) clearTimeout(timer);
  diagnosticTimers.clear();
  pendingMarkers.clear();

  unsubscribe?.();
  unsubscribe = null;
  initPromise = null;
  initialized = false;
  activeWorktree = null;

  if (monacoInstance) {
    for (const model of monacoInstance.editor.getModels()) {
      monacoInstance.editor.setModelMarkers(model, MARKER_OWNER, []);
      monacoInstance.editor.setModelMarkers(model, 'typescript', []);
      monacoInstance.editor.setModelMarkers(model, 'javascript', []);
    }
  }
  fileModels.clear();
  openFiles.clear();

  try {
    await window.sideboard.tsserver.stop();
  } catch {
    // ignore — may not be running
  }
  monacoInstance = null;
}


import type { DragEvent } from 'react';
import {
  getSideboardFileDrag,
  hasSideboardFileDrag,
  SIDEBOARD_FILE_DRAG_MIME,
  type SideboardFileDragPayload,
} from './sideboard-file-drag';

/** Electron historically exposed File.path; prefer webUtils via preload. */
type ElectronFile = File & { path?: string };

export interface ComposerDropSnapshot {
  sideboard: SideboardFileDragPayload | null;
  files: ElectronFile[];
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function canAcceptComposerFileDrop(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  if (hasSideboardFileDrag(dt)) return true;
  if (dt.files?.length) return true;
  return Array.from(dt.types).some(
    (t) => t === 'Files' || t === 'application/x-moz-file' || t === SIDEBOARD_FILE_DRAG_MIME,
  );
}

/**
 * Must run synchronously inside the drop handler — DataTransfer is cleared afterward.
 */
export function snapshotComposerDrop(dt: DataTransfer): ComposerDropSnapshot {
  return {
    sideboard: getSideboardFileDrag(dt),
    files: Array.from(dt.files ?? []) as ElectronFile[],
  };
}

function pathForDroppedFile(file: ElectronFile): string {
  try {
    const fromApi = window.sideboard.getPathForFile?.(file);
    if (typeof fromApi === 'string' && fromApi) return fromApi;
  } catch {
    // ignore
  }
  if (typeof file.path === 'string' && file.path) return file.path;
  return '';
}

export function absolutePathsFromFiles(files: ElectronFile[]): string[] {
  return files.map((f) => pathForDroppedFile(f)).filter(Boolean);
}

/** @deprecated use absolutePathsFromFiles on a snapshot */
export function absolutePathsFromDataTransfer(dt: DataTransfer): string[] {
  return absolutePathsFromFiles(Array.from(dt.files ?? []) as ElectronFile[]);
}

export async function buffersFromFiles(
  files: ElectronFile[],
  opts?: { includePathed?: boolean },
): Promise<Array<{ name: string; dataBase64: string }>> {
  const out: Array<{ name: string; dataBase64: string }> = [];
  for (const file of files) {
    if (!opts?.includePathed && pathForDroppedFile(file)) continue;
    try {
      const buf = await file.arrayBuffer();
      out.push({
        name: file.name || 'file',
        dataBase64: arrayBufferToBase64(buf),
      });
    } catch {
      // skip unreadable entries
    }
  }
  return out;
}

/** @deprecated use buffersFromFiles on a snapshot */
export async function buffersFromDataTransfer(
  dt: DataTransfer,
): Promise<Array<{ name: string; dataBase64: string }>> {
  return buffersFromFiles(Array.from(dt.files ?? []) as ElectronFile[]);
}

/**
 * Resolve OS + Sideboard file-tree drops into attachComposerFiles inputs.
 */
export async function composerDropSourcesFromSnapshot(
  snap: ComposerDropSnapshot,
  fallbackThreadId?: string,
): Promise<{
  absolutePaths: string[];
  relativePaths: string[];
  buffers: Array<{ name: string; dataBase64: string }>;
}> {
  if (snap.sideboard?.paths.length) {
    if (
      snap.sideboard.threadId &&
      fallbackThreadId &&
      snap.sideboard.threadId !== fallbackThreadId
    ) {
      return { absolutePaths: [], relativePaths: [], buffers: [] };
    }
    return {
      absolutePaths: [],
      relativePaths: snap.sideboard.paths,
      buffers: [],
    };
  }
  const absolutePaths = absolutePathsFromFiles(snap.files);
  const buffers =
    absolutePaths.length > 0 ? [] : await buffersFromFiles(snap.files);
  return { absolutePaths, relativePaths: [], buffers };
}

export function preventComposerFileDrag(e: DragEvent): boolean {
  if (!canAcceptComposerFileDrop(e.dataTransfer)) return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

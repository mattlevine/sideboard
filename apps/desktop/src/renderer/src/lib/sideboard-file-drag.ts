/** Drag payload for Sideboard worktree file lists → file manager upload. */

export const SIDEBOARD_FILE_DRAG_MIME = 'application/x-sideboard-paths';

export interface SideboardFileDragPayload {
  paths: string[];
  /** Thread whose worktree contains the relative paths. */
  threadId?: string;
}

export function setSideboardFileDrag(
  dt: DataTransfer,
  paths: string[],
  threadId?: string,
): void {
  const payload: SideboardFileDragPayload = { paths, threadId };
  dt.setData(SIDEBOARD_FILE_DRAG_MIME, JSON.stringify(payload));
  dt.setData('text/plain', paths.join('\n'));
  dt.effectAllowed = 'copy';
}

export function getSideboardFileDrag(dt: DataTransfer): SideboardFileDragPayload | null {
  const raw = dt.getData(SIDEBOARD_FILE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SideboardFileDragPayload;
    if (!parsed || !Array.isArray(parsed.paths) || parsed.paths.length === 0) return null;
    return {
      paths: parsed.paths.filter((p): p is string => typeof p === 'string' && p.length > 0),
      threadId: typeof parsed.threadId === 'string' ? parsed.threadId : undefined,
    };
  } catch {
    return null;
  }
}

export function hasSideboardFileDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(SIDEBOARD_FILE_DRAG_MIME);
}

/** Load a worktree file as a browser File for upload. */
export async function worktreePathToFile(
  threadId: string,
  relativePath: string,
): Promise<File> {
  const result = await window.sideboard.readFileForUpload(threadId, relativePath);
  const filename = relativePath.split('/').filter(Boolean).pop() || 'file';
  const bin = atob(result.contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename);
}

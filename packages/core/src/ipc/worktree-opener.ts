/** Open-worktree cube targets (Finder, Cursor, VS Code, …). */
export type WorktreeOpenerId =
  | 'finder'
  | 'cursor'
  | 'code'
  | 'xcode'
  | 'terminal'
  | 'datagrip';

/** Installed third-party (and Finder) apps the worktree cube can open. */
export interface WorktreeOpener {
  id: WorktreeOpenerId;
  label: string;
  kbd: string;
  /** True when the `.app` bundle was found on disk (icon is then available). */
  installed: boolean;
  /** PNG data URL of the macOS app icon when the bundle was found. */
  iconDataUrl?: string | null;
}

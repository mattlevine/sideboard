import { threadsSharingWorktree } from '../threads/chat-tabs.js';

/**
 * Resolve a thread ref for run_dev_script / list_run_scripts / stop_dev_script.
 * Worktree agents may omit `ref` — cwd is the worktree, so any live chat on that
 * path works (run state is shared across tabs).
 */
export function resolveRunScriptThreadRef(ref?: string | null): string {
  const explicit = ref?.trim();
  if (explicit) return explicit;
  const siblings = threadsSharingWorktree(process.cwd());
  const thread = siblings[0];
  if (!thread) {
    throw new Error(
      'No Sideboard thread for this cwd. Pass ref (thread id), or call from a worktree chat.',
    );
  }
  return thread.id;
}

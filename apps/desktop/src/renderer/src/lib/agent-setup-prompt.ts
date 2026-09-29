/** Prompt sent when the user chooses "Create settings.toml" in the Setup pane. */
export const AGENT_SETUP_PROMPT = `This worktree has no \`.sideboard/settings.toml\` or \`.conductor/settings.toml\`.

Stay in this thread's worktree (your cwd) — do not edit the main repo checkout. Explore the worktree (package manager, monorepo layout, how to install deps, how to run the dev server). Then create \`.sideboard/settings.toml\` in the worktree (preferred; use \`.conductor/settings.toml\` only if the repo already standardizes on Conductor) with:

1. \`[scripts] setup\` — command to install dependencies in a fresh worktree (e.g. pnpm install, npm ci).
2. \`[scripts.run.dev]\` with \`default = true\` — dev server command that respects \`SIDEBOARD_PORT\` / \`CONDUCTOR_PORT\` (e.g. \`PORT=\${SIDEBOARD_PORT:-\${CONDUCTOR_PORT:-3000}} ...\`). For Electron / electron-vite, also set \`preview = "window"\` so agents treat the native window as the app (the port is renderer/HMR only).
3. Optional \`[files-to-copy]\` or \`files.copy\` for env files like \`.env.local\` if the app needs them.

Commit the config in this worktree so it can land to the main branch via Sideboard. After writing the config, tell me what you created and whether Dev (⌘R) should work.`;

/** Prompt when settings.toml exists but has no `[scripts] setup`. */
export const AGENT_ADD_SETUP_PROMPT = `This worktree's settings.toml has no \`[scripts] setup\` command.

Stay in this thread's worktree (your cwd) — do not edit the main repo checkout. Add \`[scripts] setup\` (install deps in a fresh worktree, e.g. pnpm install / npm ci) and, if missing, \`[scripts.run.dev]\` with \`default = true\` that respects \`SIDEBOARD_PORT\` / \`CONDUCTOR_PORT\`. For Electron / electron-vite, also set \`preview = "window"\`. After editing, tell me what you changed and whether Dev (⌘R) should work.`;

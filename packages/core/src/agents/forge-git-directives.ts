/** Worktree prompt when origin is Cursor. GitHub checkouts keep the GitHub auth directive. */
export function formatCursorGitDirective(slug: string | null | undefined): string {
  const repo = slug?.trim() || '<origin-owner/name>';
  return [
    `Git host (Settings → Git → Cursor): this checkout is on Cursor (\`origin.cursor.com\`, \`${repo}\`).`,
    '- Use the `origin` CLI, not `gh`. Where commands overlap, flags follow `gh` (`origin <command> --help`).',
    '- `origin` already authenticates from `CURSOR_AUTH_TOKEN`, then `CURSOR_API_KEY`, then the login stored in Settings → Git → Cursor. Do not read those values, set them, or run `origin auth login` from this turn.',
    '- Push with `git push -u origin HEAD`. If git asks for credentials, tell the user to open Settings → Git → Cursor and choose Configure git (`origin auth setup-git`). Do not wait for a Keychain dialog.',
    '- Origin has no issue tracker. Tickets for this repo come from Linear or AbleTime via `list_issues`. Do not use `gh issue`.',
  ].join('\n');
}

/** Worktree prompt when origin is Entire. Trails replace pull requests. */
export function formatEntireGitDirective(slug: string | null | undefined): string {
  const repo = slug?.trim() || '<origin-owner/name>';
  return [
    `Git host (Settings → Git → Entire): this checkout is on Entire (\`${repo}\`).`,
    '- Use the `entire` CLI, not `gh` or `origin`. Trails replace pull requests and GitHub issues.',
    '- `entire` uses the login from Settings → Git → Entire. Do not read tokens, set `ENTIRE_TOKEN`, or run `entire login` from this turn.',
    '- Push with `git push -u origin HEAD`. If git asks for credentials, tell the user to open Settings → Git → Entire and log in. Do not wait for a Keychain dialog.',
    '- Tickets for this repo are Trails (`entire trail list` / `entire trail show`). Do not use `gh issue`.',
  ].join('\n');
}

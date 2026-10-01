# Security

## Reporting a vulnerability

Please **do not** post a public issue for security reports.

Email [support@sideboard.cloud](mailto:support@sideboard.cloud) privately with:

- Description of the issue
- Steps to reproduce
- Affected versions if known
- Impact assessment (e.g. remote code via MCP, land bypass, credential leak)

We will acknowledge and work on a fix. Please give a reasonable window before public disclosure.

## Design notes

- Landing and purge are intentionally human-gated (no MCP land/purge; no `--yes` on `land` in v1). Orchestrators may tell a worktree agent to merge only when the user explicitly asked.
- Agents run with the permissions of your local user account, on this Mac’s network. Treat inbound remote prompts as untrusted.
- Slack reaches this machine through a hosted relay (message text only). Connect it in Settings → Remote. Repos, secrets, and VPN-only endpoints stay on the Mac.
- Linear / AbleTime (Settings → Issues), GitHub PAT (Settings → Git), and optional Vercel / Supabase / PostHog / Sentry tokens (Settings → Connectors) live in the Mac vault.
- Optional cloud bridges should be enabled only when you intend remote control of this machine. The Mac must stay awake for Slack to reach it.

See [Support](/support/) for non-security help.

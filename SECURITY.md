# Security Policy

## Supported versions

Sideboard is pre-1.0. Security fixes land on `main` and tagged releases when published.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security reports.

Email the maintainers privately (or use GitHub Security Advisories on this repository when enabled) with:

- Description of the issue
- Steps to reproduce
- Affected versions / commit if known
- Impact assessment (e.g. remote code via MCP, land bypass, credential leak)

We will acknowledge and work on a fix. Please give a reasonable window before public disclosure.

## Design notes

- Landing and purge are intentionally human-gated (no MCP `confirm_land` / purge; no `--yes` on `land` in v1).
- Agents run with the permissions of your local user account. Treat inbound remote prompts as untrusted.
- Optional cloud bridges (including Brightsy desktop tasks) should be enabled only when you intend remote control of this machine.

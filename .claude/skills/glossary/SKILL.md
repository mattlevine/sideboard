---
name: glossary
description: >-
  Sideboard product words: project, workspace, chat, agent. Use when naming
  MCP tools, UI copy, coordinator playbooks, or docs. Do not invent thread as
  a product word.
---

# Glossary

Canonical terms: [docs/system/glossary.md](../../../docs/system/glossary.md).

| Say | Means |
|-----|-------|
| **Project** | Registered git repo (`list_projects`) |
| **Workspace** | Isolated checkout for one task/PR (`create_workspace`) |
| **Chat** | One conversation/session (`send_to_chat`) |
| **Agent** | Harness that runs a chat (Claude, Codex, Cursor, OpenCode) |

Git **worktree** is the mechanism under a workspace. Store type `Thread` is a chat record. Do not use **thread** in UI or MCP names.

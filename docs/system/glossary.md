# Glossary

Product words follow [Conductor](https://www.conductor.build/docs/concepts/workspaces-and-branches) (project → workspace → chat/agent) and [Orca](https://www.onorca.dev/docs/model/worktrees) (isolated git checkout per task). Use these names in UI, MCP, CLI, and coordinator playbooks.

| Term | Means | Use for | Not for |
|------|--------|---------|---------|
| **Project** | Registered git repo | Settings → Projects, `list_projects`, `add_project`, `sideboard project` | An isolated checkout |
| **Workspace** | Isolated copy of a project for one task, issue, or PR | Home card, **New workspace**, `create_workspace`, `fork_workspace` | The registered repo |
| **Chat** | One conversation (transcript + session) | Nested tabs, `send_to_chat`, `list_chats`, `get_chat` | The checkout or the harness |
| **Agent** | CLI harness that runs a chat | Settings → Agents, **Add agent**, Claude / Codex / Cursor / OpenCode | The checkout or the conversation |

## How they nest

```
Project (registered repo)
  └── Workspace (git worktree + branch + PR)
        └── Chat (persisted record; store type Thread)
              └── Agent (harness + session)
```

One project has many workspaces. One workspace has many chats (sibling tabs share files, Run, and git identity). One chat has exactly one agent session. **Orchestration** is a chat with no project workspace (synthetic home).

## What each is for

- **New workspace** when the work needs its own files or PR (ticket, PR, named branch, or a fork that must not share dirty files). A ticket/PR/named branch may have only one live workspace — `create_workspace` returns that chat (`alreadyStarted`).
- **Add agent** / `fork_chat` when a second conversation should share the same files (review, second harness, provider switch).
- **Agent** is *which CLI* runs the chat, not the name of the workspace.

## Git vs product

A workspace is implemented as a **git worktree**. Say “worktree” when talking about cwd isolation, `git worktree`, or folder nicknames. Humans click **workspace** (Conductor). Orca’s product word for the same unit is worktree — Sideboard prefers workspace in UI/MCP so “worktree” does not compete with chat.

Cowboy mode uses the project folder on the default branch (no extra worktree). Land is commit+push, not a PR.

## Do not say thread

**Thread** is leftover store/API vocabulary (`Thread` type, `parentThreadId`, `threads/` on disk, placeholder `thread/<team>` branches). It is not a product word. Deep links are `sideboard://chat/<id>` (legacy `sideboard://thread/<id>` still opens).

## MCP names

| Job | Tool |
|-----|------|
| List registered repos | `list_projects` |
| Register / unregister a repo | `add_project` / `remove_project` |
| Create isolated checkout + first chat | `create_workspace` |
| Home Kanban (one card per workspace) | `list_board` |
| List / read chats | `list_chats` / `get_chat` |
| Steer a chat | `send_to_chat` |
| Wait for a turn | `wait_for_turn` / `get_turn_result` |
| Stop / archive / restore a chat | `stop_chat` / `archive_chat` / `restore_chat` |
| New checkout + chat (copy transcript) | `fork_workspace` |
| New chat on the same workspace | `fork_chat` |
| Parent orchestration chat | `parentChatId` (legacy `parentThreadId` still accepted) |
| Schedule target | `chatId` or `chatId=self` (legacy `threadId` still accepted) |

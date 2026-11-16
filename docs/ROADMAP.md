# Sideboard roadmap

Written 2026-11-14 from a review of the peer products and of what this repo ships. Items 2, 6, and 7 are decided, and so is dropping a user-deployed relay (see [Decided](#decided)). The rest is a proposal. Peer-by-peer notes are in [COMPARE.md](COMPARE.md), which this review found out of date (item 3).

Two limits on the evidence:

- **No usage data.** Sideboard has no product telemetry, so nothing here is ranked by what people use. The ranking comes from the peer review and from gaps visible in the repo.
- **No backlog.** GitHub Issues and Linear both returned zero open issues. Nothing below is tracked anywhere yet.

## What the review found

One checkout per task with several agents in parallel is now a default feature. Conductor, Orca, Superset, Emdash, Cursor's Agents Window, the Codex app, and Claude Code all do it.

Three things changed since [COMPARE.md](COMPARE.md) was written:

1. **The labs ship their own phone remote to your machine.** Codex in the ChatGPT mobile app drives Codex on a connected Mac or SSH host. Claude Code Remote Control does the same for a local Claude session, and Projects can run a thread on your computer. Each covers one harness.
2. **Peers got agent-driven orchestration.** Orca has a first-party orchestration CLI (runs, tasks, supervised workers, decision gates). Superset has a CLI, a TypeScript SDK, and a hosted MCP. Conductor's MCP and API still reach cloud workspaces only.
3. **Conductor is inside Meta.** Meta bought it on November 4. A shutdown of Conductor Cloud was announced, then withdrawn on November 13. Conductor says a new interface arrives early next year.

What is still Sideboard's:

- A control plane that is local: stdio MCP and a CLI against this Mac's store, with no vendor account between the coordinator and the fleet.
- One board and one orchestrator across Claude Code, Codex, OpenCode, and Cursor.
- The checkout as the unit. Several chats share one worktree (`fork_chat`), where peers are one agent per checkout.
- The structure column: artifacts, a schema the agent invents rendered as a table or form, and files.
- `attach` / `adopt`, so a session can leave the app.

## Where Sideboard is behind

| Gap | Who has it | What the repo shows |
|-----|------------|---------------------|
| A phone app people can install | Orca (App Store, Android APK), Conductor (iOS), ChatGPT and Claude apps | The site sells the phone app. It has no App Store, TestFlight, or Play link, and the docs start `apps/mobile` from source. `eas.json` has a production profile. |
| A push when an agent needs you | Orca, Codex, Claude | `apps/mobile` has no notification library. **Needs you** shows only while the app is open. |
| Agents keep working with the laptop closed | Orca and Emdash (SSH, your VPS), Codex (Remote SSH), Conductor / Cursor / Claude (their cloud) | Always this Mac. The README sends this user elsewhere. |
| Many harnesses | Orca 27, Emdash 34, Superset "any CLI" | Four coding harnesses plus Brightsy. Each is a hand-written adapter. |
| Work that starts from an event | Conductor Cloud routines (webhook trigger, per a third-party migration guide) | Automations are clock-only. GitHub wakes are information-only. Codex automations are clock-only too. |
| Search across past chats | Orca (transcript search), Conductor (`run_sql`) | Find works inside one chat. Nothing searches across chats. |
| Company controls | Conductor Enterprise (provisioning, security controls) | No audit log and no managed policy. Agents run as the local user. |
| Other platforms | Orca, Emdash (Windows, Linux) | Apple Silicon `dmg` and `zip` only. |

## Now — before the end of the year

These close gaps in things Sideboard already claims.

### 1. Put the phone app in people's hands

The phone is one of three headline claims and the site gives no way to install it.

- Ship iOS through TestFlight, then the App Store. Ship Android as a Play listing or a signed APK.
- Link both from the site's phone section and from Settings → Remote.
- **Done when** a new user pairs a phone without cloning the repo.

### 2. Push notifications on the phone (decided)

The reason to carry the remote is to hear about a blocked agent. Today the phone has to be open.

What exists:

- The Mac already works out **Needs you** and its reason for every chat, and sends that to the phone list.
- The Mac knows when a phone joins and leaves.
- The desktop already notifies on a finished turn and on an error when its window is not focused.

The phone, the Mac, and the relay now have the path below. A phone running an older build still cannot receive a push. The first build that can is a new EAS build of `cloud.sideboard.mobile` with the push entitlement. Expo Go does not count.

How it works:

1. The phone asks for permission, gets a push token, and registers it with the relay for each Mac it has paired.
2. The Mac tells the relay to notify when a chat starts needing you, or a turn the user started finishes or fails.
3. The relay sends the push to that Mac's phones that are not connected.
4. Tapping the alert opens that chat on that Mac.

Rules:

- **No message text in a push.** The alert says which Mac and that a chat needs you. It carries a chat id so the tap can open it, and nothing from the conversation. Apple and Google carry every push, and the relay forwards only ciphertext today.
- A push fires only while the Mac is awake. The connected-phone hold lasts only while the phone is connected, and a locked phone should be assumed to have left. Settings → Advanced → Caffeinate while agents are running is what keeps a turn going. Say so where push is turned on, and test what a locked phone does to the hold.
- Notifications can be turned off per Mac on the phone.

Depends on item 1. A push needs the signed build with the push entitlement.

**Done when** a locked phone shows the alert while the app is closed, and tapping it opens that chat.

### 3. Correct the comparison

[COMPARE.md](COMPARE.md), the README, and the site describe peers as they were.

- Conductor: owned by Meta, and its iOS app now drives local workspaces (experimental, needs a Conductor account). Sideboard's site still describes Conductor's mobile app as part of the paid cloud.
- Orca: it has an orchestration CLI. "Use Sideboard when you want an orchestrator other agents can call" no longer separates the two. The difference is the shared checkout, the cross-harness board, and no IDE.
- Superset: add it. Same shape as Sideboard; its MCP is hosted and needs an org sign-in.
- Add the Codex app and Claude Code Remote Control. Both are single-harness.
- **Done when** every claim about a peer has a source dated this quarter.

### 4. A page for people leaving Conductor

Conductor users spent a week believing the product was ending. `sideboard adopt --from-conductor` already imports workspaces and chat history, and `.conductor/settings.toml` already works.

- One docs page: transfer cloud workspaces to local in Conductor, then run the import.
- Verify the import against the current Conductor build first.
- **Done when** the page exists and the import is tested on Conductor 0.94.

### 5. Forget a Mac on the relay

An account can register 3 Macs. A slot stays taken after a reinstall or a replaced Mac, and the fourth Mac is refused. The relay guide says "There is no forget control yet."

- **Done when** Settings → Remote lists this account's Macs and can remove one.

## Next — first quarter of 2027

### 6. Machines you own (decided)

Sideboard's claim moves from "always this Mac" to "always machines you own." This is the largest gap for the user Sideboard is built for. A fleet on a corporate VPN should not need a rented sandbox to survive a closed lid. It needs another machine on that network.

What exists:

- `sideboard serve` runs a host with no window. One process hosts a machine at a time.
- The phone is already a full client of a host. Over the relay it lists and creates workspaces, streams chats, answers permissions and questions, opens files and changes, and runs the git buttons. It already lists several Macs.

What is missing:

- The desktop can only show its own store. It cannot open another host.
- `packages/core` assumes macOS: the vault key is in the Keychain, and staying awake is `caffeinate`.

Steps:

1. **Desktop as a client of another Mac.** The board and sidebar list workspaces from a second Mac running `sideboard serve`, labelled by host, and can create, steer, and review them. The phone's protocol is the starting point.
2. **Linux host.** `sideboard serve` on a devbox. Needs a vault key store and a keep-awake path that are not macOS-only.

Rules that carry over:

- Land and purge stay human-only on every host.
- Repos, secrets, and agent processes stay on the host that owns them. The relay still forwards ciphertext.
- A host is a machine the user controls. Sideboard does not rent or provision one.

The README, the site, [COMPARE.md](COMPARE.md), and [safety.md](system/safety.md) say "this Mac" throughout. They change in the release that ships step 1, not before.

**Done when** a laptop can close while a Mac mini's agents keep working, and both the phone and a reopened laptop show that work.

### 7. Agent Client Protocol adapter (decided)

Peers list dozens of agents. Sideboard adds each by hand, and has four coding harnesses.

- Add one adapter that speaks the Agent Client Protocol. Gemini CLI, GitHub Copilot CLI, Cursor's CLI, Grok, Amp, Kiro, and about forty others implement it.
- It is a runner, like `claude-runner.ts` and `cursor-runner.ts`: it takes a turn request on stdin, runs the harness as a subprocess, and prints events as lines. `AgentAdapter.buildTurn` and `parseEvent` stay as they are.
- The runner hands the Sideboard MCP server to the harness when it opens the session, so an ACP harness gets the board, `ask_user`, and orchestration tools.
- `AgentKind` gains one kind. Which harness it launches is a setting, with a short built-in list to start.
- The hand-written adapters stay first-class and keep `attach`, plan usage meters, and their own session resume.
- An ACP harness resumes a session only when it reports that it can load one. For a harness that cannot, the runner either stays alive between turns or replays the transcript. That choice is open and is the first design question.
- `attach` is hidden for an ACP harness. It ships without it.

**Done when** Gemini CLI and Copilot CLI each run a worktree turn, appear on the board, and can be a child of an orchestration chat.

### 8. Automations that start from an event

- Triggers from sources Sideboard already reads: a ticket assigned to me, a review requested, a check that starts failing, a new Sentry issue.
- Polled from this Mac. No inbound webhook, so it works behind the VPN.
- The human-only rules hold. A trigger can start a workspace or queue a prompt. It cannot merge.
- **Done when** "when a ticket is assigned to me, open a workspace and plan it" runs unattended.

### 9. Search across chats

- Full-text search over stored transcripts, in the desktop and on the phone.
- A `search_chats` MCP tool, so the orchestrator can find how a problem was solved last time.
- **Done when** a phrase from an archived chat finds that chat.

### 10. Plans that know when a step is done

Orca's tasks carry status and gates. Sideboard's plans carry dependencies.

- A plan step names its check: CI green, a test command passes, or a review tab approves.
- A spend limit per orchestration chat. Token counts are already recorded per chat.
- `list_peers` / `send_to_peer`, already listed as a follow-up in [agent-orchestration.md](system/agent-orchestration.md).
- A step can require review by a different harness than the one that wrote the change. The Review tab already opens a second chat on the same checkout.
- **Done when** `execute_plan` stops at a failed check and reports the reason.

## Later

- **A fleet endpoint for callers off this machine.** The A2A Agent Card that [agent-orchestration.md](system/agent-orchestration.md) defers. Build it when an outside orchestrator needs to delegate onto this Mac.
- **Company controls.** A managed settings file (allowed harnesses, cowboy mode off) and a local audit log of agent git actions.
- **Workspaces that span repos.** Orca's folder workspaces cover this.
- **A shared team board.** Read-only, through Sideboard's relay. Explore only after item 6.
- **Intel Macs.**

## Not building

- **An IDE.** No embedded browser, design mode, computer use, or mobile emulator. Orca and Cursor own that, and `attach` plus URL preview cover the need.
- **Rented cloud sandboxes.** Item 6 is the answer to a closed laptop.
- **A Sideboard agent or model.** Agents stay plugs.
- **A Windows or Linux desktop app** before the Linux host in item 6 exists.
- **A hosted control plane that requires an account.** The local stdio MCP is the difference from Superset and Conductor. The phone relay is the one hosted piece, and it only forwards ciphertext.
- **YAML pipelines.** Recurring method stays a committed skill.

## Decided

2026-11-14:

- **Machines you own.** Sideboard moves from "always this Mac" to "always machines you own." Item 6.
- **Agent Client Protocol.** Sideboard adds the adapter. Item 7. An ACP harness ships without `attach`.
- **Push notifications on the phone.** Item 2. No message text in a push. Push goes through Sideboard's relay only.

## Open decisions

1. **How to learn what is used.** Opt-in anonymous counts, or interviews. Without one, the next roadmap has the same blind spot.
2. **Where this is tracked.** Items 1–5 are small enough to file as issues now.
3. **Which of items 6 and 7 goes first.** They do not depend on each other. Item 7 is the smaller change.

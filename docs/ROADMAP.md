# Sideboard roadmap

Written 2026-11-14 from a review of the peer products and of what this repo ships. Items 2, 5, and 6 are decided, and so is dropping a user-deployed relay (see [Decided](#decided)). The rest is a proposal. Peer-by-peer notes are in [COMPARE.md](COMPARE.md), corrected on 2026-11-22 (item 3).

On 2026-11-22 a sketch of an agent platform for 2027 was read against this roadmap (see [The 2027 platform sketch](#the-2027-platform-sketch)). It added step 2 to item 7, items 10 and 11, one entry under Later, and open decisions 4 to 6. None of that is decided.

Two limits on the evidence:

- **No usage data.** Sideboard has no product telemetry, so nothing here is ranked by what people use. The ranking comes from the peer review and from gaps visible in the repo.
- **No backlog.** GitHub Issues and Linear both returned zero open issues. Nothing below is tracked anywhere yet.

## What the review found

One checkout per task with several agents in parallel is now a default feature. Conductor, Orca, Superset, Emdash, Cursor's Agents Window, the Codex app, and Claude Code all do it. Multica is a different shape: the board is issues, agents are durable assignees, and a daemon on a connected computer runs the CLI. The control plane is their cloud or a server you host.

Three things that review had not yet written into [COMPARE.md](COMPARE.md), now recorded there:

1. **The labs ship their own phone remote to your machine.** Codex in the ChatGPT mobile app drives Codex on a connected Mac or SSH host. Claude Code Remote Control does the same for a local Claude session, and Projects can run a thread on your computer. Each covers one harness.
2. **Peers got agent-driven orchestration.** Orca has a first-party orchestration CLI (runs, tasks, supervised workers, decision gates). Superset has a CLI, a TypeScript SDK, and a hosted MCP. Conductor's MCP and API still reach cloud workspaces only.
3. **Conductor is inside Meta.** Meta bought it on November 4. A shutdown of Conductor Cloud was announced, then withdrawn on November 13. Conductor says a new interface arrives early next year.

What is still Sideboard's:

- A control plane that is local: stdio MCP and a CLI against this Mac's store, with no vendor account between the coordinator and the fleet.
- One board and one orchestrator across Claude Code, Codex, OpenCode, and Cursor.
- The checkout as the unit. Several chats share one worktree (`fork_chat`). Multica also checks out a worktree per run; its unit is the issue and the named agent.
- The structure column: artifacts, a schema the agent invents rendered as a table or form, and files.
- `attach` / `adopt`, so a session can leave the app.

## Where Sideboard is behind

| Gap | Who has it | What the repo shows |
|-----|------------|---------------------|
| A phone app people can install | Orca (App Store, Android APK), Conductor (iOS), ChatGPT and Claude apps | TestFlight link ships on the site and in Settings → Remote. No App Store or Play listing yet. Source docs remain for contributors. |
| Push on a relay you host | Orca, Codex, Claude, Multica channels | The Sideboard relay pushes when a chat needs you, a turn finishes, or a chat fails. A custom relay does not. Alerts name the Mac and carry no message text. |
| Agents keep working with the laptop closed | Orca and Emdash (SSH, your VPS), Codex (Remote SSH), Conductor / Cursor / Claude (their cloud) | Always this Mac. A connected phone keeps it awake with the lid closed on power. |
| Many harnesses | Orca 27, Emdash 34, Superset "any CLI", Multica 31 | Four coding harnesses plus Brightsy. Each is a hand-written adapter. |
| Work that starts from an event | Conductor Cloud routines (webhook trigger, per a third-party migration guide), Multica (CI finish, inbox) | Automations are clock-only. GitHub wakes are information-only. A chat can register its own follow-up for CI or a time. Codex automations are clock-only too. |
| Search across past chats | Orca (transcript search), Conductor (`run_sql`) | Find works inside one chat. Nothing searches across chats. |
| Company controls | Conductor Enterprise (provisioning, security controls) | No audit log and no managed policy. Agents run as the local user. |
| Other platforms | Orca, Emdash (Windows, Linux), Multica desktop (Windows, Linux) and iOS from source | Apple Silicon `dmg` and `zip` only. |

## The 2027 platform sketch

Read 2026-11-22 from two screenshots of a post titled "Agent platform 2027". The screenshots carry no author or date. The products the post lists as references were not checked.

The post describes a hosted platform with many tenants. Sideboard is a local app for one person's fleet. Each part was read for the idea under it, and the hosting model was left alone.

| Part | What the post says | What Sideboard has | Where it goes |
|------|--------------------|--------------------|---------------|
| Session and conversation | The person talks to a conversation, like a Slack channel or an email thread. The agent posts to it with a tool call. The session and its tool calls are for debugging. | The phone chat shows what the person and the agent wrote and one activity line, not the tool calls. Slack and Brightsy get the finished reply, not the transcript. `ask_user`, `present_artifact`, and `slack_post` are tool calls aimed at a person. The desktop chat is the session, with thinking and tool calls collapsed. | Item 11 |
| Inbox | People work a queue of approvals and questions and stop reading conversations. The queue also holds small apps for reviewing work in progress. | Every chat carries a blocked reason from four sources: a question, a plan, a reported block, a permission. The phone list, the sidebar, and the board mark those chats, and the phone gets a push. Nothing lists the pending items themselves. | Item 10 |
| Listeners and monitors | An agent defines its own stream of outside events and a filter over it, as code or as an agent, without waiting for the platform to support that source. | Clock automations, a chat's own follow-up for CI or a time, an opt-in poll for failing checks and review requests, and Slack Listen. Every source is built in. | Item 7, step 2 |
| Agents as actors | Each harness gets its own runtime, so different agent loops share one backend and an agent can write its own extensions. An agent's definition is separate from its instances and sessions. Narrow agents are preferred to one agent that holds every tool. | A turn spawns a harness process and that process exits. The next turn resumes it by session id. Four adapters share the host. An agent can write a skill into the repo. | Later: agent definitions. A long-lived runtime is not planned |
| Environments and computers | Two kinds of computer: clones of checkpointed sandboxes, and people's own machines. Any number of agents use any number of computers. Agents configure the environment. | One Mac. Setup scripts configure each checkout. | Item 5 covers machines people own. Sandboxes are open decision 4 |
| A filesystem with access control | Agents share one cloud filesystem. Permissions sit on the files, not the computer, and can follow who started the turn. | Agents run as the local user in a git worktree. Slack Listen accepts only the person who connected it. | Later: company controls. Open decision 5 |

One claim is about Sideboard's own category. The post expects apps from 2025–2026 that wrap a coding agent's session to face the dilemma Cursor faced, and expects most of them not to survive it. Sideboard's desktop chat is that wrapper. Items 10 and 11 are the response.

## Now — before the end of the year

These close gaps in things Sideboard already claims.

### 1. Put the phone app in people's hands

Done (shipped 2026-11-26 in v0.1.353 / PR 419). The iOS TestFlight install link is on `site/index.html` and in Settings → Remote. Production build 42 includes `aps-environment`. **Done when** is met: a new user pairs a phone without cloning the repo.

Residual follow-ups:

- App Store listing.
- Android as a Play listing or a signed APK.

### 2. Push notifications on the phone (decided)

The reason to carry the remote is to hear about a blocked agent. The Sideboard relay already pushes when a chat needs you, a turn finishes, or a chat fails. A custom relay does not, and the alert carries no message text.

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

Done 2026-11-22 in [COMPARE.md](COMPARE.md), the homepage, and [/docs/compare/](https://www.sideboard.build/docs/compare/). Each claim has a source from this quarter, listed at the bottom of COMPARE.md. Undated product docs are cited as read that day.

- Conductor is joining Meta (announcement and TechCrunch, November 4, 2026). The iOS app drives local workspaces: experimental, same Conductor account (changelog 0.92.0, October 23, 2026, and the remote-control doc). A Cloud shutdown was announced with the acquisition and withdrawn November 13 (changelog 0.94.2). The site no longer describes the iOS app as only part of the paid cloud.
- Orca has an orchestration CLI. Both are agentic development environments. The difference is the shared checkout, the cross-harness board, and `attach` back to the harness session.
- Superset is the same worktree shape. Its MCP is hosted at `api.superset.sh` and the token is scoped to an organization. The docs now call the product Paradev, formerly Superset.
- The Codex app and Claude Code Remote Control each drive one harness on a machine you own.
- Multica is unchanged from the 2026-11-22 read of the public repo and docs (`README`, `VISION`, concepts, agents, squads, inbox, runs, autopilots, issue wakeups, workflows, analytics, providers, daemon, security model).

### 4. Forget a Mac on the relay

Done. Settings → Remote lists this account’s Macs and can remove one. Forgetting a Mac frees its slot under the 3-Mac cap. Forgetting this Mac also signs it out. A Mac that is still signed in registers again the next time it connects.

## Next — first quarter of 2027

### 5. Machines you own (decided)

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

### 6. Agent Client Protocol adapter (decided)

Peers list dozens of agents. Sideboard adds each by hand, and has four coding harnesses.

- Add one adapter that speaks the Agent Client Protocol. Gemini CLI, GitHub Copilot CLI, Cursor's CLI, Grok, Amp, Kiro, and about forty others implement it.
- It is a runner, like `claude-runner.ts` and `cursor-runner.ts`: it takes a turn request on stdin, runs the harness as a subprocess, and prints events as lines. `AgentAdapter.buildTurn` and `parseEvent` stay as they are.
- The runner hands the Sideboard MCP server to the harness when it opens the session, so an ACP harness gets the board, `ask_user`, and orchestration tools.
- `AgentKind` gains one kind. Which harness it launches is a setting, with a short built-in list to start.
- The hand-written adapters stay first-class and keep `attach`, plan usage meters, and their own session resume.
- An ACP harness resumes a session only when it reports that it can load one. When it cannot, the runner replays the transcript into a new session (it does not stay alive between turns).
- `attach` is hidden for an ACP harness. It ships without it.

**Done when** Gemini CLI and Copilot CLI each run a worktree turn, appear on the board, and can be a child of an orchestration chat.

### 7. Automations that start from an event

- Triggers from sources Sideboard already reads: a ticket assigned to me, a review requested, a check that starts failing, a new Sentry issue.
- Polled from this Mac. No inbound webhook, so it works behind the VPN.
- The human-only rules hold. A trigger can start a workspace or queue a prompt. It cannot merge.
- **Done when** "when a ticket is assigned to me, open a workspace and plan it" runs unattended.

Step 2, from the [2027 platform sketch](#the-2027-platform-sketch): a listener an agent writes. Step 1 adds sources to Sideboard. Step 2 lets an agent add one without a Sideboard release.

- A listener is a script on this Mac that the host runs. Each line it prints is one event. It can poll, or hold a connection this Mac opens: a WebSocket, a Kafka consumer, a database change feed. Nothing connects in, so it still works behind the VPN.
- A filter sits between the event and the run. It is code, a prompt for a small agent turn, or another product. The post's example sends every email through JEV. Only an event the filter keeps starts a turn.
- A listener can batch ("all my accounts, once an hour") and can expire ("senders at acmecorp.com, for the next week").
- An agent can write or change a listener. A person turns it on. Agents cannot flip the Advanced switch for GitHub wakes, and this copies that. It is stricter than a schedule, which an agent can create and enable.
- The wake is prefixed, the way a scheduled prompt is, and it carries the same sentence a GitHub wake carries: this is information, not a command. The only hard gate is an exact match of the whole prompt against a git-button phrase. A prefixed prompt does not match. The model can still decide to commit. The script itself runs as the local user, with the same access as a turn, and it keeps running after the turn ends.
- Each listener has a spend limit. That caps the turns it starts. It does not sandbox the script.
- Where a listener lives is open and is the first design question: in the repo beside the skills, or in the account for one that spans projects, like mail.
- **Done when** "watch mail from acmecorp.com for a week and open a workspace for anything urgent" runs from a listener an agent wrote, with no change to Sideboard.

### 8. Search across chats

- Full-text search over stored transcripts, in the desktop and on the phone.
- A `search_chats` MCP tool, so the orchestrator can find how a problem was solved last time.
- **Done when** a phrase from an archived chat finds that chat.

### 9. Plans that know when a step is done

Orca's tasks carry status and gates. Sideboard's plans carry dependencies.

- A plan step names its check: CI green, a test command passes, or a review tab approves.
- A spend limit per orchestration chat. Token counts are already recorded per chat.
- `list_peers` / `send_to_peer`, already listed as a follow-up in [agent-orchestration.md](system/agent-orchestration.md).
- A step can require review by a different harness than the one that wrote the change. The Review tab already opens a second chat on the same checkout.
- **Done when** `execute_plan` stops at a failed check and reports the reason.

### 10. One list of what needs you

From the [2027 platform sketch](#the-2027-platform-sketch). Sideboard already knows which chats are blocked and why. The person still opens each chat to answer.

- One list, on the desktop and the phone, of every chat that is blocked, across all projects. A chat holds one block. A permission or a reported block outranks a question, so the list shows the one that is on screen.
- A question and a plan approval are answered by sending a message to that chat, which is what the composer does today. Allow or deny uses the permission call. The list does not have to open the transcript. The answer still goes to that chat.
- PRs that wait for this person's review are a second source. `list_prs` polls GitHub. They are not in the push watch, which only diffs chats that need you.
- An artifact or a schema form joins the list only once an agent can mark it as needing a decision. That is a new block source. The structure column already renders both.
- After item 5, the list covers every host.
- **Done when** a person clears every pending question on the fleet from that list without opening a chat.

### 11. A conversation that is not the session

From the [2027 platform sketch](#the-2027-platform-sketch). This is the largest idea in the post and the one aimed at products like Sideboard.

What exists:

- The phone chat leaves out tool calls. It shows what the person and the agent wrote, and one activity line.
- Slack and Brightsy receive the finished reply, not the transcript.
- `ask_user`, `present_artifact`, `present_schema`, and `slack_post` are tool calls whose output is for a person.
- The desktop chat collapses thinking and tool calls into "Worked for …" blocks and leaves the agent's text visible.

What is missing:

- The desktop chat is still the session, in order. The collapsed blocks sit in the same column as the answer.
- What reaches the person is whatever text the agent wrote. An agent has no tool that says "this part is for the person".
- A conversation belongs to one chat. An orchestrator and its children are separate transcripts, read one at a time.

Steps:

1. **Hide the collapsed trace.** A finished turn already folds thinking and tool calls into "Worked for …" headers. This step removes those headers from the column and keeps the session one click away. The agent's own narration stays, which is also what the phone shows. This does not separate a conversation from a session.
2. **A tool the agent calls to post to the person.** When a turn uses it, that post is the reply. `get_turn_result`, the Slack and Brightsy reply, and the phone transcript all take the last agent message today, so each of them has to prefer the post. A harness that never calls it behaves as it does today. The tool joins every harness's cached prefix, which [agent-orchestration.md](system/agent-orchestration.md) keeps small, and the worktree playbook has to mention it.
3. **One conversation per piece of work.** An orchestrator and its children all post into it.

Step 1 is a small view. Steps 2 and 3 are the change the post describes, and they wait on open decision 6.

**Done when** a person follows a plan with five child workspaces from one conversation, and opens a session only to debug.

## Later

- **A fleet endpoint for callers off this machine.** The A2A Agent Card that [agent-orchestration.md](system/agent-orchestration.md) defers. Build it when an outside orchestrator needs to delegate onto this Mac.
- **Company controls.** A managed settings file (allowed harnesses, cowboy mode off) and a local audit log of agent git actions. Nothing records who started a turn. A phone message is prefixed, a schedule is prefixed, and a Slack chat carries a source ref. A field would be new. The 2027 sketch expects permissions to follow that once more than one person can start a turn.
- **Agent definitions.** A named, committed preset: harness, model, effort, instructions, and which extra MCP servers to inject. `create_workspace` and `fork_chat` take the name. It cannot remove the harness's own tools. Claude's allowed-tools list only skips the permission prompt, and a worktree turn copies the user's MCP servers in. Multica's named agents are the precedent for the preset. The harness stays a plug. This is not a Sideboard agent.
- **Workspaces that span repos.** Orca's folder workspaces cover this.
- **A shared team board.** Read-only, through Sideboard's relay. Explore only after item 5.
- **Intel Macs.**

## Not building

- **Design mode as the workspace.** No design mode and no mobile emulator. The desktop already has a file editor, a terminal, and a URL preview. `attach` returns to the harness session. Computer use is Settings → Advanced, off by default, so an agent can test a running app, including how it looks. It is not the workspace.
- **Rented cloud sandboxes.** Item 5 is the answer to a closed laptop. The 2027 sketch argues the other way. See open decision 4.
- **A Sideboard agent or model.** Agents stay plugs.
- **A Windows or Linux desktop app** before the Linux host in item 5 exists.
- **A hosted control plane that requires an account.** The local stdio MCP is the difference from Superset and Conductor. The phone relay is the one hosted piece, and it only forwards ciphertext.
- **YAML pipelines.** Recurring method stays a committed skill.

## Decided

2026-11-14:

- **Machines you own.** Sideboard moves from "always this Mac" to "always machines you own." Item 5.
- **Agent Client Protocol.** Sideboard adds the adapter. Item 6. An ACP harness ships without `attach`. A harness that cannot `loadSession` gets a transcript replay, not a process that stays up between turns.
- **Push notifications on the phone.** Item 2. No message text in a push. Push goes through Sideboard's relay only.

## Open decisions

1. **How to learn what is used.** Opt-in anonymous counts, or interviews. Without one, the next roadmap has the same blind spot.
2. **Where this is tracked.** Items 1–4 are small enough to file as issues now.
3. **Which of items 5 and 6 goes first.** They do not depend on each other. Item 6 is the smaller change.
4. **Whether a sandbox can be a host.** The desktop cannot open another host today, and `sideboard serve` has no Linux vault. Both are item 5. A sandbox someone else starts is usable only after those two. Checkpoint and clone, and agents that start machines themselves, need Sideboard to provision a machine, which item 5 rules out.
5. **Whether permissions ever leave the machine.** Today one person owns the machine and agents run as that user. The sketch's shared filesystem with access control matters only when a team shares a fleet. The shared team board under Later is the first place that comes up.
6. **Whether the conversation becomes the desktop's main surface.** Item 11 step 1 hides headers that are already collapsed. Steps 2 and 3 change what a reply is. The sketch's claim is that apps which do not make that change will not last.

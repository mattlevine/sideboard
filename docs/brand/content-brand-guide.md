# Sideboard content brand guide for rewriting sideboard.build

**Audience of this guide:** an AI agent that rewrites the whole site. **Audience of the site:** Local Fleet Developers and Engineering Leads. The security lead is a second reader on the Boundary page.

## 1. Read this first
- The reader is the hero on every page. Sideboard is the guide and enters as the mentor from the board section onward.
- Treat the site as one arc across six pages, not six separate pages.
- Never print AND, BUT or THEREFORE as labels. Write them as natural prose.
- Where a rule below clashes with your instinct, follow the rule.
- Every claim must appear in the Claims ledger (section 5) as allowed. If it is not there, leave it out and list it in your Missing note.

## 2. Story
**Theme:** Control. This is a recommendation from the saved Brand Story, and the owner may challenge it.

**Master ABT, held word for word. Do not reword it.**
> You run several coding agents on your Mac, often inside a corporate network, and want to see and steer all of them at a glance, and if your whole fleet showed up on one board that never left your network, then you could steer every task without hopping between terminals or uploading a thing.
>
> But you feel scattered and shut out, because each agent lives in its own terminal with nothing showing which ones are working, stuck or waiting on you, and cloud agent workspaces ask your code and secrets to leave your network before they will work.
>
> Imagine the calm you'll feel watching every agent move from New to Merged on one board, because Sideboard gives each its own git worktree and keeps your agents, repos and secrets on your own Mac, where you can steer the fleet from your desk, your phone or the CLI.

**Positioning (quote exactly):** "For developers and engineering leads who run coding agents on their own Mac, Sideboard is the only local-first, open-source fleet orchestrator that keeps your agents, repos and secrets on your own network, unlike cloud sandboxes that ask you to rent the control room."

**Category:** Sideboard is an agentic development environment (an agent IDE). Local fleet orchestrator names the shape inside that category. Do not describe Sideboard as having no IDE.

**Line:** "Orchestrate your coding agents without leaving your machine."

**Purpose:** Sideboard exists to help developers who work beside AI agents feel in command of their own desk.

**Emotional promise:** Composed. Supporting feelings are Sheltered and Unhurried.

**The ten steps and where they land**

| Step | What it says | Lands on |
|---|---|---|
| 1 Backstory | The Cloud Move: the board that began to order the fleet moved into a paid cloud. Sideboard began as the open, local answer. | Why local (opening). Home gets one footer line. |
| 2 Heroes | You run several agents on your own Mac and are accountable for where your code goes. | Home hero. "You" voice on every page. |
| 3 Stakes | You want calm. You fear a stuck agent going unnoticed, and not being able to tell your security lead what leaves the machine. | Home. Boundary. |
| 4 Disruption | Agents multiplied faster than any way to see them, then the board moved to a paid cloud. | Home (one beat). Why local. |
| 5 Antagonist | The Rented Control Plane. Its forms are terminal sprawl and the upload wall. | Why local (named). Boundary (upload wall). Home (terminal sprawl, one beat). |
| 6 Mentor | Sideboard sets the order, keeps what is sensitive home, and names its enemy calmly. | Home. How it works. |
| 7 Journey | From hopping between terminals to a Board running New, Draft, Review, Approved, Merged. | How it works. Get started. |
| 8 Victory | You see the whole fleet and can say what leaves the machine. Write it as the reader's outcome, not a feature list. | Boundary (close). Home (close). |
| 9 Moral | Closing line of each page, one per page: "A fleet you can see is a fleet you can command." "A boundary anyone can read is a boundary you can trust." "The control room should live where the work does." | Last line of Home or How it works, Boundary, and Why local. |
| 10 Ritual | Open the Board, review the diff, approve, merge. Run the fit test, then install. | Fit test. Get started call to action on every page. |

## 3. Voice
**Dial:** humor 1, respect 5, formality 3, enthusiasm 2, technical depth 4. The reader is technical. Do not gloss worktree, VPN or CLI.

| Trait | Means | Shows up as | Never |
|---|---|---|---|
| Orderly (Ruler/Manager) | State, status and next action first | Short declaratives. Headings that follow the board's states. | Bureaucratic |
| Candid (Ruler/Manager) | Says when Sideboard is the wrong fit | "Use something else if..." Limits beside claims. | Dismissive |
| Grounded (Caregiver/Guardian) | Stays where the work is | Named facts (a routing token and ciphertext) before any adjective | Cold |
| Protective (Caregiver/Guardian) | Protection is a checkable fact | "Nothing is uploaded", with the boundary named | Reassuring |
| Defiant (Outlaw/Revolutionary) | Refuses to rent out the control room, calmly | One named enemy, The Rented Control Plane | Ranting |

**Mechanics**
- Address the reader as "you". Refer to Sideboard in the third person. Use "we" only for origin and stance lines.
- Headings are in sentence case. Board states (New, Draft, Review, Approved, Merged) are capitalised as on the board.
- Use short to medium sentences with one idea each.
- Use numerals. Show a figure only once a real number exists.
- Avoid contractions on the Boundary page and any security-facing copy.
- No exclamation marks and no emoji.
- Use neutral "developers and engineering leads". Assume no team size or seniority.

**Tone by page lead**
- Ruler/Manager leads Home, How it works, Fit test and Get started.
- Caregiver/Guardian leads Boundary. No defiance there.
- Outlaw/Revolutionary leads Why local. Aim defiance only at The Cloud Move and The Rented Control Plane, then close as a Ruler on what the reader controls.

## 4. Terms
**Required**
- **Sideboard:** always capitalised. Never "the Sideboard app".
- **Board:** capitalised when it names the Sideboard board.
- **The Rented Control Plane:** always capitalised. Name it once per page.
- **agentic development environment** (agent IDE): the category. Sideboard is one. Use this when naming what Sideboard is.
- **local fleet orchestrator:** the shape inside that category. The checkout is the unit. Compute stays on this Mac. The editor stays in the harness (`attach`).

**Prohibited**
- Reassurance language: "rest easy", "totally safe", "don't worry".
- Attacks on the reader's own governance, review gates or corporate rules. Show how Sideboard works inside them.
- A category phrase that puts Sideboard outside an agent IDE or an agentic development environment, or that calls it a cloud sandbox, a CMS, or an embedded editor.
- Hype words, exclamation marks and emoji.

## 5. Claims ledger

**Allowed. Carry as written and add nothing.**
1. The positioning statement and the line in section 2.
2. "Only a routing token and ciphertext leave the machine." Carried unchanged, with no independent attestation behind it, so state the boundary beside it.
3. Agents, repos and secrets stay on your own Mac and network. Nothing is uploaded.
4. Each agent gets its own git worktree.
5. The Board runs New, Draft, Review, Approved, Merged.
6. The CLI handles mechanical control at no token cost. The phone, MCP and Slack reach the same Mac.
7. Agents can run against a VPN-only API with nothing uploaded.
8. Sideboard is open source (Apache-2.0).
9. Apple Silicon Macs only. State this wherever platform fit matters.
10. What only Sideboard does: a local global board, plus an orchestrator other agents can drive over MCP.
11. Sideboard is an agentic development environment (an agent IDE): a local fleet orchestrator on this Mac. It does not embed an editor, terminal, or browser.

**Needs proof that does not exist yet. Leave out until it does.**
- Who uses Sideboard, usage numbers, customer outcomes or testimonials.
- Any security certification, audit or review.
- Time saved, speed or cost figures.
- "Safe to trust because open source."
- Independent confirmation of "the only" or of what leaves the machine.

**No-go**
- Implying rivals lack an orchestrator an agent can see.
- Comparative claims beyond what only Sideboard does.
- Guarantees or offers.
- Support for any platform other than Apple Silicon Macs.
- Table-stakes features as the lead: parallel worktrees, bring-your-own-subscription, a mobile companion, bots.

## 6. Page-by-page beat sheet
Each page carries one ABT beat, one Moral line and one next action. None repeats another page's Backstory, and the call to action always follows the resolution.

**Home** (Ruler/Manager). Steps 2 to 6, 8 and 10.
1. Open on the Board: every agent, its task, its state.
2. Put the local-only fact directly beneath it as the Guardian proof.
3. Write one factual "But" on terminals, with its cause.
4. Add one echo line of The Cloud Move in the footer band.
5. Close on what the reader controls, then the Get started call to action.

**How it works** (Ruler/Manager). Steps 6 and 7.
- Walk the journey: worktree per agent, the Board states, the CLI, then phone, MCP and Slack reaching the same Mac.
- Sections follow the Board states.

**Boundary: what stays on your machine** (Guardian). Steps 3, 5, 8 and 9.
1. One recognising line.
2. Lead the "But" on the upload wall and on not being able to say what leaves the machine.
3. State the checkable facts: nothing is uploaded, and a routing token and ciphertext are all that leave.
4. Close on the reader's outcome: you can tell your security lead exactly what leaves.
5. Moral: "A boundary anyone can read is a boundary you can trust."

**Why local** (Outlaw hook, Ruler close). Steps 1, 4, 5 and 9.
1. Open with a one-line hook.
2. Tell The Cloud Move. Name The Rented Control Plane once. Show calm defiance.
3. Close on what the reader controls: "The control room should live where the work does."

**Fit test, "Use something else if..."** (Candid). Step 10.
- A plain list of when Sideboard is the wrong choice.
- It must include Apple Silicon Macs only.
- Add other cases only if the records state them. Never invent them.

**Get started / docs** (Ruler/Manager). Steps 7 and 10.
- Setup steps, including the route to a VPN-only API with nothing uploaded.
- End on the ritual: open the Board, review the diff, approve, merge.
- Take commands and steps only from real product material. If none is supplied, flag it and do not invent any.

## 7. On-brand and off-brand examples
Illustrations, not approved copy. Never reuse their wording as a claim you have not checked.

| Where | On-brand | Off-brand | Why |
|---|---|---|---|
| Home hero | Every agent, its task, its state, on one board on your own Mac. | Take control of your AI chaos and supercharge your whole team! | State first, no hype. |
| Boundary | Your repos and secrets stay on your Mac. A routing token and ciphertext are the only things that leave. | Don't worry, your code is totally safe with us. | Protective, not reassuring. |
| Why local | Your control room shouldn't come with a subscription and an upload wall. | Cloud agent tools are a scam and their users are being fleeced. | Defiant, not ranting. |
| Launch note | Sideboard now runs against VPN-only APIs with nothing uploaded. Here is the setup. | Huge news! Sideboard just changed everything! | Candid and Grounded. |

## 8. Instructions for the rewriting agent
1. **Inputs you need.** The current sideboard.build page list and copy, the real setup steps and commands, and the licence text. If any is missing, write around it and list it under Missing. Never invent commands, URLs, numbers or contact routes.
2. **Order of work.** Home. Then How it works and Get started. Then Boundary, Why local and the Fit test. Then a consistency pass across all pages.
3. **Page rules.**
   - The first screen of every page shows the reader's situation or the Board's state before any Sideboard claim.
   - Each page has one ABT beat, one Moral line and one call to action, placed after the resolution.
   - The Rented Control Plane appears at most once per page.
   - Keep every limit (Apple Silicon only, the fit test) beside the claim it limits.
4. **Claims.** Use only section 5's allowed list. Add no testimonials, "who else uses it", numbers or certifications.
5. **Language.** Apply sections 3 and 4 on every page. Use one name (Sideboard), the category (agentic development environment), the shape (local fleet orchestrator), and one enemy name everywhere.
6. **Answer-ready writing.** Give each key claim a one or two sentence answer that stands alone with its limit attached. A named fact beats an adjective.
7. **Final check before returning.** No exclamation marks, emoji or reassurance language. No [bracketed] fill-ins. "Sideboard" spelled consistently. Master ABT clauses whole where used. Every claim traces to section 5. Every call to action follows its resolution.
8. **Return** each page's copy, then a Missing note listing every fact you could not source.
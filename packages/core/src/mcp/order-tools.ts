import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  assertCallerOwnsSubject,
  clearOrderDependency,
  defaultOrderSubject,
  executeOrderPlan,
  orderEdgeTouches,
  formatOrderPlace,
  formatOrderText,
  formatWaterfallHtml,
  showPlanDocuments,
  showPlanMessage,
  getOrderPlan,
  listWaterfall,
  listOrderRows,
  setOrderPlan,
  orderSnapshotFromThread,
  parseOrderGate,
  parseOrderHold,
  parseOrderKind,
  satisfyOrderDependency,
  setOrderDependency,
  type OrderTarget,
} from '../order/order.js';
import { sideboardMcpProfile, SIDEBOARD_THREAD_ID_ENV } from './profile.js';
import { mcpJson } from './issue-list.js';
import { readThread } from '../store/thread-store.js';
import { GLOBAL_WORKSPACE_ID } from '../store/global-workspace.js';
import { readPlanFile } from '../plan/plan-file.js';
import type { Thread } from '../types/thread.js';

const kindSchema = z.enum(['pr', 'issue', 'workspace', 'orchestration']);

function callerThread() {
  const id = process.env[SIDEBOARD_THREAD_ID_ENV]?.trim();
  if (!id) return null;
  return readThread(id);
}

/** Implementation plan for a checkout. Orchestration chats do not have one. */
function readCheckoutPlan(caller: Thread | null): string | null {
  if (!caller) return null;
  if (caller.sourceType === 'orchestration' || caller.repoPath === GLOBAL_WORKSPACE_ID) return null;
  const root = caller.worktreePath?.trim();
  if (!root) return null;
  return readPlanFile(root);
}

/** Orchestration chat that owns the plan. A worktree uses its parent orchestrator. */
function orchestrationOwnerId(worktree: boolean): string {
  const caller = callerThread();
  if (!caller) {
    throw new Error(
      worktree
        ? 'No worktree chat is bound to this tool.'
        : 'No orchestration chat is bound to this tool.',
    );
  }
  if (!worktree) return caller.id;
  let current = caller.parentThreadId?.trim() || '';
  const seen = new Set<string>([caller.id]);
  for (let hop = 0; hop < 6 && current && !seen.has(current); hop++) {
    seen.add(current);
    const row = readThread(current);
    if (!row) break;
    if (row.sourceType === 'orchestration' || row.repoPath === GLOBAL_WORKSPACE_ID) return row.id;
    current = row.parentThreadId?.trim() || '';
  }
  throw new Error('This checkout is not connected to an orchestration chat.');
}

function targetFrom(
  kind: string,
  ref: string,
  repoPath?: string,
  label?: string,
): OrderTarget {
  return {
    kind: parseOrderKind(kind),
    ref: ref.trim(),
    ...(repoPath?.trim() ? { repoPath: repoPath.trim() } : {}),
    ...(label?.trim() ? { label: label.trim() } : {}),
  };
}

export function registerOrderTools(server: McpServer): void {
  const worktree = sideboardMcpProfile() === 'worktree';

  server.tool(
    'list_order',
    worktree
      ? 'Read where this checkout sits in its orchestrator\'s plan: what you are waiting on, what is clear, and what you are blocking. Call show_plan when the user should see it. Change your step with set_dependency or clear_dependency.'
      : 'Read this chat\'s plan. Call show_plan when the user should see it. Draft with set_plan and set_dependency, revise from their feedback, then execute_plan only after they agree. Do not start planned work while the plan is draft.',
    {},
    async () => {
      try {
        const owner = orchestrationOwnerId(worktree);
        const plan = getOrderPlan(owner);
        const caller = callerThread();
        if (!plan) {
          const text = worktree
            ? 'This checkout\'s orchestrator has no plan yet.'
            : 'This chat has no plan. set_plan drafts one. Then show_plan so the user sees it.';
          return { content: [{ type: 'text' as const, text }] };
        }
        const rows = listOrderRows(plan.id);
        const place =
          worktree && caller ? `${formatOrderPlace(rows, orderSnapshotFromThread(caller))}\n\n` : '';
        return {
          content: [{ type: 'text' as const, text: `${place}${formatOrderText(rows, plan)}` }],
        };
      } catch (err) {
        return mcpJson({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  server.tool(
    'set_dependency',
    worktree
      ? 'Change what this checkout waits on. Omit subject to mean this workspace (hold=merge uses this PR; hold=start on a ticket uses this issue). gate=in-main (met when that PR is merged) or in-prod (stays waiting until satisfy_dependency). hold=start means do not begin; hold=merge means do not merge. You cannot set a dependency for a different checkout. show_plan so the user sees the change.'
      : 'Record a step on this orchestration plan. waitsOn must reach gate before subject can hold. gate=in-main is met when that PR is merged; gate=in-prod stays waiting until satisfy_dependency. hold=start blocks starting the subject; hold=merge blocks merging it. Example: PR 1 in prod before PR 2 can merge; PR 3 in main before issue 4 can start. Pass repoPath when the same PR number exists in more than one project. Worktree agents set their own checkout and can omit subject. Then show_plan so the user sees it.',
    {
      waitsOnKind: kindSchema.describe('What must happen first: pr, issue, workspace, or orchestration'),
      waitsOnRef: z
        .string()
        .describe('PR number (12), issue id (ENG-4), or workspace chat id / worktree path'),
      waitsOnRepoPath: z
        .string()
        .optional()
        .describe('Project path when a PR or issue number is not unique'),
      waitsOnLabel: z.string().optional().describe('Short label on the planner'),
      gate: z
        .enum(['in-main', 'in-prod'])
        .describe('in-main: merged to the default branch. in-prod: deployed; mark with satisfy_dependency'),
      hold: z
        .enum(['start', 'merge'])
        .describe('start: subject cannot begin. merge: subject cannot merge'),
      subjectKind: kindSchema
        .optional()
        .describe('What is held. Required from orchestration. Omit on a worktree to mean this checkout.'),
      subjectRef: z.string().optional().describe('PR number, issue id, or workspace ref for the subject'),
      subjectRepoPath: z.string().optional(),
      subjectLabel: z.string().optional(),
      note: z.string().optional().describe('Why this order matters'),
    },
    async (args) => {
      try {
        const hasKind = Boolean(args.subjectKind);
        const hasRef = Boolean(args.subjectRef?.trim());
        if (hasKind !== hasRef) {
          throw new Error('Pass subjectKind and subjectRef together, or omit both on a worktree.');
        }
        const caller = callerThread();
        let subject: OrderTarget;
        const hold = parseOrderHold(args.hold);
        if (!hasKind) {
          if (!worktree) {
            throw new Error(
              'Pass subjectKind and subjectRef. A worktree agent can omit them to mean this checkout.',
            );
          }
          if (!caller) throw new Error('No worktree chat is bound to this tool.');
          subject = defaultOrderSubject(orderSnapshotFromThread(caller), hold);
        } else {
          subject = targetFrom(
            args.subjectKind!,
            args.subjectRef!,
            args.subjectRepoPath,
            args.subjectLabel,
          );
          if (worktree) {
            if (!caller) throw new Error('No worktree chat is bound to this tool.');
            assertCallerOwnsSubject(orderSnapshotFromThread(caller), subject);
          }
        }
        const result = setOrderDependency({
          waitsOn: targetFrom(
            args.waitsOnKind,
            args.waitsOnRef,
            args.waitsOnRepoPath,
            args.waitsOnLabel,
          ),
          gate: parseOrderGate(args.gate),
          subject,
          hold,
          note: args.note,
          createdByThreadId: caller?.id ?? null,
          ownerThreadId: orchestrationOwnerId(worktree),
        });
        return mcpJson({
          created: result.created,
          id: result.edge.id,
          gate: result.edge.gate,
          hold: result.edge.hold,
          waitsOn: result.edge.waitsOn,
          subject: result.edge.subject,
        });
      } catch (err) {
        return mcpJson({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  if (!worktree) {
    server.tool(
      'set_plan',
      'Draft or retitle this chat\'s plan. It stays draft until execute_plan. Pass goal for the outcome the steps are trying to reach. Then set_dependency for each gate. A step may loop back to an earlier one. Call show_plan so the user sees it. Do not paste the diagram in chat. Do not start workspaces while it is draft.',
      {
        title: z.string().describe('Short name for the plan'),
        summary: z.string().optional().describe('What this order is for, in a sentence or two'),
        goal: z.string().optional().describe('Outcome the steps are trying to reach'),
      },
      async ({ title, summary, goal }) => {
        try {
          const plan = setOrderPlan({
            title,
            summary,
            goal,
            ownerThreadId: orchestrationOwnerId(false),
          });
          return mcpJson({ ok: true, ...plan });
        } catch (err) {
          return mcpJson({ error: err instanceof Error ? err.message : String(err) }, true);
        }
      },
    );

    server.tool(
      'execute_plan',
      'Mark the plan active after the user has seen it and told you to run it. Returns ready steps (start those with create_workspace or send_to_chat) and waiting steps (leave them alone). Does not create workspaces. Pass agreed: true only after they agree. Merge only if they asked.',
      {
        agreed: z
          .literal(true)
          .describe('True only after the user has seen the plan and told you to run it'),
      },
      async () => {
        try {
          const result = executeOrderPlan(orchestrationOwnerId(false));
          const brief = (row: (typeof result.ready)[number]) => ({
            id: row.id,
            hold: row.hold,
            gate: row.gate,
            waitsOn: row.waitsOnLabel,
            subject: row.subjectLabel,
            detail: row.detail,
          });
          return mcpJson({
            ok: true,
            status: result.plan.status,
            title: result.plan.title,
            ready: result.ready.map(brief),
            waiting: result.waiting.map(brief),
            message:
              'Plan is active. Start ready steps with create_workspace or send_to_chat. Leave waiting steps alone. Merge only if the user asked.',
          });
        } catch (err) {
          return mcpJson({ error: err instanceof Error ? err.message : String(err) }, true);
        }
      },
    );
  }

  server.tool(
    'show_plan',
    worktree
      ? 'Open the plans for this checkout in the side column. That is the orchestration diagram, with this checkout marked, and this checkout\'s implementation plan (plan.md) when the file exists. Does not write either plan. Change a step with set_dependency or clear_dependency, then show it again. Do not paste the diagram in chat.'
      : 'Open this chat\'s plan in the side column. Call it after set_plan or set_dependency so the user sees the plan. A worktree show_plan also opens that checkout\'s implementation plan (plan.md) when the file exists. Does not write either plan. Do not paste the diagram in chat.',
    {},
    async () => {
      const caller = callerThread();
      let diagramHtml: string | null = null;
      let diagramTitle = 'Planner';
      let diagramError: string | null = null;
      try {
        const owner = orchestrationOwnerId(worktree);
        const plan = getOrderPlan(owner);
        diagramTitle = plan?.title || 'Planner';
        diagramHtml = formatWaterfallHtml(plan ? listWaterfall(plan.id) : [], {
          plan,
          you: caller ? orderSnapshotFromThread(caller) : null,
        });
      } catch (err) {
        diagramError = err instanceof Error ? err.message : String(err);
      }
      const artifacts = showPlanDocuments({
        diagramTitle,
        diagramHtml,
        checkoutMarkdown: readCheckoutPlan(caller),
      });
      if (!artifacts.length) {
        return mcpJson({ error: diagramError || 'Nothing to show.' }, true);
      }
      const primary = artifacts.find((doc) => doc.artifact_id === 'plan') ?? artifacts[0]!;
      return mcpJson({
        ok: true,
        title: primary.title,
        type: primary.type,
        artifact_id: primary.artifact_id,
        content: primary.content,
        artifacts,
        message: showPlanMessage(artifacts, worktree),
      });
    },
  );

  server.tool(
    'clear_dependency',
    worktree
      ? 'Remove a planner step this checkout is part of. Pass id from list_order. Then show_plan so the user sees it.'
      : 'Remove one planner step. Pass id from list_order. Then show_plan so the user sees it.',
    { id: z.string().describe('Step id from list_order') },
    async ({ id }) => {
      try {
        const caller = callerThread();
        clearOrderDependency(
          id,
          worktree && caller ? orderSnapshotFromThread(caller) : null,
          orchestrationOwnerId(worktree),
        );
        return mcpJson({ ok: true, id });
      } catch (err) {
        return mcpJson({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );

  server.tool(
    'satisfy_dependency',
    'Mark a planner gate met. Use this when a PR is in production — Sideboard cannot see deploys. in-main also clears on its own once that PR is merged. Pass satisfied=false to undo a manual mark. One mark covers every step waiting on that same gate.',
    {
      id: z.string().describe('Step id from list_order'),
      satisfied: z
        .boolean()
        .optional()
        .describe('false clears the manual mark. Default true.'),
    },
    async ({ id, satisfied }) => {
      try {
        const owner = orchestrationOwnerId(worktree);
        const plan = getOrderPlan(owner);
        if (!plan) throw new Error('set_plan first. This chat has no plan yet.');
        const rows = listOrderRows(plan.id);
        const hit = rows.find((row) => row.id === id || (id.length >= 8 && row.id.startsWith(id)));
        if (!hit) throw new Error('That step is on another orchestration chat\'s plan.');
        const caller = callerThread();
        if (worktree && caller && !orderEdgeTouches(hit, orderSnapshotFromThread(caller))) {
          throw new Error('This checkout can only change a step it is part of.');
        }
        const edge = satisfyOrderDependency(id, satisfied !== false);
        return mcpJson({
          ok: true,
          id: edge.id,
          satisfied: satisfied !== false,
          gate: edge.gate,
          waitsOn: edge.waitsOn,
        });
      } catch (err) {
        return mcpJson({ error: err instanceof Error ? err.message : String(err) }, true);
      }
    },
  );
}

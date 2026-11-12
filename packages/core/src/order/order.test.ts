import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertCallerOwnsSubject,
  buildWaterfall,
  defaultOrderSubject,
  formatOrderPlace,
  formatOrderText,
  formatWaterfallHtml,
  showPlanDocuments,
  showPlanMessage,
  buildPlanMap,
  planWatchCopy,
  resolveOrchestrationGates,
  resolveOrderRows,
  waterfallNodeState,
  type OrderThreadSnapshot,
} from './order-view.js';

function thread(partial: Partial<OrderThreadSnapshot> & Pick<OrderThreadSnapshot, 'id'>): OrderThreadSnapshot {
  return {
    title: partial.title ?? 'Checkout',
    sourceType: partial.sourceType ?? 'branch',
    sourceRef: partial.sourceRef ?? 'matt/thing',
    repoPath: partial.repoPath ?? '/repos/sideboard',
    worktreePath: partial.worktreePath ?? `/wt/${partial.id}`,
    prUrl: partial.prUrl ?? null,
    prState: partial.prState ?? null,
    prTitle: partial.prTitle ?? null,
    status: partial.status ?? 'idle',
    ...partial,
  };
}

describe('order of operations', () => {
  const prevData = process.env.SIDEBOARD_APP_DATA;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sb-order-'));
    process.env.SIDEBOARD_APP_DATA = dataDir;
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SIDEBOARD_APP_DATA;
    else process.env.SIDEBOARD_APP_DATA = prevData;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function store() {
    return import('./order.js');
  }

  it('records a gate, dedupes it, keeps a loop, and rejects a step that waits on itself', async () => {
    const { setOrderDependency, listOrderEdges } = await store();
    const first = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '#1', label: 'Ship auth' },
      gate: 'prod',
      subject: { kind: 'pr', ref: '2' },
      hold: 'merge',
      note: 'prod before merge',
    });
    expect(first.created).toBe(true);
    expect(first.edge.gate).toBe('in-prod');
    expect(first.edge.waitsOn.ref).toBe('1');
    const again = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '1' },
      gate: 'in-prod',
      subject: { kind: 'pr', ref: '2' },
      hold: 'before merge',
    });
    expect(again.created).toBe(false);
    expect(again.edge.id).toBe(first.edge.id);
    expect(listOrderEdges()).toHaveLength(1);
    const loop = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '2' },
      gate: 'in-main',
      subject: { kind: 'pr', ref: '1' },
      hold: 'start',
    });
    expect(loop.created).toBe(true);
    expect(loop.edge.loop).toBe(true);
    expect(listOrderEdges()).toHaveLength(2);
    expect(() =>
      setOrderDependency({
        waitsOn: { kind: 'issue', ref: 'ENG-4' },
        gate: 'in-main',
        subject: { kind: 'issue', ref: 'ENG-4' },
        hold: 'start',
      }),
    ).toThrow(/itself/);
  });

  it('clears in-main when the PR is merged, including after archive', async () => {
    const { setOrderDependency, listOrderRows, satisfyOrderDependency, clearOrderDependency } =
      await store();
    const edge = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '3', repoPath: '/repos/sideboard' },
      gate: 'in-main',
      subject: { kind: 'issue', ref: 'ENG-4' },
      hold: 'start',
    }).edge;
    const open = thread({
      id: 'pr3',
      sourceType: 'pr',
      sourceRef: '3',
      prUrl: 'https://github.com/mattlevine/sideboard/pull/3',
      prState: 'OPEN',
      prTitle: 'Land the API',
    });
    const waiting = resolveOrderRows([edge], [open]);
    expect(waiting[0]?.met).toBe(false);
    expect(waiting[0]?.detail).toBe('open — not in main');
    const merged = resolveOrderRows(
      [edge],
      [{ ...open, status: 'archived', prState: 'MERGED' }],
    );
    expect(merged[0]?.met).toBe(true);
    expect(merged[0]?.detail).toBe('merged to main');
    expect(merged[0]?.marked).toBe(false);

    const otherRepo = thread({
      id: 'other',
      repoPath: '/repos/other',
      sourceType: 'pr',
      sourceRef: '3',
      prState: 'MERGED',
      prUrl: 'https://github.com/other/repo/pull/3',
    });
    expect(resolveOrderRows([edge], [otherRepo])[0]?.met).toBe(false);

    satisfyOrderDependency(edge.id.slice(0, 8), true);
    expect(listOrderRows()[0]?.met).toBe(true);
    expect(listOrderRows()[0]?.detail).toBe('marked in main');
    clearOrderDependency(edge.id);
    expect(listOrderRows()).toHaveLength(0);
  });

  it('keeps in-prod waiting until it is marked, and one mark covers every waiter', async () => {
    const { setOrderDependency, satisfyOrderDependency, listOrderRows } = await store();
    const first = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '1' },
      gate: 'in-prod',
      subject: { kind: 'pr', ref: '2' },
      hold: 'merge',
    }).edge;
    setOrderDependency({
      waitsOn: { kind: 'pr', ref: '1' },
      gate: 'in-prod',
      subject: { kind: 'issue', ref: 'ENG-9' },
      hold: 'start',
    });
    expect(listOrderRows().every((row) => !row.met)).toBe(true);
    satisfyOrderDependency(first.id, true);
    expect(listOrderRows().every((row) => row.met && row.detail === 'marked in production')).toBe(
      true,
    );
    satisfyOrderDependency(first.id, false);
    expect(listOrderRows().every((row) => !row.met)).toBe(true);
  });

  it('stacks a chain and formats the waterfall', async () => {
    const { setOrderDependency } = await store();
    const a = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '1' },
      gate: 'in-main',
      subject: { kind: 'pr', ref: '2' },
      hold: 'merge',
    }).edge;
    const b = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '2' },
      gate: 'in-prod',
      subject: { kind: 'issue', ref: 'ENG-4' },
      hold: 'start',
    }).edge;
    const rows = resolveOrderRows([a, b], []);
    expect(rows.map((row) => row.depth)).toEqual([1, 2]);
    const chains = buildWaterfall(rows);
    expect(chains).toHaveLength(1);
    expect(chains[0]?.nodes.map((node) => node.depth)).toEqual([0, 1, 2]);
    expect(chains[0]?.nodes[2]?.incoming[0]?.hold).toBe('start');
    const text = formatOrderText(rows);
    expect(text).toMatch(/PR #1 must be in main before PR #2 can merge/);
    expect(text).toMatch(/waiting to be marked in production/);
    expect(text).toContain(a.id.slice(0, 8));
    const html = formatWaterfallHtml(chains);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('PR #2');
    expect(html).toContain('ENG-4');
    expect(html).toContain('in production');
    expect(formatWaterfallHtml([])).toContain('No order yet');
    const escaped = formatWaterfallHtml([
      {
        nodes: [
          {
            key: 'pr::1',
            label: 'PR #1 · <Auth>',
            kind: 'pr',
            ref: '1',
            depth: 0,
            incoming: [],
          },
        ],
      },
    ]);
    expect(escaped).toContain('PR #1 · &lt;Auth&gt;');
    expect(escaped).not.toContain('<Auth>');
    const working = formatWaterfallHtml([
      {
        nodes: [
          {
            key: 'pr::9',
            label: 'PR #9',
            kind: 'pr',
            ref: '9',
            depth: 0,
            incoming: [],
            working: true,
          },
        ],
      },
    ]);
    expect(working).toContain('Working');
    expect(working).toContain('bar current');
  });

  it('defaults a worktree subject to its PR or ticket and refuses another checkout', () => {
    const ticket = thread({
      id: 'chat-1',
      title: 'Issue four',
      sourceType: 'ticket',
      sourceRef: 'ENG-4',
      prUrl: 'https://github.com/mattlevine/sideboard/pull/8',
      prState: 'OPEN',
      prTitle: 'Issue four PR',
    });
    expect(defaultOrderSubject(ticket, 'start')).toMatchObject({
      kind: 'issue',
      ref: 'ENG-4',
    });
    expect(defaultOrderSubject(ticket, 'merge')).toMatchObject({ kind: 'pr', ref: '8' });
    assertCallerOwnsSubject(ticket, { kind: 'pr', ref: '8', repoPath: ticket.repoPath });
    expect(() =>
      assertCallerOwnsSubject(ticket, { kind: 'pr', ref: '99', repoPath: ticket.repoPath }),
    ).toThrow(/own workspace/);
  });

  it('stays a draft until execute, then splits ready and waiting', async () => {
    const { setOrderPlan, setOrderDependency, satisfyOrderDependency, executeOrderPlan, getOrderPlan } =
      await store();
    const plan = setOrderPlan({
      title: 'Billing rollout',
      summary: 'Auth, then billing.',
      goal: 'Billing is in production',
    });
    expect(plan.status).toBe('draft');
    expect(plan.goal).toBe('Billing is in production');
    const edge = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '1', label: 'Auth' },
      gate: 'in-prod',
      subject: { kind: 'pr', ref: '2', label: 'Billing' },
      hold: 'merge',
    }).edge;
    expect(getOrderPlan()?.status).toBe('draft');
    const waiting = executeOrderPlan();
    expect(waiting.plan.status).toBe('active');
    expect(waiting.ready).toHaveLength(0);
    expect(waiting.waiting).toHaveLength(1);
    satisfyOrderDependency(edge.id, true);
    const ready = executeOrderPlan();
    expect(ready.ready.map((row) => row.subject.ref)).toEqual(['2']);
    expect(ready.waiting).toHaveLength(0);
  });

  it('tells a checkout where it sits and refuses edits to other steps', async () => {
    const { setOrderDependency, clearOrderDependency } = await store();
    const edge = setOrderDependency({
      waitsOn: { kind: 'pr', ref: '1' },
      gate: 'in-main',
      subject: { kind: 'pr', ref: '8' },
      hold: 'merge',
    }).edge;
    const you = thread({
      id: 'chat-1',
      sourceType: 'pr',
      sourceRef: '8',
      prUrl: 'https://github.com/mattlevine/sideboard/pull/8',
      prTitle: 'Billing',
    });
    const stranger = thread({
      id: 'chat-2',
      sourceType: 'pr',
      sourceRef: '3',
      prUrl: 'https://github.com/mattlevine/sideboard/pull/3',
    });
    expect(formatOrderPlace([
      {
        id: edge.id,
        waitsOn: edge.waitsOn,
        subject: edge.subject,
        gate: edge.gate,
        hold: edge.hold,
        note: '',
        depth: 1,
        met: false,
        marked: false,
        detail: 'open — not in main',
        waitsOnLabel: 'PR #1',
        subjectLabel: 'PR #8',
      },
    ], you)).toMatch(/Waiting: PR #1 must be in main before you can merge/);
    expect(() => clearOrderDependency(edge.id, stranger)).toThrow(/part of/);
    clearOrderDependency(edge.id, you);
  });

  it('names the idle gap and the step a production mark unblocks', () => {
    const edges = [
      {
        id: 'a1b2c3d4-e5f6-4789-a012-000000000070',
        waitsOn: { kind: 'pr' as const, ref: '70', label: 'API enhancement' },
        gate: 'in-prod' as const,
        subject: { kind: 'pr' as const, ref: '71', label: 'Reporting' },
        hold: 'start' as const,
        note: '',
        createdByThreadId: null,
        createdAt: '2026-11-12T18:00:00.000Z',
      },
    ];
    const waiting = buildWaterfall(resolveOrderRows(edges, [], []));
    expect(planWatchCopy(waiting)).toContain(
      'PR #71 · Reporting can start once PR #70 · API enhancement is in production',
    );
    expect(planWatchCopy(waiting)).toContain('idle');
    const api = waiting[0]?.nodes.find((node) => node.ref === '70');
    const reporting = waiting[0]?.nodes.find((node) => node.ref === '71');
    expect(api && waterfallNodeState(api, waiting)).toBe('Waiting on production');
    expect(reporting && waterfallNodeState(reporting, waiting)).toBe('Waiting to start');
    const ready = buildWaterfall(
      resolveOrderRows(edges, [], [{ key: 'pr::70', gate: 'in-prod', at: '2026-11-12T18:01:00.000Z' }]),
    );
    expect(planWatchCopy(ready)).toBe('PR #71 · Reporting can start.');
    const readyNode = ready[0]?.nodes.find((node) => node.ref === '71');
    const apiReady = ready[0]?.nodes.find((node) => node.ref === '70');
    expect(readyNode && waterfallNodeState(readyNode, ready)).toBe('Ready to start');
    expect(apiReady && waterfallNodeState(apiReady, ready)).toBe('In production');
  });

  it('keeps each plan on the orchestration chat that drafted it', async () => {
    const { setOrderPlan, setOrderDependency, listOrderBoard, getOrderPlan, clearOrderDependency } =
      await store();
    setOrderPlan({
      ownerThreadId: 'orch-a',
      title: 'API then reporting',
      summary: 'Reporting waits on prod.',
    });
    setOrderPlan({ ownerThreadId: 'orch-b', title: 'Mobile', summary: 'iOS then Android.' });
    const edge = setOrderDependency({
      ownerThreadId: 'orch-a',
      waitsOn: { kind: 'pr', ref: '70', label: 'API' },
      gate: 'in-prod',
      subject: { kind: 'pr', ref: '71', label: 'Reporting' },
      hold: 'start',
    }).edge;
    const board = listOrderBoard();
    expect(board.plans.map((item) => item.plan.title)).toEqual(['API then reporting', 'Mobile']);
    const api = board.plans.find((item) => item.plan.ownerThreadId === 'orch-a');
    expect(api?.chains.some((chain) => chain.nodes.some((node) => node.ref === '71'))).toBe(true);
    const mobile = board.plans.find((item) => item.plan.ownerThreadId === 'orch-b');
    expect(mobile?.chains).toHaveLength(0);
    expect(getOrderPlan('orch-b')?.title).toBe('Mobile');
    expect(() =>
      setOrderDependency({
        ownerThreadId: 'missing',
        waitsOn: { kind: 'pr', ref: '1' },
        gate: 'in-main',
        subject: { kind: 'pr', ref: '2' },
        hold: 'start',
      }),
    ).toThrow(/set_plan/);
    expect(() => clearOrderDependency(edge.id, null, 'orch-b')).toThrow(/another orchestration/);
  });

  it('clears a parent step when the child orchestration plan is clear, and maps the spawn', () => {
    const fleet = {
      id: 'p1',
      ownerThreadId: 'orch-a',
      title: 'Fleet',
      summary: '',
      goal: '',
      status: 'active' as const,
      updatedAt: '',
    };
    const child = {
      id: 'p2',
      ownerThreadId: 'orch-b',
      title: 'Reporting',
      summary: '',
      goal: 'Reporting is in production',
      status: 'draft' as const,
      updatedAt: '',
    };
    const edges = [
      {
        id: 'e-spawn',
        planId: 'p1',
        waitsOn: { kind: 'pr' as const, ref: '70', label: 'API' },
        gate: 'in-prod' as const,
        subject: { kind: 'orchestration' as const, ref: 'orch-b', label: 'Reporting' },
        hold: 'start' as const,
        note: '',
        createdByThreadId: null,
        createdAt: '',
      },
      {
        id: 'e-wait',
        planId: 'p1',
        waitsOn: { kind: 'orchestration' as const, ref: 'orch-b', label: 'Reporting' },
        gate: 'in-main' as const,
        subject: { kind: 'pr' as const, ref: '72', label: 'Changelog' },
        hold: 'merge' as const,
        note: '',
        createdByThreadId: null,
        createdAt: '',
      },
      {
        id: 'e-child',
        planId: 'p2',
        waitsOn: { kind: 'pr' as const, ref: '71', label: 'Reporting PR' },
        gate: 'in-main' as const,
        subject: { kind: 'pr' as const, ref: '73', label: 'Docs' },
        hold: 'merge' as const,
        note: '',
        createdByThreadId: null,
        createdAt: '',
      },
    ];
    const waiting = resolveOrchestrationGates([fleet, child], edges, [], []);
    expect(waiting.find((row) => row.id === 'e-wait')?.detail).toBe('plan still waiting');
    expect(waiting.find((row) => row.id === 'e-wait')?.met).toBe(false);
    const ready = resolveOrchestrationGates(
      [fleet, child],
      edges,
      [],
      [{ key: 'pr::71', gate: 'in-main', at: '2026-11-12T18:01:00.000Z' }],
    );
    expect(ready.find((row) => row.id === 'e-child')?.met).toBe(true);
    expect(ready.find((row) => row.id === 'e-wait')?.met).toBe(true);
    expect(ready.find((row) => row.id === 'e-wait')?.detail).toBe('plan is clear');
    const chains = (planId: string) =>
      buildWaterfall(ready.filter((row) => edges.find((edge) => edge.id === row.id)?.planId === planId));
    const map = buildPlanMap(
      [
        { plan: fleet, chains: chains('p1') },
        { plan: child, chains: chains('p2') },
      ],
      [{ id: 'orch-b', parentThreadId: 'orch-a' }],
    );
    expect(map.links.some((link) => link.fromId === 'p1' && link.toId === 'p2')).toBe(true);
    expect(map.nodes.find((node) => node.id === 'p2')!.depth).toBeGreaterThan(
      map.nodes.find((node) => node.id === 'p1')!.depth,
    );
  });
});

describe('showPlanDocuments', () => {
  const html = '<!DOCTYPE html><html><body><h1>Fleet</h1></body></html>';
  const markdown = '# Ship the relay\n\nWait for the API pull request, then start the phone client.\n';

  it('opens the checkout plan and then the diagram', () => {
    const docs = showPlanDocuments({
      diagramTitle: 'Fleet',
      diagramHtml: html,
      checkoutMarkdown: markdown,
    });
    expect(docs.map((doc) => doc.artifact_id)).toEqual(['checkout-plan', 'plan']);
    expect(docs[0]?.title).toBe('Ship the relay');
    expect(docs[0]?.type).toBe('markdown');
    expect(docs[1]?.type).toBe('html');
    expect(showPlanMessage(docs, true)).toMatch(/implementation plan/);
  });

  it('opens only the document that exists', () => {
    expect(showPlanDocuments({ checkoutMarkdown: markdown }).map((doc) => doc.artifact_id)).toEqual([
      'checkout-plan',
    ]);
    expect(showPlanDocuments({ diagramTitle: 'Fleet', diagramHtml: html })).toEqual([
      { title: 'Fleet', type: 'html', artifact_id: 'plan', content: html },
    ]);
    expect(showPlanDocuments({})).toEqual([]);
    expect(showPlanMessage([], false)).toMatch(/Opened the plan/);
  });
});

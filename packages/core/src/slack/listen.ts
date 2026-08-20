import type { AgentKind } from '../types/thread.js';
import { coerceOrchestratorAgent } from '../agents/orchestrator-capable.js';
import { getOrchestrator } from '../orchestrator/orchestrator.js';
import {
  enrichWorkspacesWithGithub,
} from '../orchestrator/coordinator-prompt.js';
import {
  ensureSlackDeviceIdentity,
  getDefaultAgent,
} from '../store/app-settings.js';
import {
  ensureSlackCoordinator,
  findSlackCoordinator,
} from '../store/global-workspace.js';
import { readThread } from '../store/thread-store.js';
import { SlackApiError, slackApi } from './api.js';
import {
  isSlackStopCommand,
  type SlackInboundMessage,
  type SlackSocketModeOptions,
} from './socket-mode.js';
import { listSlackWorkspacesRaw, slackTokenFor } from './workspaces.js';
import { getSlackReplyTarget, setSlackReplyTarget } from './reply-target.js';
import { slackRelayUrl } from './baked-app.js';
import { runSlackRelayClient } from './relay-client.js';

export {
  inboundFromSocketFrame,
  isSlackStopCommand,
  parseSlackSocketFrame,
  runSlackSocketMode,
  stripSlackMentions,
} from './socket-mode.js';
export type { SlackInboundMessage } from './socket-mode.js';

export const SLACK_LISTEN_STOPPED_REPLY =
  'Sideboard stopped the in-progress turn. Send another message when you want to continue.';

export const SLACK_LISTEN_TIMEOUT_REPLY = [
  'Sideboard timed out waiting for the local agent turn to finish.',
  'Send another message to interrupt and retry, or send "stop".',
].join(' ');

/** Serialize send+wait so two replacement turns do not overlap. Interrupt happens before this queue. */
let handleChain: Promise<void> = Promise.resolve();

function enqueueHandle(fn: () => Promise<void>): Promise<void> {
  const run = handleChain.then(fn, fn);
  handleChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface SlackListenOptions {
  agent?: AgentKind;
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  /** Override hosted relay URL (tests / local relay). */
  relayUrl?: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: SlackSocketModeOptions['WebSocketImpl'];
  /** Tests: handle without talking to Slack Web API. */
  postReply?: (msg: SlackInboundMessage, text: string) => Promise<void>;
  /** Tests: ack reactions without talking to Slack Web API. */
  addReaction?: (msg: SlackInboundMessage, name: string) => Promise<void>;
  /**
   * Listen session token. After waitForTurn, skip posting if a newer inbound
   * superseded this turn (interrupt-and-replace).
   */
  inboundGeneration?: number;
  currentInboundGeneration?: () => number;
  /** Listen already acked; skip the eyes reaction in handleSlackInbound. */
  skipAck?: boolean;
}

function refreshWorkspaces() {
  return getOrchestrator().listWorkspaces();
}

function slackInboundSuperseded(opts: SlackListenOptions): boolean {
  if (opts.inboundGeneration === undefined || !opts.currentInboundGeneration) {
    return false;
  }
  return opts.currentInboundGeneration() !== opts.inboundGeneration;
}

function slackCoordinatorGone(err: unknown): boolean {
  const errMsg = err instanceof Error ? err.message : String(err);
  return /thread not found|thread is archived/i.test(errMsg);
}

/**
 * Kill an in-flight Slack coordinator turn so a follow-up can start immediately.
 * Same force-stop as MCP `send_to_thread` (`clearQueue: true`).
 * Does not create a chat — empty-board inbound is handled in handleSlackInbound.
 */
export function interruptSlackCoordinatorForInbound(
  msg: SlackInboundMessage,
  _agent: AgentKind,
  log: (line: string) => void = () => undefined,
): boolean {
  const userId = msg.userId?.trim();
  if (!userId) return false;
  try {
    const coordinator = findSlackCoordinator(msg.teamId, userId);
    if (!coordinator) return false;
    const fresh = readThread(coordinator.id) ?? coordinator;
    if (fresh.status !== 'running' && fresh.status !== 'queued') return false;
    getOrchestrator().stop(fresh.id, { clearQueue: true });
    log(
      `interrupt ${msg.kind} ${msg.ts} → coordinator ${fresh.id.slice(0, 8)} (${fresh.status})`,
    );
    return true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`interrupt ${msg.ts}: ${errMsg}`);
    return false;
  }
}

export function formatSlackInboundPrompt(msg: SlackInboundMessage): string {
  const kind = msg.kind === 'mention' ? 'Slack @mention' : 'Slack DM';
  return `${kind}\n\n${msg.text}`;
}

/** True when the last coordinator user message was injected from Slack Listen. */
export function isSlackInboundUserPrompt(text: string): boolean {
  return text.startsWith('Slack DM\n') || text.startsWith('Slack @mention\n');
}

/**
 * Prefix Slack replies with This Mac's destination (`Work: …`) so a user with
 * more than one device can see who answered and address follow-ups the same way.
 */
export function formatSlackSignedReply(deviceLabel: string, text: string): string {
  const label = deviceLabel.trim();
  const body = text.trim();
  if (!body) return body;
  if (!label) return body;
  const head = `${label}:`;
  if (body.slice(0, head.length).toLowerCase() === head.toLowerCase()) {
    return body;
  }
  return `${label}: ${body}`;
}

function signForThisMac(text: string): string {
  return formatSlackSignedReply(ensureSlackDeviceIdentity().deviceLabel, text);
}

/**
 * Top-level DMs stay in the main conversation. Mentions and already-threaded
 * messages reply in-thread so Slack does not hide the answer.
 */
export function slackReplyThreadTs(msg: SlackInboundMessage): string | undefined {
  if (msg.threadTs && msg.threadTs !== msg.ts) return msg.threadTs;
  if (msg.kind === 'mention') return msg.ts;
  return undefined;
}

/** Slack emoji short name for “seen / looking at this”. */
export const SLACK_SEEN_REACTION = 'eyes';

function writeTokenForTeam(teamId: string): string {
  const workspaces = listSlackWorkspacesRaw();
  const ws = workspaces.find((w) => w.team_id === teamId);
  if (!ws) {
    const connected = workspaces
      .map((w) => `${w.team_name} (${w.team_id})`)
      .join(', ');
    throw new Error(
      connected
        ? `No connected Slack workspace for team ${teamId}. Connected: ${connected}`
        : `No connected Slack workspace for team ${teamId}`,
    );
  }
  return slackTokenFor(ws, 'write');
}

/** Eyes-react the inbound message so Slack shows the bot saw it. */
export async function ackSlackInboundSeen(
  msg: SlackInboundMessage,
  opts: Pick<SlackListenOptions, 'addReaction' | 'fetchImpl' | 'onLog'>,
): Promise<void> {
  const log = opts.onLog ?? (() => undefined);
  try {
    if (opts.addReaction) {
      await opts.addReaction(msg, SLACK_SEEN_REACTION);
      return;
    }
    await slackApi(
      writeTokenForTeam(msg.teamId),
      'reactions.add',
      {
        channel: msg.channelId,
        timestamp: msg.ts,
        name: SLACK_SEEN_REACTION,
      },
      opts.fetchImpl,
    );
  } catch (err) {
    if (err instanceof SlackApiError && err.slackError === 'already_reacted') return;
    const errMsg = err instanceof Error ? err.message : String(err);
    const hint =
      err instanceof SlackApiError && err.slackError === 'missing_scope'
        ? ' — reconnect Slack in Account to grant reactions:write'
        : '';
    log(`react error: ${errMsg}${hint}`);
  }
}

async function postSlackText(
  target: { teamId: string; channelId: string; threadTs?: string },
  text: string,
  opts: Pick<SlackListenOptions, 'postReply' | 'fetchImpl'>,
): Promise<void> {
  const stub: SlackInboundMessage = {
    teamId: target.teamId,
    channelId: target.channelId,
    ts: target.threadTs ?? '',
    threadTs: target.threadTs,
    text: '',
    kind: 'dm',
  };
  if (opts.postReply) {
    await opts.postReply(stub, text);
    return;
  }
  const token = writeTokenForTeam(target.teamId);
  await slackApi(
    token,
    'chat.postMessage',
    {
      channel: target.channelId,
      text,
      thread_ts: target.threadTs,
    },
    opts.fetchImpl,
  );
}

async function postSlackReply(
  msg: SlackInboundMessage,
  text: string,
  opts: Pick<SlackListenOptions, 'postReply' | 'fetchImpl'>,
): Promise<void> {
  await postSlackText(
    {
      teamId: msg.teamId,
      channelId: msg.channelId,
      threadTs: slackReplyThreadTs(msg),
    },
    signForThisMac(text),
    opts,
  );
}

const lastRelayed = new Map<string, string>();

function markRelayed(threadId: string, text: string): void {
  lastRelayed.set(threadId, `${threadId}:${text}`);
}

function alreadyRelayed(threadId: string, text: string): boolean {
  return lastRelayed.get(threadId) === `${threadId}:${text}`;
}

/**
 * Desktop follow-ups on a Slack-linked coordinator. Inbound Slack turns post
 * after waitForTurn so this does not double-send (or race with empty text).
 */
async function relayCoordinatorReplyToSlack(
  threadId: string,
  opts: SlackListenOptions,
): Promise<void> {
  const target = getSlackReplyTarget(threadId);
  if (!target) return;
  const thread = readThread(threadId);
  const lastUser = thread
    ? [...thread.messages].reverse().find((m) => m.role === 'user')
    : undefined;
  if (lastUser && isSlackInboundUserPrompt(lastUser.text)) return;
  const result = getOrchestrator().getTurnResult(threadId);
  const text = result.text.trim();
  if (!text) return;
  if (alreadyRelayed(threadId, text)) return;
  markRelayed(threadId, text);
  const log = opts.onLog ?? (() => undefined);
  try {
    await postSlackText(target, signForThisMac(text), opts);
    log(`replied ${target.threadTs ?? target.channelId} (${text.length} chars)`);
  } catch (err) {
    lastRelayed.delete(threadId);
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`relay error: ${errMsg}`);
  }
}

export async function handleSlackInbound(
  msg: SlackInboundMessage,
  opts: SlackListenOptions,
): Promise<void> {
  const log = opts.onLog ?? (() => undefined);
  if (!opts.skipAck) {
    await ackSlackInboundSeen(msg, opts);
  }
  if (slackInboundSuperseded(opts)) {
    log(`skip superseded ${msg.kind} ${msg.ts}`);
    return;
  }
  const agent = coerceOrchestratorAgent(opts.agent ?? getDefaultAgent());
  const workspaces = refreshWorkspaces();
  for (const ws of workspaces) {
    await getOrchestrator().reconcile(ws.path).catch(() => undefined);
  }
  const inventory = await enrichWorkspacesWithGithub(workspaces);
  const userId = msg.userId?.trim();
  if (!userId) {
    log(`skip ${msg.kind} ${msg.ts}: missing Slack user id`);
    return;
  }
  if (slackInboundSuperseded(opts)) {
    log(`skip superseded ${msg.kind} ${msg.ts}`);
    return;
  }
  if (isSlackStopCommand(msg.text)) {
    const live = findSlackCoordinator(msg.teamId, userId);
    if (live) {
      try {
        getOrchestrator().stop(live.id, { clearQueue: true });
        log(`stop ${msg.kind} ${msg.ts} → coordinator ${live.id.slice(0, 8)}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log(`stop ${msg.ts}: ${errMsg}`);
      }
    }
    if (slackInboundSuperseded(opts)) {
      log(`skip superseded stop reply ${msg.ts}`);
      return;
    }
    await postSlackReply(msg, SLACK_LISTEN_STOPPED_REPLY, opts);
    log(`replied stopped ${msg.ts}`);
    return;
  }

  const opened = ensureSlackCoordinator(msg.teamId, userId, agent);
  let fresh = readThread(opened.id) ?? opened;

  // Follow-up while busy: interrupt-and-replace (do not wait for the old turn).
  if (fresh.status === 'running' || fresh.status === 'queued') {
    interruptSlackCoordinatorForInbound(msg, agent, log);
    fresh = readThread(fresh.id) ?? fresh;
  }

  log(
    `run ${msg.kind} ${msg.ts} user ${userId} → coordinator ${fresh.id.slice(0, 8)} (${inventory.length} workspace${inventory.length === 1 ? '' : 's'})`,
  );

  const prompt = formatSlackInboundPrompt(msg);
  const orch = getOrchestrator();
  const bindReplyTarget = (threadId: string) => {
    setSlackReplyTarget({
      threadId,
      teamId: msg.teamId,
      channelId: msg.channelId,
      threadTs: slackReplyThreadTs(msg),
    });
  };
  bindReplyTarget(fresh.id);

  const runTurn = async (threadId: string) => {
    await orch.send(threadId, prompt);
    await orch.waitForTurn(threadId, 14 * 60 * 1000);
  };

  let reply: string;
  try {
    try {
      await runTurn(fresh.id);
    } catch (err) {
      if (!slackCoordinatorGone(err)) throw err;
      log(`coordinator ${fresh.id.slice(0, 8)} gone, opening a new chat`);
      fresh = ensureSlackCoordinator(msg.teamId, userId, agent, { forceNew: true });
      bindReplyTarget(fresh.id);
      await runTurn(fresh.id);
    }
    if (slackInboundSuperseded(opts)) {
      log(`turn finished ${msg.ts} (superseded)`);
      return;
    }
    let after = readThread(fresh.id);
    if (after?.status === 'stopped') {
      log(`turn finished ${msg.ts} (interrupted, skip post)`);
      return;
    }
    if (!after || after.status === 'archived') {
      log(`coordinator ${fresh.id.slice(0, 8)} closed, opening a new chat`);
      fresh = ensureSlackCoordinator(msg.teamId, userId, agent, { forceNew: true });
      bindReplyTarget(fresh.id);
      await runTurn(fresh.id);
      if (slackInboundSuperseded(opts)) {
        log(`turn finished ${msg.ts} (superseded)`);
        return;
      }
      after = readThread(fresh.id);
      if (!after || after.status === 'stopped' || after.status === 'archived') {
        log(`turn finished ${msg.ts} (interrupted, skip post)`);
        return;
      }
    }
    reply = orch.getTurnResult(fresh.id).text.trim();
  } catch (err) {
    if (slackInboundSuperseded(opts)) {
      log(`turn error ${msg.ts} (superseded)`);
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    if (slackCoordinatorGone(err)) {
      log(`turn finished ${msg.ts} (thread gone, skip post)`);
      return;
    }
    const timedOut = /timed out|timeout/i.test(errMsg);
    const errorReply = timedOut
      ? SLACK_LISTEN_TIMEOUT_REPLY
      : `Sideboard coordinator error: ${errMsg}`;
    await postSlackReply(msg, errorReply, opts).catch((postErr) => {
      const postMsg = postErr instanceof Error ? postErr.message : String(postErr);
      log(`post error: ${postMsg}`);
    });
    log(`replied error ${msg.ts}: ${errMsg}`);
    if (!timedOut) throw err;
    return;
  }

  if (!reply) {
    log(`post error: no agent text to send for ${msg.ts}`);
    return;
  }
  if (alreadyRelayed(fresh.id, reply)) {
    log(`turn finished ${msg.ts} (already posted)`);
    return;
  }
  try {
    await postSlackReply(msg, reply, opts);
    markRelayed(fresh.id, reply);
    log(`replied ${msg.ts} (${reply.length} chars)`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log(`post error: ${errMsg}`);
  }
}

function ownedSlackUserKeys(): Set<string> {
  const keys = new Set<string>();
  for (const w of listSlackWorkspacesRaw()) {
    const team = w.team_id?.trim();
    const user = w.user_id?.trim();
    if (team && user) keys.add(`${team}:${user}`);
  }
  return keys;
}

/**
 * Only handle Slack events for Slack users who connected this Sideboard
 * (OAuth authed_user). Other people messaging the bot must run their own Mac.
 */
export function isInboundForThisDesktop(msg: SlackInboundMessage): boolean {
  const userId = msg.userId?.trim();
  if (!userId) return false;
  const owned = ownedSlackUserKeys();
  return owned.has(`${msg.teamId.trim()}:${userId}`);
}

/**
 * Sideboard-native Slack inbound via the hosted relay.
 * The Mac never holds an app-level `xapp-` token.
 */
export async function runSlackListen(opts: SlackListenOptions = {}): Promise<void> {
  const log = opts.onLog ?? console.log;
  const connected = listSlackWorkspacesRaw();
  const orch = getOrchestrator();
  const agent = coerceOrchestratorAgent(opts.agent ?? getDefaultAgent());
  let inboundGeneration = 0;
  const off = orch.on((event) => {
    if (event.type !== 'turn_finished') return;
    void relayCoordinatorReplyToSlack(event.threadId, opts);
  });

  const onInbound = (msg: SlackInboundMessage) => {
    if (!isInboundForThisDesktop(msg)) {
      log(
        `skip ${msg.kind} ${msg.ts}: Slack user ${msg.userId ?? '?'} is not connected on this Mac`,
      );
      return;
    }
    const generation = ++inboundGeneration;
    void ackSlackInboundSeen(msg, opts);
    // Interrupt immediately so the previous waitForTurn unblocks — do not wait
    // for the serialized handle queue (same pattern as Brightsy force-stop).
    interruptSlackCoordinatorForInbound(msg, agent, log);
    return enqueueHandle(async () => {
      if (generation !== inboundGeneration) {
        log(`skip superseded ${msg.kind} ${msg.ts}`);
        return;
      }
      await handleSlackInbound(msg, {
        ...opts,
        skipAck: true,
        inboundGeneration: generation,
        currentInboundGeneration: () => inboundGeneration,
      });
    });
  };

  try {
    const relay = (opts.relayUrl ?? slackRelayUrl()).trim();
    if (!relay) {
      throw new Error('Slack Listen needs the hosted relay URL.');
    }
    const withIdentity = connected.filter(
      (w) => w.bot_token?.trim() && w.user_token?.trim() && w.user_id?.trim(),
    );
    if (withIdentity.length === 0) {
      throw new Error(
        'Slack Listen needs Add via browser (bot token + your Slack user id). Paste-only bot tokens cannot prove which Slack user owns this Mac.',
      );
    }
    const device = ensureSlackDeviceIdentity();
    log(
      `Relay listen · ${device.deviceLabel} · ${withIdentity.length} workspace${withIdentity.length === 1 ? '' : 's'} as Slack user: ${withIdentity.map((w) => `${w.team_name}/${w.user_id}`).join(', ')}`,
    );
    await runSlackRelayClient({
      url: relay,
      signal: opts.signal,
      onLog: log,
      WebSocketImpl: opts.WebSocketImpl,
      deviceId: device.deviceId,
      deviceLabel: device.deviceLabel,
      workspaces: withIdentity.map((w) => ({
        teamId: w.team_id,
        userId: w.user_id!.trim(),
        botToken: w.bot_token!.trim(),
        userToken: w.user_token!.trim(),
      })),
      onEvent: onInbound,
    });
  } finally {
    off();
  }
}

/** How Listen will receive Slack events on this machine. */
export function resolveSlackListenMode(opts?: {
  relayUrl?: string | null;
  workspaceCount?: number;
}): 'relay' | null {
  const relay = (opts?.relayUrl ?? slackRelayUrl()).trim();
  const count =
    opts?.workspaceCount ??
    listSlackWorkspacesRaw().filter(
      (w) => w.bot_token?.trim() && w.user_token?.trim() && w.user_id?.trim(),
    ).length;
  if (relay && count > 0) return 'relay';
  return null;
}

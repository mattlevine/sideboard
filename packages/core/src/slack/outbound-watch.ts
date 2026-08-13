import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import { writePrivateFile } from '../store/private-file.js';
import { isSecureFileEncrypted, readSecureJson } from '../store/secure-file.js';
import { slackApi } from './api.js';
import { getSlackWorkspace, slackTokenFor } from './workspaces.js';

const MAX_WATCHES = 40;
const WATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 12_000;

export interface SlackOutboundWatch {
  id: string;
  teamId: string;
  channelId: string;
  /** Posted message ts. */
  ts: string;
  /** Parent thread ts (same as `ts` for top-level posts). */
  threadTs: string;
  kind: 'dm' | 'channel';
  toUserId?: string;
  toLabel: string;
  ownerUserId?: string;
  postedAt: string;
  lastSeenTs: string;
  unread: boolean;
  replyUserId?: string;
  replyUserName?: string;
  replyTs?: string;
  replyPreview?: string;
  permalink?: string;
}

export interface SlackReplyBadge {
  id: string;
  userId: string;
  userName: string;
  initials: string;
  hue: number;
  permalink: string;
  label: string;
  preview?: string;
  repliedAt: string;
}

type Store = { watches?: SlackOutboundWatch[] };

type SlackHistoryMessage = {
  ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
};

let lastPollMs = 0;
const nameCache = new Map<string, string>();

function storePath(): string {
  return join(appDataDir(), 'slack-outbound-watch.json');
}

function watchId(teamId: string, channelId: string, ts: string): string {
  return `${teamId}:${channelId}:${ts}`;
}

function badgeId(teamId: string, userId: string): string {
  return `${teamId}:${userId}`;
}

export function slackArchiveUrl(channelId: string, ts: string): string {
  return `https://slack.com/archives/${channelId}/p${ts.replace('.', '')}`;
}

export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const w = parts[0]!;
    return (w.slice(0, 2) || '?').toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

export function hueFromId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

function tsNewer(a: string, b: string): boolean {
  return Number(a) > Number(b);
}

function readStore(): SlackOutboundWatch[] {
  const path = storePath();
  if (!existsSync(path)) return [];
  try {
    const parsed = isSecureFileEncrypted(path)
      ? readSecureJson<Store>(path)
      : (JSON.parse(readFileSync(path, 'utf8')) as Store);
    return Array.isArray(parsed?.watches) ? parsed.watches : [];
  } catch {
    return [];
  }
}

function writeStore(watches: SlackOutboundWatch[]): SlackOutboundWatch[] {
  writePrivateFile(storePath(), `${JSON.stringify({ watches }, null, 2)}\n`);
  return watches;
}

function pruneWatches(
  watches: SlackOutboundWatch[],
  nowMs = Date.now(),
): SlackOutboundWatch[] {
  const cutoff = nowMs - WATCH_TTL_MS;
  const kept = watches.filter((w) => {
    const posted = Date.parse(w.postedAt);
    return Number.isFinite(posted) ? posted >= cutoff : true;
  });
  if (kept.length <= MAX_WATCHES) return kept;
  return kept
    .slice()
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, MAX_WATCHES);
}

export function recordSlackOutboundWatch(input: {
  teamId: string;
  channelId: string;
  ts: string;
  threadTs?: string;
  kind: 'dm' | 'channel';
  toUserId?: string;
  toLabel: string;
  ownerUserId?: string;
}): SlackOutboundWatch | null {
  const ts = input.ts.trim();
  const channelId = input.channelId.trim();
  const teamId = input.teamId.trim();
  if (!ts || !channelId || !teamId) return null;
  const owner = input.ownerUserId?.trim();
  const toUser = input.toUserId?.trim();
  if (toUser && owner && toUser === owner) return null;

  const id = watchId(teamId, channelId, ts);
  const next: SlackOutboundWatch = {
    id,
    teamId,
    channelId,
    ts,
    threadTs: input.threadTs?.trim() || ts,
    kind: input.kind === 'dm' ? 'dm' : 'channel',
    toUserId: toUser,
    toLabel: input.toLabel.trim() || toUser || channelId,
    ownerUserId: owner,
    postedAt: new Date().toISOString(),
    lastSeenTs: ts,
    unread: false,
    permalink: slackArchiveUrl(channelId, ts),
  };
  const watches = pruneWatches(readStore().filter((w) => w.id !== id));
  watches.unshift(next);
  writeStore(pruneWatches(watches));
  return next;
}

function isHumanReply(msg: SlackHistoryMessage, watch: SlackOutboundWatch): boolean {
  const ts = msg.ts?.trim();
  if (!ts || ts === watch.ts) return false;
  if (!tsNewer(ts, watch.lastSeenTs)) return false;
  if (msg.bot_id) return false;
  if (msg.subtype) return false;
  const user = msg.user?.trim();
  if (!user) return false;
  if (watch.ownerUserId && user === watch.ownerUserId) return false;
  return true;
}

function displayName(user: {
  name?: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
}): string {
  const fromProfile =
    user.profile?.display_name?.trim() || user.profile?.real_name?.trim();
  return fromProfile || user.real_name?.trim() || user.name?.trim() || '';
}

async function resolveUserName(
  token: string,
  userId: string,
  fallback: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const cached = nameCache.get(userId);
  if (cached) return cached;
  try {
    const data = await slackApi<{
      user?: {
        name?: string;
        real_name?: string;
        profile?: { display_name?: string; real_name?: string };
      };
    }>(token, 'users.info', { user: userId }, fetchImpl);
    const name = displayName(data.user ?? {}) || fallback;
    nameCache.set(userId, name);
    return name;
  } catch {
    return fallback;
  }
}

async function resolvePermalink(
  token: string,
  channelId: string,
  ts: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  try {
    const data = await slackApi<{ permalink?: string }>(
      token,
      'chat.getPermalink',
      { channel: channelId, message_ts: ts },
      fetchImpl,
    );
    if (data.permalink?.startsWith('http')) return data.permalink;
  } catch {
    /* fallback */
  }
  return slackArchiveUrl(channelId, ts);
}

async function fetchMessages(
  token: string,
  watch: SlackOutboundWatch,
  fetchImpl?: typeof fetch,
): Promise<SlackHistoryMessage[]> {
  const out: SlackHistoryMessage[] = [];
  try {
    const data = await slackApi<{ messages?: SlackHistoryMessage[] }>(
      token,
      'conversations.replies',
      {
        channel: watch.channelId,
        ts: watch.threadTs,
        oldest: watch.lastSeenTs,
        inclusive: false,
        limit: 50,
      },
      fetchImpl,
    );
    out.push(...(data.messages ?? []));
  } catch {
    /* not a thread, or missing scope */
  }
  if (watch.kind === 'dm' || watch.channelId.startsWith('D')) {
    try {
      const data = await slackApi<{ messages?: SlackHistoryMessage[] }>(
        token,
        'conversations.history',
        {
          channel: watch.channelId,
          oldest: watch.lastSeenTs,
          inclusive: false,
          limit: 50,
        },
        fetchImpl,
      );
      out.push(...(data.messages ?? []));
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function listSlackReplyBadges(): SlackReplyBadge[] {
  const unread = readStore().filter((w) => w.unread && w.replyUserId && w.permalink);
  const byUser = new Map<string, SlackOutboundWatch>();
  for (const w of unread) {
    const id = badgeId(w.teamId, w.replyUserId!);
    const prev = byUser.get(id);
    if (!prev || tsNewer(w.replyTs || '', prev.replyTs || '')) {
      byUser.set(id, w);
    }
  }
  return [...byUser.entries()]
    .map(([id, w]) => {
      const userName = w.replyUserName || w.toLabel || 'Slack';
      return {
        id,
        userId: w.replyUserId!,
        userName,
        initials: initialsFromName(userName),
        hue: hueFromId(w.replyUserId!),
        permalink: w.permalink || slackArchiveUrl(w.channelId, w.replyTs || w.ts),
        label: w.toLabel,
        preview: w.replyPreview,
        repliedAt: w.replyTs || w.postedAt,
      };
    })
    .sort((a, b) => b.repliedAt.localeCompare(a.repliedAt));
}

export function dismissSlackReplyBadge(badgeKey: string): SlackReplyBadge[] {
  const key = badgeKey.trim();
  const watches = readStore().map((w) => {
    if (!w.unread || !w.replyUserId) return w;
    if (badgeId(w.teamId, w.replyUserId) !== key) return w;
    return { ...w, unread: false };
  });
  writeStore(watches);
  return listSlackReplyBadges();
}

export function permalinkForSlackReplyBadge(badgeKey: string): string | null {
  return listSlackReplyBadges().find((b) => b.id === badgeKey)?.permalink ?? null;
}

export async function refreshSlackReplyBadges(opts?: {
  fetchImpl?: typeof fetch;
  force?: boolean;
  now?: number;
}): Promise<SlackReplyBadge[]> {
  const now = opts?.now ?? Date.now();
  if (!opts?.force && now - lastPollMs < POLL_INTERVAL_MS) {
    return listSlackReplyBadges();
  }
  lastPollMs = now;

  const existing = readStore();
  let watches = pruneWatches(existing, now);
  let changed = watches.length !== existing.length;

  for (let i = 0; i < watches.length; i++) {
    const watch = watches[i]!;
    const ws = getSlackWorkspace(watch.teamId);
    if (!ws) continue;
    let token: string;
    try {
      token = slackTokenFor(ws, 'read');
    } catch {
      continue;
    }
    const messages = await fetchMessages(token, watch, opts?.fetchImpl);
    const replies = messages
      .filter((m) => isHumanReply(m, watch))
      .sort((a, b) => Number(a.ts) - Number(b.ts));
    const latest = replies[replies.length - 1];
    if (!latest?.ts || !latest.user) continue;
    const fallback = watch.toUserId === latest.user ? watch.toLabel : latest.user;
    const replyUserName = await resolveUserName(
      token,
      latest.user,
      fallback,
      opts?.fetchImpl,
    );
    const permalink = await resolvePermalink(
      token,
      watch.channelId,
      latest.ts,
      opts?.fetchImpl,
    );
    watches[i] = {
      ...watch,
      lastSeenTs: latest.ts,
      unread: true,
      replyUserId: latest.user,
      replyUserName,
      replyTs: latest.ts,
      replyPreview: (latest.text ?? '').slice(0, 140),
      permalink,
    };
    changed = true;
  }

  if (changed) writeStore(watches);
  return listSlackReplyBadges();
}

/** Tests: clear in-memory poll throttle / name cache. */
export function resetSlackOutboundWatchStateForTests(): void {
  lastPollMs = 0;
  nameCache.clear();
}

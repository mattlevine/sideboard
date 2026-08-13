import { slackApi } from './api.js';

export type SlackDestinationKind = 'channel' | 'user' | 'dm';

export interface SlackDestination {
  /** Conversation id to pass to chat.postMessage (C… / G… / D…). */
  channelId: string;
  kind: SlackDestinationKind;
  /** User id when kind is user (before / after opening the DM). */
  userId?: string;
  label: string;
}

export interface SlackUserSummary {
  id: string;
  name: string;
  real_name?: string;
  display_name?: string;
  email?: string;
}

type SlackUserMember = {
  id?: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    real_name?: string;
    display_name?: string;
    email?: string;
  };
};

function isChannelId(raw: string): boolean {
  return /^[CGD][A-Z0-9]+$/i.test(raw);
}

function isUserId(raw: string): boolean {
  return /^U[A-Z0-9]+$/i.test(raw);
}

function isEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

/** Strip leading # / @ and angle-bracket mention wrappers. */
export function normalizeSlackHandle(raw: string): string {
  let s = raw.trim();
  // <@U123> or <@U123|name>
  const mention = s.match(/^<@([UW][A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (mention?.[1]) return mention[1];
  // <#C123|eng>
  const channelMention = s.match(/^<#([CGD][A-Z0-9]+)(?:\|[^>]+)?>$/i);
  if (channelMention?.[1]) return channelMention[1];
  if (s.startsWith('#') || s.startsWith('@')) s = s.slice(1);
  return s.trim();
}

export async function listSlackUsers(
  token: string,
  opts?: { query?: string; limit?: number; fetchImpl?: typeof fetch },
): Promise<SlackUserSummary[]> {
  const query = opts?.query?.trim().toLowerCase() ?? '';
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));
  const members: SlackUserMember[] = [];
  let cursor: string | undefined;
  do {
    const data = await slackApi<{
      members?: SlackUserMember[];
      response_metadata?: { next_cursor?: string };
    }>(
      token,
      'users.list',
      {
        limit: 200,
        cursor: cursor || undefined,
      },
      opts?.fetchImpl,
    );
    for (const m of data.members ?? []) {
      if (!m.id || m.deleted || m.is_bot) continue;
      members.push(m);
    }
    cursor = data.response_metadata?.next_cursor?.trim() || undefined;
  } while (cursor && members.length < 2000);

  const mapped = members.map((m) => ({
    id: m.id!,
    name: m.name ?? m.id!,
    real_name: m.profile?.real_name,
    display_name: m.profile?.display_name,
    email: m.profile?.email,
  }));

  const filtered = query
    ? mapped.filter((u) => {
        const hay = [u.name, u.real_name, u.display_name, u.email, u.id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(query);
      })
    : mapped;

  return filtered.slice(0, limit);
}

async function findUserId(
  token: string,
  handle: string,
  fetchImpl?: typeof fetch,
): Promise<SlackUserSummary> {
  if (isUserId(handle)) {
    return { id: handle, name: handle };
  }
  if (isEmail(handle)) {
    try {
      const data = await slackApi<{ user?: SlackUserMember }>(
        token,
        'users.lookupByEmail',
        { email: handle },
        fetchImpl,
      );
      if (data.user?.id) {
        return {
          id: data.user.id,
          name: data.user.name ?? data.user.id,
          real_name: data.user.profile?.real_name,
          display_name: data.user.profile?.display_name,
          email: data.user.profile?.email,
        };
      }
    } catch {
      // Fall through to list search when email scope is missing.
    }
  }

  const users = await listSlackUsers(token, { query: handle, limit: 20, fetchImpl });
  const exact = users.find(
    (u) =>
      u.name.toLowerCase() === handle.toLowerCase() ||
      u.display_name?.toLowerCase() === handle.toLowerCase() ||
      u.real_name?.toLowerCase() === handle.toLowerCase() ||
      u.email?.toLowerCase() === handle.toLowerCase(),
  );
  if (exact) return exact;
  if (users.length === 1) return users[0]!;
  if (users.length === 0) {
    throw new Error(`No Slack user matching "${handle}"`);
  }
  throw new Error(
    `Ambiguous Slack user "${handle}". Matches: ${users
      .slice(0, 5)
      .map((u) => `${u.name} (${u.id})`)
      .join(', ')}. Pass a user id (U…) or use slack_list_users.`,
  );
}

async function openDmChannel(
  token: string,
  userId: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const data = await slackApi<{ channel?: { id?: string } }>(
    token,
    'conversations.open',
    { users: userId },
    fetchImpl,
  );
  const id = data.channel?.id?.trim();
  if (!id) throw new Error(`Could not open Slack DM with user ${userId}`);
  return id;
}

async function resolveChannelByName(
  token: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const data = await slackApi<{
    channels?: Array<{ id?: string; name?: string }>;
  }>(
    token,
    'conversations.list',
    {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
    },
    fetchImpl,
  );
  const match = (data.channels ?? []).find((c) => c.name?.toLowerCase() === name.toLowerCase());
  if (!match?.id) throw new Error(`No Slack channel named #${name}`);
  return match.id;
}

/**
 * Resolve a Slack destination for posting or reading.
 * Accepts #channel, @user, C/G/D ids, U ids, email, or bare channel/user names.
 * For users, opens a DM conversation and returns the D… channel id.
 */
export async function resolveSlackDestination(
  token: string,
  destination: string,
  opts?: { fetchImpl?: typeof fetch; forRead?: boolean },
): Promise<SlackDestination> {
  const raw = destination.trim();
  if (!raw) throw new Error('destination is required');

  const hadAt = raw.startsWith('@') || /^<@/i.test(raw);
  const hadHash = raw.startsWith('#') || /^<#/i.test(raw);
  const handle = normalizeSlackHandle(raw);

  if (isChannelId(handle)) {
    return {
      channelId: handle,
      kind: handle.toUpperCase().startsWith('D') ? 'dm' : 'channel',
      label: handle,
    };
  }

  if (isUserId(handle) || hadAt || isEmail(handle)) {
    const user = await findUserId(token, handle, opts?.fetchImpl);
    if (opts?.forRead) {
      // Reading a DM still needs the conversation id.
      const channelId = await openDmChannel(token, user.id, opts?.fetchImpl);
      return {
        channelId,
        kind: 'user',
        userId: user.id,
        label: user.display_name || user.real_name || user.name,
      };
    }
    const channelId = await openDmChannel(token, user.id, opts?.fetchImpl);
    return {
      channelId,
      kind: 'user',
      userId: user.id,
      label: user.display_name || user.real_name || user.name,
    };
  }

  if (hadHash) {
    const channelId = await resolveChannelByName(token, handle, opts?.fetchImpl);
    return { channelId, kind: 'channel', label: `#${handle}` };
  }

  // Bare name: try channel first, then user.
  try {
    const channelId = await resolveChannelByName(token, handle, opts?.fetchImpl);
    return { channelId, kind: 'channel', label: `#${handle}` };
  } catch (channelErr) {
    try {
      const user = await findUserId(token, handle, opts?.fetchImpl);
      const channelId = await openDmChannel(token, user.id, opts?.fetchImpl);
      return {
        channelId,
        kind: 'user',
        userId: user.id,
        label: user.display_name || user.real_name || user.name,
      };
    } catch {
      throw channelErr;
    }
  }
}

/** Back-compat: resolve a channel id only (no user DM open). */
export async function resolveChannelId(
  token: string,
  channel: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const dest = await resolveSlackDestination(token, channel, { fetchImpl, forRead: true });
  return dest.channelId;
}

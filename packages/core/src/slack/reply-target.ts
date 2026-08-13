import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appDataDir } from '../store/paths.js';
import { writePrivateFile } from '../store/private-file.js';
import { isSecureFileEncrypted, readSecureJson } from '../store/secure-file.js';

export interface SlackReplyTarget {
  threadId: string;
  teamId: string;
  channelId: string;
  /** Omit for top-level DMs so replies stay in the main conversation. */
  threadTs?: string;
}

type Store = { targets?: Record<string, SlackReplyTarget> };

function storePath(): string {
  return join(appDataDir(), 'slack-reply-to.json');
}

function readStore(): Record<string, SlackReplyTarget> {
  const path = storePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = isSecureFileEncrypted(path)
      ? readSecureJson<Store>(path)
      : (JSON.parse(readFileSync(path, 'utf8')) as Store);
    return parsed?.targets && typeof parsed.targets === 'object' ? parsed.targets : {};
  } catch {
    return {};
  }
}

export function setSlackReplyTarget(target: SlackReplyTarget): void {
  const targets = readStore();
  targets[target.threadId] = target;
  writePrivateFile(storePath(), `${JSON.stringify({ targets }, null, 2)}\n`);
}

export function getSlackReplyTarget(threadId: string): SlackReplyTarget | null {
  return readStore()[threadId] ?? null;
}

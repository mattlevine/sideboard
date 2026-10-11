import { getGitHubStatus } from '../integrations/github.js';

/** Same cadence as the desktop sidebar's GitHub login poll. */
const TTL_MS = 5 * 60_000;

let cached = '';
let fetchedAt = 0;
let inflight: Promise<string> | null = null;

/** Last known GitHub login. Empty until a refresh resolves. */
export function phoneViewerLogin(): string {
  return cached;
}

/**
 * `gh api user`, shared across phone sidebar pushes. A warm cache returns
 * immediately so a thread write does not shell out.
 */
export function refreshPhoneViewerLogin(force = false): Promise<string> {
  const now = Date.now();
  if (!force && fetchedAt && now - fetchedAt < TTL_MS) return Promise.resolve(cached);
  if (inflight) return inflight;
  const run = getGitHubStatus()
    .then((status) => {
      cached = status.login?.trim() ?? '';
      fetchedAt = Date.now();
      return cached;
    })
    .catch(() => cached)
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

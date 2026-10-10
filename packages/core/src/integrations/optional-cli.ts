import {
  installNpmGlobalPackage,
  whichOnPath,
  type AgentSetupActionResult,
} from '../agents/install.js';
import { enrichPathWithNpmGlobalBin } from '../agents/path.js';
import {
  OPTIONAL_SERVICES,
  isOptionalServiceId,
  optionalServiceSpec,
  type OptionalCliPresence,
  type OptionalServiceId,
} from './optional-services.js';

export interface OptionalServiceCliStatus {
  id: OptionalServiceId;
  /** Binary name, or null when the service has no CLI (PostHog). */
  cli: string | null;
  installed: boolean;
  path: string | null;
}

export async function detectOptionalServiceClis(): Promise<OptionalServiceCliStatus[]> {
  enrichPathWithNpmGlobalBin();
  return Promise.all(
    OPTIONAL_SERVICES.map(async (spec) => {
      if (!spec.cli) {
        return { id: spec.id, cli: null, installed: false, path: null };
      }
      const path = await whichOnPath(spec.cli);
      return {
        id: spec.id,
        cli: spec.cli,
        installed: Boolean(path),
        path,
      };
    }),
  );
}

const CLI_PRESENCE_TTL_MS = 60_000;
const cliPresenceCache = new Map<OptionalServiceId, { at: number; installed: boolean }>();

/** Test hook. Presence is cached so a turn does not `which` on every message. */
export function clearOptionalCliPresenceCache(): void {
  cliPresenceCache.clear();
}

/**
 * `which` for connector CLIs. Does not call `detectOptionalServiceClis` or
 * `npm prefix -g`, and does not mutate `process.env`.
 * Pass only connected CLI ids — PostHog has no binary and is ignored.
 */
export async function optionalCliPresence(
  ids: readonly OptionalServiceId[],
): Promise<OptionalCliPresence> {
  const presence: OptionalCliPresence = {};
  const now = Date.now();
  await Promise.all(
    ids.map(async (id) => {
      const spec = optionalServiceSpec(id);
      if (!spec.cli) return;
      const hit = cliPresenceCache.get(id);
      if (hit && now - hit.at < CLI_PRESENCE_TTL_MS) {
        presence[id] = hit.installed;
        return;
      }
      const path = await whichOnPath(spec.cli);
      const installed = Boolean(path);
      cliPresenceCache.set(id, { at: now, installed });
      presence[id] = installed;
    }),
  );
  return presence;
}

/** Install a connector CLI via the same `npm i -g` path as Settings → Agents. */
export async function installOptionalServiceCli(
  id: OptionalServiceId,
): Promise<AgentSetupActionResult> {
  if (!isOptionalServiceId(id)) {
    return { ok: false, message: 'Unknown optional service' };
  }
  const spec = optionalServiceSpec(id);
  if (!spec.cli || !spec.npmPackage) {
    return {
      ok: false,
      message: `${spec.label} has no CLI to install. Agents call posthog_api.`,
    };
  }
  // Connector CLIs stay skip-if-present. Agent Install is the path that
  // always re-runs npm / vendor update.
  enrichPathWithNpmGlobalBin();
  const existing = await whichOnPath(spec.cli);
  if (existing) {
    return {
      ok: true,
      command: existing,
      message: `Already on PATH: ${existing}`,
    };
  }
  return installNpmGlobalPackage({
    npmPackage: spec.npmPackage,
    installCommand: `npm install -g ${spec.npmPackage}`,
    cliBin: spec.cli,
  });
}

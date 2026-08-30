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
      message: `${spec.label} has no CLI to install. Use the HTTP API with the stored token.`,
    };
  }
  return installNpmGlobalPackage({
    npmPackage: spec.npmPackage,
    installCommand: `npm install -g ${spec.npmPackage}`,
    cliBin: spec.cli,
  });
}

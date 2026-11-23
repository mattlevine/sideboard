/**
 * Built-in ACP harnesses. One AgentKind (`acp`); which CLI launches is this id.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from '../git/run.js';
import { loadAppSettings } from '../store/app-settings.js';
import type { AcpHarnessId, AgentKind, AgentStatus } from '../types/thread.js';

export type { AcpHarnessId } from '../types/thread.js';

export type AcpHarnessSpec = {
  id: AcpHarnessId;
  label: string;
  bin: string;
  /** Args that start the CLI as an ACP agent on stdio. */
  args: string[];
  npmPackage: string;
  installCommand: string;
  loginCommand: string;
  docsUrl: string;
  /** Shown when the binary is installed but no local credential was found. */
  authHint: string;
};

export const ACP_HARNESSES: Record<AcpHarnessId, AcpHarnessSpec> = {
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    args: ['--acp'],
    npmPackage: '@google/gemini-cli',
    installCommand: 'npm install -g @google/gemini-cli',
    loginCommand: 'gemini',
    docsUrl: 'https://geminicli.com/docs/cli/acp-mode/',
    authHint:
      'Gemini CLI is on PATH but no API key or ~/.gemini login was found. Set GEMINI_API_KEY or run `gemini` once to sign in.',
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot CLI',
    bin: 'copilot',
    args: ['--acp', '--stdio'],
    npmPackage: '@github/copilot',
    installCommand: 'npm install -g @github/copilot',
    loginCommand: 'copilot',
    docsUrl: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server',
    authHint:
      'Copilot CLI is on PATH but no GitHub token was found. Set GH_TOKEN / GITHUB_TOKEN / COPILOT_GITHUB_TOKEN, or run `copilot` once to sign in.',
  },
};

export const ACP_HARNESS_IDS = Object.keys(ACP_HARNESSES) as AcpHarnessId[];

export function isAcpHarnessId(value: unknown): value is AcpHarnessId {
  return value === 'gemini' || value === 'copilot';
}

export function acpHarnessLabel(id: string | null | undefined): string {
  if (isAcpHarnessId(id)) return ACP_HARNESSES[id].label;
  return 'ACP';
}

/** Settings default, else Gemini CLI. */
export function defaultAcpHarness(): AcpHarnessId {
  const stored = loadAppSettings().defaults?.acpHarness;
  return isAcpHarnessId(stored) ? stored : 'gemini';
}

export function agentSupportsAttach(agent: AgentKind): boolean {
  return agent !== 'acp';
}

const AUTH_READ_MAX = 64_000;

function envSet(env: NodeJS.ProcessEnv, ...keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()));
}

function fileMentionsCredential(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const text = readFileSync(path, 'utf8').slice(0, AUTH_READ_MAX);
    return (
      /"(access_token|refresh_token|oauth_token|api_key|apiKey)"\s*:/i.test(text) ||
      /oauth_token\s*:/i.test(text)
    );
  } catch {
    return false;
  }
}

/**
 * Local, non-interactive auth hint. Does not spawn the CLI (a login prompt
 * would hang detect). A miss means "we did not find a credential", not a
 * proof the CLI will reject the turn.
 */
export function acpHarnessLooksAuthenticated(
  id: AcpHarnessId,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): boolean {
  if (id === 'gemini') {
    if (envSet(env, 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY')) return true;
    return (
      fileMentionsCredential(join(home, '.gemini', 'oauth_creds.json')) ||
      fileMentionsCredential(join(home, '.gemini', 'google_accounts.json'))
    );
  }
  if (envSet(env, 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN')) return true;
  return (
    fileMentionsCredential(join(home, '.copilot', 'config.json')) ||
    fileMentionsCredential(join(home, '.config', 'gh', 'hosts.yml'))
  );
}

export function acpHarnessStatus(input: {
  id: AcpHarnessId;
  /** Absolute path from `which`, or null when the binary is missing. */
  binPath: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
}): AgentStatus {
  const spec = ACP_HARNESSES[input.id];
  if (!input.binPath) {
    return {
      agent: 'acp',
      acpHarness: input.id,
      label: spec.label,
      installed: false,
      authenticated: false,
      linearMcp: false,
      warnings: [],
      reason: `${spec.label} is not on PATH (\`${spec.bin}\`). ${spec.installCommand}`,
    };
  }
  const authenticated = acpHarnessLooksAuthenticated(
    input.id,
    input.env ?? process.env,
    input.home ?? homedir(),
  );
  return {
    agent: 'acp',
    acpHarness: input.id,
    label: spec.label,
    installed: true,
    authenticated,
    linearMcp: false,
    warnings: [],
    ...(authenticated ? {} : { reason: spec.authHint }),
  };
}

export async function resolveAcpHarnessCommand(
  id: AcpHarnessId,
): Promise<{ file: string; args: string[] }> {
  const spec = ACP_HARNESSES[id];
  const which = await run('which', [spec.bin], { reject: false, timeoutMs: 3_000 });
  const file = which.exitCode === 0 ? which.stdout.trim().split('\n')[0]?.trim() ?? '' : '';
  if (!file) {
    throw new Error(`${spec.label} is not on PATH. ${spec.installCommand}`);
  }
  return { file, args: [...spec.args] };
}

export async function detectAcpHarness(id: AcpHarnessId): Promise<AgentStatus> {
  const spec = ACP_HARNESSES[id];
  const which = await run('which', [spec.bin], { reject: false, timeoutMs: 3_000 });
  const file = which.exitCode === 0 ? which.stdout.trim().split('\n')[0]?.trim() ?? '' : '';
  return acpHarnessStatus({ id, binPath: file || null });
}

export async function detectAcpHarnesses(): Promise<AgentStatus[]> {
  return Promise.all(ACP_HARNESS_IDS.map((id) => detectAcpHarness(id)));
}

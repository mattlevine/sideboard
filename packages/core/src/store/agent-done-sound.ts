import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { appDataDir } from './paths.js';

/** Max size for an imported agent-done sound (5 MiB). */
export const AGENT_DONE_CUSTOM_SOUND_MAX_BYTES = 5 * 1024 * 1024;

const AUDIO_EXT_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.caf': 'audio/x-caf',
  '.flac': 'audio/flac',
};

export const AGENT_DONE_CUSTOM_SOUND_EXTENSIONS = Object.keys(AUDIO_EXT_MIME);

export function agentDoneSoundsDir(): string {
  const dir = join(appDataDir(), 'sounds');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeExt(ext: string): string {
  const e = ext.trim().toLowerCase();
  return e.startsWith('.') ? e : `.${e}`;
}

export function agentDoneCustomSoundMime(extOrPath: string): string | null {
  const ext = normalizeExt(extname(extOrPath) || extOrPath);
  return AUDIO_EXT_MIME[ext] ?? null;
}

/** Stored copy lives at `sounds/agent-done.<ext>` (one custom file at a time). */
export function findAgentDoneCustomSoundPath(): string | null {
  const dir = agentDoneSoundsDir();
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('agent-done.')) continue;
    const full = join(dir, name);
    if (existsSync(full) && agentDoneCustomSoundMime(name)) return full;
  }
  return null;
}

export function clearAgentDoneCustomSoundFile(): void {
  const dir = agentDoneSoundsDir();
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('agent-done.')) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {
      /* ignore */
    }
  }
}

export type ImportedAgentDoneSound = {
  /** Original basename for display in Settings. */
  name: string;
  /** Absolute path of the copied file under app data. */
  path: string;
  mime: string;
};

/**
 * Copy a user-picked audio file into app data as the custom agent-done sound.
 * Replaces any previous custom file.
 */
export function importAgentDoneCustomSound(sourcePath: string): ImportedAgentDoneSound {
  const trimmed = sourcePath.trim();
  if (!trimmed || !existsSync(trimmed)) {
    throw new Error('Sound file not found');
  }
  const ext = normalizeExt(extname(trimmed));
  const mime = AUDIO_EXT_MIME[ext];
  if (!mime) {
    throw new Error(
      `Unsupported audio type (use ${AGENT_DONE_CUSTOM_SOUND_EXTENSIONS.join(', ')})`,
    );
  }
  const data = readFileSync(trimmed);
  if (data.byteLength === 0) throw new Error('Sound file is empty');
  if (data.byteLength > AGENT_DONE_CUSTOM_SOUND_MAX_BYTES) {
    throw new Error('Sound file is too large (max 5 MB)');
  }

  clearAgentDoneCustomSoundFile();
  const dest = join(agentDoneSoundsDir(), `agent-done${ext}`);
  copyFileSync(trimmed, dest);
  return {
    name: basename(trimmed),
    path: dest,
    mime,
  };
}

export type AgentDoneCustomSoundPayload = {
  name: string;
  mime: string;
  dataBase64: string;
};

/** Read the imported custom sound for renderer playback (or null if missing). */
export function readAgentDoneCustomSound(
  displayName?: string | null,
): AgentDoneCustomSoundPayload | null {
  const path = findAgentDoneCustomSoundPath();
  if (!path) return null;
  const mime = agentDoneCustomSoundMime(path);
  if (!mime) return null;
  const data = readFileSync(path);
  if (data.byteLength === 0) return null;
  return {
    name: displayName?.trim() || basename(path),
    mime,
    dataBase64: data.toString('base64'),
  };
}

import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { mapSpeechDictateError, speechDictateSourcePaths } from './speech-dictate-util';

const execFileAsync = promisify(execFile);
const MAX_WAV_BYTES = 12 * 1024 * 1024;

function packagedHelperBinary(): string | null {
  if (!app.isPackaged) return null;
  const bin = join(
    process.resourcesPath,
    'speech-dictate.app',
    'Contents',
    'MacOS',
    'speech-dictate',
  );
  return existsSync(bin) ? bin : null;
}

function helperNeedsRebuild(bin: string, swift: string): boolean {
  if (!existsSync(bin)) return true;
  try {
    return statSync(swift).mtimeMs > statSync(bin).mtimeMs;
  } catch {
    return true;
  }
}

function repoStagedHelperBinary(): string | null {
  const bin = join(
    __dirname,
    '../../build/speech-dictate.app',
    'Contents',
    'MacOS',
    'speech-dictate',
  );
  return existsSync(bin) ? bin : null;
}

export function ensureSpeechDictateHelper(opts?: {
  sourceRoot?: string;
  appRoot?: string;
}): string {
  const packaged = packagedHelperBinary();
  if (packaged) return packaged;

  const { swift, plist } = speechDictateSourcePaths(
    opts?.sourceRoot ?? join(__dirname, '../../native'),
  );
  const staged = repoStagedHelperBinary();
  if (staged && existsSync(swift) && !helperNeedsRebuild(staged, swift)) return staged;
  if (!existsSync(swift) || !existsSync(plist)) {
    throw new Error('Dictation helper source is missing.');
  }
  const appRoot = opts?.appRoot ?? join(app.getPath('userData'), 'speech-dictate.app');
  const bin = join(appRoot, 'Contents', 'MacOS', 'speech-dictate');
  if (!helperNeedsRebuild(bin, swift)) return bin;

  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(join(appRoot, 'Contents', 'Info.plist'), readFileSync(plist));
  try {
    execFileSync('swiftc', ['-O', '-o', bin, swift], { timeout: 120_000, stdio: 'pipe' });
  } catch (err) {
    throw new Error(mapSpeechDictateError(err instanceof Error ? err.message : String(err)));
  }
  if (!existsSync(bin)) {
    throw new Error('Could not build the dictation helper. Install Xcode command-line tools.');
  }
  return bin;
}

export async function transcribeWavFile(
  wav: Buffer,
  locale = 'en-US',
  helper?: string,
): Promise<string> {
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  if (buf.byteLength < 48 || buf.byteLength > MAX_WAV_BYTES) {
    throw new Error('No microphone input. Hold the mic and speak, then release.');
  }
  const bin = helper ?? ensureSpeechDictateHelper();
  const dir = mkdtempSync(join(tmpdir(), 'sideboard-dictate-'));
  const wavPath = join(dir, 'clip.wav');
  try {
    writeFileSync(wavPath, buf);
    const { stdout } = await execFileAsync(bin, [wavPath, locale], {
      timeout: 50_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr)
        : '';
    throw new Error(
      mapSpeechDictateError(stderr || (err instanceof Error ? err.message : String(err))),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

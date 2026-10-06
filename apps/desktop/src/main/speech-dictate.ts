import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import {
  isNoSpeechDictateStderr,
  mapSpeechDictateError,
  SPEECH_DICTATE_BUNDLE_ID,
  speechDictateOpenArgs,
  speechDictateSourcePaths,
} from './speech-dictate-util';

const execFileAsync = promisify(execFile);
const MAX_WAV_BYTES = 12 * 1024 * 1024;

function helperBinary(appRoot: string): string {
  return join(appRoot, 'Contents', 'MacOS', 'speech-dictate');
}

function packagedHelperApp(): string | null {
  if (!app.isPackaged) return null;
  const appRoot = join(process.resourcesPath, 'speech-dictate.app');
  return existsSync(helperBinary(appRoot)) ? appRoot : null;
}

function helperNeedsRebuild(bin: string, swift: string, plist: string): boolean {
  if (!existsSync(bin)) return true;
  try {
    const binM = statSync(bin).mtimeMs;
    if (statSync(swift).mtimeMs > binM) return true;
    if (existsSync(plist) && statSync(plist).mtimeMs > binM) return true;
    return false;
  } catch {
    return true;
  }
}

function repoStagedHelperApp(): string | null {
  const appRoot = join(__dirname, '../../build/speech-dictate.app');
  return existsSync(helperBinary(appRoot)) ? appRoot : null;
}

export function signSpeechDictateApp(appRoot: string): void {
  execFileSync(
    'codesign',
    ['--force', '--sign', '-', '--identifier', SPEECH_DICTATE_BUNDLE_ID, appRoot],
    { timeout: 30_000, stdio: 'pipe' },
  );
}

function compileSpeechDictateApp(appRoot: string, swift: string, plist: string): string {
  const bin = helperBinary(appRoot);
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
  signSpeechDictateApp(appRoot);
  return appRoot;
}

/** Path to speech-dictate.app (LaunchServices identity), not the inner binary. */
export function ensureSpeechDictateHelper(opts?: {
  sourceRoot?: string;
  appRoot?: string;
}): string {
  const packaged = packagedHelperApp();
  if (packaged) return packaged;

  const { swift, plist } = speechDictateSourcePaths(
    opts?.sourceRoot ?? join(__dirname, '../../native'),
  );
  const staged = repoStagedHelperApp();
  if (staged && existsSync(swift) && existsSync(plist)) {
    if (helperNeedsRebuild(helperBinary(staged), swift, plist)) {
      return compileSpeechDictateApp(staged, swift, plist);
    }
    try {
      signSpeechDictateApp(staged);
    } catch {
      /* already signed */
    }
    return staged;
  }
  if (!existsSync(swift) || !existsSync(plist)) {
    throw new Error('Dictation helper source is missing.');
  }
  const appRoot = opts?.appRoot ?? join(app.getPath('userData'), 'speech-dictate.app');
  if (!helperNeedsRebuild(helperBinary(appRoot), swift, plist)) {
    try {
      signSpeechDictateApp(appRoot);
    } catch {
      /* already signed */
    }
    return appRoot;
  }
  return compileSpeechDictateApp(appRoot, swift, plist);
}

function stopSpeechDictateHelper(): void {
  try {
    execFileSync('killall', ['-9', 'speech-dictate'], { timeout: 5_000, stdio: 'pipe' });
  } catch {
    /* none running */
  }
}

function isExecFileError(err: unknown): err is NodeJS.ErrnoException & { cmd?: string } {
  return Boolean(err && typeof err === 'object' && 'cmd' in err);
}

export async function transcribeWavFile(
  wav: Buffer,
  locale = 'en-US',
  helperApp?: string,
): Promise<string> {
  const buf = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  if (buf.byteLength < 48 || buf.byteLength > MAX_WAV_BYTES) {
    throw new Error('Click the mic, speak, then click it again to stop.');
  }
  const appRoot = helperApp ?? ensureSpeechDictateHelper();
  const dir = mkdtempSync(join(tmpdir(), 'sideboard-dictate-'));
  const wavPath = join(dir, 'clip.wav');
  const stdoutPath = join(dir, 'out.txt');
  const stderrPath = join(dir, 'err.txt');
  try {
    writeFileSync(wavPath, buf);
    writeFileSync(stdoutPath, '');
    writeFileSync(stderrPath, '');
    try {
      await execFileAsync(
        'open',
        speechDictateOpenArgs({
          appRoot,
          wavPath,
          locale,
          stdoutPath,
          stderrPath,
        }),
        { timeout: 50_000 },
      );
    } catch (err) {
      stopSpeechDictateHelper();
      const stderrFile = existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '';
      throw new Error(
        mapSpeechDictateError(
          stderrFile || (err instanceof Error ? err.message : String(err)),
        ),
      );
    }
    const stdout = readFileSync(stdoutPath, 'utf8').trim();
    const stderr = readFileSync(stderrPath, 'utf8').trim();
    if (stdout) return stdout;
    if (isNoSpeechDictateStderr(stderr) || !stderr) return '';
    throw new Error(mapSpeechDictateError(stderr));
  } catch (err) {
    if (isExecFileError(err)) {
      throw new Error(mapSpeechDictateError(err.message));
    }
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

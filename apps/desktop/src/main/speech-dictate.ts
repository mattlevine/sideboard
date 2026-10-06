import { execFile, execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import {
  isFifoWouldBlock,
  isNoSpeechDictateStderr,
  mapSpeechDictateError,
  parseLiveDictateLine,
  SPEECH_DICTATE_BUNDLE_ID,
  speechDictateLiveOpenArgs,
  speechDictateOpenArgs,
  speechDictateSourcePaths,
  writeLivePcmCarry,
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
    return staged;
  }
  if (!existsSync(swift) || !existsSync(plist)) {
    throw new Error('Dictation helper source is missing.');
  }
  const appRoot = opts?.appRoot ?? join(app.getPath('userData'), 'speech-dictate.app');
  if (!helperNeedsRebuild(helperBinary(appRoot), swift, plist)) {
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

export type LiveDictateEvent =
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string };

type LiveSession = {
  dir: string;
  pcmFd: number | null;
  stdoutPath: string;
  stderrPath: string;
  offset: number;
  carry: string;
  poll: ReturnType<typeof setInterval> | null;
  onEvent: (ev: LiveDictateEvent) => void;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (err: Error) => void;
  ended: Promise<void>;
  resolveEnded: () => void;
  closing: boolean;
  pcmPending: Buffer;
};

let liveSession: LiveSession | null = null;

function consumeLiveStdout(session: LiveSession): void {
  let raw: Buffer;
  try {
    raw = readFileSync(session.stdoutPath);
  } catch {
    return;
  }
  if (raw.length <= session.offset) return;
  const chunk = raw.subarray(session.offset).toString('utf8');
  session.offset = raw.length;
  session.carry += chunk;
  const lines = session.carry.split('\n');
  session.carry = lines.pop() ?? '';
  for (const line of lines) {
    const parsed = parseLiveDictateLine(line);
    if (!parsed) continue;
    if (parsed.k === 'r') {
      session.resolveReady();
      continue;
    }
    if (parsed.k === 'p') {
      session.onEvent({ type: 'partial', text: parsed.t });
      continue;
    }
    if (parsed.k === 'f') {
      session.onEvent({ type: 'final', text: parsed.t });
      if (session.closing) session.resolveEnded();
      continue;
    }
    if (parsed.k === 'e') {
      const message = mapSpeechDictateError(parsed.t || 'Could not transcribe dictation.');
      session.onEvent({ type: 'error', message });
      session.rejectReady(new Error(message));
      session.resolveEnded();
    }
  }
}

function closeLivePcm(session: LiveSession): void {
  if (session.pcmFd == null) return;
  try {
    closeSync(session.pcmFd);
  } catch {
    /* already closed */
  }
  session.pcmFd = null;
}

function disposeLiveSession(session: LiveSession): void {
  if (session.poll) {
    clearInterval(session.poll);
    session.poll = null;
  }
  closeLivePcm(session);
  rmSync(session.dir, { recursive: true, force: true });
}

export async function startLiveSpeechDictate(
  locale: string,
  onEvent: (ev: LiveDictateEvent) => void,
): Promise<void> {
  await stopLiveSpeechDictate();
  const appRoot = ensureSpeechDictateHelper();
  const dir = mkdtempSync(join(tmpdir(), 'sideboard-dictate-live-'));
  const fifoPath = join(dir, 'in.pcm');
  const stdoutPath = join(dir, 'out.jsonl');
  const stderrPath = join(dir, 'err.txt');
  writeFileSync(stdoutPath, '');
  writeFileSync(stderrPath, '');
  execFileSync('mkfifo', [fifoPath], { timeout: 5_000 });
  const pcmFd = openSync(fifoPath, constants.O_RDWR | constants.O_NONBLOCK);
  let readySettled = false;
  let resolveReady = () => {};
  let rejectReady = (_err: Error) => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve();
    };
    rejectReady = (err) => {
      if (readySettled) return;
      readySettled = true;
      reject(err);
    };
  });
  let endedSettled = false;
  let resolveEnded = () => {};
  const ended = new Promise<void>((resolve) => {
    resolveEnded = () => {
      if (endedSettled) return;
      endedSettled = true;
      resolve();
    };
  });
  const session: LiveSession = {
    dir,
    pcmFd,
    stdoutPath,
    stderrPath,
    offset: 0,
    carry: '',
    poll: null,
    onEvent,
    ready,
    resolveReady,
    rejectReady,
    ended,
    resolveEnded,
    closing: false,
    pcmPending: Buffer.alloc(0),
  };
  liveSession = session;
  session.poll = setInterval(() => {
    if (liveSession !== session) return;
    consumeLiveStdout(session);
  }, 40);
  try {
    await execFileAsync(
      'open',
      speechDictateLiveOpenArgs({
        appRoot,
        fifoPath,
        locale,
        stdoutPath,
        stderrPath,
      }),
      { timeout: 15_000 },
    );
  } catch (err) {
    const stderrFile = existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '';
    disposeLiveSession(session);
    if (liveSession === session) liveSession = null;
    throw new Error(
      mapSpeechDictateError(
        stderrFile || (err instanceof Error ? err.message : String(err)),
      ),
    );
  }
  const timeout = setTimeout(() => {
    const stderrFile = existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8').trim() : '';
    session.rejectReady(
      new Error(mapSpeechDictateError(stderrFile || 'Could not start dictation.')),
    );
  }, 20_000);
  try {
    await session.ready;
  } catch (err) {
    stopSpeechDictateHelper();
    disposeLiveSession(session);
    if (liveSession === session) liveSession = null;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function flushLivePcmPending(session: LiveSession): void {
  const fd = session.pcmFd;
  if (fd == null || session.pcmPending.length === 0) return;
  for (let i = 0; i < 4 && session.pcmPending.length > 0; i++) {
    try {
      const n = writeSync(fd, session.pcmPending);
      if (!Number.isFinite(n) || n <= 0) return;
      session.pcmPending = session.pcmPending.subarray(n);
    } catch (err) {
      if (isFifoWouldBlock(err)) return;
      session.pcmPending = Buffer.alloc(0);
      return;
    }
  }
}

export function pushLiveSpeechPcm(pcm: Buffer): void {
  const session = liveSession;
  if (!session || session.pcmFd == null) return;
  if (pcm.byteLength === 0 || pcm.byteLength > 64 * 1024) return;
  const fd = session.pcmFd;
  session.pcmPending = writeLivePcmCarry(
    (buf) => writeSync(fd, buf),
    session.pcmPending,
    pcm,
  );
}

export async function stopLiveSpeechDictate(): Promise<void> {
  const session = liveSession;
  if (!session) return;
  session.closing = true;
  session.rejectReady(new Error('stopped'));
  flushLivePcmPending(session);
  closeLivePcm(session);
  consumeLiveStdout(session);
  const timeout = setTimeout(() => {
    stopSpeechDictateHelper();
    session.resolveEnded();
  }, 4_000);
  try {
    await session.ended;
  } finally {
    clearTimeout(timeout);
    consumeLiveStdout(session);
    disposeLiveSession(session);
    if (liveSession === session) liveSession = null;
  }
}

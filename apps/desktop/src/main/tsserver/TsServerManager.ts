/**
 * Spawns tsserver in the Electron main process so the file UI can resolve
 * imports against a real worktree (tsconfig + node_modules), unlike Monaco's
 * in-browser TypeScript worker.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, sep } from 'node:path';
import type { BrowserWindow } from 'electron';

// Main is bundled as CJS; resolve the app's typescript dependency.
const require = createRequire(`${__dirname}/`);

interface TsServerRequest {
  seq: number;
  type: 'request';
  command: string;
  arguments?: unknown;
}

interface TsServerResponse {
  seq: number;
  type: 'response';
  request_seq: number;
  success: boolean;
  command: string;
  message?: string;
  body?: unknown;
}

interface TsServerEvent {
  seq: number;
  type: 'event';
  event: string;
  body?: unknown;
}

type TsServerMessage = TsServerResponse | TsServerEvent;

function lineCountAndLastOffset(text: string): { lines: number; lastOffset: number } {
  if (text.length === 0) return { lines: 1, lastOffset: 1 };
  const parts = text.split('\n');
  const last = parts[parts.length - 1] ?? '';
  // tsserver offsets are 1-based character positions within the line
  return { lines: parts.length, lastOffset: last.length + 1 };
}

export class TsServerManager {
  private tsserverProcess: ChildProcess | null = null;
  private window: BrowserWindow | null;
  private messageBuffer = '';
  private requestSeq = 0;
  private isInitialized = false;
  private worktreePath: string | null = null;
  /** Last known content per open file — used for full-buffer change ranges. */
  private fileContents = new Map<string, string>();

  constructor(window: BrowserWindow) {
    this.window = window;
  }

  setWindow(window: BrowserWindow): void {
    this.window = window;
  }

  async start(worktreePath?: string): Promise<void> {
    const nextRoot = worktreePath?.trim() || null;
    if (this.tsserverProcess && this.isInitialized) {
      if (nextRoot && this.worktreePath && nextRoot !== this.worktreePath) {
        await this.stop();
      } else {
        if (nextRoot) this.worktreePath = nextRoot;
        return;
      }
    }

    this.worktreePath = nextRoot;
    const tsserverPath = require.resolve('typescript/lib/tsserver.js');
    const cwd = nextRoot && existsSync(nextRoot) ? nextRoot : process.cwd();
    const nodeModules = join(cwd, 'node_modules');
    const nodePathParts = [
      existsSync(nodeModules) ? nodeModules : null,
      process.env.NODE_PATH,
    ].filter(Boolean);

    this.tsserverProcess = spawn(
      'node',
      [tsserverPath, '--useInferredProjectPerProjectRoot', '--disableAutomaticTypingAcquisition'],
      {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(nodePathParts.length ? { NODE_PATH: nodePathParts.join(sep === '\\' ? ';' : ':') } : {}),
        },
      },
    );

    this.tsserverProcess.stdout?.on('data', (data: Buffer) => {
      this.handleTsServerOutput(data.toString());
    });
    this.tsserverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[TsServerManager] stderr:', data.toString());
    });
    this.tsserverProcess.on('exit', (code) => {
      console.log(`[TsServerManager] exited with code ${code}`);
      this.tsserverProcess = null;
      this.isInitialized = false;
      this.fileContents.clear();
    });

    // Brief settle so stdin is ready for configure
    await new Promise((resolve) => setTimeout(resolve, 200));

    this.isInitialized = true;
    this.sendRequest('configure', {
      hostInfo: 'sideboard',
      preferences: {
        includePackageJsonAutoImports: 'auto',
        disableSuggestions: true,
      },
      watchOptions: {
        followSymlinks: true,
      },
    });
  }

  private handleTsServerOutput(data: string): void {
    this.messageBuffer += data;
    while (true) {
      const headerMatch = this.messageBuffer.match(/Content-Length: (\d+)\r?\n\r?\n/);
      if (!headerMatch) break;

      const contentLength = Number.parseInt(headerMatch[1]!, 10);
      const headerStart = this.messageBuffer.indexOf(headerMatch[0]!);
      const messageStart = headerStart + headerMatch[0]!.length;
      const messageEnd = messageStart + contentLength;
      if (this.messageBuffer.length < messageEnd) break;

      const messageText = this.messageBuffer.slice(messageStart, messageEnd);
      this.messageBuffer = this.messageBuffer.slice(messageEnd);

      try {
        const message = JSON.parse(messageText) as TsServerMessage;
        this.forwardMessage(message);
      } catch (err) {
        console.error('[TsServerManager] Failed to parse message:', err);
      }
    }
  }

  private forwardMessage(message: TsServerMessage): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('tsserver:message', message);
    }
  }

  sendRequest(command: string, args?: unknown): number {
    if (!this.tsserverProcess || !this.isInitialized) {
      console.error('[TsServerManager] Cannot send — not initialized');
      return -1;
    }
    this.requestSeq += 1;
    const request: TsServerRequest = {
      seq: this.requestSeq,
      type: 'request',
      command,
      arguments: args,
    };
    try {
      this.tsserverProcess.stdin?.write(`${JSON.stringify(request)}\n`);
      return this.requestSeq;
    } catch (err) {
      console.error('[TsServerManager] Failed to write request:', err);
      return -1;
    }
  }

  openFile(filePath: string, fileContent?: string): void {
    const projectRoot = this.getProjectRoot(filePath);
    if (projectRoot) {
      const tsconfigPath = join(projectRoot, 'tsconfig.json');
      if (existsSync(tsconfigPath)) {
        this.sendRequest('open', { file: tsconfigPath });
      }
    }

    const content = fileContent ?? '';
    this.fileContents.set(filePath, content);
    this.sendRequest('open', {
      file: filePath,
      fileContent: content,
      scriptKindName: this.getScriptKind(filePath),
      projectRootPath: projectRoot,
    });
  }

  /** Prefer nearest tsconfig.json; fall back to package.json. */
  private getProjectRoot(filePath: string): string | undefined {
    let dir = dirname(filePath);
    for (let i = 0; i < 40; i++) {
      if (existsSync(join(dir, 'tsconfig.json'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    dir = dirname(filePath);
    for (let i = 0; i < 40; i++) {
      if (existsSync(join(dir, 'package.json'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  }

  closeFile(filePath: string): void {
    this.fileContents.delete(filePath);
    this.sendRequest('close', { file: filePath });
  }

  /** Full-document sync using 1-based line/offset locations. */
  updateFile(filePath: string, content: string): void {
    const previous = this.fileContents.get(filePath) ?? '';
    const { lines, lastOffset } = lineCountAndLastOffset(previous);
    this.sendRequest('change', {
      file: filePath,
      line: 1,
      offset: 1,
      endLine: lines,
      endOffset: lastOffset,
      insertString: content,
    });
    this.fileContents.set(filePath, content);
  }

  getSemanticDiagnostics(filePath: string): number {
    return this.sendRequest('semanticDiagnosticsSync', {
      file: filePath,
      includeLinePosition: true,
    });
  }

  getSyntacticDiagnostics(filePath: string): number {
    return this.sendRequest('syntacticDiagnosticsSync', {
      file: filePath,
      includeLinePosition: true,
    });
  }

  requestDiagnostics(filePath: string, delay = 0): void {
    this.sendRequest('geterr', {
      files: [filePath],
      delay,
    });
  }

  private getScriptKind(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'TS',
      '.tsx': 'TSX',
      '.js': 'JS',
      '.jsx': 'JSX',
      '.mts': 'TS',
      '.cts': 'TS',
      '.mjs': 'JS',
      '.cjs': 'JS',
    };
    return map[ext] ?? 'TS';
  }

  async stop(): Promise<void> {
    if (!this.tsserverProcess) return;
    try {
      this.sendRequest('exit');
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (this.tsserverProcess) {
      this.tsserverProcess.kill();
      this.tsserverProcess = null;
    }
    this.isInitialized = false;
    this.fileContents.clear();
    this.worktreePath = null;
  }

  isRunning(): boolean {
    return this.tsserverProcess !== null && this.isInitialized;
  }
}

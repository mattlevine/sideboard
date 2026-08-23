import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentKind, MessagePart, TokenUsage } from '@sideboard-ai/core';
import { isShellToolName, isSubagentToolName, messagePartParentId, toolActivityLine } from '@sideboard/message-parts';
import {
  extractRightPaneContents,
  isFilesPane,
  isSchemaPane,
  type RightPaneContent,
} from '../lib/right-pane';
import { formatTokenCount, contextTokens, usageTooltip, contextFillRatio, contextMeterTooltip, resolveContextWindow } from '../lib/tokens';
import { ContextMeter } from './ContextMeter';
import type { FilePathLink } from '../lib/file-path-link';
import { FileReferenceModal } from './FileReferenceModal';
import { FloatingMenu } from './FloatingMenu';
import { MarkdownMessage } from './MarkdownMessage';
import { ActivityMark } from './ActivityMark';
import { ToolDiffPopover } from './ToolDiffPopover';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

function StreamingVerb({ verb }: { verb: string }) {
  return <span className="thinking-wave">{verb}</span>;
}

interface Props {
  text: string;
  parts?: MessagePart[];
  ts?: string;
  /** Persisted turn duration (ms). */
  durationMs?: number;
  /** Token usage for this turn, when the agent CLI reports it. */
  usage?: TokenUsage;
  /** Used with usage for the context-fill ring (defaults to Claude-sized window). */
  agent?: AgentKind;
  model?: string | null;
  /** When set (live turn), show a ticking timer from this epoch ms. */
  startedAt?: number;
  streaming?: boolean;
  threadId?: string;
  worktreePath?: string;
  knownFilePaths?: string[];
  onOpenFile?: (path: string) => void;
  /** Navigate to another Sideboard thread from a markdown deep link. */
  onOpenThread?: (threadRef: string) => void;
  /** Open a document or schema pane in the side column. */
  onOpenArtifact?: (content: RightPaneContent) => void;
  /** Currently open right-pane id (highlights the matching chip). */
  activeArtifactId?: string | null;
  /** Prefix for extracted fence/tool ids (must match auto-open logic). */
  artifactIdPrefix?: string;
  /** Fork chat history into a new tab in the same worktree. */
  onFork?: () => void;
  /** Fork into a new git worktree (Conductor-style new workspace). */
  onForkWorkspace?: () => void;
  /** Hide the answer body when the plan card already shows the same markdown. */
  hideAnswer?: boolean;
}

function basename(path: string): string {
  const parts = path.replace(/\/$/, '').split('/');
  return parts[parts.length - 1] || path;
}

export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  const m2 = min % 60;
  return m2 === 0 ? `${hr}h` : `${hr}h ${m2}m`;
}

function useLiveDuration(startedAt: number | undefined, fixedMs: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (startedAt != null) return formatDuration(now - startedAt);
  if (fixedMs != null && Number.isFinite(fixedMs)) return formatDuration(fixedMs);
  return null;
}

function stripBrightsyNdjsonNoise(text: string): string {
  if (!text || !text.includes('"type"')) return text;
  let out = text;
  out = out.replace(
    /\{"type":"(?:tool_use|tool_result|tool|thinking|usage|done|error)"[\s\S]*?\}\s*(?=\{"type":"|$|(?=[A-Za-z*#]))/g,
    '',
  );
  out = out.replace(/\{"type":"(?:tool_use|tool_result|tool)"[\s\S]*$/g, '');
  return out.trim();
}

function finalText(text: string, parts: MessagePart[] | undefined): string {
  if (!parts?.length) return stripBrightsyNdjsonNoise(text);
  const texts = parts.filter(
    (p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text' && !p.parentId,
  );
  if (texts.length === 0) return stripBrightsyNdjsonNoise(text);
  return stripBrightsyNdjsonNoise(texts[texts.length - 1]!.text.trim() || text);
}

function toolChips(parts: MessagePart[], streaming = false): ToolPart[] {
  const tools = parts.filter((p): p is ToolPart => p.type === 'tool');
  if (streaming) {
    const running = tools.filter((t) => t.status === 'running');
    if (running.length) {
      const seen = new Set<string>();
      return running.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      }).slice(-4);
    }
  }
  const edits = tools.filter(
    (t) =>
      Boolean(t.filePath) ||
      /edit|write|apply|multi.?edit/i.test(t.name),
  );
  const list = edits.length > 0 ? edits : tools.slice(-4);
  const seen = new Set<string>();
  return list.filter((t) => {
    const key = t.filePath ?? `${t.name}:${t.detail ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nestedInsight(kids: MessagePart[], live: boolean): string | null {
  for (let i = kids.length - 1; i >= 0; i--) {
    const p = kids[i];
    if (p.type === 'tool' && p.status === 'running') return p.description || p.name;
    if (p.type === 'thinking' && p.text.trim()) return thinkingPreview(p.text, live);
    if (p.type === 'text' && p.text.trim()) return thinkingPreview(p.text, live);
  }
  return null;
}

function toolRowDetail(part: ToolPart, kids: MessagePart[], streaming: boolean): string | undefined {
  if (streaming && isSubagentToolName(part.name) && part.status === 'running') {
    const nested = nestedInsight(kids, true);
    if (nested) return nested;
  }
  return part.detail;
}

function thinkingPreview(text: string, live: boolean): string {
  if (live && text.length > 280) return `…${text.slice(-280)}`;
  if (text.length > 160) return `${text.slice(0, 157)}…`;
  return text;
}

function ThinkingBody({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinToEnd = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !pinToEnd.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div
      ref={ref}
      className={`turn-thinking-pill${live ? ' live' : ''}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
    >
      {text}
    </div>
  );
}

function clipToolTail(text: string, max = 12000): string {
  if (text.length <= max) return text;
  return `…${text.slice(-max)}`;
}

/** Wait this long before painting a live log so `ls` / `git status` never flash a pane. */
const SHELL_TAIL_AFTER_MS = 3000;

function useLongRunningShellIds(parts: MessagePart[], delayMs = SHELL_TAIL_AFTER_MS): Set<string> {
  const firstSeenAt = useRef(new Map<string, number>());
  const [longRunning, setLongRunning] = useState<Set<string>>(() => new Set());
  const runningKey = parts
    .filter((p): p is ToolPart => p.type === 'tool' && p.status === 'running' && isShellToolName(p.name))
    .map((p) => p.id)
    .join('\0');

  useEffect(() => {
    const runningIds = runningKey ? runningKey.split('\0') : [];
    const running = new Set(runningIds);
    const now = Date.now();
    for (const id of [...firstSeenAt.current.keys()]) {
      if (!running.has(id)) firstSeenAt.current.delete(id);
    }
    for (const id of running) {
      if (!firstSeenAt.current.has(id)) firstSeenAt.current.set(id, now);
    }

    const sync = () => {
      const t = Date.now();
      const next = new Set<string>();
      for (const [id, at] of firstSeenAt.current) {
        if (t - at >= delayMs) next.add(id);
      }
      setLongRunning((prev) => {
        if (prev.size === next.size && [...next].every((id) => prev.has(id))) return prev;
        return next;
      });
    };

    sync();
    if (running.size === 0) return;
    const timer = window.setInterval(sync, 250);
    return () => window.clearInterval(timer);
  }, [runningKey, delayMs]);

  return longRunning;
}

function ToolOutputTail({ text, live }: { text: string; live: boolean }) {
  const preRef = useRef<HTMLPreElement>(null);
  const pinToEnd = useRef(true);
  useEffect(() => {
    const el = preRef.current;
    if (!el || !pinToEnd.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={preRef}
      className={`turn-tool-tail${live ? ' live' : ''}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
    >
      {clipToolTail(text)}
    </pre>
  );
}

function groupTranscript(parts: MessagePart[]): {
  top: MessagePart[];
  children: Map<string, MessagePart[]>;
} {
  const toolIds = new Set(
    parts.filter((p): p is ToolPart => p.type === 'tool').map((p) => p.id),
  );
  const children = new Map<string, MessagePart[]>();
  const top: MessagePart[] = [];
  for (const part of parts) {
    const parentId = messagePartParentId(part);
    if (parentId && toolIds.has(parentId)) {
      const list = children.get(parentId) ?? [];
      list.push(part);
      children.set(parentId, list);
    } else {
      top.push(part);
    }
  }
  return { top, children };
}

function hasCodeDiff(tool: ToolPart): boolean {
  const input = tool.input;
  if (!input) return Boolean(tool.filePath);
  return Boolean(
    input.old_string != null ||
      input.oldString != null ||
      input.new_string != null ||
      input.newString != null ||
      input.content != null ||
      tool.filePath,
  );
}

export function AgentMessage({
  text,
  parts,
  durationMs,
  usage,
  agent,
  model,
  startedAt,
  streaming,
  threadId,
  worktreePath,
  knownFilePaths,
  onOpenFile,
  onOpenThread,
  onOpenArtifact,
  activeArtifactId = null,
  artifactIdPrefix,
  onFork,
  onForkWorkspace,
  hideAnswer = false,
}: Props) {
  const [expanded, setExpanded] = useState(() => Boolean(streaming));
  const [menuOpen, setMenuOpen] = useState(false);
  const [diffTool, setDiffTool] = useState<ToolPart | null>(null);
  const [fileRef, setFileRef] = useState<FilePathLink | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const diffAnchorRef = useRef<HTMLElement | null>(null);
  const userToggledTrace = useRef(false);
  const windowTokens = usage
    ? resolveContextWindow(agent ?? 'claude', model, contextTokens(usage))
    : 0;

  function openFileReference(link: FilePathLink) {
    setFileRef(link);
  }

  const safeParts = parts ?? [];
  const longRunningShells = useLongRunningShellIds(safeParts);
  const grouped = groupTranscript(safeParts);
  const thinkingCount = safeParts.filter((p) => p.type === 'thinking').length;
  const usedTools = safeParts.some(
    (p) =>
      p.type === 'tool' &&
      !p.parentId &&
      !/present_plan$/i.test(p.name ?? '') &&
      !/ask_user|AskUserQuestion/i.test(p.name ?? ''),
  );
  const showTrace = usedTools || thinkingCount > 0;
  useEffect(() => {
    if (streaming) {
      if (!userToggledTrace.current) setExpanded(true);
      return;
    }
    userToggledTrace.current = false;
    setExpanded(false);
  }, [streaming]);
  const answer = finalText(text, safeParts);
  const chips = useMemo(() => toolChips(safeParts, Boolean(streaming)), [safeParts, streaming]);
  const activityLine = useMemo(() => toolActivityLine(safeParts), [safeParts]);
  const idPrefix = artifactIdPrefix ?? (streaming ? 'live' : 'msg');
  const paneContents = useMemo(
    () => extractRightPaneContents(answer || text, safeParts, idPrefix),
    [answer, text, safeParts, idPrefix],
  );
  const durationLabel = useLiveDuration(startedAt, durationMs);
  const lastThinking = [...safeParts].reverse().find((p) => p.type === 'thinking');
  const briefThought =
    !durationLabel || (/^\d+s$/.test(durationLabel) && Number(durationLabel.slice(0, -1)) < 8);
  const traceLabel = usedTools
    ? durationLabel
      ? `Worked for ${durationLabel}`
      : 'Worked'
    : briefThought
      ? 'Thought briefly'
      : durationLabel
        ? `Thought ${durationLabel}`
        : 'Thought';

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer || text);
    } catch {
      // ignore
    }
  }

  function openInspector(tool: ToolPart, anchor: HTMLElement) {
    diffAnchorRef.current = anchor;
    setDiffTool((prev) => (prev?.id === tool.id ? null : tool));
  }

  function closeInspector() {
    setDiffTool(null);
  }

  function renderThinking(part: Extract<MessagePart, { type: 'thinking' }>, key: string) {
    const isLive = Boolean(streaming && part === lastThinking);
    return (
      <div key={key} className={`turn-thinking${isLive ? ' live' : ''}`}>
        <ThinkingBody text={part.text} live={isLive} />
      </div>
    );
  }

  function renderToolRow(part: ToolPart, key: string, kids: MessagePart[] = []) {
    if (/present_plan$/i.test(part.name ?? '')) return null;
    if (/ask_user|AskUserQuestion/i.test(part.name ?? '')) return null;
    const clickable = hasCodeDiff(part);
    const isRunning = part.status === 'running';
    const detail = toolRowDetail(part, kids, Boolean(streaming));
    const showTail =
      isRunning &&
      longRunningShells.has(part.id) &&
      Boolean(part.result?.trim());
    return (
      <div key={key} className="turn-tool-block">
        <button
          type="button"
          className={`turn-tool${isRunning ? ' running' : ''}${diffTool?.id === part.id ? ' active' : ''}`}
          onClick={(e) => openInspector(part, e.currentTarget)}
        >
          {isRunning ? (
            <ActivityMark tone="active" size="sm" />
          ) : (
            <span className="turn-icon term" aria-hidden>
              ›_
            </span>
          )}
          <span className="turn-tool-desc">{part.description ?? part.name}</span>
          {detail && (
            <span className={`turn-tool-pill${clickable ? ' clickable' : ''}${isRunning ? ' live' : ''}`}>
              {detail}
            </span>
          )}
        </button>
        {showTail ? <ToolOutputTail text={part.result!} live /> : null}
      </div>
    );
  }

  function renderParts(list: MessagePart[], keyPrefix: string): ReactNode {
    return list.map((part, i) => {
      const key = `${keyPrefix}-${i}`;
      if (part.type === 'thinking') return renderThinking(part, key);
      if (part.type === 'tool') {
        const kids = grouped.children.get(part.id) ?? [];
        const row = renderToolRow(part, `${key}-row`, kids);
        if (!row) return null;
        const showNested = kids.length > 0 || isSubagentToolName(part.name);
        if (!showNested) return row;
        return (
          <div
            key={key}
            className={`turn-subagent${part.status === 'running' ? ' running' : ''}`}
          >
            {row}
            <div className="turn-subagent-stream">
              {kids.length > 0
                ? renderParts(kids, key)
                : streaming && part.status === 'running'
                  ? (
                      <div className="turn-subagent-waiting">
                        <span className="thinking-indicator-label">
                          <span className="thinking-wave">
                            {part.description && part.description !== part.name
                              ? part.description
                              : 'Working'}
                          </span>
                        </span>
                      </div>
                    )
                  : null}
            </div>
          </div>
        );
      }
      return null;
    });
  }

  return (
    <div className={`agent-msg${streaming ? ' streaming' : ''}`}>
      {showTrace && (
        <div className="turn-transcript">
          <button
            type="button"
            className={`turn-summary${streaming ? ' live' : ''}${expanded ? ' open' : ''}`}
            onClick={() => {
              userToggledTrace.current = true;
              setExpanded((v) => !v);
            }}
            aria-expanded={expanded}
          >
            <span className="turn-summary-text">
              {streaming ? (
                <StreamingVerb verb={usedTools ? 'Working' : 'Thinking'} />
              ) : (
                traceLabel
              )}
            </span>
            <span className={`turn-chevron${expanded ? ' open' : ''}`} aria-hidden>
              <svg viewBox="0 0 12 12" width="10" height="10">
                <path
                  d="M4.25 2.4 8.5 6 4.25 9.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
          {expanded && (
            <div className="turn-details">{renderParts(grouped.top, 'top')}</div>
          )}
        </div>
      )}

      {answer && !hideAnswer && (
        <div className="msg-body">
          <MarkdownMessage
            text={answer}
            knownFilePaths={knownFilePaths}
            onFileReferenceClick={threadId ? openFileReference : undefined}
            onThreadLinkClick={onOpenThread}
            isStreaming={streaming}
          />
        </div>
      )}

      {activityLine && (
        <div className="msg-activity-line">
          <span>{activityLine.text}</span>
          {activityLine.additions > 0 && (
            <span className="msg-activity-add">+{activityLine.additions}</span>
          )}
          {activityLine.deletions > 0 && (
            <span className="msg-activity-del">−{activityLine.deletions}</span>
          )}
        </div>
      )}

      {streaming && !showTrace && (
        <div className="msg-body waiting-inline">
          <span className="thinking-indicator-label">
            <StreamingVerb verb="Thinking" />
          </span>
        </div>
      )}

      {(durationLabel ||
        usage ||
        chips.length > 0 ||
        paneContents.length > 0 ||
        onFork ||
        onForkWorkspace) && (
        <div className="msg-footer">
          <div className="msg-footer-left">
            {durationLabel && (
              <span className={`msg-age${startedAt != null ? ' live' : ''}`}>{durationLabel}</span>
            )}
            {usage && (
              <span className="msg-usage" title={usageTooltip(usage)}>
                <ContextMeter
                  ratio={contextFillRatio(usage, windowTokens)}
                  title={contextMeterTooltip(usage, windowTokens)}
                  size={12}
                />
                {formatTokenCount(contextTokens(usage))} tok
              </span>
            )}
            <button type="button" className="msg-foot-btn" title="Copy" onClick={() => void copyAnswer()}>
              ⎘
            </button>
            {(onFork || onForkWorkspace) && (
              <div className="msg-footer-more">
                <button
                  ref={moreBtnRef}
                  type="button"
                  className="msg-foot-btn"
                  title="More"
                  onClick={() => setMenuOpen((v) => !v)}
                >
                  ···
                </button>
                <FloatingMenu
                  open={menuOpen}
                  onClose={() => setMenuOpen(false)}
                  anchorRef={moreBtnRef}
                  align="left"
                  minWidth={200}
                >
                  {onFork && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onFork();
                      }}
                    >
                      <span className="tool-menu-icon">⎇</span>
                      <span>Fork to new tab</span>
                    </button>
                  )}
                  {onForkWorkspace && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onForkWorkspace();
                      }}
                    >
                      <span className="tool-menu-icon">⧉</span>
                      <span>Fork to new workspace</span>
                    </button>
                  )}
                </FloatingMenu>
              </div>
            )}
          </div>
          {(chips.length > 0 || (paneContents.length > 0 && onOpenArtifact)) && (
            <div className="tool-chips">
              {onOpenArtifact &&
                paneContents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`tool-chip artifact-chip${isSchemaPane(a) ? ' schema-chip' : ''}${isFilesPane(a) ? ' files-chip' : ''}${activeArtifactId === a.id ? ' active' : ''}`}
                    title={
                      isFilesPane(a)
                        ? `Open files: ${a.title}`
                        : isSchemaPane(a)
                          ? `Open CMS: ${a.title}`
                          : `Open artifact: ${a.title}`
                    }
                    onClick={() => onOpenArtifact(a)}
                  >
                    <span className="tool-chip-gear" aria-hidden>
                      {isFilesPane(a) ? '▤' : isSchemaPane(a) ? '▦' : '◫'}
                    </span>
                    <span className="tool-chip-name">{a.title}</span>
                  </button>
                ))}
              {chips.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tool-chip${t.status === 'error' ? ' error' : ''}${t.status === 'running' ? ' running' : ''}${diffTool?.id === t.id ? ' active' : ''}`}
                  onClick={(e) => openInspector(t, e.currentTarget)}
                >
                  {t.status === 'running' ? (
                    <ActivityMark tone="active" size="sm" className="tool-chip-activity" />
                  ) : (
                    <span className="tool-chip-gear" aria-hidden>
                      ⚙
                    </span>
                  )}
                  <span className="tool-chip-name">
                    {t.filePath ? basename(t.filePath) : t.name}
                  </span>
                  {hasCodeDiff(t) &&
                    (t.additions != null || t.deletions != null) && (
                    <span className="tool-chip-diff">
                      {t.additions != null && (
                        <span className="add">+{t.additions}</span>
                      )}
                      {t.deletions != null && (
                        <span className="del">-{t.deletions}</span>
                      )}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {streaming && (
        <div className="msg-stream-activity" aria-live="polite" aria-label="Generating">
          <ActivityMark tone="active" size="sm" />
          <span className="thinking-indicator-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </div>
      )}

      {diffTool && (
        <FloatingMenu
          open
          onClose={closeInspector}
          anchorRef={diffAnchorRef}
          align="right"
          placement="up"
          minWidth={480}
          maxMenuHeight={Math.min(420, Math.round(window.innerHeight * 0.55))}
          className="tool-diff-floating"
        >
          <ToolDiffPopover
            tool={diffTool}
            threadId={threadId}
            onClose={closeInspector}
          />
        </FloatingMenu>
      )}

      {fileRef && threadId && onOpenFile && (
        <FileReferenceModal
          threadId={threadId}
          link={fileRef}
          worktreePath={worktreePath}
          onClose={() => setFileRef(null)}
          onOpenInTab={onOpenFile}
        />
      )}
    </div>
  );
}

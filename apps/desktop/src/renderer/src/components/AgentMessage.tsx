import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessagePart, TokenUsage } from '@sideboard-ai/core';
import {
  extractRightPaneContents,
  isFilesPane,
  isSchemaPane,
  type RightPaneContent,
} from '../lib/right-pane';
import { formatTokenCount, totalTokens, usageTooltip } from '../lib/tokens';
import type { FilePathLink } from '../lib/file-path-link';
import { FileReferenceModal } from './FileReferenceModal';
import { FloatingMenu } from './FloatingMenu';
import { MarkdownMessage } from './MarkdownMessage';
import { ActivityMark } from './ActivityMark';
import { ToolDiffPopover } from './ToolDiffPopover';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

interface Props {
  text: string;
  parts?: MessagePart[];
  ts?: string;
  /** Persisted turn duration (ms). */
  durationMs?: number;
  /** Token usage for this turn, when the agent CLI reports it. */
  usage?: TokenUsage;
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
  const texts = parts.filter((p): p is Extract<MessagePart, { type: 'text' }> => p.type === 'text');
  if (texts.length === 0) return stripBrightsyNdjsonNoise(text);
  return stripBrightsyNdjsonNoise(texts[texts.length - 1]!.text.trim() || text);
}

function toolChips(parts: MessagePart[]): ToolPart[] {
  const tools = parts.filter((p): p is ToolPart => p.type === 'tool');
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
  const [expanded, setExpanded] = useState(Boolean(streaming));
  const [menuOpen, setMenuOpen] = useState(false);
  const [diffTool, setDiffTool] = useState<ToolPart | null>(null);
  const [fileRef, setFileRef] = useState<FilePathLink | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const diffAnchorRef = useRef<HTMLElement | null>(null);

  function openFileReference(link: FilePathLink) {
    setFileRef(link);
  }

  const safeParts = parts ?? [];
  const toolCount = safeParts.filter(
    (p) =>
      p.type === 'tool' &&
      !/present_plan$/i.test(p.name ?? '') &&
      !/ask_user|AskUserQuestion/i.test(p.name ?? ''),
  ).length;
  const messageCount = safeParts.filter((p) => p.type === 'text').length;
  const thinkingCount = safeParts.filter((p) => p.type === 'thinking').length;
  const hasTranscript = toolCount > 0 || thinkingCount > 0;
  const answer = finalText(text, safeParts);
  const chips = useMemo(() => toolChips(safeParts), [safeParts]);
  const idPrefix = artifactIdPrefix ?? (streaming ? 'live' : 'msg');
  const paneContents = useMemo(
    () => extractRightPaneContents(answer || text, safeParts, idPrefix),
    [answer, text, safeParts, idPrefix],
  );
  const durationLabel = useLiveDuration(startedAt, durationMs);
  let lastThinkingIdx = -1;
  for (let j = safeParts.length - 1; j >= 0; j--) {
    if (safeParts[j]?.type === 'thinking') {
      lastThinkingIdx = j;
      break;
    }
  }

  const summaryBits: string[] = [];
  if (toolCount > 0) summaryBits.push(`${toolCount} tool call${toolCount === 1 ? '' : 's'}`);
  if (messageCount > 0) summaryBits.push(`${messageCount} message${messageCount === 1 ? '' : 's'}`);
  else if (thinkingCount > 0) summaryBits.push(`${thinkingCount} thinking`);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer || text);
    } catch {
      // ignore
    }
  }

  function openDiff(tool: ToolPart, anchor?: HTMLElement | null) {
    diffAnchorRef.current = anchor ?? moreBtnRef.current;
    setDiffTool((prev) => (prev?.id === tool.id ? null : tool));
  }

  return (
    <div className={`agent-msg${streaming ? ' streaming' : ''}`}>
      {hasTranscript && (
        <div className="turn-transcript">
          <button
            type="button"
            className="turn-summary"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <span className={`turn-chevron${expanded ? ' open' : ''}`}>▸</span>
            <span className="turn-summary-text">{summaryBits.join(', ')}</span>
            <span className="turn-summary-icons" aria-hidden>
              <span title="Tools">›_</span>
              <span title="Transcript">☰</span>
              <span title="Attachments">⧉</span>
            </span>
          </button>

          {expanded && (
            <div className="turn-details">
              {safeParts.map((part, i) => {
                if (part.type === 'thinking') {
                  const isLive = Boolean(streaming && i === lastThinkingIdx);
                  return (
                    <div
                      key={`th-${i}`}
                      className={`turn-thinking${isLive ? ' live' : ''}`}
                    >
                      <div className="turn-thinking-label">
                        {isLive ? (
                          <ActivityMark tone="active" size="sm" />
                        ) : (
                          <span className="turn-icon brain" aria-hidden>
                            ✶
                          </span>
                        )}
                        Thinking
                        {isLive ? (
                          <span className="thinking-indicator-dots" aria-hidden>
                            <span />
                            <span />
                            <span />
                          </span>
                        ) : null}
                      </div>
                      <div className="turn-thinking-pill">
                        {part.text.length > 160 ? `${part.text.slice(0, 157)}…` : part.text}
                      </div>
                    </div>
                  );
                }
                if (part.type === 'tool') {
                  // Plan body is rendered as PlanApprovalCard in the chat stream.
                  if (/present_plan$/i.test(part.name ?? '')) return null;
                  // Questions are rendered as a chat brief + composer panel.
                  if (/ask_user|AskUserQuestion/i.test(part.name ?? '')) return null;
                  const clickable = hasCodeDiff(part);
                  const isRunning = part.status === 'running';
                  return (
                    <div
                      key={`tool-${part.id}-${i}`}
                      className={`turn-tool${isRunning ? ' running' : ''}`}
                    >
                      {isRunning ? (
                        <ActivityMark tone="active" size="sm" />
                      ) : (
                        <span className="turn-icon term" aria-hidden>
                          ›_
                        </span>
                      )}
                      <span className="turn-tool-desc">
                        {part.description ?? part.name}
                      </span>
                      {part.detail && (
                        <button
                          type="button"
                          className={`turn-tool-pill${clickable ? ' clickable' : ''}${isRunning ? ' live' : ''}`}
                          title={clickable ? 'Show diff' : part.detail}
                          onClick={(e) => {
                            if (clickable) openDiff(part, e.currentTarget);
                          }}
                        >
                          {part.detail}
                        </button>
                      )}
                    </div>
                  );
                }
                if (part.type === 'text' && part.text.trim()) {
                  return (
                    <div key={`tx-${i}`} className="turn-text">
                      <MarkdownMessage
                        text={part.text}
                        knownFilePaths={knownFilePaths}
                        onFileReferenceClick={threadId ? openFileReference : undefined}
                        onThreadLinkClick={onOpenThread}
                        isStreaming={streaming}
                      />
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}
        </div>
      )}

      {answer && !hideAnswer && (!hasTranscript || !expanded) && (
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

      {!answer && streaming && !hasTranscript && (
        <div className="msg-body waiting-inline">
          <span className="thinking-indicator-label">Thinking</span>
          <span className="thinking-indicator-dots" aria-hidden>
            <span />
            <span />
            <span />
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
                {formatTokenCount(totalTokens(usage))} tok
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
                  title={hasCodeDiff(t) ? 'Show diff' : 'Show tool input & result'}
                  onClick={(e) => openDiff(t, e.currentTarget)}
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

      {diffTool && (
        <FloatingMenu
          open
          onClose={() => setDiffTool(null)}
          anchorRef={diffAnchorRef}
          align="right"
          placement="auto"
          minWidth={480}
          maxMenuHeight={Math.min(420, Math.round(window.innerHeight * 0.55))}
          className="tool-diff-floating"
        >
          <ToolDiffPopover
            tool={diffTool}
            threadId={threadId}
            onClose={() => setDiffTool(null)}
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

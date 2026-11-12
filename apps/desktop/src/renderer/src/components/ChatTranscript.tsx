import { memo, useEffect, useState } from 'react';
import type {
  DiffScope,
  MessagePart,
  Thread,
  ThreadAttachment,
  TokenUsage,
} from '@sideboard-ai/core';
import { latestPendingPlanQuestions } from '@sideboard/plan-ask-user';
import { compactPartsForSummaryMessage } from '@sideboard/message-parts';
import { findRightPaneByRef } from '../lib/chat-open-link';
import { extractRightPaneContents, type RightPaneContent } from '../lib/right-pane';
import { AgentMessage } from './AgentMessage';
import { UserMessageText } from './user-message-text';
import { PlanQuestionsChatBrief, PlanQuestionsOrphanBrief } from './PlanQuestionsPanel';
import { ActivityMark } from './ActivityMark';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ComposerAttachmentChips } from './ComposerOptionsToolbar';
import { MarkdownMessage } from './MarkdownMessage';
import { type FilePathLink } from '../lib/file-path-link';
import { openWorktreePathLink } from '../lib/reveal-worktree-path';

function looksLikeAutoContinuePrompt(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith('Detached job still running:') ||
    t.startsWith('You ended the turn after promising to report later') ||
    t.startsWith('The previous agent process ended before it finished.')
  );
}

export type ChatTranscriptHandlers = {
  onSelectFile?: (
    path: string,
    opts?: {
      view?: 'edit' | 'diff';
      scope?: DiffScope;
      commitSha?: string | null;
      base?: string | null;
      startLine?: number;
      endLine?: number;
    },
  ) => void;
  onRevealDirectory?: (path: string) => void;
  attachToChat: (att: ThreadAttachment) => void;
  onOpenThreadLink?: (threadRef: string) => void;
  openRightPane: (next: RightPaneContent) => void;
  forkToTab: (throughIndex: number) => void;
  requestForkWorkspace: (throughIndex: number) => void;
};

/** Isolated from composer `prompt` so keystrokes do not rebuild markdown/tool cards. */
export const ChatTranscript = memo(function ChatTranscript({
  messages,
  compactedMessages,
  forceRevealEarlier,
  fallbackDurations,
  showPlanCard,
  showStreaming,
  lastAgentMessageIndex,
  presentedPlanSource,
  showPlanQuestions,
  pendingPlanQuestions,
  pendingTranscripts,
  pendingAttachments,
  liveOutput,
  liveParts,
  liveUsage,
  turnStartedAt,
  forwardOccupancy,
  occupancyEstimated,
  threadId,
  worktreePath,
  agent,
  model,
  status,
  filePaths,
  activeArtifactId,
  canForkWorkspace,
  liveHasPresentPlan,
  omitPlanWaterfall = false,
  handlersRef,
}: {
  messages: Thread['messages'];
  compactedMessages: Thread['messages'];
  forceRevealEarlier: boolean;
  fallbackDurations: Array<number | undefined>;
  showPlanCard: boolean;
  showStreaming: boolean;
  lastAgentMessageIndex: number;
  presentedPlanSource?: string;
  showPlanQuestions: boolean;
  pendingPlanQuestions: ReturnType<typeof latestPendingPlanQuestions>;
  pendingTranscripts: string[];
  pendingAttachments: ThreadAttachment[];
  liveOutput: string;
  liveParts: MessagePart[];
  liveUsage: TokenUsage | null;
  turnStartedAt: number | undefined;
  forwardOccupancy: number | undefined;
  occupancyEstimated?: boolean;
  threadId: string;
  worktreePath: string;
  agent: Thread['agent'];
  model: Thread['model'];
  status: Thread['status'];
  filePaths: string[];
  activeArtifactId?: string;
  canForkWorkspace: boolean;
  liveHasPresentPlan: boolean;
  omitPlanWaterfall?: boolean;
  handlersRef: { current: ChatTranscriptHandlers };
}) {
  const h = handlersRef.current;
  const [earlierPinned, setEarlierPinned] = useState(false);
  function openArtifactLink(ref: string) {
    const panes: RightPaneContent[] = [];
    const push = (
      text: string,
      parts: MessagePart[] | undefined,
      prefix: string,
      role: string,
    ) => {
      if (role !== 'agent' && role !== 'summary') return;
      panes.push(
        ...extractRightPaneContents(
          text,
          parts,
          prefix,
          omitPlanWaterfall ? { omitPlanWaterfall: true } : undefined,
        ),
      );
    };
    (compactedMessages ?? []).forEach((m, i) => {
      if (m.origin === 'continue') return;
      push(m.text, m.parts, `earlier-${i}`, m.role);
    });
    messages.forEach((m, i) => {
      if (m.origin === 'continue') return;
      push(m.text, m.parts, `msg-${i}`, m.role);
    });
    if (showStreaming) push(liveOutput, liveParts, 'live', 'agent');
    const match = findRightPaneByRef(panes, ref);
    if (match) h.openRightPane(match);
  }
  function openChatFile(link: FilePathLink) {
    void openWorktreePathLink({
      link,
      threadId,
      worktreePath,
      knownFilePaths: filePaths,
      onOpenFile: h.onSelectFile,
      onRevealDirectory: h.onRevealDirectory,
    });
  }
  useEffect(() => {
    setEarlierPinned(false);
  }, [threadId]);
  const earlier = (compactedMessages ?? []).filter((m) => m.origin !== 'continue');
  const revealEarlier = earlierPinned || forceRevealEarlier;
  return (
    <>
      {earlier.length > 0 && (
        <div className="chat-earlier">
          {forceRevealEarlier && !earlierPinned ? (
            <div className="chat-earlier-toggle" role="status">
              {earlier.length} earlier message{earlier.length === 1 ? '' : 's'}
            </div>
          ) : (
            <button
              type="button"
              className="chat-earlier-toggle"
              onClick={() => setEarlierPinned((open) => !open)}
            >
              {revealEarlier
                ? 'Hide earlier messages'
                : `Show ${earlier.length} earlier message${earlier.length === 1 ? '' : 's'}`}
            </button>
          )}
          {revealEarlier &&
            earlier.map((m, i) => (
              <div
                key={`earlier-${m.ts}-${i}`}
                className={`msg ${m.role === 'user' ? 'user' : 'agent'} earlier`}
                data-chat-search-key={`earlier-${i}`}
              >
                {m.role === 'user' ? (
                  <div className="msg-user-body">
                    {m.text ? (
                      <UserMessageText
                        text={m.text}
                        threadId={threadId}
                        worktreePath={worktreePath}
                        knownFilePaths={filePaths}
                        onOpenFile={h.onSelectFile}
                        onRevealDirectory={h.onRevealDirectory}
                        onThreadLinkClick={h.onOpenThreadLink}
                        onArtifactLinkClick={openArtifactLink}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="msg-body msg-body-md" data-chat-text="">
                    <MarkdownMessage
                      text={m.text}
                      knownFilePaths={filePaths}
                      worktreePath={worktreePath}
                      onFileReferenceClick={openChatFile}
                      onThreadLinkClick={h.onOpenThreadLink}
                      onArtifactLinkClick={openArtifactLink}
                    />
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
      {messages.map((m, i) => {
        if (m.origin === 'continue') return null;
        const fallbackDuration = fallbackDurations[i];
        const hidePlanProse =
          showPlanCard &&
          !showStreaming &&
          i === lastAgentMessageIndex &&
          m.role === 'agent' &&
          (presentedPlanSource === 'present_plan' ||
            presentedPlanSource === 'text' ||
            presentedPlanSource === 'exit_plan');
        return (
          <div
            key={`${m.ts}-${i}`}
            className={`msg ${m.role === 'summary' ? 'agent' : m.role}`}
            data-chat-search-key={`msg-${i}`}
          >
            {m.role === 'agent' ? (
              <>
                <AgentMessage
                  text={m.text}
                  parts={m.parts}
                  ts={m.ts}
                  durationMs={m.durationMs ?? fallbackDuration}
                  usage={m.usage}
                  occupancyTokens={
                    !showStreaming && i === lastAgentMessageIndex
                      ? forwardOccupancy
                      : undefined
                  }
                  occupancyEstimated={
                    !showStreaming && i === lastAgentMessageIndex
                      ? occupancyEstimated
                      : undefined
                  }
                  agent={agent}
                  model={model}
                  threadId={threadId}
                  worktreePath={worktreePath}
                  knownFilePaths={filePaths}
                  onOpenFile={h.onSelectFile}
                  onRevealDirectory={h.onRevealDirectory}
                  onOpenThread={h.onOpenThreadLink}
                  onArtifactLinkClick={openArtifactLink}
                  onOpenArtifact={h.openRightPane}
                  activeArtifactId={activeArtifactId}
                  artifactIdPrefix={`msg-${i}`}
                  omitPlanWaterfall={omitPlanWaterfall}
                  onFork={() => void h.forkToTab(i)}
                  onForkWorkspace={
                    canForkWorkspace ? () => h.requestForkWorkspace(i) : undefined
                  }
                  hideAnswer={hidePlanProse}
                />
                <PlanQuestionsChatBrief
                  pending={showPlanQuestions ? pendingPlanQuestions : null}
                  parts={m.parts}
                />
              </>
            ) : m.role === 'summary' ? (
              <AgentMessage
                text=""
                parts={compactPartsForSummaryMessage(m)}
                ts={m.ts}
                agent={agent}
                model={model}
                threadId={threadId}
                worktreePath={worktreePath}
                knownFilePaths={filePaths}
                onOpenFile={h.onSelectFile}
                onRevealDirectory={h.onRevealDirectory}
                onOpenThread={h.onOpenThreadLink}
                onArtifactLinkClick={openArtifactLink}
                onOpenArtifact={h.openRightPane}
                activeArtifactId={activeArtifactId}
                artifactIdPrefix={`msg-${i}`}
                omitPlanWaterfall={omitPlanWaterfall}
                hideAnswer
                toolsOnly
              />
            ) : (
              <div className="msg-user-body">
                {(m.attachments?.length ?? 0) > 0 && (
                  <ComposerAttachmentChips
                    attachments={m.attachments!}
                    className="msg-attachments"
                    expandImages
                    onOpen={h.onSelectFile}
                  />
                )}
                {m.text ? (
                  <UserMessageText
                    text={m.text}
                    threadId={threadId}
                    worktreePath={worktreePath}
                    knownFilePaths={filePaths}
                    onOpenFile={h.onSelectFile}
                    onRevealDirectory={h.onRevealDirectory}
                    onThreadLinkClick={h.onOpenThreadLink}
                    onArtifactLinkClick={openArtifactLink}
                  />
                ) : null}
              </div>
            )}
          </div>
        );
      })}
      {pendingTranscripts.map((text, i) =>
        looksLikeAutoContinuePrompt(text) ? null : (
          <div className="msg user pending" data-chat-search-key={`pending-${i}`} key={`pending-${i}`}>
            <div className="msg-user-body">
              {i === pendingTranscripts.length - 1 && pendingAttachments.length > 0 && (
                <ComposerAttachmentChips
                  attachments={pendingAttachments}
                  className="msg-attachments"
                  expandImages
                  onOpen={h.onSelectFile}
                />
              )}
              <UserMessageText
                text={text}
                threadId={threadId}
                worktreePath={worktreePath}
                knownFilePaths={filePaths}
                onOpenFile={h.onSelectFile}
                onRevealDirectory={h.onRevealDirectory}
                onThreadLinkClick={h.onOpenThreadLink}
                onArtifactLinkClick={openArtifactLink}
              />
            </div>
          </div>
        ),
      )}
      {showStreaming && (
        <div
          className={`msg agent streaming${liveOutput || liveParts.length ? '' : ' waiting'}`}
          data-chat-search-key="live"
        >
          {liveOutput || liveParts.length || turnStartedAt ? (
            <AgentMessage
              text={liveOutput}
              parts={liveParts}
              streaming
              startedAt={turnStartedAt}
              usage={liveUsage ?? undefined}
              occupancyTokens={forwardOccupancy}
              occupancyEstimated={occupancyEstimated}
              agent={agent}
              model={model}
              threadId={threadId}
              worktreePath={worktreePath}
              knownFilePaths={filePaths}
              onOpenFile={h.onSelectFile}
              onRevealDirectory={h.onRevealDirectory}
              onOpenThread={h.onOpenThreadLink}
              onArtifactLinkClick={openArtifactLink}
              onOpenArtifact={h.openRightPane}
              activeArtifactId={activeArtifactId}
              artifactIdPrefix="live"
              omitPlanWaterfall={omitPlanWaterfall}
              hideAnswer={showPlanCard && liveHasPresentPlan}
              onFork={() =>
                void h.forkToTab(Math.max(0, messages.length - 1))
              }
              onForkWorkspace={
                canForkWorkspace
                  ? () => h.requestForkWorkspace(Math.max(0, messages.length - 1))
                  : undefined
              }
            />
          ) : (
            <>
              <ThinkingIndicator
                queued={status === 'queued'}
                showMark={false}
              />
              <div
                className="msg-stream-activity"
                aria-live="polite"
                aria-label={status === 'queued' ? 'Queued' : 'Generating'}
              >
                <ActivityMark
                  tone={status === 'queued' ? 'queued' : 'active'}
                  size="sm"
                />
                <span className="thinking-indicator-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </>
          )}
          <PlanQuestionsChatBrief
            pending={showPlanQuestions ? pendingPlanQuestions : null}
            parts={liveParts}
          />
        </div>
      )}
      <PlanQuestionsOrphanBrief
        pending={showPlanQuestions ? pendingPlanQuestions : null}
        messages={messages}
        liveParts={liveParts}
      />
    </>
  );
});

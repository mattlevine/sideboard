import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThreadAttachment } from '@sideboard-ai/core';
import { ORCHESTRATOR_AGENT_KINDS } from '@sideboard/orchestrator-capable';
import {
  applyAutocomplete,
  autocompleteItemsFromQuery,
  ComposerAutocomplete,
  consumeAutocompleteKeyDown,
  getAutocompleteQuery,
  type AutocompleteItem,
  type AutocompleteSkill,
} from './ComposerAutocomplete';
import {
  ComposerAttachmentChips,
  ComposerOptionsToolbar,
  type ComposerDraftOptions,
} from './ComposerOptionsToolbar';
import { DictationMicButton } from './DictationMicButton';
import {
  absolutePathsFromFiles,
  buffersFromFiles,
  canAcceptComposerFileDrop,
  preventComposerFileDrag,
  snapshotComposerDrop,
} from '../lib/composer-file-drop';
import { attachmentsFromLargePaste } from '../lib/paste-attachment';
import { worktreePathToFile } from '../lib/sideboard-file-drag';
import type { useSpeechDictation } from '../lib/use-speech-dictation';

type Dictation = ReturnType<typeof useSpeechDictation>;

export function AutomationPrompt({
  prompt,
  threadId,
  attachments,
  planMode,
  busy,
  repoPath,
  composerOptions,
  dictation,
  onPrompt,
  onAttachments,
  onPatchOptions,
  onError,
}: {
  prompt: string;
  threadId: string;
  attachments: ThreadAttachment[];
  planMode: boolean;
  busy: boolean;
  repoPath?: string;
  composerOptions: ComposerDraftOptions;
  dictation: Dictation;
  onPrompt: (prompt: string, cursor: number) => void;
  onAttachments: (attachments: ThreadAttachment[]) => void;
  onPatchOptions: (patch: Partial<ComposerDraftOptions>) => void;
  onError: (message: string) => void;
}) {
  const [skills, setSkills] = useState<AutocompleteSkill[]>([]);
  const [cursor, setCursor] = useState(prompt.length);
  const [acIndex, setAcIndex] = useState(0);
  const [acSuppressed, setAcSuppressed] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const acQuery = useMemo(() => getAutocompleteQuery(prompt, cursor), [prompt, cursor]);
  const acItems: AutocompleteItem[] = useMemo(
    () => autocompleteItemsFromQuery(acQuery, { suppressed: acSuppressed, skills, filePaths }),
    [acQuery, acSuppressed, skills, filePaths],
  );

  useEffect(() => {
    setAcIndex(0);
    setAcSuppressed(false);
  }, [acQuery?.kind, acQuery?.query]);

  useEffect(() => {
    let cancelled = false;
    void window.sideboard
      .listSkillsForRepo(repoPath ?? '')
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  useEffect(() => {
    if (!threadId) {
      setFilePaths([]);
      return;
    }
    let cancelled = false;
    void window.sideboard
      .listFiles(threadId)
      .then((list) => {
        if (!cancelled) setFilePaths(list);
      })
      .catch(() => {
        if (!cancelled) setFilePaths([]);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  function pickAutocomplete(item: AutocompleteItem) {
    if (!acQuery) return;
    const next = applyAutocomplete(prompt, acQuery.start, acQuery.end, item.insert);
    onPrompt(next.value, next.cursor);
    setCursor(next.cursor);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function attachDroppedFiles(files: File[]) {
    if (busy || files.length === 0) return;
    const buffers = await buffersFromFiles(files, { includePathed: true });
    const staged =
      buffers.length > 0
        ? await window.sideboard.attachmentsFromBuffers(buffers)
        : await window.sideboard.attachmentsFromPaths(absolutePathsFromFiles(files));
    if (staged.length) onAttachments([...attachments, ...staged]);
  }

  async function stageDroppedSnapshot(snap: ReturnType<typeof snapshotComposerDrop>) {
    if (busy) return;
    const dragged = snap.sideboard;
    if (dragged?.paths.length && dragged.threadId) {
      const files = await Promise.all(
        dragged.paths.map((path) => worktreePathToFile(dragged.threadId!, path)),
      );
      await attachDroppedFiles(files);
      return;
    }
    await attachDroppedFiles(snap.files);
  }

  return (
    <div className="settings-field">
      Prompt
      <div
        className={`composer-box automations-composer${dragOver ? ' drag-over' : ''}`}
        onDragEnter={(e) => {
          if (!preventComposerFileDrag(e)) return;
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          setDragOver(false);
        }}
        onDragOver={(e) => {
          if (!canAcceptComposerFileDrop(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }}
        onDrop={(e) => {
          if (!preventComposerFileDrag(e)) return;
          setDragOver(false);
          const snap = snapshotComposerDrop(e.dataTransfer);
          void stageDroppedSnapshot(snap).catch((err) => {
            onError(err instanceof Error ? err.message : String(err));
          });
        }}
      >
        <ComposerAttachmentChips
          attachments={attachments}
          onRemove={(id) => onAttachments(attachments.filter((a) => a.id !== id))}
        />
        <div className="composer-input-row">
          {acItems.length > 0 && (
            <ComposerAutocomplete
              items={acItems}
              activeIndex={Math.min(acIndex, acItems.length - 1)}
              onHover={setAcIndex}
              onPick={pickAutocomplete}
            />
          )}
          <textarea
            ref={textareaRef}
            value={prompt}
            rows={4}
            disabled={busy}
            placeholder={
              threadId
                ? 'What the agent should do when this fires. @ files, / for skills'
                : 'What the agent should do when this fires. Type / for skills'
            }
            onChange={(e) => {
              onPrompt(e.target.value, e.target.selectionStart);
              setCursor(e.target.selectionStart);
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
            onClick={(e) => setCursor(e.currentTarget.selectionStart)}
            onKeyUp={(e) => setCursor(e.currentTarget.selectionStart)}
            onPaste={(e) => {
              if (busy) return;
              const pasted = e.clipboardData?.files;
              if (pasted && pasted.length > 0) {
                e.preventDefault();
                void attachDroppedFiles(Array.from(pasted)).catch((err) => {
                  onError(err instanceof Error ? err.message : String(err));
                });
                return;
              }
              void attachmentsFromLargePaste(e, attachments)
                .then((files) => {
                  if (files?.length) onAttachments([...attachments, ...files]);
                })
                .catch((err) => {
                  onError(err instanceof Error ? err.message : String(err));
                });
            }}
            onKeyDown={(e) => {
              if (busy) return;
              if (
                consumeAutocompleteKeyDown(e, {
                  items: acItems,
                  activeIndex: acIndex,
                  onIndex: setAcIndex,
                  onPick: pickAutocomplete,
                  onSuppress: () => setAcSuppressed(true),
                })
              ) {
                e.stopPropagation();
              }
            }}
          />
        </div>
        {planMode && (
          <div className="composer-plan-banner">
            Plan mode stays on until you turn it off (no file edits).
          </div>
        )}
        <ComposerOptionsToolbar
          options={composerOptions}
          attachments={attachments}
          onPatchOptions={onPatchOptions}
          onAttachmentsChange={onAttachments}
          repoPath={repoPath}
          menuPlacement="auto"
          allowedAgents={ORCHESTRATOR_AGENT_KINDS}
          bindShortcuts
          rightSlot={
            <DictationMicButton
              listening={dictation.listening}
              supported={dictation.supported}
              error={dictation.error}
              disabled={busy}
              onStart={dictation.start}
              onStop={() => {
                void dictation.stop();
              }}
            />
          }
        />
      </div>
      <p className="settings-hint">
        Files, issues, workspaces, and the agent settings on this prompt are sent with every run.
      </p>
    </div>
  );
}

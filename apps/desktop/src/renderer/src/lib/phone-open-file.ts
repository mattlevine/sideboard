import { useEffect, useRef, useState } from 'react';
import type { MessagePart } from '@sideboard-ai/core';
import { pickArtifactMatch } from '@sideboard/phone-artifact';
import { extractRightPaneContents, type RightPaneContent } from './right-pane';

type PhoneFileRequest = {
  threadId: string;
  path: string;
  directory?: boolean;
  startLine?: number;
  endLine?: number;
};

/** Phone tap: select the chat, then open the file once that worktree is current. */
export function usePhoneOpenFile(
  selectedId: string | null,
  worktreePath: string | null | undefined,
  setSelectedId: (id: string) => void,
  openFile: (path: string, opts?: { startLine?: number; endLine?: number }) => void,
  revealDirectory: (path: string) => void,
): void {
  const [phoneFile, setPhoneFile] = useState<PhoneFileRequest | null>(null);
  useEffect(() => window.sideboard.onPhoneOpenFile(setPhoneFile), []);
  useEffect(() => {
    if (!phoneFile) return;
    setSelectedId(phoneFile.threadId);
    if (selectedId !== phoneFile.threadId) return;
    if (phoneFile.directory) revealDirectory(phoneFile.path);
    else {
      openFile(phoneFile.path, {
        startLine: phoneFile.startLine,
        endLine: phoneFile.endLine,
      });
    }
    setPhoneFile(null);
    // worktreePath is a dependency so the open waits until that chat is current.
    void worktreePath;
  }, [phoneFile, selectedId, worktreePath, revealDirectory]);
}

type PhoneArtifactRequest = { threadId: string; title: string; hint?: string };

let pendingArtifact: PhoneArtifactRequest | null = null;
const artifactListeners = new Set<() => void>();

function queuePhoneArtifact(request: PhoneArtifactRequest): void {
  pendingArtifact = request;
  for (const listener of artifactListeners) listener();
}

function artifactRefs(text: string, parts: MessagePart[] | undefined, idPrefix: string) {
  return extractRightPaneContents(text, parts, idPrefix).map((pane) => ({
    pane,
    title: pane.title,
    content: 'content' in pane && typeof pane.content === 'string' ? pane.content : undefined,
  }));
}

/** Phone tap: show the chat, then open the matching artifact pane. */
export function usePhoneOpenArtifact(
  thread: { id: string; messages: Array<{ role: string; text: string; parts?: MessagePart[] }> },
  liveText: string,
  liveParts: MessagePart[] | undefined,
  open: (content: RightPaneContent) => void,
): void {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const run = () => {
      const request = pendingArtifact;
      if (!request || request.threadId !== thread.id) return;
      const items = [
        ...thread.messages.flatMap((message, index) =>
          message.role === 'agent' ? artifactRefs(message.text, message.parts, `msg-${index}`) : [],
        ),
        ...artifactRefs(liveText, liveParts, 'live'),
      ];
      const match = pickArtifactMatch(items, request);
      if (!match) return;
      pendingArtifact = null;
      openRef.current(match.pane);
    };
    run();
    artifactListeners.add(run);
    return () => {
      artifactListeners.delete(run);
    };
  }, [thread.id, thread.messages, liveText, liveParts]);
}

/** Select the chat when the phone asks to open an artifact. */
export function usePhoneSelectArtifact(setSelectedId: (id: string) => void): void {
  const selectRef = useRef(setSelectedId);
  selectRef.current = setSelectedId;
  useEffect(() => {
    return window.sideboard.onPhoneOpenArtifact((request) => {
      queuePhoneArtifact(request);
      selectRef.current(request.threadId);
    });
  }, []);
}

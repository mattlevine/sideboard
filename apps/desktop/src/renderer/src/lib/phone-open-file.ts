import { useEffect, useState } from 'react';

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
    if (selectedId !== phoneFile.threadId) {
      setSelectedId(phoneFile.threadId);
      return;
    }
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

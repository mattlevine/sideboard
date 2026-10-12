import { MarkdownMessage } from './MarkdownMessage';
import { type FilePathLink } from '../lib/file-path-link';
import { openWorktreePathLink } from '../lib/reveal-worktree-path';

/** Keep typed single newlines as markdown hard breaks. */
function userTextToMarkdown(text: string): string {
  return text.replace(/([^\n])\n(?!\n)/g, '$1  \n');
}

export function UserMessageText({
  text,
  threadId,
  worktreePath,
  knownFilePaths,
  onOpenFile,
  onRevealDirectory,
  onThreadLinkClick,
  onArtifactLinkClick,
}: {
  text: string;
  threadId?: string;
  worktreePath?: string;
  knownFilePaths?: string[];
  onOpenFile?: (path: string, opts?: { startLine?: number; endLine?: number }) => void;
  onRevealDirectory?: (path: string) => void;
  onThreadLinkClick?: (threadRef: string) => void;
  onArtifactLinkClick?: (ref: string) => void;
}) {
  const onFileReferenceClick =
    onOpenFile || onRevealDirectory
      ? (link: FilePathLink) => {
          void openWorktreePathLink({
            link,
            threadId,
            worktreePath,
            knownFilePaths,
            onOpenFile,
            onRevealDirectory,
          });
        }
      : undefined;
  return (
    <div className="msg-body msg-body-md" data-chat-text="">
      <MarkdownMessage
        text={userTextToMarkdown(text)}
        knownFilePaths={knownFilePaths}
        worktreePath={worktreePath}
        onFileReferenceClick={onFileReferenceClick}
        onThreadLinkClick={onThreadLinkClick}
        onArtifactLinkClick={onArtifactLinkClick}
      />
    </div>
  );
}

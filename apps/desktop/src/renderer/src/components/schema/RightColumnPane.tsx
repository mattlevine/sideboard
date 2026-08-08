import {
  isFilesPane,
  isSchemaPane,
  type RightPaneContent,
  type SchemaPaneContent,
} from '../../lib/right-pane';
import { ArtifactPane, ARTIFACT_WIDTH_DEFAULT } from '../ArtifactPane';
import { FilesPane, FILES_WIDTH_DEFAULT } from './FilesPane';
import { SchemaPane, SCHEMA_WIDTH_DEFAULT } from './SchemaPane';

export { ARTIFACT_WIDTH_DEFAULT, SCHEMA_WIDTH_DEFAULT, FILES_WIDTH_DEFAULT };

interface Props {
  content: RightPaneContent;
  width?: number;
  onWidthChange?: (width: number) => void;
  onClose: () => void;
  onSchemaContentChange?: (next: SchemaPaneContent) => void;
  /** Active thread for worktree → file manager drag uploads. */
  worktreeThreadId?: string;
}

/** Switcher: document → ArtifactPane; schema → SchemaPane; files → FilesPane. */
export function RightColumnPane({
  content,
  width,
  onWidthChange,
  onClose,
  onSchemaContentChange,
  worktreeThreadId,
}: Props) {
  if (isFilesPane(content)) {
    return (
      <FilesPane
        content={content}
        width={width ?? FILES_WIDTH_DEFAULT}
        onWidthChange={onWidthChange}
        onClose={onClose}
        worktreeThreadId={worktreeThreadId}
      />
    );
  }
  if (isSchemaPane(content)) {
    return (
      <SchemaPane
        content={content}
        width={width ?? SCHEMA_WIDTH_DEFAULT}
        onWidthChange={onWidthChange}
        onClose={onClose}
        onContentChange={onSchemaContentChange}
        worktreeThreadId={worktreeThreadId}
      />
    );
  }
  return (
    <ArtifactPane
      artifact={content}
      width={width ?? ARTIFACT_WIDTH_DEFAULT}
      onWidthChange={onWidthChange}
      onClose={onClose}
    />
  );
}

import {
  isFilesPane,
  isSchemaPane,
  type RightPaneContent,
  type SchemaPaneContent,
} from '../../lib/right-pane';
import { ArtifactPane, ARTIFACT_WIDTH_DEFAULT } from '../ArtifactPane';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { FilesPane, FILES_WIDTH_DEFAULT } from './FilesPane';
import type { FilePickerRequest } from './FileManagerColumn';
import { SchemaPane, SCHEMA_WIDTH_DEFAULT } from './SchemaPane';

export { ARTIFACT_WIDTH_DEFAULT, SCHEMA_WIDTH_DEFAULT, FILES_WIDTH_DEFAULT };

const COLUMN_WIDTH_MIN = 320;
const COLUMN_WIDTH_MAX = 900;
export const RIGHT_COLUMN_WIDTH_DEFAULT = SCHEMA_WIDTH_DEFAULT;

export interface RightColumnFilePicker {
  request: FilePickerRequest;
  /** Tab to return to after select/cancel. */
  returnTabId: string;
}

interface Props {
  tabs: RightPaneContent[];
  activeId: string | null;
  width?: number;
  onWidthChange?: (width: number) => void;
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onSchemaContentChange?: (next: SchemaPaneContent) => void;
  worktreeThreadId?: string;
  /** When set, the matching files tab is in selection mode. */
  filePicker?: RightColumnFilePicker | null;
  onFilePickerChange?: (picker: RightColumnFilePicker | null) => void;
  /** Schema form asked to open / focus a files tab (browse or pick). */
  onRequestFilesTab?: (opts: {
    returnTabId: string;
    picker?: FilePickerRequest | null;
  }) => void;
}

function tabKind(content: RightPaneContent): string {
  if (isSchemaPane(content)) return 'CMS';
  if (isFilesPane(content)) return 'FILES';
  return 'DOC';
}

/** One resizable column with tabs for artifact / schema / files panes. */
export function RightColumnPane({
  tabs,
  activeId,
  width = RIGHT_COLUMN_WIDTH_DEFAULT,
  onWidthChange,
  onActivate,
  onCloseTab,
  onSchemaContentChange,
  worktreeThreadId,
  filePicker = null,
  onFilePickerChange,
  onRequestFilesTab,
}: Props) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  const clamped = Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, width));

  if (!active) return null;

  function renderBody(content: RightPaneContent) {
    if (isFilesPane(content)) {
      const picking = filePicker;
      return (
        <FilesPane
          content={content}
          embedded
          worktreeThreadId={worktreeThreadId}
          pickerRequest={picking?.request ?? null}
          onClose={() => {
            if (picking) {
              onFilePickerChange?.(null);
              onActivate(picking.returnTabId);
              return;
            }
            onCloseTab(content.id);
          }}
          onPickerSelect={(url, file) => {
            if (!picking) return;
            picking.request.onSelect(url, file);
            onFilePickerChange?.(null);
            onActivate(picking.returnTabId);
          }}
          onPickerCancel={() => {
            if (!picking) return;
            onFilePickerChange?.(null);
            onActivate(picking.returnTabId);
          }}
        />
      );
    }
    if (isSchemaPane(content)) {
      return (
        <SchemaPane
          content={content}
          embedded
          onClose={() => onCloseTab(content.id)}
          onContentChange={onSchemaContentChange}
          worktreeThreadId={worktreeThreadId}
          onRequestFilesTab={(picker) =>
            onRequestFilesTab?.({
              returnTabId: content.id,
              picker: picker ?? null,
            })
          }
        />
      );
    }
    return (
      <ArtifactPane
        artifact={content}
        embedded
        onClose={() => onCloseTab(content.id)}
      />
    );
  }

  return (
    <div className="right-column-shell" style={{ width: clamped }}>
      {onWidthChange ? (
        <PanelResizeHandle
          edge="left"
          value={clamped}
          min={COLUMN_WIDTH_MIN}
          max={COLUMN_WIDTH_MAX}
          onChange={onWidthChange}
        />
      ) : null}
      <div className="right-column-tabs" role="tablist" aria-label="Right column">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active.id}
            className={`right-column-tab${tab.id === active.id ? ' active' : ''}${
              isSchemaPane(tab) ? ' schema' : ''
            }${isFilesPane(tab) ? ' files' : ''}`}
            title={tab.title}
            onClick={() => onActivate(tab.id)}
          >
            <span className="right-column-tab-kind">{tabKind(tab)}</span>
            <span className="right-column-tab-title">{tab.title}</span>
            <span
              className="right-column-tab-close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
      </div>
      <div className="right-column-body" role="tabpanel">
        {renderBody(active)}
      </div>
    </div>
  );
}

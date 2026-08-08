import { useEffect, useState } from 'react';
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

function MaximizeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
      />
    </svg>
  );
}

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
  const [maximized, setMaximized] = useState(false);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null;
  const clamped = Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, width));

  useEffect(() => {
    if (tabs.length === 0) setMaximized(false);
  }, [tabs.length]);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized]);

  if (!active) return null;

  const maximizeButton = (
    <button
      type="button"
      className="right-column-maximize"
      title={maximized ? 'Minimize' : 'Maximize'}
      aria-label={maximized ? 'Minimize pane' : 'Maximize pane'}
      aria-pressed={maximized}
      onMouseDown={(e) => {
        // mousedown beats iframe / overlay steal of click
        e.preventDefault();
        e.stopPropagation();
        setMaximized((v) => !v);
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {maximized ? <MinimizeIcon /> : <MaximizeIcon />}
    </button>
  );

  function renderBody(content: RightPaneContent) {
    if (isFilesPane(content)) {
      const picking = filePicker;
      return (
        <FilesPane
          content={content}
          embedded
          worktreeThreadId={worktreeThreadId}
          headerAction={maximizeButton}
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
          headerAction={maximizeButton}
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
        headerAction={maximizeButton}
      />
    );
  }

  return (
    <div
      className={`right-column-host${maximized ? ' is-maximized' : ''}`}
      style={maximized ? undefined : { width: clamped }}
      onMouseDown={(e) => {
        if (maximized && e.target === e.currentTarget) {
          setMaximized(false);
        }
      }}
    >
      <div
        className="right-column-shell"
        role={maximized ? 'dialog' : undefined}
        aria-modal={maximized ? true : undefined}
        aria-label={maximized ? active.title : undefined}
      >
        {!maximized && onWidthChange ? (
          <PanelResizeHandle
            edge="left"
            value={clamped}
            min={COLUMN_WIDTH_MIN}
            max={COLUMN_WIDTH_MAX}
            onChange={onWidthChange}
          />
        ) : null}
        <div className="right-column-toolbar">
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
        </div>
        <div className="right-column-body" role="tabpanel">
          {renderBody(active)}
        </div>
      </div>
    </div>
  );
}

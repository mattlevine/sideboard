/**
 * Sideboard TipTap richtext editor for schema CMS fields.
 * Reference: brightsy-ai RichTextEditor + TipTapWidget (separate instance).
 * Files/AI go through SchemaMediaContext (Brightsy client or agent tools).
 */
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import type { FileAccept } from './FileManagerColumn';
import { useSchemaMedia } from './SchemaMediaContext';

export interface SchemaRichTextEditorProps {
  value: unknown;
  onChange: (value: object) => void;
  disabled?: boolean;
  placeholder?: string;
}

function parseContent(value: unknown): object | string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const doc = value as { type?: string; content?: unknown };
    if (doc.type === 'doc') return value as object;
    if (Array.isArray(doc.content)) return { type: 'doc', content: doc.content };
  }
  if (typeof value === 'string' && value.trim()) return value;
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function ToolbarBtn({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`schema-rte-btn${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={label}
    >
      {label}
    </button>
  );
}

const AI_ACTIONS: Array<{ id: string; label: string; instruction: string }> = [
  {
    id: 'fix',
    label: 'Fix grammar',
    instruction: 'Fix all spelling and grammar errors. Return only the corrected text:',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    instruction: 'Make this text shorter while preserving meaning. Return only the shortened text:',
  },
  {
    id: 'expand',
    label: 'Expand',
    instruction: 'Expand this text with more detail. Return only the expanded text:',
  },
  {
    id: 'simplify',
    label: 'Simplify',
    instruction: 'Simplify this text with clearer words. Return only the simplified text:',
  },
];

export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder = 'Start writing…',
}: SchemaRichTextEditorProps) {
  const { files, ai, openFilePicker } = useSchemaMedia();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const lastJson = useRef<string>('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { class: 'schema-rte-link' },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder }),
    ],
    editable: !disabled,
    content: parseContent(value),
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      const serialized = JSON.stringify(json);
      if (serialized === lastJson.current) return;
      lastJson.current = serialized;
      onChangeRef.current(json);
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    const next = parseContent(value);
    const serialized = JSON.stringify(next);
    if (serialized === lastJson.current) return;
    const current = JSON.stringify(editor.getJSON());
    if (serialized === current) {
      lastJson.current = serialized;
      return;
    }
    lastJson.current = serialized;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  function openLinkDialog() {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    setLinkUrl(prev || 'https://');
    setLinkOpen(true);
  }

  function applyLink() {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      const { empty } = editor.state.selection;
      if (empty) {
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'text',
            text: url,
            marks: [{ type: 'link', attrs: { href: url } }],
          })
          .run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      }
    }
    setLinkOpen(false);
  }

  function openFiles(mode: 'media' | 'link', accept: FileAccept = 'image') {
    if (!files || !editor) {
      setAiError('No file datasource — connect Brightsy or provide agent file tools');
      return;
    }
    openFilePicker({
      mode,
      accept,
      title: mode === 'link' ? 'Pick link target' : 'Insert from files',
      onSelect: (url) => {
        if (mode === 'link') {
          setLinkUrl(url);
          setLinkOpen(true);
          return;
        }
        if (accept === 'image' || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) {
          editor.chain().focus().setImage({ src: url }).run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              text: url,
              marks: [{ type: 'link', attrs: { href: url } }],
            })
            .run();
        }
      },
    });
  }

  async function runAi(instruction: string) {
    if (!editor || !ai) {
      setAiError('No AI datasource — connect Brightsy or wire an agent complete tool');
      return;
    }
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to);
    const text = selected.trim() || editor.getText();
    if (!text.trim()) {
      setAiError('Select text or write something first');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await ai.completeText({ instruction, text });
      if (selected.trim()) {
        editor.chain().focus().insertContentAt({ from, to }, result).run();
      } else {
        editor.chain().focus().setContent({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: result }] }],
        }).run();
      }
      setAiOpen(false);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  if (!editor) {
    return <div className="schema-muted">Loading editor…</div>;
  }

  return (
    <div className={`schema-rte${disabled ? ' disabled' : ''}`}>
      <div className="schema-rte-toolbar">
        <ToolbarBtn
          label="B"
          active={editor.isActive('bold')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarBtn
          label="I"
          active={editor.isActive('italic')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarBtn
          label="U"
          active={editor.isActive('underline')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarBtn
          label="H2"
          active={editor.isActive('heading', { level: 2 })}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarBtn
          label="•"
          active={editor.isActive('bulletList')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarBtn
          label="1."
          active={editor.isActive('orderedList')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarBtn
          label="❝"
          active={editor.isActive('blockquote')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarBtn
          label="Link"
          active={editor.isActive('link')}
          disabled={disabled}
          onClick={openLinkDialog}
        />
        <ToolbarBtn
          label="Image"
          disabled={disabled || !files}
          onClick={() => openFiles('media', 'image')}
        />
        <ToolbarBtn
          label="Files"
          disabled={disabled || !files}
          onClick={() => openFiles('media', 'all')}
        />
        <ToolbarBtn
          label="AI"
          disabled={disabled || !ai || aiBusy}
          onClick={() => {
            setAiError(null);
            setAiOpen((v) => !v);
          }}
        />
        <ToolbarBtn
          label="Table"
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        />
      </div>

      {linkOpen ? (
        <div className="schema-rte-popover">
          <input
            className="schema-input"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') setLinkOpen(false);
            }}
          />
          <button type="button" className="primary" onClick={applyLink}>
            Apply
          </button>
          {files ? (
            <button
              type="button"
              onClick={() => {
                setLinkOpen(false);
                openFiles('link', 'all');
              }}
            >
              From files…
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              setLinkOpen(false);
            }}
          >
            Remove
          </button>
          <button type="button" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {aiOpen ? (
        <div className="schema-rte-popover schema-rte-ai">
          {AI_ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={aiBusy}
              onClick={() => void runAi(a.instruction)}
            >
              {a.label}
            </button>
          ))}
          {aiBusy ? <span className="schema-muted">Working…</span> : null}
        </div>
      ) : null}

      {aiError ? <div className="schema-error">{aiError}</div> : null}

      <EditorContent editor={editor} className="schema-rte-body" />
    </div>
  );
}

/** @internal helper for tests */
export function __hasLinkMark(editor: Editor | null): boolean {
  return Boolean(editor?.isActive('link'));
}

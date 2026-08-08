/**
 * Sideboard markdown editor for schema CMS fields.
 * Reference: brightsy-ai MarkdownEditor (separate instance).
 */
import { useRef, useState } from 'react';
import { MarkdownMessage } from '../MarkdownMessage';
import { useSchemaMedia } from './SchemaMediaContext';

export interface SchemaMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  disabled = false,
  placeholder = 'Write markdown…',
}: SchemaMarkdownEditorProps) {
  const { files, ai, openFilePicker } = useSchemaMedia();
  const [preview, setPreview] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function wrap(before: string, after = before) {
    const el = taRef.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || 'text';
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + before.length + selected.length + after.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function insertAtCursor(text: string) {
    const el = taRef.current;
    if (!el || disabled) return;
    const start = el.selectionStart;
    const next = value.slice(0, start) + text + value.slice(start);
    onChange(next);
  }

  async function runAi(instruction: string) {
    if (!ai) {
      setError('No AI datasource');
      return;
    }
    const el = taRef.current;
    const selected =
      el && el.selectionStart !== el.selectionEnd
        ? value.slice(el.selectionStart, el.selectionEnd)
        : value;
    if (!selected.trim()) {
      setError('Select or write text first');
      return;
    }
    setAiBusy(true);
    setError(null);
    try {
      const result = await ai.completeText({ instruction, text: selected });
      if (el && el.selectionStart !== el.selectionEnd) {
        onChange(
          value.slice(0, el.selectionStart) + result + value.slice(el.selectionEnd),
        );
      } else {
        onChange(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className={`schema-md${disabled ? ' disabled' : ''}`}>
      <div className="schema-md-toolbar">
        <button type="button" disabled={disabled} onClick={() => wrap('**')}>
          Bold
        </button>
        <button type="button" disabled={disabled} onClick={() => wrap('_')}>
          Italic
        </button>
        <button type="button" disabled={disabled} onClick={() => wrap('`')}>
          Code
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setError(null);
            if (files) {
              openFilePicker({
                accept: 'image',
                title: 'Insert image',
                onSelect: (url) => insertAtCursor(`\n\n![](${url})\n\n`),
              });
              return;
            }
            wrap('[', '](https://)');
          }}
        >
          {files ? 'Image/File' : 'Link'}
        </button>
        <button
          type="button"
          disabled={disabled || !ai || aiBusy}
          onClick={() =>
            void runAi('Fix spelling and grammar. Return only the corrected markdown:')
          }
        >
          {aiBusy ? 'AI…' : 'AI fix'}
        </button>
        <button
          type="button"
          className={preview ? 'active' : ''}
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {error ? <div className="schema-error">{error}</div> : null}
      {preview ? (
        <div className="schema-md-preview">
          {value.trim() ? (
            <MarkdownMessage text={value} />
          ) : (
            <span className="schema-muted">Nothing to preview</span>
          )}
        </div>
      ) : (
        <textarea
          ref={taRef}
          className="schema-input schema-textarea schema-md-input"
          rows={10}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

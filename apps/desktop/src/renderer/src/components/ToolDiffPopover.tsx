import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessagePart } from '@sideboard/core';
import { buildToolDiff } from '../lib/tool-diff';
import { DiffLines } from './DiffLines';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

interface Props {
  tool: ToolPart;
  threadId?: string;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

function prettyJson(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Claude-style inspector: tool name, input, and returned output (or a code diff). */
export function ToolDiffPopover({ tool, threadId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  useEffect(() => {
    const path = tool.filePath;
    if (!threadId || !path) {
      setFileContent(null);
      return;
    }
    let cancelled = false;
    void window.sideboard
      .readFile(threadId, path)
      .then((text) => {
        if (!cancelled) setFileContent(text);
      })
      .catch(() => {
        if (!cancelled) setFileContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, tool.filePath, tool.id]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const model = useMemo(
    () => buildToolDiff(tool.input, tool.filePath, fileContent),
    [tool.input, tool.filePath, fileContent],
  );

  const inputJson = useMemo(() => prettyJson(tool.input ?? {}), [tool.input]);
  const resultJson = useMemo(() => prettyJson(tool.result), [tool.result]);

  if (!model) {
    return (
      <div className="tool-diff-popover" ref={ref} role="dialog" aria-label={`Tool ${tool.name}`}>
        <div className="tool-diff-header">{tool.name}</div>
        <div className="tool-diff-inspect">
          {inputJson && <pre className="tool-diff-result">{inputJson}</pre>}
          {resultJson ? (
            <pre className="tool-diff-result output">{resultJson}</pre>
          ) : (
            <div className="tool-diff-empty">
              {tool.status === 'running' ? 'Running…' : 'No tool output captured.'}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="tool-diff-popover" ref={ref} role="dialog" aria-label={`Diff ${model.path}`}>
      <div className="tool-diff-header">{model.path}</div>
      <DiffLines rows={model.rows} />
      {resultJson && (
        <div className="tool-diff-inspect compact">
          <pre className="tool-diff-result output">{resultJson}</pre>
        </div>
      )}
    </div>
  );
}

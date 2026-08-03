import { useEffect, useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import plaintext from 'highlight.js/lib/languages/plaintext';
import type { MessagePart } from '@sideboard/core';
import { buildToolDiff } from '../lib/tool-diff';
import { DiffLines } from './DiffLines';
import 'highlight.js/styles/vs2015.css';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

interface Props {
  tool: ToolPart;
  threadId?: string;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

let langsRegistered = false;
function ensureHljs(): void {
  if (langsRegistered) return;
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('plaintext', plaintext);
  langsRegistered = true;
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

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function monacoToHljs(lang: string): string {
  if (lang === 'shell') return 'bash';
  if (lang === 'plaintext') return 'plaintext';
  if (hljs.getLanguage(lang)) return lang;
  return 'plaintext';
}

function FormattedCode({
  code,
  language,
  label,
}: {
  code: string;
  language: string;
  label?: string;
}) {
  ensureHljs();
  const html = useMemo(() => {
    const lang = monacoToHljs(language);
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return hljs.highlight(code, { language: 'plaintext', ignoreIllegals: true }).value;
    }
  }, [code, language]);

  return (
    <div className="tool-diff-codeblock">
      {label ? <div className="tool-diff-codeblock-label">{label}</div> : null}
      <pre className="tool-diff-result hljs">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

/** Claude-style inspector: tool name, input, and returned output (or a code diff). */
export function ToolDiffPopover({ tool, threadId, onClose }: Props) {
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
      .then((r) => {
        if (!cancelled) setFileContent(r.binary ? null : r.content);
      })
      .catch(() => {
        if (!cancelled) setFileContent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, tool.filePath, tool.id]);

  // Escape is handled by FloatingMenu when portaled; keep a local fallback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bashCommand =
    str(tool.input?.command) ?? str(tool.input?.cmd) ?? null;
  const isBash = Boolean(
    bashCommand || /bash|shell|terminal/i.test(tool.name ?? ''),
  );

  const inputJson = useMemo(() => prettyJson(tool.input ?? {}), [tool.input]);
  const resultText = useMemo(() => {
    if (tool.result == null) return null;
    if (typeof tool.result === 'string') {
      const trimmed = tool.result.trim();
      if (!trimmed) return null;
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return tool.result;
      }
    }
    return prettyJson(tool.result);
  }, [tool.result]);

  const resultLooksJson = useMemo(() => {
    if (resultText == null) return false;
    const t = resultText.trim();
    return t.startsWith('{') || t.startsWith('[');
  }, [resultText]);

  const model = useMemo(
    () => buildToolDiff(tool.input, tool.filePath, fileContent),
    [tool.input, tool.filePath, fileContent],
  );

  if (model) {
    return (
      <div className="tool-diff-popover" role="dialog" aria-label={`Diff ${model.path}`}>
        <div className="tool-diff-header">{model.path}</div>
        <DiffLines rows={model.rows} />
        {resultText && (
          <div className="tool-diff-inspect compact">
            <FormattedCode
              code={resultText}
              language={resultLooksJson ? 'json' : 'plaintext'}
              label="Result"
            />
          </div>
        )}
      </div>
    );
  }

  const inputCode = isBash && bashCommand ? bashCommand : inputJson;
  const inputLang = isBash && bashCommand ? 'bash' : 'json';

  return (
    <div className="tool-diff-popover" role="dialog" aria-label={`Tool ${tool.name}`}>
      <div className="tool-diff-header">{tool.name}</div>
      <div className="tool-diff-inspect">
        {inputCode ? (
          <FormattedCode
            code={inputCode}
            language={inputLang}
            label={isBash ? 'Command' : 'Input'}
          />
        ) : null}
        {resultText ? (
          <FormattedCode
            code={resultText}
            language={resultLooksJson ? 'json' : 'plaintext'}
            label="Result"
          />
        ) : (
          <div className="tool-diff-empty">
            {tool.status === 'running' ? 'Running…' : 'No tool output captured.'}
          </div>
        )}
      </div>
    </div>
  );
}

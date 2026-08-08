import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';

function getTextContent(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (typeof node === 'object' && 'props' in node) {
    return getTextContent((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

type MarkdownCodeBlockProps = ComponentProps<'pre'>;

/**
 * Fenced markdown code block with a copy-to-clipboard control.
 */
export function MarkdownCodeBlock({ children, className, ...props }: MarkdownCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const text = getTextContent(children).replace(/\n$/, '');

  useEffect(() => {
    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  function copy() {
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setCopied(false);
      }, 1200);
    });
  }

  return (
    <div className="md-codeblock">
      <button
        type="button"
        className="md-codeblock-copy"
        title={copied ? 'Copied' : 'Copy code'}
        aria-label={copied ? 'Copied' : 'Copy code to clipboard'}
        onClick={copy}
      >
        {copied ? '✓' : '⧉'}
      </button>
      <pre className={className} {...props}>
        {children}
      </pre>
    </div>
  );
}

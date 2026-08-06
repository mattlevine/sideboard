import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/vs2015.css';
import { parseFilePathLink, type FilePathLink } from '../lib/file-path-link';
import {
  linkifyThreadUrls,
  markdownUrlTransform,
  parseThreadLink,
} from '../lib/thread-link';

const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

interface Props {
  text: string;
  className?: string;
  knownFilePaths?: string[];
  onFileReferenceClick?: (link: FilePathLink) => void;
  /** Open a Sideboard thread from a sideboard://thread/<id> markdown link. */
  onThreadLinkClick?: (threadRef: string) => void;
  /** When true, defer mermaid rendering to avoid parse errors on incomplete syntax. */
  isStreaming?: boolean;
}

function isSafeExternalUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function getTextContent(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join('');
  if (typeof node === 'object' && 'props' in node) {
    return getTextContent((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

function getCodeLanguage(className: unknown): string {
  if (typeof className !== 'string') return '';
  const match = /language-(\w+)/.exec(className);
  return match?.[1]?.toLowerCase() ?? '';
}

export function MarkdownMessage({
  text,
  className,
  knownFilePaths,
  onFileReferenceClick,
  onThreadLinkClick,
  isStreaming = false,
}: Props) {
  const components: ComponentProps<typeof ReactMarkdown>['components'] = {
    a({ href, children, ...props }) {
      const url = typeof href === 'string' ? href : '';
      const threadRef = parseThreadLink(url);
      if (threadRef) {
        return (
          <a
            {...props}
            href={url}
            className="md-thread-link"
            title="Open thread in Sideboard"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onThreadLinkClick?.(threadRef);
            }}
          >
            {children}
          </a>
        );
      }
      if (!url || !isSafeExternalUrl(url)) {
        return <span {...props}>{children}</span>;
      }
      return (
        <a
          {...props}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            void window.sideboard.openExternal(url);
          }}
        >
          {children}
        </a>
      );
    },
    // Fenced blocks arrive as <pre><code class="language-…">. Intercept mermaid
    // here so rehype-highlight never shows it as a plain code block.
    pre({ children, ...props }) {
      const firstChild = Array.isArray(children) ? children[0] : children;
      if (
        firstChild &&
        typeof firstChild === 'object' &&
        'props' in firstChild
      ) {
        const codeProps = (firstChild as { props: { className?: string; children?: ReactNode } })
          .props;
        const language = getCodeLanguage(codeProps.className);
        if (language === 'mermaid') {
          const chart = getTextContent(codeProps.children).replace(/\n$/, '');
          if (isStreaming) {
            return (
              <div className="md-mermaid md-mermaid-streaming">
                <div className="md-mermaid-streaming-label">Generating diagram…</div>
                <pre>{chart.length > 100 ? `${chart.slice(0, 100)}…` : chart}</pre>
              </div>
            );
          }
          return (
            <Suspense
              fallback={
                <div className="md-mermaid md-mermaid-loading">
                  <span>Loading diagram…</span>
                </div>
              }
            >
              <MermaidDiagram chart={chart} />
            </Suspense>
          );
        }
      }
      return <pre {...props}>{children}</pre>;
    },
    ...(onFileReferenceClick
      ? {
          code({ className: codeClassName, children, ...props }) {
            const raw = String(children).replace(/\n$/, '');
            const isBlock = Boolean(codeClassName?.startsWith('language-'));
            const lang = getCodeLanguage(codeClassName);
            // Mermaid is handled by `pre`; don't turn the fence into a file ref.
            if (lang === 'mermaid') {
              return (
                <code className={codeClassName} {...props}>
                  {children}
                </code>
              );
            }
            const link = parseFilePathLink(isBlock ? lang : raw, knownFilePaths);

            if (link) {
              const label =
                isBlock && link.startLine != null ? `${link.path}:${link.startLine}` : raw;
              return (
                <button
                  type="button"
                  className={`md-file-ref${isBlock ? ' block' : ''}`}
                  title={`Preview ${link.path}`}
                  onClick={() => onFileReferenceClick(link)}
                >
                  {isBlock ? link.path : label}
                </button>
              );
            }

            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
        }
      : {}),
  };

  return (
    <div className={className ?? 'md'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {linkifyThreadUrls(text)}
      </ReactMarkdown>
    </div>
  );
}

import { lazy, memo, Suspense, useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/vs2015.css';
import {
  isKnownDirectoryPath,
  parseFilePathLink,
  type FilePathLink,
} from '../lib/file-path-link';
import { parseArtifactLink, parseSideboardFileLink } from '../lib/chat-open-link';
import {
  linkifyThreadUrls,
  markdownUrlTransform,
  parseThreadLink,
} from '../lib/thread-link';
import { normalizeMarkdownTables } from '../lib/normalize-markdown-tables';
import { slackMrkdwnToMarkdown } from '../lib/slack-mrkdwn-to-markdown';
import { MarkdownCodeBlock } from './MarkdownCodeBlock';
import { MarkdownImage } from './MarkdownImage';

const MermaidDiagram = lazy(() => import('./MermaidDiagram'));

/** Stable plugin lists. A new array each render is a new `components` input for callers that rebuild markdown. */
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];
const noRehypePlugins: [] = [];

interface Props {
  text: string;
  className?: string;
  knownFilePaths?: string[];
  worktreePath?: string;
  onFileReferenceClick?: (link: FilePathLink) => void;
  /** Open a Sideboard thread from a sideboard://chat/<id> markdown link. */
  onThreadLinkClick?: (threadRef: string) => void;
  /** Open a side-column pane from sideboard://artifact/<id or title>. */
  onArtifactLinkClick?: (ref: string) => void;
  /**
   * Optional in-app handler for http(s) URLs (e.g. PR review preview tab).
   * Chat markdown omits this so links open in the system browser.
   */
  onUrlClick?: (url: string) => void;
  /** When true, defer mermaid rendering to avoid parse errors on incomplete syntax. */
  isStreaming?: boolean;
  /** Linked badge images (PR descriptions) should stay clickable links, not expand overlays. */
  expandImages?: boolean;
}

type MarkdownHandlers = {
  knownFilePaths?: string[];
  worktreePath?: string;
  onFileReferenceClick?: (link: FilePathLink) => void;
  onThreadLinkClick?: (threadRef: string) => void;
  onArtifactLinkClick?: (ref: string) => void;
  onUrlClick?: (url: string) => void;
};

function decodeHref(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
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

function MarkdownMessageInner({
  text,
  className,
  knownFilePaths,
  worktreePath,
  onFileReferenceClick,
  onThreadLinkClick,
  onArtifactLinkClick,
  onUrlClick,
  isStreaming = false,
  expandImages = true,
}: Props) {
  const handlersRef = useRef<MarkdownHandlers>(null!);
  handlersRef.current = {
    knownFilePaths,
    worktreePath,
    onFileReferenceClick,
    onThreadLinkClick,
    onArtifactLinkClick,
    onUrlClick,
  };

  // Component identity is the React type. A new `pre`/`img` function each
  // render remounts diagrams, images, and code blocks (mermaid.render, image
  // reload, lost expand/copy state) even when the source text did not change.
  const components = useMemo((): ComponentProps<typeof ReactMarkdown>['components'] => {
    return {
      img({ src, alt, title, className: imgClassName }) {
        const srcStr = typeof src === 'string' ? src : '';
        if (!srcStr) return null;
        if (!expandImages) {
          return (
            <img
              src={srcStr}
              alt={typeof alt === 'string' ? alt : ''}
              title={typeof title === 'string' ? title : undefined}
              className={typeof imgClassName === 'string' ? imgClassName : undefined}
              loading="lazy"
            />
          );
        }
        return (
          <MarkdownImage
            src={srcStr}
            alt={typeof alt === 'string' ? alt : ''}
            title={typeof title === 'string' ? title : undefined}
            className={typeof imgClassName === 'string' ? imgClassName : undefined}
          />
        );
      },
      a({ href, children, ...props }) {
        const handlers = handlersRef.current;
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
                handlersRef.current.onThreadLinkClick?.(threadRef);
              }}
            >
              {children}
            </a>
          );
        }
        const artifactRef = parseArtifactLink(url);
        if (artifactRef) {
          return (
            <a
              {...props}
              href={url}
              className="md-artifact-link"
              title="Open in the side column"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlersRef.current.onArtifactLinkClick?.(artifactRef);
              }}
            >
              {children}
            </a>
          );
        }
        const sideboardFile = parseSideboardFileLink(url);
        const fileLink =
          sideboardFile ??
          (!/^[a-z][a-z0-9+.-]*:/i.test(url)
            ? parseFilePathLink(decodeHref(url), handlers.knownFilePaths, handlers.worktreePath)
            : null);
        if (fileLink && handlers.onFileReferenceClick) {
          const dirHint = isKnownDirectoryPath(fileLink.path, handlers.knownFilePaths);
          return (
            <a
              {...props}
              href={url}
              className="md-file-link"
              title={dirHint ? `Show ${fileLink.path} in files` : `Open ${fileLink.path}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlersRef.current.onFileReferenceClick?.(fileLink);
              }}
            >
              {children}
            </a>
          );
        }
        if (!url || !isSafeExternalUrl(url)) {
          return <span {...props}>{children}</span>;
        }
        const openInTab =
          Boolean(handlers.onUrlClick) &&
          (url.startsWith('http://') || url.startsWith('https://'));
        return (
          <a
            {...props}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            title={
              openInTab ? 'Open in Sideboard preview (⌥/Alt-click for browser)' : 'Open in browser'
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (openInTab && !e.altKey && !e.metaKey) {
                handlersRef.current.onUrlClick?.(url);
                return;
              }
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
        if (firstChild && typeof firstChild === 'object' && 'props' in firstChild) {
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
        return <MarkdownCodeBlock {...props}>{children}</MarkdownCodeBlock>;
      },
      code({ className: codeClassName, children, ...props }) {
        const handlers = handlersRef.current;
        const raw = String(children).replace(/\n$/, '');
        const isBlock = Boolean(codeClassName?.startsWith('language-'));
        const lang = getCodeLanguage(codeClassName);
        // Mermaid is handled by `pre`; don't turn the fence into a file ref.
        if (lang === 'mermaid' || !handlers.onFileReferenceClick) {
          return (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          );
        }
        const link = parseFilePathLink(
          isBlock ? lang : raw,
          handlers.knownFilePaths,
          handlers.worktreePath,
        );

        if (link) {
          const label =
            isBlock && link.startLine != null ? `${link.path}:${link.startLine}` : raw;
          const dirHint = isKnownDirectoryPath(link.path, handlers.knownFilePaths);
          return (
            <button
              type="button"
              className={`md-file-ref${isBlock ? ' block' : ''}`}
              title={dirHint ? `Show ${link.path} in files` : `Open ${link.path}`}
              onClick={() => handlersRef.current.onFileReferenceClick?.(link)}
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
    };
  }, [expandImages, isStreaming]);

  return (
    <div className={className ?? 'md'}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={isStreaming ? noRehypePlugins : rehypePlugins}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {normalizeMarkdownTables(linkifyThreadUrls(slackMrkdwnToMarkdown(text)))}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageInner);

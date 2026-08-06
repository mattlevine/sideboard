import { documentPreviewKind, imageMimeType } from '../lib/language';
import { MarkdownMessage } from './MarkdownMessage';

interface Props {
  path: string;
  content: string;
  /** When content is base64 (images from readFile). */
  encoding?: 'utf8' | 'base64';
  className?: string;
}

export function DocumentPreview({ path, content, encoding = 'utf8', className }: Props) {
  const kind = documentPreviewKind(path);
  if (!kind) return null;

  if (kind === 'image') {
    if (encoding !== 'base64' || !content) return null;
    const src = `data:${imageMimeType(path)};base64,${content}`;
    return (
      <div className={`doc-preview doc-preview-image${className ? ` ${className}` : ''}`}>
        <img src={src} alt={path} className="doc-preview-img" />
      </div>
    );
  }

  if (kind === 'markdown') {
    return (
      <div className={`doc-preview doc-preview-md${className ? ` ${className}` : ''}`}>
        <MarkdownMessage text={content} className="md" />
      </div>
    );
  }

  return (
    <iframe
      className={`doc-preview doc-preview-html${className ? ` ${className}` : ''}`}
      title={`Preview ${path}`}
      sandbox="allow-scripts"
      srcDoc={content}
    />
  );
}

interface ModeToggleProps {
  mode: 'code' | 'preview';
  onChange: (mode: 'code' | 'preview') => void;
}

/** Segmented Code / Preview control for markdown & HTML files. */
export function DocumentPreviewModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="doc-preview-toggle" role="group" aria-label="View mode">
      <button
        type="button"
        className={mode === 'code' ? 'active' : ''}
        aria-pressed={mode === 'code'}
        onClick={() => onChange('code')}
      >
        Code
      </button>
      <button
        type="button"
        className={mode === 'preview' ? 'active' : ''}
        aria-pressed={mode === 'preview'}
        onClick={() => onChange('preview')}
      >
        Preview
      </button>
    </div>
  );
}

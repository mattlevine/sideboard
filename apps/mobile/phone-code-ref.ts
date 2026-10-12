/** Selection the phone sends. The Mac builds the desktop code-ref attachment. */
export type PhoneCodeSelection = {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
};

export type PhoneCodeRef = PhoneCodeSelection & { id: string };

/** Inclusive line label, matching desktop code-ref chips (`L10` / `L10-20`). */
export function codeRefRangeLabel(startLine: number, endLine: number): string {
  return startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;
}

export function codeRefChipLabel(ref: PhoneCodeSelection): string {
  const base = ref.path.split('/').pop() || ref.path;
  return `${base}:${codeRefRangeLabel(ref.startLine, ref.endLine)}`;
}

/**
 * Map a character selection in the file text to an inclusive line range.
 * A trailing newline does not pull in the next line.
 */
export function selectionLineRange(
  content: string,
  start: number,
  end: number,
): { startLine: number; endLine: number; text: string } | null {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(content.length, Math.max(start, end));
  if (to <= from) return null;
  const text = content.slice(from, to).replace(/\n$/, '').slice(0, 20_000);
  if (!text.trim()) return null;
  const startLine = content.slice(0, from).split('\n').length;
  const endLine = content.slice(0, from + text.length).split('\n').length;
  return { startLine, endLine, text };
}

/** Text files can be selected. Images, folders, and binary bodies cannot. */
export function selectableFileText(file: {
  encoding: 'utf8' | 'base64';
  directory?: boolean;
  binary?: boolean;
  mime?: string;
  path: string;
  content: string;
  diff?: boolean;
}): { path: string; content: string } | null {
  if (file.diff || file.directory || file.binary || file.encoding !== 'utf8') return null;
  if (file.mime?.startsWith('image/')) return null;
  if (!file.path || !file.content) return null;
  return { path: file.path, content: file.content };
}

export function phoneSendExtras(
  files: Array<{ name: string; dataBase64: string }>,
  links: Array<{ ref: string; title: string; url?: string }>,
  refs: PhoneCodeRef[],
) {
  const wire = refs.map(({ path, startLine, endLine, text }) => ({ path, startLine, endLine, text }));
  return {
    attached: files.length > 0 || links.length > 0 || refs.length > 0,
    names: [...files.map((file) => file.name), ...links.map((link) => link.ref), ...refs.map(codeRefChipLabel)],
    payload: {
      ...(files.length ? { files: files.map(({ name, dataBase64 }) => ({ name, dataBase64 })) } : {}),
      ...(links.length ? { links } : {}),
      ...(wire.length ? { refs: wire } : {}),
    },
  };
}

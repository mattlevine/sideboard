/**
 * SmartCrusher-style crush for Sideboard-owned MCP payloads.
 *
 * Same safety gates as Headroom's SmartCrusher, tuned so a coding agent does
 * not lose unique information:
 * - Small arrays / short text pass through unchanged.
 * - Exact and near-duplicate items are dropped (lossless).
 * - Error / exception / failed / fatal / panic / traceback blocks are never dropped.
 * - Length outliers (> mean + 2σ) are never dropped.
 * - Remaining budget: 30% from the start, 15% from the end, 55% by importance
 *   (length, code fences). Original order is restored.
 * - If the crushed result is not smaller, return the original.
 *
 * Nothing is stored locally. Re-fetch with include=full for the vendor original.
 */

export const MUST_KEEP_TEXT_RE =
  /\b(error|exception|failed|failure|fatal|critical|panic|traceback|npm err|assert)\b/i;

/** Headroom min_items_to_analyze. */
export const CRUSH_MIN_ITEMS = 5;
/** ~200 tokens at ~4 chars/token (Headroom min_tokens_to_crush). */
export const CRUSH_MIN_CHARS = 800;
/**
 * Comment-thread budget after crush. High on purpose: unique discussion stays.
 * Adaptive K only fires when the thread is actually huge.
 */
export const CRUSH_COMMENT_MAX_CHARS = 16_000;
/** Unique markdown body: pass through under this (typical tickets). */
export const CRUSH_BODY_MIN_CHARS = 12_000;
/** Cap after a huge-body crush (plus any must-keep error blocks). */
export const CRUSH_BODY_MAX_CHARS = 8_000;

const NEAR_DUP_JACCARD = 0.92;

export interface CrushArrayOptions {
  minItems?: number;
  minChars?: number;
  maxChars?: number;
}

export interface CrushArrayResult<T> {
  items: T[];
  truncated: boolean;
  kept: number;
  dropped: number;
  reason: 'passthrough' | 'dedup' | 'budget';
}

export interface CrushMarkdownResult {
  text: string;
  truncated: boolean;
  originalChars: number;
}

export function textChars(text: string | undefined | null): number {
  return text?.length ?? 0;
}

export function looksLikeMustKeep(text: string): boolean {
  return MUST_KEEP_TEXT_RE.test(text);
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) {
    if (b.has(w)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function importance(text: string): number {
  let score = text.length;
  if (/```/.test(text)) score += 400;
  if (/https?:\/\//.test(text)) score += 50;
  if (looksLikeMustKeep(text)) score += 10_000;
  return score;
}

function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/** Drop exact / near-duplicate texts; keep the first (longer wins on near-dup). */
export function dedupTextItems<T>(
  items: T[],
  getText: (item: T) => string,
): { items: T[]; dropped: number } {
  const kept: T[] = [];
  const keptNorm: string[] = [];
  const keptWords: Set<string>[] = [];

  for (const item of items) {
    const text = getText(item);
    const norm = normalizeText(text);
    if (!norm) {
      kept.push(item);
      keptNorm.push(norm);
      keptWords.push(wordSet(text));
      continue;
    }
    const words = wordSet(text);
    let dupAt = -1;
    for (let i = 0; i < kept.length; i++) {
      if (keptNorm[i] === norm) {
        dupAt = i;
        break;
      }
      if (
        keptWords[i]!.size >= 8 &&
        words.size >= 8 &&
        jaccard(keptWords[i]!, words) >= NEAR_DUP_JACCARD
      ) {
        dupAt = i;
        break;
      }
    }
    if (dupAt < 0) {
      kept.push(item);
      keptNorm.push(norm);
      keptWords.push(words);
      continue;
    }
    if (text.length > getText(kept[dupAt]!).length) {
      kept[dupAt] = item;
      keptNorm[dupAt] = norm;
      keptWords[dupAt] = words;
    }
  }

  return { items: kept, dropped: items.length - kept.length };
}

/**
 * Crush an array of text-bearing objects (comments, similar JSON rows).
 * Returns the original array when gates say crushing would lose unique work.
 */
export function crushTextItems<T>(
  items: T[],
  getText: (item: T) => string,
  opts: CrushArrayOptions = {},
): CrushArrayResult<T> {
  const minItems = opts.minItems ?? CRUSH_MIN_ITEMS;
  const minChars = opts.minChars ?? CRUSH_MIN_CHARS;
  const maxChars = opts.maxChars ?? CRUSH_COMMENT_MAX_CHARS;
  const original = items;
  const totalChars = items.reduce((n, item) => n + getText(item).length, 0);

  if (items.length < minItems || totalChars < minChars) {
    return {
      items,
      truncated: false,
      kept: items.length,
      dropped: 0,
      reason: 'passthrough',
    };
  }

  const deduped = dedupTextItems(items, getText);
  const unique = deduped.items;
  const uniqueChars = unique.reduce((n, item) => n + getText(item).length, 0);

  if (uniqueChars <= maxChars) {
    const changed = unique.length < original.length;
    return {
      items: unique,
      truncated: changed,
      kept: unique.length,
      dropped: original.length - unique.length,
      reason: changed ? 'dedup' : 'passthrough',
    };
  }

  const lengths = unique.map((item) => getText(item).length);
  const { mean, std } = meanStd(lengths);
  const outlierFloor = mean + 2 * std;

  const mustKeep = new Set<number>();
  unique.forEach((item, i) => {
    const text = getText(item);
    if (looksLikeMustKeep(text) || text.length > outlierFloor) mustKeep.add(i);
  });

  const remainingIdx = unique.map((_, i) => i).filter((i) => !mustKeep.has(i));
  let used = [...mustKeep].reduce((n, i) => n + lengths[i]!, 0);

  const pick = new Set<number>(mustKeep);
  const canTake = (i: number): boolean => {
    if (pick.has(i)) return false;
    const next = used + lengths[i]!;
    if (next > maxChars && pick.size > mustKeep.size) return false;
    used = next;
    pick.add(i);
    return true;
  };

  const k = remainingIdx.length;
  const headN = Math.max(1, Math.ceil(k * 0.3));
  const tailN = Math.max(1, Math.ceil(k * 0.15));
  for (const i of remainingIdx.slice(0, headN)) canTake(i);
  for (const i of remainingIdx.slice(-tailN).reverse()) canTake(i);

  const middle = remainingIdx
    .filter((i) => !pick.has(i))
    .sort((a, b) => importance(getText(unique[b]!)) - importance(getText(unique[a]!)));
  for (const i of middle) {
    if (used >= maxChars) break;
    canTake(i);
  }

  const crushed = unique.filter((_, i) => pick.has(i));
  const crushedChars = crushed.reduce((n, item) => n + getText(item).length, 0);
  if (crushed.length >= original.length && crushedChars >= totalChars) {
    return {
      items: original,
      truncated: false,
      kept: original.length,
      dropped: 0,
      reason: 'passthrough',
    };
  }

  return {
    items: crushed,
    truncated: crushed.length < original.length,
    kept: crushed.length,
    dropped: original.length - crushed.length,
    reason: 'budget',
  };
}

function splitBlocks(text: string): string[] {
  if (/\n\n/.test(text)) return text.split(/\n\n+/);
  return text.split('\n');
}

function capOversizedBlock(block: string, maxChars: number): string {
  if (block.length <= maxChars) return block;
  const head = Math.floor(maxChars * 0.3);
  const tail = Math.floor(maxChars * 0.15);
  return `${block.slice(0, head)}\n\n[…crushed ${block.length - head - tail} chars; pass include=full to read the rest…]\n\n${block.slice(-tail)}`;
}

/**
 * Crush a single markdown / log body. Unique tickets under CRUSH_BODY_MIN_CHARS
 * pass through. Huge pasted dumps keep head + tail + every must-keep error block.
 */
export function crushMarkdown(
  text: string | undefined | null,
  opts?: { minChars?: number; maxChars?: number },
): CrushMarkdownResult {
  const original = text ?? '';
  const minChars = opts?.minChars ?? CRUSH_BODY_MIN_CHARS;
  const maxChars = opts?.maxChars ?? CRUSH_BODY_MAX_CHARS;
  if (original.length < minChars) {
    return { text: original, truncated: false, originalChars: original.length };
  }

  const rawBlocks = splitBlocks(original).filter((b) => b.length > 0);
  const blocks = rawBlocks.map((b) => capOversizedBlock(b, maxChars));
  const cappedABlock = blocks.some((b, i) => b !== rawBlocks[i]);
  if (blocks.length <= 1) {
    const cut = blocks[0] ?? original;
    if (cut.length >= original.length) {
      return { text: original, truncated: false, originalChars: original.length };
    }
    return { text: cut, truncated: true, originalChars: original.length };
  }

  const must = blocks.filter((b) => looksLikeMustKeep(b));
  const rest = blocks.filter((b) => !looksLikeMustKeep(b));
  const marker = `[…crushed body; ${original.length} chars originally. Pass include=full to read the rest.]`;
  let used = must.reduce((n, b) => n + b.length, 0) + marker.length;
  const keptRest: string[] = [];

  const headN = Math.max(1, Math.ceil(rest.length * 0.3));
  const tailN = Math.max(1, Math.ceil(rest.length * 0.15));
  const head = rest.slice(0, headN);
  const tail = rest.slice(-tailN);
  const middle = rest.slice(headN, Math.max(headN, rest.length - tailN));

  const take = (block: string): boolean => {
    if (used + block.length + 2 > maxChars && keptRest.length + must.length > 0) {
      return false;
    }
    used += block.length + 2;
    keptRest.push(block);
    return true;
  };

  for (const b of head) take(b);
  for (const b of tail) take(b);
  const ranked = [...middle].sort((a, b) => importance(b) - importance(a));
  for (const b of ranked) {
    if (used >= maxChars) break;
    take(b);
  }

  const keepSet = new Set([...must, ...keptRest]);
  const ordered = blocks.filter((b) => keepSet.has(b));
  const omitted = blocks.length - ordered.length;
  if (omitted <= 0) {
    const joined = blocks.join('\n\n');
    if (cappedABlock && joined.length < original.length) {
      return { text: joined, truncated: true, originalChars: original.length };
    }
    return { text: original, truncated: false, originalChars: original.length };
  }

  const out: string[] = [];
  let inserted = false;
  for (const block of blocks) {
    if (keepSet.has(block)) {
      out.push(block);
      continue;
    }
    if (!inserted) {
      out.push(marker);
      inserted = true;
    }
  }
  const textOut = out.join('\n\n');
  if (textOut.length >= original.length) {
    return { text: original, truncated: false, originalChars: original.length };
  }
  return { text: textOut, truncated: true, originalChars: original.length };
}

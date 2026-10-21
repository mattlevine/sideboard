/** SEP-1865 `_meta.ui.visibility`. Default is model + app. */

export type McpUiAudience = 'model' | 'app';

export function visibilityFromMeta(meta: unknown): McpUiAudience[] {
  const rec = asRecord(meta);
  const ui = asRecord(rec.ui);
  const raw = ui.visibility;
  if (!Array.isArray(raw)) return ['model', 'app'];
  const out: McpUiAudience[] = [];
  for (const item of raw) {
    if (item !== 'model' && item !== 'app') continue;
    if (!out.includes(item)) out.push(item);
  }
  return out.length ? out : ['model', 'app'];
}

export function toolVisibleTo(
  visibility: readonly string[] | undefined,
  audience: McpUiAudience,
): boolean {
  const vis = visibility?.length ? visibility : ['model', 'app'];
  return vis.includes(audience);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

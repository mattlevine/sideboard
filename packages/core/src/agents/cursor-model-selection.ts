/**
 * Build the Cursor SDK `model` argument for Agent.create / resume / send.
 *
 * Always sends an explicit `fast` param. Omitting it lets Cursor default Fast
 * on Pro+ for Grok (and other models that support the param), which bills ~2×.
 *
 * Local `Agent.create({ local })` rejects Grok 4.7's catalog default (500k
 * context). Pin the standard 256k window; 500k is cloud-only today.
 */
export function buildCursorModelSelection(
  model: string | null | undefined,
  opts: { effort?: string | null; fast?: boolean },
): { id: string; params?: Array<{ id: string; value: string }> } {
  // Cursor.models.list uses id "default" for Auto.
  const raw = (model && model.trim()) || '';
  const id =
    !raw || raw.toLowerCase() === 'auto' || raw.toLowerCase() === 'default'
      ? 'default'
      : raw;
  const params: Array<{ id: string; value: string }> = [];
  if (/^grok-4\.7(?:$|-)/i.test(id)) {
    params.push({ id: 'context', value: '256k' });
  }
  const effort = (opts.effort ?? '').trim().toLowerCase();
  const normalized =
    effort === 'normal'
      ? 'medium'
      : effort === 'low' ||
          effort === 'medium' ||
          effort === 'high' ||
          effort === 'xhigh' ||
          effort === 'max'
        ? effort
        : '';
  if (normalized) {
    params.push({ id: 'effort', value: normalized });
  }
  // Explicit true/false — never omit (Cursor Pro+ defaults Fast for Grok).
  params.push({ id: 'fast', value: opts.fast ? 'true' : 'false' });
  return { id, params };
}

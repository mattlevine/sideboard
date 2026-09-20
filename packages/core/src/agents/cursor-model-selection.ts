/**
 * Build the Cursor SDK `model` argument for Agent.create / resume / send.
 *
 * Always sends an explicit `fast` param. Omitting it lets Cursor default Fast
 * on Pro+ for Grok (and other models that support the param), which bills ~2×.
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

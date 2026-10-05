/**
 * Build the Cursor SDK `model` argument for Agent.create / resume / send.
 *
 * Always sends an explicit `fast` param. Omitting it lets Cursor default Fast
 * on Pro+ for Grok (and other models that support the param), which bills ~2×.
 *
 * Grok 4.7's catalog uses `reasoning_effort` (not `effort`) plus a `context`
 * param. Local `Agent.create({ local })` rejects the listed default (500k);
 * pin 256k. Sending `effort` is an invalid registry param even at 256k.
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
  const isGrok47 = /^grok-4\.7(?:$|-)/i.test(id);
  const params: Array<{ id: string; value: string }> = [];
  if (isGrok47) {
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
    // Catalog: grok-4.7 → reasoning_effort (low|medium|high|xhigh); older
    // Grok / Claude still use `effort`. Max is Sideboard-only — clamp to xhigh.
    params.push({
      id: isGrok47 ? 'reasoning_effort' : 'effort',
      value: isGrok47 && normalized === 'max' ? 'xhigh' : normalized,
    });
  }
  // Explicit true/false — never omit (Cursor Pro+ defaults Fast for Grok).
  params.push({ id: 'fast', value: opts.fast ? 'true' : 'false' });
  return { id, params };
}

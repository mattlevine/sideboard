export type CreateModalMode = 'create' | 'orchestration';

/** True when dismissing the create / orchestration modal would lose typed work. */
export function createModalHasDraft(input: {
  mode: CreateModalMode;
  prompt: string;
  goal: string;
  attachmentCount: number;
  hasSelection?: boolean;
}): boolean {
  if (input.attachmentCount > 0) return true;
  if (input.mode !== 'orchestration' && input.hasSelection) return true;
  const text = input.mode === 'orchestration' ? input.goal : input.prompt;
  return Boolean(text.trim());
}

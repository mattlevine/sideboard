/** Shared shape for composer agent model pickers. */
export type AgentModelInfo = {
  id: string;
  displayName: string;
  description?: string;
};

/** @deprecated Prefer {@link AgentModelInfo} — same shape. */
export type CursorModelInfo = AgentModelInfo;

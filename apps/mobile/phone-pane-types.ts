/** Mirrors PhonePaneRow in packages/core. The phone app does not import core. */
export type PhonePaneId = 'files' | 'changes' | 'checks';

export type PhonePaneRow = {
  label: string;
  path?: string;
  /** Git name-status letter (M/A/D/…). Changes rows only. */
  status?: string;
  detail?: string;
  href?: string;
};

export type PhoneSide = {
  pane: PhonePaneId;
  rows: PhonePaneRow[];
  note?: string;
  loading?: boolean;
};

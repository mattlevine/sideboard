/** Snapshot picker fields from the host once per open, not on live effort/Fast echoes. */
export function shouldSnapshotPickerFromHost(
  open: boolean,
  alreadySnapshotted: boolean,
): boolean {
  if (!open) return false;
  return !alreadySnapshotted;
}

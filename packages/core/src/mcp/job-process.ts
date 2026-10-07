function jobAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True if any process remains in the wrap pid's group (wrap itself may already be dead). */
export function processGroupAlive(pgid: number): boolean {
  if (process.platform === 'win32') return false;
  // pgid 1 would become process.kill(-1), which signals every process.
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return Boolean(err && typeof err === 'object' && 'code' in err && err.code === 'EPERM');
  }
}

/** Wrap-exit is not "everything is dead" — leftover children keep the job running. */
export function jobTreeAlive(pid: number | null | undefined): boolean {
  if (pid == null) return false;
  return jobAlive(pid) || processGroupAlive(pid);
}

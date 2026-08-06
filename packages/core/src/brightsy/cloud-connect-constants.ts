/** Title / sourceRef for the singleton Brightsy cloud coordinator chat. */
export const CLOUD_ORCHESTRATOR_GOAL = 'Cloud-connected Sideboard orchestrator';

/**
 * First-line token for a desktop task that force-stops the in-progress
 * Brightsy-marked orchestration turn. Optional follow-up request may follow
 * on later lines.
 */
export const SIDEBOARD_FORCE_STOP = 'SIDEBOARD_FORCE_STOP';

/** Fixed non-AI reply when the cloud coordinator is already busy. */
export const CLOUD_COORDINATOR_BUSY_REPLY = [
  'Sideboard is busy with an in-progress client/desktop tool turn on the global coordinator.',
  'I did not start a new orchestration turn.',
  `To force-stop the in-progress turn, send another desktop request whose first line is exactly ${SIDEBOARD_FORCE_STOP}`,
  '(optional follow-up request on later lines).',
  'What do you want me to do? (retry later, wait until idle, force-stop, rephrase, or cancel)',
].join(' ');

/** Fixed non-AI reply when a force-stop task had no follow-up request. */
export const CLOUD_COORDINATOR_STOPPED_REPLY = [
  'Sideboard force-stopped the in-progress global coordinator turn.',
  'No new orchestration request was started.',
].join(' ');

/** Fixed non-AI reply when wait_for_turn times out. */
export const CLOUD_COORDINATOR_TIMEOUT_REPLY = [
  'Sideboard global coordinator timed out waiting for the local agent turn to finish.',
  'I did not produce a full orchestration result.',
  `To force-stop the in-progress turn, send another desktop request whose first line is exactly ${SIDEBOARD_FORCE_STOP}`,
  '(optional follow-up request on later lines).',
  'What do you want me to do? (retry later, wait, force-stop, rephrase, or cancel)',
].join(' ');

/**
 * Detect a force-stop directive on the first line of a desktop task message.
 * Force-stop is true only when that line (trimmed, case-insensitive) equals
 * {@link SIDEBOARD_FORCE_STOP}. Remainder is everything after the first line
 * (trimmed); empty when stop-only. When forceStop is false, remainder is the original message.
 */
export function parseForceStopMessage(message: string): {
  forceStop: boolean;
  remainder: string;
} {
  const normalized = message.replace(/\r\n/g, '\n');
  const nl = normalized.indexOf('\n');
  const firstLine = (nl === -1 ? normalized : normalized.slice(0, nl)).trim();
  const remainder = (nl === -1 ? '' : normalized.slice(nl + 1)).trim();
  const forceStop =
    firstLine.toLowerCase() === SIDEBOARD_FORCE_STOP.toLowerCase();
  return { forceStop, remainder: forceStop ? remainder : message };
}

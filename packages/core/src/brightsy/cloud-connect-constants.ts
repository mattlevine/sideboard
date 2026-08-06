/** Title / sourceRef for the singleton Brightsy cloud coordinator chat. */
export const CLOUD_ORCHESTRATOR_GOAL = 'Cloud-connected Sideboard orchestrator';

/** Fixed non-AI reply when the cloud coordinator is already busy. */
export const CLOUD_COORDINATOR_BUSY_REPLY = [
  'Sideboard is busy with an in-progress client/desktop tool turn on the global coordinator.',
  'I did not start a new orchestration turn.',
  'What do you want me to do? (retry later, wait until idle, rephrase, or cancel)',
].join(' ');

/** Fixed non-AI reply when wait_for_turn times out. */
export const CLOUD_COORDINATOR_TIMEOUT_REPLY = [
  'Sideboard global coordinator timed out waiting for the local agent turn to finish.',
  'I did not produce a full orchestration result.',
  'What do you want me to do? (retry later, wait, rephrase, or cancel)',
].join(' ');

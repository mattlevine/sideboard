import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const core = (rel: string) => resolve(__dirname, '../../packages/core/src', rel);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@sideboard/message-parts': core('agents/message-parts.ts'),
      '@sideboard/worktree-labels': core('git/worktree-labels.ts'),
      '@sideboard/brightsy-targets': core('agents/brightsy-targets.ts'),
      '@sideboard/gh-errors': core('git/gh-errors.ts'),
      '@sideboard/diff-comment': core('composer/diff-comment.ts'),
      '@sideboard/teams': core('git/teams.ts'),
      '@sideboard/orchestrator-capable': core('agents/orchestrator-capable.ts'),
      '@sideboard/plan-ask-user': core('plan/ask-user.ts'),
      '@sideboard/plan-file': core('plan/plan-present.ts'),
      '@sideboard/agent-git-actions': core('git/agent-git-actions.ts'),
      '@sideboard/review-request-template': core('review/review-request-template.ts'),
    },
  },
});

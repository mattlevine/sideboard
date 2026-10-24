import { beforeEach, describe, expect, it, vi } from 'vitest';
import { linearGraphql } from './linear.js';
import {
  getLinearIssueBlockedBy,
  linearBlockedByIdentifiers,
  linearBlockedByRelations,
} from './linear-blocked.js';

vi.mock('./linear.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./linear.js')>();
  return { ...actual, linearGraphql: vi.fn() };
});

const graphql = vi.mocked(linearGraphql);

beforeEach(() => {
  graphql.mockReset();
});

describe('linearBlockedByRelations', () => {
  it('treats an incoming blocks relation as blockedBy and ignores outgoing blocks', () => {
    expect(
      linearBlockedByIdentifiers(
        linearBlockedByRelations({
          relations: {
            nodes: [{ type: 'blocks', relatedIssue: { identifier: 'ENG-8' } }],
          },
          inverseRelations: {
            nodes: [{ type: 'blocks', issue: { identifier: 'ENG-2' } }],
          },
        }),
      ),
    ).toEqual(['ENG-2']);
  });
});

describe('getLinearIssueBlockedBy', () => {
  it('reads blockers from inverse relations without the full issue payload', async () => {
    graphql.mockResolvedValue({
      issue: {
        identifier: 'ENG-9',
        relations: { nodes: [] },
        inverseRelations: {
          nodes: [{ type: 'blocks', issue: { identifier: 'ENG-2' } }],
        },
      },
    });
    await expect(getLinearIssueBlockedBy('ENG-9')).resolves.toEqual(['ENG-2']);
    const query = String(graphql.mock.calls[0]?.[0] ?? '');
    expect(query).toContain('inverseRelations');
    expect(query).not.toContain('comments');
  });
});

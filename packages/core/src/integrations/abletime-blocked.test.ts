import { afterEach, describe, expect, it, vi } from 'vitest';
import { ableTimeBlockedByIdentifiers, getAbleTimeIssueBlockedBy } from './abletime-blocked.js';

describe('ableTimeBlockedByIdentifiers', () => {
  it('reads a wait-on id from the task payload', () => {
    expect(
      ableTimeBlockedByIdentifiers({
        task: { blocked_by: { identifier: 'CRM-8' } },
      }),
    ).toEqual(['CRM-8']);
    expect(ableTimeBlockedByIdentifiers({ depends_on: 'CRM-1' })).toEqual(['CRM-1']);
    expect(
      ableTimeBlockedByIdentifiers({
        dependencyParentTimeflowTaskId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      }),
    ).toEqual(['01ARZ3NDEKTSV4RRFFQ69G5FAV']);
    expect(ableTimeBlockedByIdentifiers({ depends_on: null })).toEqual([]);
    expect(
      ableTimeBlockedByIdentifiers({
        blocked_by: { identifier: 'CRM-8', state: 'done' },
      }),
    ).toEqual([]);
  });
});

describe('getAbleTimeIssueBlockedBy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves a REST dependency parent id to its task reference', async () => {
    const parentId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const taskId = '01ARZ3NDEKTSV4RRFFQ69G5FBW';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const href = String(url);
        let payload: unknown = { data: [], page: {} };
        if (href.includes(`/tasks/${parentId}`)) {
          payload = { timeflowTaskId: parentId, taskRef: 'CRM-8', title: 'Parent' };
        } else if (href.includes(`/tasks/${taskId}`)) {
          payload = {
            timeflowTaskId: taskId,
            taskRef: 'CRM-1',
            title: 'Child',
            dependencyParentTimeflowTaskId: parentId,
          };
        } else if (href.includes('/tasks')) {
          payload = {
            data: [
              {
                timeflowTaskId: taskId,
                taskRef: 'CRM-1',
                title: 'Child',
                dependencyParentTimeflowTaskId: parentId,
              },
            ],
            page: {},
          };
        }
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify(payload),
        };
      }),
    );
    expect(
      await getAbleTimeIssueBlockedBy('CRM-1', {
        token: 'atk_org',
        host: 'https://track.abletime.com',
      }),
    ).toEqual(['CRM-8']);
  });

  it('omits a dependency parent that is already done', async () => {
    const parentId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const taskId = '01ARZ3NDEKTSV4RRFFQ69G5FBW';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const href = String(url);
        let payload: unknown = { data: [], page: {} };
        if (href.includes(`/tasks/${parentId}`)) {
          payload = {
            timeflowTaskId: parentId,
            taskRef: 'CRM-8',
            title: 'Parent',
            state: 'done',
          };
        } else if (href.includes(`/tasks/${taskId}`)) {
          payload = {
            timeflowTaskId: taskId,
            taskRef: 'CRM-1',
            title: 'Child',
            dependencyParentTimeflowTaskId: parentId,
          };
        } else if (href.includes('/tasks')) {
          payload = {
            data: [
              {
                timeflowTaskId: taskId,
                taskRef: 'CRM-1',
                title: 'Child',
                dependencyParentTimeflowTaskId: parentId,
              },
            ],
            page: {},
          };
        }
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify(payload),
        };
      }),
    );
    expect(
      await getAbleTimeIssueBlockedBy('CRM-1', {
        token: 'atk_org',
        host: 'https://track.abletime.com',
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  filterPhoneOrchestration,
  filterPhoneProjects,
  phoneOrchestrationVisible,
  phoneTagChoices,
  togglePhoneTagFilter,
} from '../../../../apps/mobile/sidebar-filter.ts';

const projects = [
  {
    name: 'sideboard',
    path: '/sb',
    worktrees: [
      {
        label: 'monaco',
        tags: ['Auth', 'phone'],
        chats: [
          { title: 'Pairing', agent: 'cursor', preview: 'relay code' },
          { title: 'Tags', agent: 'claude', preview: 'chips' },
        ],
      },
      {
        label: 'lyon',
        tags: ['Auth'],
        chats: [{ title: 'Login', agent: 'codex', preview: 'session' }],
      },
    ],
  },
  {
    name: 'other',
    path: '/other',
    worktrees: [{ label: 'nice', tags: ['phone'], chats: [{ title: 'Notes', agent: 'cursor', preview: '' }] }],
  },
];

describe('phone sidebar filter', () => {
  it('toggles tags and keeps a vanished selection in the chip list', () => {
    expect(togglePhoneTagFilter(['Auth'], 'auth')).toEqual([]);
    expect(togglePhoneTagFilter(['Auth'], 'phone')).toEqual(['Auth', 'phone']);
    expect(phoneTagChoices(projects, ['gone'])).toEqual(['gone', 'Auth', 'phone']);
  });

  it('keeps a workspace only when it has every selected tag', () => {
    const both = filterPhoneProjects(projects, '', ['auth', 'phone']);
    expect(both.map((project) => project.worktrees.map((worktree) => worktree.label))).toEqual([['monaco']]);
    expect(filterPhoneProjects(projects, '', ['phone']).map((project) => project.name)).toEqual([
      'sideboard',
      'other',
    ]);
  });

  it('matches the desktop haystack and hides projects with nothing left', () => {
    const login = filterPhoneProjects(projects, 'login', []);
    expect(login).toEqual([
      {
        name: 'sideboard',
        path: '/sb',
        worktrees: [
          {
            label: 'lyon',
            tags: ['Auth'],
            chats: [{ title: 'Login', agent: 'codex', preview: 'session' }],
          },
        ],
      },
    ]);
    expect(filterPhoneProjects(projects, 'monaco', []).flatMap((project) => project.worktrees.map((worktree) => worktree.chats.length))).toEqual([
      2,
    ]);
    expect(filterPhoneProjects(projects, 'missing', [])).toEqual([]);
  });

  it('matches a checkout nickname that is not the row label', () => {
    const named = [
      {
        name: 'sideboard',
        path: '/sb',
        worktrees: [
          {
            label: 'matt/remove-sidebar-create-search',
            workspace: 'Real Salt Lake',
            tags: [],
            chats: [{ title: 'Notes', agent: 'cursor', preview: '' }],
          },
        ],
      },
    ];
    expect(filterPhoneProjects(named, 'salt lake', []).flatMap((project) => project.worktrees.map((worktree) => worktree.label))).toEqual([
      'matt/remove-sidebar-create-search',
    ]);
  });

  it('filters orchestration chats and keeps the section when the query names it', () => {
    const chats = [{ title: 'Planner', agent: 'claude', preview: 'board' }];
    expect(filterPhoneOrchestration(chats, 'planner')).toEqual(chats);
    expect(filterPhoneOrchestration(chats, 'zz')).toEqual([]);
    expect(phoneOrchestrationVisible(chats, 'zz')).toBe(false);
    expect(phoneOrchestrationVisible(chats, 'orch')).toBe(true);
    expect(phoneOrchestrationVisible([], '')).toBe(true);
  });
});

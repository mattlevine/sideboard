/**
 * Phone sidebar filter. Same rules as the desktop left sidebar:
 * a workspace stays listed only when it has every selected tag, and the
 * text query matches a workspace the way the desktop haystack does.
 */

export type SidebarChat = {
  title: string;
  agent?: string;
  preview?: string;
};

export type SidebarWorktree<C extends SidebarChat = SidebarChat> = {
  label: string;
  tags?: readonly string[] | null;
  chats: C[];
};

export type SidebarProject<
  C extends SidebarChat = SidebarChat,
  W extends SidebarWorktree<C> = SidebarWorktree<C>,
> = {
  name: string;
  path: string;
  worktrees: W[];
};

export function togglePhoneTagFilter(selected: readonly string[], tag: string): string[] {
  const key = tag.toLowerCase();
  if (selected.some((item) => item.toLowerCase() === key)) {
    return selected.filter((item) => item.toLowerCase() !== key);
  }
  return [...selected, tag];
}

/** Distinct tags in sidebar order. Selected tags that disappeared stay listed. */
export function phoneTagChoices(
  projects: readonly { worktrees: readonly { tags?: readonly string[] | null }[] }[],
  selected: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (!tag) return;
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };
  for (const project of projects) {
    for (const worktree of project.worktrees) {
      for (const tag of worktree.tags ?? []) push(tag);
    }
  }
  const extra = selected.filter((tag) => !seen.has(tag.trim().toLowerCase()));
  return extra.length > 0 ? [...extra, ...out] : out;
}

function hasEveryTag(tags: readonly string[] | null | undefined, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;
  const have = new Set((tags ?? []).map((tag) => tag.toLowerCase()));
  return selected.every((tag) => have.has(tag.toLowerCase()));
}

function chatHay<C extends SidebarChat>(
  projectName: string,
  worktree: SidebarWorktree<C>,
  chat: C,
): string {
  return `${worktree.label} ${chat.title} ${chat.agent ?? ''} ${chat.preview ?? ''} ${projectName} ${(worktree.tags ?? []).join(' ')}`.toLowerCase();
}

export function filterPhoneOrchestration<T extends SidebarChat>(
  chats: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...chats];
  return chats.filter((chat) =>
    `${chat.title} ${chat.agent ?? ''} ${chat.preview ?? ''} global orchestration`.toLowerCase().includes(q),
  );
}

/** The Orchestration block stays when the query names it, even with no matching chats. */
export function phoneOrchestrationVisible<T extends SidebarChat>(
  chats: readonly T[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (filterPhoneOrchestration(chats, q).length > 0) return true;
  return 'orchestration'.includes(q) || 'global'.includes(q);
}

export function filterPhoneProjects<
  C extends SidebarChat,
  W extends SidebarWorktree<C>,
  P extends SidebarProject<C, W>,
>(projects: readonly P[], query: string, selectedTags: readonly string[]): P[] {
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0 || selectedTags.length > 0;
  const out: P[] = [];
  for (const project of projects) {
    let changed = false;
    const worktrees: W[] = [];
    for (const worktree of project.worktrees) {
      if (!hasEveryTag(worktree.tags, selectedTags)) {
        changed = true;
        continue;
      }
      if (!q) {
        worktrees.push(worktree);
        continue;
      }
      const chats = worktree.chats.filter((chat) => chatHay(project.name, worktree, chat).includes(q));
      if (chats.length === 0) {
        const bare = `${project.name} ${worktree.label} ${(worktree.tags ?? []).join(' ')}`.toLowerCase();
        if (bare.includes(q)) worktrees.push(worktree);
        else changed = true;
        continue;
      }
      if (chats.length === worktree.chats.length) worktrees.push(worktree);
      else {
        changed = true;
        worktrees.push({ ...worktree, chats });
      }
    }
    if (worktrees.length === 0) {
      if (filtering) continue;
      out.push(project);
      continue;
    }
    out.push(changed ? { ...project, worktrees } : project);
  }
  return out;
}

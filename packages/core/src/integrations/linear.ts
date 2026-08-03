import type { IssueInfo } from '../types/thread.js';
import { getLinearApiKey } from '../store/app-settings.js';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

const ASSIGNED_ISSUES_QUERY = `
query SideboardAssignedIssues($first: Int!) {
  viewer {
    assignedIssues(
      first: $first
      orderBy: updatedAt
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
    ) {
      nodes {
        id
        identifier
        title
        url
        labels { nodes { name } }
      }
    }
  }
}
`;

type LinearIssueNode = {
  id?: string;
  identifier?: string;
  title?: string;
  url?: string;
  labels?: { nodes?: Array<{ name?: string }> };
};

/**
 * List open issues assigned to the authenticated Linear user via GraphQL.
 * Uses Sideboard-stored API key (Account → Linear), not agent MCP.
 */
export async function listLinearIssuesDirect(
  opts?: { limit?: number; apiKey?: string | null },
): Promise<IssueInfo[]> {
  const apiKey = (opts?.apiKey ?? getLinearApiKey())?.trim();
  if (!apiKey) {
    throw new Error('Linear is not connected — add an API key in Account settings');
  }

  const first = Math.max(1, Math.min(100, opts?.limit ?? 50));
  const res = await fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: ASSIGNED_ISSUES_QUERY,
      variables: { first },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Linear API error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
    );
  }

  const json = (await res.json()) as {
    data?: {
      viewer?: {
        assignedIssues?: { nodes?: LinearIssueNode[] };
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message ?? 'Linear error').join('; '));
  }

  const nodes = json.data?.viewer?.assignedIssues?.nodes ?? [];
  return nodes.map((node) => ({
    id: String(node.id ?? node.identifier ?? ''),
    identifier: String(node.identifier ?? node.id ?? ''),
    title: String(node.title ?? ''),
    url: String(node.url ?? ''),
    labels: (node.labels?.nodes ?? [])
      .map((l) => l.name)
      .filter((n): n is string => Boolean(n)),
    provider: 'linear' as const,
  }));
}

/** Probe Linear with the stored key (or provided key). */
export async function validateLinearApiKey(apiKey: string): Promise<boolean> {
  const key = apiKey.trim();
  if (!key) return false;
  try {
    await listLinearIssuesDirect({ limit: 1, apiKey: key });
    return true;
  } catch {
    return false;
  }
}

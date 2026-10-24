import { flipLinearRelationType, linearGraphql } from './linear.js';

type IssueRef = { identifier?: string | null; id?: string | null };

type RelationNode = {
  type?: string | null;
  issue?: IssueRef | null;
  relatedIssue?: IssueRef | null;
};

type BlockedByIssue = {
  relations?: { nodes?: RelationNode[] | null } | null;
  inverseRelations?: { nodes?: RelationNode[] | null } | null;
};

/** Relations only — the sidebar poll must not pull comments and attachments. */
const ISSUE_BLOCKED_BY_QUERY = `
query SideboardIssueBlockedBy($id: String!) {
  issue(id: $id) {
    identifier
    relations(first: 25) {
      nodes { id type relatedIssue { id identifier } }
    }
    inverseRelations(first: 25) {
      nodes { id type issue { id identifier } }
    }
  }
}
`;

/** Identifiers of issues that block this one (`blockedBy` after inverse flip). */
export function linearBlockedByIdentifiers(
  relations: Array<{ type?: string | null; issue?: IssueRef | null }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rel of relations) {
    const type = (rel.type ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (type !== 'blockedby' && type !== 'blocked') continue;
    const id = (rel.issue?.identifier || rel.issue?.id || '').trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/** This issue's view: forward `relatedIssue`, inverse types flipped. */
export function linearBlockedByRelations(issue: BlockedByIssue): Array<{
  type: string;
  issue?: IssueRef | null;
}> {
  const out: Array<{ type: string; issue?: IssueRef | null }> = [];
  for (const rel of issue.relations?.nodes ?? []) {
    out.push({ type: String(rel.type ?? 'related'), issue: rel.relatedIssue });
  }
  for (const rel of issue.inverseRelations?.nodes ?? []) {
    out.push({
      type: flipLinearRelationType(String(rel.type ?? 'related')),
      issue: rel.issue,
    });
  }
  return out;
}

/** Blocking issue identifiers for one Linear issue (uuid or ENG-123). */
export async function getLinearIssueBlockedBy(
  id: string,
  opts?: { apiKey?: string | null },
): Promise<string[]> {
  const issueId = id.trim();
  if (!issueId) throw new Error('Linear issue id is required (uuid or ENG-123)');
  const json = await linearGraphql<{ issue?: BlockedByIssue | null }>(
    ISSUE_BLOCKED_BY_QUERY,
    { id: issueId },
    opts,
  );
  if (!json.issue) throw new Error(`Linear issue not found: ${issueId}`);
  return linearBlockedByIdentifiers(linearBlockedByRelations(json.issue));
}

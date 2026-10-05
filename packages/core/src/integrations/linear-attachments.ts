/**
 * Linear file attachments — listing from get_issue payloads and Account-auth
 * download into `.context/attachments/`. Kept out of linear.ts for the
 * max-lines ratchet.
 */
import { httpFetch } from '../http/fetch.js';
import {
  downloadAuthenticatedFile,
  extractHttpUrls,
  hostMatches,
  issueAttachmentWorktreePath,
  looksLikeHttpUrl,
  mergeIssueAttachments,
  type DownloadedIssueAttachment,
} from './issue-attachments.js';
import { getLinearAuthToken, linearAuthorizationHeader } from './linear-oauth.js';

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

const LINEAR_FILE_HOSTS = ['linear.app', 'uploads.linear.app', 'linearusercontent.com'] as const;

/** Integration links (PRs, Figma) are not downloadable files. */
const LINEAR_LINK_SOURCE_TYPES = new Set([
  'github',
  'githubPullRequest',
  'gitlab',
  'figma',
  'slack',
  'sentry',
  'zendesk',
  'intercom',
  'front',
]);

const ATTACHMENT_QUERY = `
query SideboardAttachment($id: String!) {
  attachment(id: $id) {
    id
    title
    url
    subtitle
    sourceType
  }
}
`;

export interface LinearIssueAttachment {
  id: string;
  title: string;
  url: string;
  subtitle?: string;
  sourceType?: string;
}

export type LinearAttachmentSource = {
  description?: string | null;
  comments?: { nodes?: Array<{ body?: string | null }> };
  attachments?: {
    nodes?: Array<{
      id?: string;
      title?: string;
      url?: string;
      subtitle?: string;
      sourceType?: string;
    }>;
  };
};

export function mapLinearAttachments(node: LinearAttachmentSource): LinearIssueAttachment[] {
  const listed: LinearIssueAttachment[] = [];
  for (const attachment of node.attachments?.nodes ?? []) {
    const id = String(attachment.id ?? '');
    const url = String(attachment.url ?? '').trim();
    if (!id && !url) continue;
    listed.push({
      id,
      title: String(attachment.title ?? ''),
      url,
      subtitle: attachment.subtitle?.trim() || undefined,
      sourceType: attachment.sourceType?.trim() || undefined,
    });
  }
  const embedded = [
    ...extractHttpUrls(node.description).filter((url) => hostMatches(url, LINEAR_FILE_HOSTS)),
    ...(node.comments?.nodes ?? []).flatMap((comment) =>
      extractHttpUrls(comment.body).filter((url) => hostMatches(url, LINEAR_FILE_HOSTS)),
    ),
  ];
  const merged = mergeIssueAttachments([
    ...listed.map((item) => ({
      id: item.id,
      name: item.title || item.subtitle || 'attachment',
      url: item.url,
      sourceType: item.sourceType,
    })),
    ...embedded.map((url) => ({
      id: url,
      name: url.split('/').pop() || 'image',
      url,
      sourceType: 'upload',
    })),
  ]);
  const byUrl = new Map(listed.map((item) => [item.url, item]));
  return merged.map((item) => {
    const prior = byUrl.get(item.url);
    return {
      id: prior?.id || item.id,
      title: prior?.title || item.name,
      url: item.url,
      subtitle: prior?.subtitle,
      sourceType: prior?.sourceType || item.sourceType,
    };
  });
}

function assertLinearFileUrl(url: string, sourceType?: string): void {
  const kind = sourceType?.trim();
  if (kind && LINEAR_LINK_SOURCE_TYPES.has(kind)) {
    throw new Error(
      `Linear attachment is a ${kind} link, not a file. Open the URL in the browser instead of downloading it.`,
    );
  }
  if (!hostMatches(url, LINEAR_FILE_HOSTS)) {
    throw new Error(
      `Linear attachment URL is not a Linear upload (${url}). Only uploads.linear.app / linear.app file hosts can be downloaded with the Linear token.`,
    );
  }
}

async function requireLinearToken(apiKey?: string | null): Promise<string> {
  const token = (apiKey ?? (await getLinearAuthToken()))?.trim();
  if (!token) {
    throw new Error('Linear is not connected — sign in from Account settings');
  }
  return token;
}

/**
 * Download a Linear file attachment into `.context/attachments/` using Account
 * Linear OAuth / API key. Pass the attachment uuid or upload URL from
 * `linear_get_issue`.
 */
export async function downloadLinearAttachment(
  input: { id: string; name?: string },
  opts?: { apiKey?: string | null; destPath?: string | null },
): Promise<DownloadedIssueAttachment> {
  const id = input.id.trim();
  if (!id) throw new Error('Linear attachment id or URL is required');
  const apiKey = await requireLinearToken(opts?.apiKey);
  let url = id;
  let name = input.name?.trim();
  let sourceType: string | undefined;
  if (!looksLikeHttpUrl(id)) {
    const res = await httpFetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: linearAuthorizationHeader(apiKey),
      },
      body: JSON.stringify({ query: ATTACHMENT_QUERY, variables: { id } }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status} looking up attachment ${id}`);
    }
    const json = (await res.json()) as {
      data?: { attachment?: { title?: string; url?: string; subtitle?: string; sourceType?: string } | null };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message ?? 'Linear error').join('; '));
    }
    const attachment = json.data?.attachment;
    if (!attachment?.url?.trim()) {
      throw new Error(`Linear attachment not found: ${id}`);
    }
    url = attachment.url.trim();
    name = name || attachment.title?.trim() || attachment.subtitle?.trim() || undefined;
    sourceType = attachment.sourceType?.trim() || undefined;
  }
  assertLinearFileUrl(url, sourceType);
  return downloadAuthenticatedFile({
    url,
    headers: { Authorization: linearAuthorizationHeader(apiKey) },
    worktreePath: issueAttachmentWorktreePath(opts?.destPath),
    name,
  });
}

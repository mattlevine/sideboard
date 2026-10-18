/** `me`, `unassigned`, `all`, a tracker user id, or a display name / GitHub login. */
export type IssueAssigneeFilter = string;

export interface ListIssuesOptions {
  /** me (Linear default), unassigned, all, or a user id / GitHub login. */
  assignee?: IssueAssigneeFilter;
  /** Case-insensitive search (Linear `searchIssues`, GitHub `--search`, AbleTime search). */
  query?: string;
  limit?: number;
  /**
   * ISO datetime, YYYY-MM-DD, or relative (yesterday, 2d, 3 hours ago).
   * Vendor-side filter for tickets updated since then; also loads new comments.
   */
  updatedSince?: string;
}

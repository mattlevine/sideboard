/** Sideboard product skill — branches, issues, and pull requests from the providers. */

export const WORK_SOURCES_SKILL_COMMAND = 'work-sources';
export const WORK_SOURCES_SKILL_NAME = 'work-sources';
export const BUNDLED_WORK_SOURCES_PATH = 'bundled:work-sources';

export const WORK_SOURCES_SKILL_DESCRIPTION =
  'List branches, issues, and pull requests for a repo from the git host and issue providers. Use for create-from pickers, find-work, or when an agent needs the same lists the UI selectors use.';

export const WORK_SOURCES_SKILL_BODY = `# Work sources

Branches, issues, and pull requests come from two providers. Use the tools. Do not call \`gh\`, Linear, or AbleTime directly to fill a picker.

## Git host

The host is chosen from the repo's \`origin\` remote. GitHub is registered. Another host implements the same three methods and \`matches()\` for its remotes; the pickers and tools already call that host.

- \`listBranches\` — local branches, including \`origin/\`. \`list_branches\` (unmerged into the default branch by default).
- \`listPullRequests\` — \`list_prs\`. On GitHub, the review inbox is \`queue=review\`.
- \`listIssues\` — that host's own issues. \`github_search_issues\` reads GitHub's list, and only when origin is GitHub. \`list_issues\` uses it only when GitHub is the issue source.

An origin that matches no host still lists local branches. Pull requests and that host's issues name the remote instead of calling \`gh\`. A missing origin stays on GitHub.

## Issue provider

Settings → Issues picks Linear, AbleTime, or GitHub. That provider's \`listIssuePage\` is \`list_issues\` (Create-from, link-issue, Home, phone).

Linear and AbleTime do not list branches or pull requests. Those stay on the git host, including when the issue source is Linear or AbleTime. A new git host's tickets are its own issue provider, not the GitHub one.

## How to list them

Pass \`repoPath\` from \`list_projects\`.

- Branches for a new workspace: \`list_branches\`.
- Pull requests to review: \`list_prs\` (\`queue=review\`, \`limit\`).
- Tickets to work on: \`list_issues\` (\`assignee\`, \`query\`, \`updatedSince\`).

Then \`create_workspace\` with \`sourceType\` \`branch\`, \`pr\`, or \`ticket\`.
`;

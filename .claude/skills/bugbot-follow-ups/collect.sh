#!/usr/bin/env bash
# Collect unresolved Cursor Bugbot / cursorbot review threads from recently
# merged PRs. Writes compact JSON to .context/cli/bugbot-follow-ups.json.
# Prints a one-line summary — never dump raw GraphQL / --json into a tool result.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

LIMIT="${1:-20}"
OUT_DIR="$ROOT/.context/cli"
OUT="$OUT_DIR/bugbot-follow-ups.json"
mkdir -p "$OUT_DIR"

if ! command -v gh >/dev/null || ! command -v jq >/dev/null; then
  echo "need gh and jq on PATH" >&2
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
OWNER="${REPO%/*}"
NAME="${REPO#*/}"

gh pr list -R "$REPO" --state merged --limit "$LIMIT" \
  --json number,title,url,mergedAt > "$OUT_DIR/bugbot-merged-prs.json"

QUERY='
query($owner: String!, $name: String!, $n: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      reviewThreads(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          comments(first: 20) {
            nodes {
              author { login }
              body
              url
              createdAt
            }
          }
        }
      }
    }
  }
}'

: > "$OUT_DIR/bugbot-threads.jsonl"

skipped_release=0
scanned=0

while IFS=$'\t' read -r number title url merged_at; do
  if [[ "$title" == Release\ * ]]; then
    skipped_release=$((skipped_release + 1))
    continue
  fi
  scanned=$((scanned + 1))
  after=""
  page=0
  while :; do
    page=$((page + 1))
    page_file="$OUT_DIR/bugbot-pr-${number}-page-${page}.json"
    if [[ -n "$after" ]]; then
      gh api graphql -f query="$QUERY" \
        -F owner="$OWNER" -F name="$NAME" -F n="$number" -F after="$after" \
        > "$page_file"
    else
      gh api graphql -f query="$QUERY" \
        -F owner="$OWNER" -F name="$NAME" -F n="$number" \
        > "$page_file"
    fi
    jq -c \
      --argjson n "$number" \
      --arg title "$title" \
      --arg url "$url" \
      --arg mergedAt "$merged_at" \
      '
      .data.repository.pullRequest.reviewThreads.nodes[]?
      | select(.isResolved == false)
      | select(.comments.nodes | any(.author.login | test("cursor|bugbot"; "i")))
      | . as $t
      | ($t.comments.nodes | map(select(.author.login | test("cursor|bugbot"; "i"))) | .[0]) as $bot
      | ($t.comments.nodes | map(select(.author.login | test("cursor|bugbot"; "i") | not))) as $replies
      | {
          pr: $n,
          title: $title,
          prUrl: $url,
          mergedAt: $mergedAt,
          path: $t.path,
          threadId: $t.id,
          outdated: $t.isOutdated,
          commentUrl: $bot.url,
          createdAt: $bot.createdAt,
          author: $bot.author.login,
          replies: ($replies | length),
          replyLogins: [$replies[].author.login],
          titleLine: ($bot.body | split("\n")[0][0:160]),
          preview: ($bot.body[0:800])
        }
      ' "$page_file" >> "$OUT_DIR/bugbot-threads.jsonl"

    has_next="$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' "$page_file")"
    if [[ "$has_next" != "true" ]]; then
      break
    fi
    after="$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' "$page_file")"
  done
done < <(jq -r '.[] | [.number, .title, .url, .mergedAt] | @tsv' "$OUT_DIR/bugbot-merged-prs.json")

if [[ -s "$OUT_DIR/bugbot-threads.jsonl" ]]; then
  notes_json="$(jq -s '.' "$OUT_DIR/bugbot-threads.jsonl")"
else
  notes_json='[]'
fi

jq -n \
  --arg collectedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg repo "$REPO" \
  --argjson mergedLimit "$LIMIT" \
  --argjson prsScanned "$scanned" \
  --argjson prsSkippedRelease "$skipped_release" \
  --argjson notes "$notes_json" \
  '{
    collectedAt: $collectedAt,
    repo: $repo,
    mergedLimit: $mergedLimit,
    prsScanned: $prsScanned,
    prsSkippedRelease: $prsSkippedRelease,
    notes: $notes
  }' > "$OUT"

rm -f "$OUT_DIR/bugbot-merged-prs.json" "$OUT_DIR/bugbot-threads.jsonl" \
  "$OUT_DIR"/bugbot-pr-*-page-*.json

count="$(jq '.notes | length' "$OUT")"
prs="$(jq '[.notes[].pr] | unique | length' "$OUT")"
echo "$count unresolved cursorbot notes in $prs PRs → $OUT"

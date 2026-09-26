#!/usr/bin/env bash
# Helper script to read dev terminal logs from ~/.sideboard/threads/
# Usage: ./read-dev-log.sh [worktree-path] [script-name] [tail-chars]

set -e

SIDEBOARD_DATA="${SIDEBOARD_APP_DATA:-$HOME/Library/Application\ Support/sideboard}"
THREADS_DIR="$SIDEBOARD_DATA/threads"

# Function to normalize worktree path and compute hash
compute_run_log_key() {
  local worktree_path="$1"
  local script_name="${2:-dev}"

  # Normalize path (remove trailing slash, get absolute path)
  worktree_path=$(cd "$worktree_path" 2>/dev/null && pwd || echo "$worktree_path")

  # Create SHA1 hash of the worktree path
  local hash=$(echo -n "$worktree_path" | shasum | cut -c1-16)

  # Sanitize script name
  local safe_script=$(echo "$script_name" | sed 's/[^a-zA-Z0-9._-]/_/g' | cut -c1-64)
  safe_script=${safe_script:-dev}

  echo "wt-${hash}-run-${safe_script}"
}

# Get worktree path (default to current directory)
WORKTREE_PATH="${1:-.}"

# Get script name (default to 'dev')
SCRIPT_NAME="${2:-dev}"

# Get tail chars (default to 16000)
TAIL_CHARS="${3:-16000}"

# Compute the log key
LOG_KEY=$(compute_run_log_key "$WORKTREE_PATH" "$SCRIPT_NAME")
LOG_FILE="$THREADS_DIR/$LOG_KEY.run.log.json"

echo "Reading log: $LOG_FILE"
echo "---"

if [ ! -f "$LOG_FILE" ]; then
  echo "Error: Log file not found: $LOG_FILE"
  echo "Make sure the worktree path is correct and the script has been run at least once."
  exit 1
fi

# Read and parse the JSON log file, extract output
jq -r '.output' "$LOG_FILE" | tail -c "$TAIL_CHARS"
echo ""
echo "---"
echo "(Run this script with more tail chars to see earlier output: $0 '$WORKTREE_PATH' '$SCRIPT_NAME' 256000)"

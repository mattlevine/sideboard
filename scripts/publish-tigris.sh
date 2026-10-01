#!/usr/bin/env bash
# Upload desktop release artifacts to the public Tigris bucket
# (https://download.sideboard.cloud).
#
# Usage:
#   scripts/publish-tigris.sh <dir>
#
# <dir> must contain latest-mac.yml plus Sideboard-*-arm64.{dmg,zip} and
# their .blockmap files (the same set GitHub Releases already has).
#
# Env:
#   TIGRIS_ACCESS_KEY_ID / AWS_ACCESS_KEY_ID
#   TIGRIS_SECRET_ACCESS_KEY / AWS_SECRET_ACCESS_KEY
#   TIGRIS_BUCKET     default sideboard-downloads
#   TIGRIS_ENDPOINT   default https://fly.storage.tigris.dev
#
# Uploads versioned files first, then a stable Sideboard-latest-arm64.dmg
# alias, then latest-mac.yml (so the updater never points at a missing zip).
# Removes older Sideboard-* objects after the new feed is live.
set -euo pipefail

dir=${1:-}
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
  echo "usage: scripts/publish-tigris.sh <dir>" >&2
  exit 2
fi

key=${TIGRIS_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}
secret=${TIGRIS_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}
bucket=${TIGRIS_BUCKET:-sideboard-downloads}
endpoint=${TIGRIS_ENDPOINT:-https://fly.storage.tigris.dev}

if [ -z "$key" ] || [ -z "$secret" ]; then
  echo "TIGRIS_ACCESS_KEY_ID and TIGRIS_SECRET_ACCESS_KEY must be set" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required (preinstalled on ubuntu-latest)" >&2
  exit 1
fi

yml="$dir/latest-mac.yml"
if [ ! -f "$yml" ]; then
  echo "missing $yml" >&2
  exit 1
fi

shopt -s nullglob
zip=("$dir"/Sideboard-*-arm64-mac.zip)
dmg=("$dir"/Sideboard-*-arm64.dmg)
if [ ${#zip[@]} -eq 0 ]; then
  echo "no Sideboard-*-arm64-mac.zip in $dir" >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID=$key
export AWS_SECRET_ACCESS_KEY=$secret
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-auto}
# Do not print credentials. aws s3 uses the env above.

s3() {
  aws s3 "$@" --endpoint-url "$endpoint"
}

upload() {
  local file=$1
  local dest=$2
  [ -f "$file" ] || return 0
  echo "s3://$bucket/$dest"
  s3 cp "$file" "s3://$bucket/$dest"
}

# Versioned artifacts first (zip/dmg + blockmaps). latest-mac.yml last.
for f in "$dir"/Sideboard-*-arm64-mac.zip "$dir"/Sideboard-*-arm64-mac.zip.blockmap \
  "$dir"/Sideboard-*-arm64.dmg "$dir"/Sideboard-*-arm64.dmg.blockmap; do
  [ -f "$f" ] || continue
  upload "$f" "$(basename "$f")"
done

if [ ${#dmg[@]} -gt 0 ] && [ -f "${dmg[0]}" ]; then
  upload "${dmg[0]}" "Sideboard-latest-arm64.dmg"
fi

upload "$yml" "latest-mac.yml"

# Keep the new version + the stable alias. Drop prior Sideboard-* objects.
keep=$(
  {
    printf '%s\n' latest-mac.yml Sideboard-latest-arm64.dmg
    for f in "$dir"/Sideboard-*; do
      [ -f "$f" ] || continue
      basename "$f"
    done
  } | sort -u
)

# aws s3 ls prints: DATE TIME SIZE NAME
while read -r name; do
  [ -n "$name" ] || continue
  case "$name" in
    Sideboard-* | latest-mac.yml) ;;
    *) continue ;;
  esac
  if printf '%s\n' "$keep" | grep -Fxq "$name"; then
    continue
  fi
  echo "delete s3://$bucket/$name"
  s3 rm "s3://$bucket/$name"
done < <(s3 ls "s3://$bucket/" | awk '{print $4}')

echo "published https://download.sideboard.cloud/latest-mac.yml"

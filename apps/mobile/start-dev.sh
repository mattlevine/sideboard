#!/bin/sh
# Sideboard run script for apps/mobile.
# `expo start --ios` asks Launch Services for the Simulator app and exits if
# that app is not installed, even when simctl already has a booted device.
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
# Expo 52 otherwise treats the pnpm workspace root as Metro's project, so
# Expo Go requests ./index from the repo instead of this package.
export EXPO_NO_METRO_WORKSPACE_ROOT=1
port="${SIDEBOARD_PORT:-${CONDUCTOR_PORT:-8081}}"

if osascript -e 'id of app "Simulator"' >/dev/null 2>&1; then
  exec pnpm exec expo start --ios --localhost --port "$port"
fi

echo "Simulator.app is not installed, so Expo will not be asked to open it."
echo "xcode-select is $(xcode-select -p). Starting Metro on port ${port}."
pnpm exec expo start --localhost --port "$port" &
child=$!
i=0
while [ "$i" -lt 90 ]; do
  if ! kill -0 "$child" 2>/dev/null; then
    wait "$child"
    exit $?
  fi
  if nc -z 127.0.0.1 "$port" 2>/dev/null; then
    if xcrun simctl openurl booted "exp://127.0.0.1:${port}"; then
      echo "Opened Expo Go on the booted simulator: exp://127.0.0.1:${port}"
    else
      echo "Metro is at http://127.0.0.1:${port}. No booted simulator accepted the URL."
      echo "Install the Simulator app from Xcode, or open that URL in Expo Go on a phone."
    fi
    break
  fi
  i=$((i + 1))
  sleep 1
done
wait "$child"

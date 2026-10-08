#!/bin/sh
# Sideboard run script for apps/mobile.
# `expo start --ios` asks Launch Services for the Simulator app and exits if
# that app is not installed, even when simctl already has a booted device.
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
root=$(CDPATH= cd -- ../.. && pwd)
# Without this, Expo treats the pnpm workspace root as Metro's project, so
# Expo Go requests ./index from the repo instead of this package.
export EXPO_NO_METRO_WORKSPACE_ROOT=1
# Node otherwise binds "localhost" to IPv6 only. The simulator opens 127.0.0.1.
export NODE_OPTIONS="--dns-result-order=ipv4first${NODE_OPTIONS:+ $NODE_OPTIONS}"
port="${SIDEBOARD_PORT:-${CONDUCTOR_PORT:-8081}}"

# The booted simulator may still have an old Expo Go. SDK 57 will not load in it.
install_sdk_expo_go() {
  if ! xcrun simctl list devices booted 2>/dev/null | grep -q '(Booted)'; then
    echo "No booted simulator. Metro will stay up for a phone on the same network."
    return 0
  fi
  container=$(xcrun simctl get_app_container booted host.exp.Exponent app 2>/dev/null || true)
  installed=none
  if [ -n "$container" ]; then
    installed=$(defaults read "$container/Info" CFBundleShortVersionString 2>/dev/null || echo none)
  fi
  mkdir -p "$root/.context/cli"
  curl -fsSL "https://exp.host/--/api/v2/versions" -o "$root/.context/cli/expo-versions.json"
  expected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdkVersions"]["57.0.0"]["iosClientVersion"])' "$root/.context/cli/expo-versions.json")
  url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sdkVersions"]["57.0.0"]["iosClientUrl"])' "$root/.context/cli/expo-versions.json")
  if [ "$installed" = "$expected" ]; then
    echo "Expo Go ${installed} is already on the booted simulator."
    return 0
  fi
  echo "Simulator has Expo Go ${installed}. Installing ${expected} for SDK 57."
  cache="${HOME}/.expo/ios-simulator-app-cache"
  mkdir -p "$cache"
  tarball="${cache}/Expo-Go-${expected}.tar.gz"
  if [ ! -s "$tarball" ]; then
    curl -fL --retry 3 -o "$tarball" "$url"
  fi
  # The archive is the .app contents, not a wrapper directory.
  bundle="${cache}/Expo-Go-${expected}.app"
  rm -rf "$bundle"
  mkdir -p "$bundle"
  tar -xzf "$tarball" -C "$bundle"
  if [ ! -f "$bundle/Info.plist" ]; then
    echo "Expo Go archive did not contain an app bundle." >&2
    exit 1
  fi
  xcrun simctl terminate booted host.exp.Exponent >/dev/null 2>&1 || true
  xcrun simctl install booted "$bundle"
  echo "Installed Expo Go ${expected} on the booted simulator."
}

metro_ready() {
  curl -fsS -o /dev/null --max-time 1 "http://127.0.0.1:${port}"
}

install_sdk_expo_go

if osascript -e 'id of app "Simulator"' >/dev/null 2>&1; then
  exec pnpm exec expo start --ios --localhost --port "$port"
fi

echo "Simulator.app is not registered with Launch Services, so Expo will not be asked to open it."
echo "xcode-select is $(xcode-select -p). Starting Metro on port ${port}."
pnpm exec expo start --localhost --port "$port" &
child=$!
i=0
while [ "$i" -lt 90 ]; do
  if ! kill -0 "$child" 2>/dev/null; then
    wait "$child"
    exit $?
  fi
  if metro_ready; then
    if xcrun simctl openurl booted "exp://127.0.0.1:${port}"; then
      echo "Opened Expo Go on the booted simulator: exp://127.0.0.1:${port}"
    else
      echo "Metro is at http://127.0.0.1:${port}. No booted simulator accepted the URL."
    fi
    break
  fi
  i=$((i + 1))
  sleep 1
done
wait "$child"

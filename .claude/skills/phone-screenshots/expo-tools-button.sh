#!/bin/sh
# Show or hide Expo Go's tools button on the booted simulator.
# This is Expo Go's own preference (host.exp.Exponent). It is not a Sideboard patch.
# Quit Expo Go and reopen the project after changing it; a running app keeps the old value.
set -eu

mode="${1:-}"
case "$mode" in
  hide) value=false ;;
  show) value=true ;;
  *)
    echo "usage: expo-tools-button.sh show|hide" >&2
    exit 2
    ;;
esac

if ! xcrun simctl list devices booted | grep -q "(Booted)"; then
  echo "No booted simulator." >&2
  exit 1
fi

# Write after Expo Go has quit so it does not save the old value on exit.
xcrun simctl terminate booted host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl spawn booted defaults write host.exp.Exponent EXDevMenuShowFloatingActionButton -bool "$value"
got=$(xcrun simctl spawn booted defaults read host.exp.Exponent EXDevMenuShowFloatingActionButton)
echo "EXDevMenuShowFloatingActionButton=$got"
echo "Reopen the project in Expo Go for the button to update."

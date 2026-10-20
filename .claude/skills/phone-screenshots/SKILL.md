---
name: phone-screenshots
description: >-
  Capture Sideboard phone or marketing screenshots from the iOS simulator
  without the Expo tools button. Use when hiding or restoring that button,
  retaking site/phone images, or the Expo overlay is in the way.
---

# Phone and marketing screenshots

The Expo tools button is Expo Go, not Sideboard. This repo does not hide it.
Do not patch `apps/mobile`, `app.json`, or Metro to remove it, and do not
leave it hidden after the shots are taken.

Expo Go stores the switch on the booted simulator:

`host.exp.Exponent` → `EXDevMenuShowFloatingActionButton`

`true` shows the button (normal use). `false` hides it for a capture.

## Toggle

From the repo root. The script quits Expo Go first so the running app does
not write the old value back on exit.

```sh
.claude/skills/phone-screenshots/expo-tools-button.sh hide   # screenshots only
.claude/skills/phone-screenshots/expo-tools-button.sh show   # put the button back
```

Then reopen the project. Take the URL from this worktree's mobile dev script
(`list_run_scripts` / the Dev button). Do not guess a port.

```sh
xcrun simctl openurl booted "exp://127.0.0.1:<port>"
```

## What to save

- Phone shots: `site/phone/*.png`, 1206×2622, from the simulator. Not an HTML mock.
- Marketing kanban: `site/board.png`. Crop the window only. Do not resize the pixels.

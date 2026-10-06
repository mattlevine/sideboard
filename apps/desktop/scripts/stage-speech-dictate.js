#!/usr/bin/env node
/**
 * Compile native/speech-dictate.swift into build/speech-dictate.app so
 * packaged extraResources can transcribe without Xcode on the user's Mac.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const src = path.join(desktopRoot, 'native', 'speech-dictate.swift');
const plist = path.join(desktopRoot, 'native', 'speech-dictate-Info.plist');
const appRoot = path.join(desktopRoot, 'build', 'speech-dictate.app');
const bin = path.join(appRoot, 'Contents', 'MacOS', 'speech-dictate');

if (!fs.existsSync(src) || !fs.existsSync(plist)) {
  throw new Error('speech-dictate sources missing under apps/desktop/native');
}

fs.mkdirSync(path.dirname(bin), { recursive: true });
fs.copyFileSync(plist, path.join(appRoot, 'Contents', 'Info.plist'));
execFileSync('swiftc', ['-O', '-o', bin, src], { stdio: 'inherit' });
if (!fs.existsSync(bin)) {
  throw new Error('swiftc did not produce speech-dictate');
}
execFileSync(
  'codesign',
  ['--force', '--sign', '-', '--identifier', 'ai.sideboard.dictation', appRoot],
  { stdio: 'inherit' },
);
console.log('staged', bin);

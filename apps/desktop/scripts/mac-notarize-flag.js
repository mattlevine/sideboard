'use strict';

/**
 * Enable notarization only when Apple notary + Developer ID signing env are present.
 * Ad-hoc-signed builds are always rejected by Apple.
 */

function hasAppleNotaryCreds() {
  return !!(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD);
}

function hasDeveloperIdSigningEnv() {
  return !!(
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_IDENTITY
  );
}

/** Extra CLI args for electron-builder (empty string if notarization should stay off). */
function macNotarizeCliArg() {
  if (!hasAppleNotaryCreds() || !hasDeveloperIdSigningEnv()) {
    return '';
  }
  return '-c.mac.notarize=true';
}

function printMacNotarizeSummary() {
  if (!hasAppleNotaryCreds()) {
    console.log(
      '🍎 Mac notarization: off (set APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + Developer ID CSC_* to enable).',
    );
    return;
  }
  if (!hasDeveloperIdSigningEnv()) {
    console.warn(
      '🍎 Mac notarization: off — APPLE_* is set but Developer ID signing is not (CSC_LINK + CSC_KEY_PASSWORD, or CSC_NAME / CSC_IDENTITY).',
    );
    return;
  }
  console.log('🍎 Mac notarization: on (APPLE_* + Developer ID signing env present).');
}

module.exports = {
  macNotarizeCliArg,
  printMacNotarizeSummary,
  hasAppleNotaryCreds,
  hasDeveloperIdSigningEnv,
};

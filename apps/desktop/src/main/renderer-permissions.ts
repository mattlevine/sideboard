/** Permissions Chromium may request from the renderer. Media is required for dictation. */
export function isAllowedRendererPermission(permission: string): boolean {
  switch (permission) {
    case 'media':
    case 'mediaKeySystem':
    case 'audioCapture':
    case 'microphone':
    case 'fullscreen':
    case 'pointerLock':
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
    case 'notifications':
      return true;
    default:
      return false;
  }
}

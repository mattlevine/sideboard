import { session, systemPreferences } from 'electron';
import { isAllowedRendererPermission } from './renderer-permissions';

export function setupMicrophonePermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(isAllowedRendererPermission(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => isAllowedRendererPermission(permission));
}

export async function askMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  try {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') return false;
    return await systemPreferences.askForMediaAccess('microphone');
  } catch {
    return true;
  }
}

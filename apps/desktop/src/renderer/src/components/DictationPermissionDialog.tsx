import { useEffect, useState } from 'react';
import {
  dictationPermissionDialogCopy,
  dictationPrivacySettingsUrl,
  isDictationPermissionError,
} from '../lib/speech-dictation';
import { ConfirmDialog } from './ConfirmDialog';

export function DictationPermissionDialog({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  const [packaged, setPackaged] = useState(false);
  useEffect(() => {
    const load = window.sideboard.getDictationPrivacyHelp;
    if (typeof load !== 'function') return;
    void load()
      .then((help) => setPackaged(Boolean(help?.packaged)))
      .catch(() => {});
  }, [error]);

  if (!isDictationPermissionError(error)) return null;
  const message = error!.trim();
  const copy = dictationPermissionDialogCopy(message, packaged);
  return (
    <ConfirmDialog
      title={copy.title}
      message={copy.message}
      confirmLabel="Open Settings"
      cancelLabel="OK"
      onCancel={onDismiss}
      onConfirm={() => {
        void window.sideboard.openExternal(dictationPrivacySettingsUrl(message));
        onDismiss();
      }}
    />
  );
}

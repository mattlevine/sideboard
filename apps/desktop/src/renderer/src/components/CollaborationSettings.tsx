import { SlackRemoteSettings } from './SlackRemoteSettings';

export function CollaborationSettings({
  busy,
  setBusy,
  setError,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}) {
  return (
    <div className="settings-body">
      <p className="settings-lead">
        Connect Slack teams so agents can find people, send messages, and read replies. This
        Mac’s name is on Remote. Slack sign-in stays on Sideboard’s Slack relay.
      </p>
      <SlackRemoteSettings busy={busy} setBusy={setBusy} setError={setError} />
    </div>
  );
}

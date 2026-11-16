import { useEffect, useRef } from 'react';
import { hostedPushRelay, isExpoPushToken, parsePushData, sessionTokensForPush } from './push-plan';

export { hostedPushRelay };

const EAS_PROJECT_ID = 'df689cd6-ee41-404d-868b-5d079dfa3e76';

export async function loadExpoPushToken(): Promise<string | null> {
  const Notifications = await import('expo-notifications');
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  return isExpoPushToken(token.data) ? token.data : null;
}

/**
 * Registers this phone with Sideboard's relay and opens the chat from a tap.
 * A foreground alert is suppressed; the system shows it once the app is backgrounded.
 */
export function usePhonePush(opts: {
  relayUrl: string;
  desktops: Array<{ deviceId: string; sessionToken: string; notify?: boolean }>;
  send: (payload: object) => void;
  onSent?: () => void;
  handlers: { current: { openDesktop: (deviceId: string) => void; openChat: (chatId: string) => void } };
}): { hasPending: () => boolean; consumePending: (chatIds: Set<string>) => string | null } {
  const pending = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tokens = sessionTokensForPush(opts.desktops).join('\n');
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!hostedPushRelay(opts.relayUrl)) return;
    const sessionTokens = tokens.split('\n').filter(Boolean);
    if (sessionTokens.length === 0) {
      const token = registered.current;
      if (!token) return;
      registered.current = null;
      optsRef.current.onSent?.();
      optsRef.current.send({ type: 'push_register', token, sessionTokens: [] });
      return;
    }
    let cancelled = false;
    void loadExpoPushToken()
      .then((token) => {
        if (cancelled || !token) return;
        registered.current = token;
        optsRef.current.onSent?.();
        optsRef.current.send({ type: 'push_register', token, sessionTokens });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [opts.relayUrl, tokens]);

  useEffect(() => {
    let remove = (): void => undefined;
    let cancelled = false;
    void import('expo-notifications')
      .then((Notifications) => {
        if (cancelled) return;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: false,
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
        const openFrom = (response: { notification: { request: { content: { data?: unknown } } } } | null) => {
          if (!response) return;
          const parsed = parsePushData(response.notification.request.content.data);
          if (!parsed) return;
          pending.current = parsed.chatId;
          optsRef.current.handlers.current.openDesktop(parsed.deviceId);
        };
        const sub = Notifications.addNotificationResponseReceivedListener(openFrom);
        openFrom(Notifications.getLastNotificationResponse());
        remove = () => sub.remove();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      remove();
    };
  }, []);

  return {
    hasPending: () => pending.current != null,
    consumePending(chatIds: Set<string>) {
      const id = pending.current;
      if (!id || !chatIds.has(id)) return null;
      pending.current = null;
      return id;
    },
  };
}

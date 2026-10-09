export function historyCount(total: number, filtered: boolean): string {
  if (filtered) return total === 1 ? '1 match' : `${total} matches`;
  return total === 1 ? '1 archived chat' : `${total} archived chats`;
}

export function agentStatus(status: string): string {
  if (status === 'running' || status === 'queued') return 'Running';
  if (status === 'error' || status === 'broken') return 'Error';
  if (status === 'stopped') return 'Stopped';
  return 'Idle';
}

export function desktopStatus(desktop: { expired: boolean; online: boolean | null }): string {
  if (desktop.expired) return 'Pair again';
  if (desktop.online === null) return 'Checking…';
  return desktop.online ? 'Online' : 'Offline';
}

export function onMac(screen: string): boolean {
  return screen === 'chat' || screen === 'agents' || screen === 'history';
}

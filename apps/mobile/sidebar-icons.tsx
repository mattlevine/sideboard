import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { palette } from './styles';

/** Same marks as the desktop sidebar: project tile, worktree status glyph. */
export type WorktreeIconKind = 'running' | 'queued' | 'error' | 'archived' | 'idle';

const LABEL: Record<WorktreeIconKind, string> = {
  running: 'Running',
  queued: 'Queued',
  error: 'Error',
  archived: 'Archived',
  idle: 'Idle',
};

/** Busiest chat wins, matching the desktop rule that a running agent beats idle. */
export function worktreeStatusKind(chats: { status: string }[]): WorktreeIconKind {
  const statuses = chats.map((chat) => chat.status);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.some((status) => status === 'error' || status === 'broken')) return 'error';
  if (statuses.length > 0 && statuses.every((status) => status === 'archived')) return 'archived';
  return 'idle';
}

/** Desktop `.workspace-glyph`: warm tile, cream on the lower right. */
export function ProjectGlyph() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.project}>
      <View style={styles.projectCream} />
    </View>
  );
}

export function WorktreeStatusIcon({ kind }: { kind: WorktreeIconKind }) {
  return (
    <View accessibilityRole="image" accessibilityLabel={LABEL[kind]} style={styles.slot}>
      {kind === 'running' ? <RunningMark /> : null}
      {kind === 'queued' ? <QueuedMark /> : null}
      {kind === 'error' ? <ErrorMark /> : null}
      {kind === 'archived' ? <ArchivedMark /> : null}
      {kind === 'idle' ? <View style={[styles.ring, styles.ringIdle]} /> : null}
    </View>
  );
}

function RunningMark() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={[styles.ring, styles.ringRun, { transform: [{ rotate }] }]} />;
}

function QueuedMark() {
  return (
    <View style={styles.slot}>
      <View style={[styles.ring, styles.ringQueue]} />
      <View style={styles.clockHour} />
      <View style={styles.clockMinute} />
    </View>
  );
}

function ErrorMark() {
  return <View style={styles.triangle} />;
}

function ArchivedMark() {
  return (
    <View style={styles.archive}>
      <View style={styles.archiveLid} />
    </View>
  );
}

const styles = StyleSheet.create({
  project: {
    width: 14,
    height: 14,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: '#8a6d4b',
  },
  projectCream: {
    position: 'absolute',
    right: -7,
    bottom: -7,
    width: 16,
    height: 16,
    backgroundColor: '#e8dcc8',
    transform: [{ rotate: '45deg' }],
  },
  slot: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1.5,
  },
  ringIdle: { borderColor: palette.muted },
  ringRun: { borderColor: palette.warn, borderTopColor: 'transparent' },
  ringQueue: { borderColor: palette.warn },
  clockHour: {
    position: 'absolute',
    width: 1.5,
    height: 4,
    borderRadius: 1,
    backgroundColor: palette.warn,
    top: 3,
  },
  clockMinute: {
    position: 'absolute',
    width: 3.5,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: palette.warn,
    left: 6.5,
    top: 6,
  },
  triangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: palette.err,
  },
  archive: {
    width: 12,
    height: 10,
    borderWidth: 1.5,
    borderColor: '#6b6b6b',
    borderRadius: 2,
    overflow: 'hidden',
  },
  archiveLid: {
    height: 3,
    borderBottomWidth: 1.5,
    borderBottomColor: '#6b6b6b',
  },
});

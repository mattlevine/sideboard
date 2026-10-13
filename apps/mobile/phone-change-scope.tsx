import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PhoneChangeCommit, PhoneChangeScope, PhoneChangeStat, PhoneSide } from './phone-pane-types';
import { palette } from './styles';

const SCOPES: Array<{ id: PhoneChangeScope; label: string; trigger: string }> = [
  { id: 'last_turn', label: 'Last Agent Turn', trigger: 'Last Agent Turn' },
  { id: 'uncommitted', label: 'Uncommitted', trigger: 'Uncommitted' },
  { id: 'staged', label: 'Staged', trigger: 'Staged' },
  { id: 'unstaged', label: 'Unstaged', trigger: 'Unstaged' },
  { id: 'commits', label: 'Commits', trigger: 'All Commits' },
];

/** Desktop Changes scope menu. All Commits is the phone default. */
export function PhoneChangeScopeMenu({
  side,
  scope,
  commitSha,
  onPick,
}: {
  side: PhoneSide | null;
  scope: PhoneChangeScope;
  commitSha: string | null;
  onPick: (scope: PhoneChangeScope, commitSha: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showCommits, setShowCommits] = useState(false);
  const selected = side?.commits?.find((commit) => commit.sha === commitSha);
  const active = SCOPES.find((item) => item.id === scope) ?? SCOPES[SCOPES.length - 1]!;
  const trigger = scope === 'commits' && selected ? selected.shortSha : active.trigger;
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => {
          setShowCommits(scope === 'commits');
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Change filter, ${trigger}`}
        style={styles.trigger}
      >
        <Text style={styles.triggerText} numberOfLines={1}>
          {trigger}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.dismiss} onPress={() => setOpen(false)} accessibilityLabel="Close change filter" />
          <View style={styles.sheet}>
            <ScrollView>
              {SCOPES.map((item) => {
                const disabled = item.id === 'last_turn' && side?.hasLastTurnBase === false;
                const on = item.id === scope && (item.id !== 'commits' || !commitSha);
                return (
                  <View key={item.id}>
                    <Pressable
                      disabled={disabled}
                      onPress={() => {
                        if (item.id === 'commits') {
                          setShowCommits(true);
                          onPick('commits', null);
                          return;
                        }
                        onPick(item.id, null);
                        setOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on, disabled }}
                      style={[styles.option, on && styles.optionOn, disabled && styles.optionOff]}
                    >
                      <Text style={styles.optionText}>{item.label}</Text>
                      <StatText stat={side?.scopeStats?.[item.id]} />
                      {on && item.id !== 'commits' ? <Text style={styles.check}>✓</Text> : null}
                      {item.id === 'commits' ? <Text style={styles.more}>›</Text> : null}
                    </Pressable>
                    {item.id === 'commits' && showCommits ? (
                      <CommitList
                        commits={side?.commits ?? []}
                        commitSha={commitSha}
                        allOn={scope === 'commits' && !commitSha}
                        onAll={() => {
                          onPick('commits', null);
                          setOpen(false);
                        }}
                        onCommit={(sha) => {
                          onPick('commits', sha);
                          setOpen(false);
                        }}
                      />
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CommitList({
  commits,
  commitSha,
  allOn,
  onAll,
  onCommit,
}: {
  commits: PhoneChangeCommit[];
  commitSha: string | null;
  allOn: boolean;
  onAll: () => void;
  onCommit: (sha: string) => void;
}) {
  return (
    <View style={styles.commits}>
      <Pressable onPress={onAll} style={[styles.option, allOn && styles.optionOn]}>
        <Text style={styles.optionText}>All Commits</Text>
        {allOn ? <Text style={styles.check}>✓</Text> : null}
      </Pressable>
      {commits.length === 0 ? <Text style={styles.empty}>No commits on branch</Text> : null}
      {commits.map((commit) => {
        const on = commitSha === commit.sha;
        return (
          <Pressable key={commit.sha} onPress={() => onCommit(commit.sha)} style={[styles.option, on && styles.optionOn]}>
            <Text style={styles.sha}>{commit.shortSha}</Text>
            <Text style={styles.subject} numberOfLines={1}>
              {commit.subject}
            </Text>
            {commit.relativeTime ? <Text style={styles.time}>{commit.relativeTime}</Text> : null}
            {on ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function StatText({ stat }: { stat?: PhoneChangeStat }) {
  if (!stat || (stat.additions === 0 && stat.deletions === 0)) return null;
  return (
    <Text style={styles.counts}>
      {stat.additions > 0 ? <Text style={styles.add}>{`+${stat.additions}`}</Text> : null}
      {stat.additions > 0 && stat.deletions > 0 ? ' ' : null}
      {stat.deletions > 0 ? <Text style={styles.del}>{`−${stat.deletions}`}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8 },
  trigger: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: palette.elevated,
  },
  triggerText: { color: palette.text, fontSize: 13, fontWeight: '600', maxWidth: 220 },
  chevron: { color: palette.muted, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    maxHeight: '70%',
    backgroundColor: palette.elevated,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingVertical: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionOn: { backgroundColor: palette.hover },
  optionOff: { opacity: 0.4 },
  optionText: { color: palette.text, fontSize: 15, flexShrink: 1 },
  check: { color: palette.text, fontSize: 14, marginLeft: 'auto' },
  more: { color: palette.muted, fontSize: 18, marginLeft: 'auto' },
  counts: { marginLeft: 'auto', fontSize: 12 },
  add: { color: '#6a9955' },
  del: { color: '#f14c4c' },
  commits: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: palette.border, marginLeft: 16 },
  sha: { color: palette.muted, fontSize: 12, width: 64 },
  subject: { color: palette.text, fontSize: 14, flex: 1 },
  time: { color: palette.muted, fontSize: 12 },
  empty: { color: palette.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 8 },
});

const CHANGE_SCOPES: PhoneChangeScope[] = ['last_turn', 'uncommitted', 'staged', 'unstaged', 'commits'];

/** Scope fields on a Changes pane reply. Missing fields stay off so an older Mac still loads the list. */
export function changeFilterFromReply(record: Record<string, unknown>): Pick<
  PhoneSide,
  'scope' | 'commitSha' | 'base' | 'hasLastTurnBase' | 'commits' | 'scopeStats'
> {
  const scope = CHANGE_SCOPES.find((item) => item === record.scope);
  const commitSha = typeof record.commitSha === 'string' && record.commitSha ? record.commitSha : null;
  const base = typeof record.base === 'string' && record.base ? record.base : undefined;
  const commits = Array.isArray(record.commits) ? record.commits.flatMap(changeCommit) : [];
  return {
    ...(scope ? { scope } : {}),
    commitSha,
    ...(base ? { base } : {}),
    hasLastTurnBase: record.hasLastTurnBase === true,
    commits,
    scopeStats: changeStats(record.scopeStats),
  };
}

function changeCommit(value: unknown): PhoneChangeCommit[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as { sha?: unknown; shortSha?: unknown; subject?: unknown; relativeTime?: unknown };
  if (typeof row.sha !== 'string' || typeof row.shortSha !== 'string' || typeof row.subject !== 'string') return [];
  return [
    {
      sha: row.sha,
      shortSha: row.shortSha,
      subject: row.subject,
      relativeTime: typeof row.relativeTime === 'string' ? row.relativeTime : '',
    },
  ];
}

function changeStats(value: unknown): Partial<Record<PhoneChangeScope, PhoneChangeStat>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const stats: Partial<Record<PhoneChangeScope, PhoneChangeStat>> = {};
  for (const scope of CHANGE_SCOPES) {
    const row = (value as Record<string, unknown>)[scope];
    if (!row || typeof row !== 'object') continue;
    const stat = row as { files?: unknown; additions?: unknown; deletions?: unknown };
    stats[scope] = {
      files: numberField(stat.files),
      additions: numberField(stat.additions),
      deletions: numberField(stat.deletions),
    };
  }
  return stats;
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

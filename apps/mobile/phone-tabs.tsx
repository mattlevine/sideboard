import { useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PhoneViewer } from './phone-viewer';
import type { FilePathLink } from './file-link';
import { PhonePaneBody } from './phone-file-search';
import { PhoneOpenFiles } from './phone-open-files';
import type { PhoneCodeSelection } from './phone-code-ref';
import type { PhoneOpenDoc } from './phone-open-docs';
import { changeFilterFromReply } from './phone-change-scope';
import { keepPaneOnOpenedChat, type PhoneChangeScope, type PhonePaneId, type PhonePaneRow, type PhoneSide } from './phone-pane-types';
import { palette } from './styles';

export { keepPaneOnOpenedChat };

export type PhoneTab = 'chat' | 'doc' | PhonePaneId;

/** Desktop right-sidebar header: branch, git counts, PR, and the primary action. */
export type PhoneRightHeader = {
  branch: string;
  additions: number;
  deletions: number;
  unpushed: number;
  dirty: boolean;
  ready: boolean;
  title?: string;
  prUrl?: string;
  prNumber?: string;
  prStatus?: string;
  action?: string;
  actionLabel?: string;
};

const TABS: Array<{ id: PhonePaneId; label: string }> = [
  { id: 'files', label: 'All files' },
  { id: 'changes', label: 'Changes' },
  { id: 'checks', label: 'Checks' },
];

export function usePhonePanes(send: (payload: object) => void, chatId: () => string | null) {
  const [pane, setPane] = useState<PhoneTab>('chat');
  const [side, setSide] = useState<PhoneSide | null>(null);
  const sideRef = useRef(side);
  sideRef.current = side;
  const requestedRef = useRef<{
    chatId: string;
    pane: PhonePaneId;
    query: string;
    scope?: PhoneChangeScope;
    commitSha?: string | null;
  } | null>(null);
  const [changeScope, setChangeScope] = useState<PhoneChangeScope>('commits');
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const changeScopeRef = useRef(changeScope);
  const commitShaRef = useRef(commitSha);
  changeScopeRef.current = changeScope;
  commitShaRef.current = commitSha;
  const [fileQuery, setFileQuery] = useState('');
  const fileQueryRef = useRef('');
  const paneRef = useRef<PhoneTab>('chat');
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  paneRef.current = pane;

  function takeControl(control: object): boolean {
    const record = control as { op?: unknown; chatId?: unknown; message?: unknown; query?: unknown };
    const replyChat = typeof record.chatId === 'string' ? record.chatId : '';
    const wanted = requestedRef.current;
    const next = sideFromPhoneReply(control);
    if (next) {
      const replyQuery = typeof record.query === 'string' ? record.query : null;
      if (!wanted || wanted.pane !== next.pane || (replyChat && replyChat !== wanted.chatId)) return true;
      if (replyQuery != null && replyQuery !== wanted.query) return true;
      if (next.pane === 'changes' && next.scope && wanted.scope && next.scope !== wanted.scope) return true;
      if (next.pane === 'changes' && wanted.commitSha && next.commitSha && next.commitSha !== wanted.commitSha) {
        return true;
      }
      requestedRef.current = null;
      setSide(next);
      return true;
    }
    if (record.op !== 'error' || !sideRef.current?.loading || !wanted) return false;
    if (replyChat && replyChat !== wanted.chatId) return false;
    const raw = typeof record.message === 'string' ? record.message : '';
    if (raw !== 'invalid phone command' && raw !== 'That agent is not on this Mac.') return false;
    requestedRef.current = null;
    const message =
      raw === 'invalid phone command'
        ? 'This Mac’s Sideboard app doesn’t have these tabs yet. Update Sideboard on the Mac.'
        : raw;
    setSide({ ...sideRef.current, loading: false, rows: [], note: message });
    return true;
  }

  function selectPane(next: PhoneTab, scope?: PhoneChangeScope, sha?: string | null) {
    const nextScope = next === 'changes' ? (scope ?? changeScopeRef.current) : changeScopeRef.current;
    const nextSha = next !== 'changes' ? commitShaRef.current : nextScope === 'commits' ? (sha === undefined ? commitShaRef.current : sha) : null;
    if (next === 'changes') {
      changeScopeRef.current = nextScope;
      commitShaRef.current = nextSha;
      setChangeScope(nextScope);
      setCommitSha(nextSha);
    }
    setPane(next);
    paneRef.current = next;
    if (next !== 'files' && queryTimer.current) {
      clearTimeout(queryTimer.current);
      queryTimer.current = null;
    }
    if (next !== 'files' && next !== 'changes' && next !== 'checks') {
      requestedRef.current = null;
      return;
    }
    const id = chatId();
    const query = next === 'files' ? fileQueryRef.current.trim() : '';
    const previous = sideRef.current;
    const keep = next === 'files' && previous?.pane === 'files';
    const keepChanges = next === 'changes' && previous?.pane === 'changes';
    const loading: PhoneSide = keep
      ? { pane: next, rows: previous.rows, note: previous.note, loading: true }
      : {
          pane: next,
          rows: [],
          loading: true,
          ...(keepChanges
            ? {
                commits: previous.commits,
                scopeStats: previous.scopeStats,
                hasLastTurnBase: previous.hasLastTurnBase,
                scope: nextScope,
                commitSha: nextSha,
              }
            : {}),
        };
    sideRef.current = loading;
    setSide(loading);
    if (!id) {
      requestedRef.current = null;
      return;
    }
    requestedRef.current = {
      chatId: id,
      pane: next,
      query,
      ...(next === 'changes' ? { scope: nextScope, commitSha: nextSha } : {}),
    };
    send({
      op: 'pane',
      chatId: id,
      pane: next,
      ...(next === 'changes' ? { scope: nextScope, ...(nextSha ? { commitSha: nextSha } : {}) } : {}),
      ...(query ? { query } : {}),
    });
  }

  function setFileSearch(value: string) {
    setFileQuery(value);
    fileQueryRef.current = value;
    if (queryTimer.current) clearTimeout(queryTimer.current);
    queryTimer.current = setTimeout(() => {
      queryTimer.current = null;
      if (paneRef.current !== 'files') return;
      selectPane('files');
    }, 250);
  }

  function setVisiblePane(next: PhoneTab) {
    if (next !== 'files' && queryTimer.current) {
      clearTimeout(queryTimer.current);
      queryTimer.current = null;
    }
    paneRef.current = next;
    setPane(next);
  }

  function askReview() {
    const id = chatId();
    if (!id) return;
    setVisiblePane('chat');
    send({ op: 'review', chatId: id });
  }

  return {
    pane,
    paneNow: () => paneRef.current,
    side,
    fileQuery,
    changeScope,
    commitSha,
    setFileSearch,
    setPane: setVisiblePane,
    takeControl,
    selectPane,
    askReview,
  };
}

export function PhoneWorkspace({
  pane,
  docs,
  activeDocId,
  side,
  header,
  onSelect,
  onReview,
  onSelectDoc,
  onCloseDoc,
  onOpenPath,
  onAddCodeRef,
  onHeaderAction,
  onHeaderArchive,
  fileQuery,
  changeScope,
  commitSha,
  onFileQuery,
  children,
}: {
  pane: PhoneTab;
  docs: PhoneOpenDoc[];
  activeDocId: string | null;
  side: PhoneSide | null;
  header: PhoneRightHeader | null;
  onSelect: (tab: PhoneTab, scope?: PhoneChangeScope, commitSha?: string | null) => void;
  onReview: () => void;
  onSelectDoc: (id: string) => void;
  onCloseDoc: (id: string) => void;
  fileQuery: string;
  changeScope: PhoneChangeScope;
  commitSha: string | null;
  onFileQuery: (value: string) => void;
  onOpenPath: (link: FilePathLink) => void;
  onAddCodeRef?: (ref: PhoneCodeSelection) => void;
  onHeaderAction: () => void;
  onHeaderArchive: () => void;
  children: ReactNode;
}) {
  const open = docs.find((doc) => doc.id === activeDocId)?.viewer ?? null;
  return (
    <View style={styles.workspace}>
      {header ? (
        <PhoneRightTop header={header} onAction={onHeaderAction} onArchive={onHeaderArchive} />
      ) : null}
      <PhoneTabBar tab={pane} onSelect={onSelect} onReview={onReview} />
      <PhoneOpenFiles
        docs={docs}
        activeId={pane === 'doc' ? activeDocId : null}
        onSelect={onSelectDoc}
        onClose={onCloseDoc}
      />
      <View style={styles.fill}>
        {pane === 'chat' ? (
          children
        ) : pane === 'doc' ? (
          <PhoneViewer
            inline
            viewer={open}
            onClose={() => {
              if (activeDocId) onCloseDoc(activeDocId);
            }}
            onOpenPath={onOpenPath}
            onAddCodeRef={onAddCodeRef}
          />
        ) : (
          <PhonePaneBody
            side={side}
            fileQuery={fileQuery}
            onFileQuery={onFileQuery}
            changeScope={changeScope}
            commitSha={commitSha}
            onChangeScope={(scope, sha) => onSelect('changes', scope, sha)}
            onOpenPath={(path) =>
              onOpenPath(
                pane === 'changes'
                  ? { path, view: 'diff', scope: changeScope, ...(commitSha ? { commitSha } : {}) }
                  : { path },
              )
            }
          />
        )}
      </View>
    </View>
  );
}

/** Pull request, Commit, and Archive — the desktop right-sidebar top row. */
export function PhoneRightTop({
  header,
  onAction,
  onArchive,
}: {
  header: PhoneRightHeader;
  onAction: () => void;
  onArchive: () => void;
}) {
  const showPr = Boolean(header.prNumber || header.prStatus || header.prUrl);
  return (
    <View style={styles.top}>
      <View style={styles.topRow}>
        {showPr ? (
          <PrChip number={header.prNumber} status={header.prStatus} url={header.prUrl} />
        ) : null}
        <View style={styles.topGap} />
        {header.actionLabel ? (
          <Pressable onPress={onAction} style={styles.action} accessibilityRole="button">
            <Text style={styles.actionText}>{header.actionLabel}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onArchive} style={styles.archive} accessibilityRole="button" accessibilityLabel="Archive">
          <Text style={styles.archiveText}>Archive</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Desktop PR pill: #N | status | ↗. Status color matches the right sidebar. */
function PrChip({ number, status, url }: { number?: string; status?: string; url?: string }) {
  const tone = prTone(status ?? '');
  const open = () => {
    if (url) void Linking.openURL(url);
  };
  return (
    <View style={[styles.pr, { borderColor: tone.border, borderStyle: tone.dashed ? 'dashed' : 'solid' }]}>
      <Pressable
        onPress={open}
        disabled={!url}
        style={styles.prMain}
        accessibilityRole="button"
        accessibilityLabel={
          number ? `Pull request ${number}${status ? `, ${status}` : ''}` : 'Pull request'
        }
      >
        <Text style={[styles.prNum, { color: tone.color }]}>{number ? `#${number}` : 'PR'}</Text>
      </Pressable>
      {status ? (
        <>
          <View style={[styles.prRule, { backgroundColor: tone.color }]} />
          <Pressable onPress={open} disabled={!url} style={styles.prStatusBtn}>
            <Text style={[styles.prStatus, { color: tone.color }]} numberOfLines={1}>
              {status}
            </Text>
          </Pressable>
        </>
      ) : null}
      {url ? (
        <>
          <View style={[styles.prRule, { backgroundColor: tone.color }]} />
          <Pressable
            onPress={open}
            style={styles.prExt}
            accessibilityRole="button"
            accessibilityLabel="Open on GitHub"
          >
            <Text style={[styles.prExtText, { color: tone.color }]}>↗</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function prTone(status: string): { border: string; color: string; dashed: boolean } {
  if (status === 'Merged') return { border: 'rgba(210, 168, 255, 0.55)', color: '#e8d4ff', dashed: false };
  if (status === 'Closed') return { border: 'rgba(154, 160, 166, 0.5)', color: '#b0b5ba', dashed: false };
  if (status === 'Queued') return { border: 'rgba(111, 219, 212, 0.55)', color: '#9ee8e2', dashed: false };
  if (status === 'Approved') return { border: 'rgba(111, 207, 151, 0.55)', color: '#8fd9a8', dashed: false };
  if (status === 'Needs approval') return { border: 'rgba(226, 179, 64, 0.55)', color: '#f0c14d', dashed: false };
  if (status === 'Changes requested' || status === 'Merge conflicts' || status === 'Checks failing') {
    return { border: 'rgba(255, 123, 114, 0.55)', color: '#ffa198', dashed: false };
  }
  return { border: 'rgba(117, 190, 255, 0.55)', color: '#9cdcfe', dashed: status === 'Draft' };
}

export function sideFromPhoneReply(control: object): PhoneSide | undefined {
  const record = control as Record<string, unknown>;
  if (record.op !== 'pane') return undefined;
  const pane = record.pane;
  if (pane !== 'files' && pane !== 'changes' && pane !== 'checks') return undefined;
  const rows = Array.isArray(record.rows) ? record.rows.flatMap(paneRow) : [];
  const note = typeof record.note === 'string' ? record.note : undefined;
  if (pane !== 'changes') return { pane, rows, note, loading: false };
  return {
    pane,
    rows,
    note,
    loading: false,
    ...changeFilterFromReply(record),
  };
}

function paneRow(value: unknown): PhonePaneRow[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as { label?: unknown; path?: unknown; detail?: unknown; href?: unknown; status?: unknown };
  if (typeof row.label !== 'string' || !row.label) return [];
  const status = typeof row.status === 'string' && row.status.length > 0 && row.status.length <= 8 ? row.status : undefined;
  return [
    {
      label: row.label,
      ...(typeof row.path === 'string' ? { path: row.path } : {}),
      ...(typeof row.detail === 'string' ? { detail: row.detail } : {}),
      ...(typeof row.href === 'string' ? { href: row.href } : {}),
      ...(status ? { status } : {}),
    },
  ];
}

/** Chat sits with All files, Changes, Checks, and Review, under the workspace header. */
export function PhoneTabBar({
  tab,
  onSelect,
  onReview,
}: {
  tab: PhoneTab;
  onSelect: (tab: PhoneTab) => void;
  onReview: () => void;
}) {
  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        <Tab label="Chat" active={tab === 'chat'} onPress={() => onSelect('chat')} />
        {TABS.map((item) => (
          <Tab key={item.id} label={item.label} active={tab === item.id} onPress={() => onSelect(item.id)} />
        ))}
      </ScrollView>
      <Pressable onPress={onReview} hitSlop={8} style={styles.review}>
        <Text style={styles.reviewText}>Review</Text>
      </Pressable>
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <Text style={[styles.tabText, active && styles.tabOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1 },
  fill: { flex: 1 },
  top: {
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.elevated,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  topGap: { flex: 1, minWidth: 8 },
  pr: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 28,
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: 'transparent',
  },
  prMain: { justifyContent: 'center', paddingLeft: 10, paddingRight: 8 },
  prNum: { fontSize: 12, fontWeight: '700' },
  prRule: { width: 1, opacity: 0.45 },
  prStatusBtn: { justifyContent: 'center', paddingHorizontal: 8, flexShrink: 1 },
  prStatus: { fontSize: 12, fontWeight: '500' },
  prExt: { justifyContent: 'center', paddingHorizontal: 8 },
  prExtText: { fontSize: 13, fontWeight: '600' },
  action: {
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentDim,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  archive: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  archiveText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.elevated,
    minHeight: 40,
  },
  tabs: { alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  tab: { paddingHorizontal: 8, paddingVertical: 10 },
  tabText: { color: palette.muted, fontSize: 13, fontWeight: '600' },
  tabOn: { color: palette.text },
  review: { paddingHorizontal: 12, paddingVertical: 10 },
  reviewText: { color: palette.accent, fontSize: 13, fontWeight: '600' },
});

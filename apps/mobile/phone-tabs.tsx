import { useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PhoneViewer, type PhoneViewerModel } from './phone-viewer';
import type { FilePathLink } from './file-link';
import type { PhonePaneId, PhonePaneRow } from './phone-pane-types';
import { palette } from './styles';

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

export type PhoneSide = {
  pane: PhonePaneId;
  rows: PhonePaneRow[];
  note?: string;
  loading?: boolean;
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
  const requestedRef = useRef<{ chatId: string; pane: PhonePaneId } | null>(null);

  function takeControl(control: object): boolean {
    const record = control as { op?: unknown; chatId?: unknown; message?: unknown };
    const replyChat = typeof record.chatId === 'string' ? record.chatId : '';
    const wanted = requestedRef.current;
    const next = sideFromPhoneReply(control);
    if (next) {
      if (!wanted || wanted.pane !== next.pane || (replyChat && replyChat !== wanted.chatId)) return true;
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

  function selectPane(next: PhoneTab, scope?: 'uncommitted' | 'commits') {
    setPane(next);
    if (next !== 'files' && next !== 'changes' && next !== 'checks') {
      requestedRef.current = null;
      return;
    }
    const id = chatId();
    const loading = { pane: next, rows: [], loading: true };
    sideRef.current = loading;
    setSide(loading);
    if (!id) {
      requestedRef.current = null;
      return;
    }
    requestedRef.current = { chatId: id, pane: next };
    send({ op: 'pane', chatId: id, pane: next, ...(scope ? { scope } : {}) });
  }

  function askReview() {
    const id = chatId();
    if (!id) return;
    setPane('chat');
    send({ op: 'review', chatId: id });
  }

  return { pane, side, setPane, takeControl, selectPane, askReview };
}

export function PhoneWorkspace({
  pane,
  viewer,
  side,
  header,
  onSelect,
  onReview,
  onCloseDoc,
  onOpenPath,
  onHeaderStatus,
  onHeaderAction,
  onHeaderArchive,
  children,
}: {
  pane: PhoneTab;
  viewer: PhoneViewerModel | null;
  side: PhoneSide | null;
  header: PhoneRightHeader | null;
  onSelect: (tab: PhoneTab, scope?: 'uncommitted' | 'commits') => void;
  onReview: () => void;
  onCloseDoc: () => void;
  onOpenPath: (link: FilePathLink) => void;
  onHeaderStatus: () => void;
  onHeaderAction: () => void;
  onHeaderArchive: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.workspace}>
      {header ? (
        <PhoneRightTop
          header={header}
          onStatus={onHeaderStatus}
          onAction={onHeaderAction}
          onArchive={onHeaderArchive}
        />
      ) : null}
      <PhoneTabBar tab={pane} docTitle={viewer?.title} onSelect={onSelect} onReview={onReview} />
      <View style={styles.fill}>
        {pane === 'chat' ? (
          children
        ) : pane === 'doc' ? (
          <PhoneViewer inline viewer={viewer} onClose={onCloseDoc} onOpenPath={onOpenPath} />
        ) : (
          <PhonePaneBody side={side} onOpenPath={(path) => onOpenPath({ path })} />
        )}
      </View>
    </View>
  );
}

/** Branch, diff counts, pull request, and Commit / Archive — the desktop right-sidebar top row. */
export function PhoneRightTop({
  header,
  onStatus,
  onAction,
  onArchive,
}: {
  header: PhoneRightHeader;
  onStatus: () => void;
  onAction: () => void;
  onArchive: () => void;
}) {
  const title = header.title?.replace(/\n/g, ', ') || header.branch;
  const showPr = Boolean(header.prNumber || header.prStatus || header.prUrl);
  return (
    <View style={styles.top}>
      <View style={styles.topRow}>
        {showPr ? (
          <PrChip number={header.prNumber} status={header.prStatus} url={header.prUrl} />
        ) : null}
        <View style={styles.topGap} />
        <Pressable onPress={onStatus} style={styles.git} accessibilityRole="button" accessibilityLabel={title}>
          <Text style={styles.branch} numberOfLines={1}>
            {header.branch}
          </Text>
          {header.ready && header.dirty && (header.additions > 0 || header.deletions > 0) ? (
            <Text style={styles.counts}>
              <Text style={styles.add}>+{header.additions}</Text>
              <Text style={styles.del}> −{header.deletions}</Text>
            </Text>
          ) : header.ready && header.dirty ? (
            <Text style={styles.gitMeta}>dirty</Text>
          ) : header.ready && header.unpushed === 0 ? (
            <Text style={styles.gitMeta}>clean</Text>
          ) : null}
          {header.ready && header.unpushed > 0 ? <Text style={styles.gitMeta}>↑{header.unpushed}</Text> : null}
        </Pressable>
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
  return { pane, rows, note, loading: false };
}

function paneRow(value: unknown): PhonePaneRow[] {
  if (!value || typeof value !== 'object') return [];
  const row = value as { label?: unknown; path?: unknown; detail?: unknown; href?: unknown };
  if (typeof row.label !== 'string' || !row.label) return [];
  return [
    {
      label: row.label,
      ...(typeof row.path === 'string' ? { path: row.path } : {}),
      ...(typeof row.detail === 'string' ? { detail: row.detail } : {}),
      ...(typeof row.href === 'string' ? { href: row.href } : {}),
    },
  ];
}

export function PhonePaneBody({
  side,
  onOpenPath,
}: {
  side: PhoneSide | null;
  onOpenPath: (path: string) => void;
}) {
  if (!side || side.loading) {
    return (
      <View style={styles.fill}>
        <Text style={styles.note}>Loading…</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.list}>
      {side.note ? <Text style={styles.note}>{side.note}</Text> : null}
      {side.rows.length === 0 && !side.note ? <Text style={styles.note}>Nothing here.</Text> : null}
      {side.rows.map((row) => (
        <Pressable
          key={`${row.label}:${row.detail ?? ''}`}
          onPress={() => {
            if (row.path) onOpenPath(row.path);
            else if (row.href) void Linking.openURL(row.href);
          }}
        >
          <View style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>
              {row.label}
            </Text>
            {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Chat sits with All files, Changes, Checks, and Review, under the git header. */
export function PhoneTabBar({
  tab,
  docTitle,
  onSelect,
  onReview,
}: {
  tab: PhoneTab;
  docTitle?: string;
  onSelect: (tab: PhoneTab) => void;
  onReview: () => void;
}) {
  const doc = docTitle ? docTitle.split('/').pop() || docTitle : '';
  return (
    <View style={styles.bar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        <Tab label="Chat" active={tab === 'chat'} onPress={() => onSelect('chat')} />
        {doc ? <Tab label={doc} active={tab === 'doc'} onPress={() => onSelect('doc')} /> : null}
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
  git: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    maxWidth: 200,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  branch: { color: palette.text, fontSize: 12, fontWeight: '500', flexShrink: 1 },
  counts: { fontSize: 12, fontWeight: '600' },
  add: { color: palette.ok },
  del: { color: palette.err },
  gitMeta: { color: palette.muted, fontSize: 12, fontWeight: '600' },
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
  list: { paddingVertical: 8 },
  note: { color: palette.muted, fontSize: 14, paddingHorizontal: 16, paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  label: { flex: 1, color: palette.text, fontSize: 14 },
  detail: { color: palette.muted, fontSize: 12 },
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

import { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PickedFile } from './media';
import { AgentKindIcon } from './agent-icons';

const palette = {
  bg: '#121212',
  elevated: '#18191a',
  hover: '#242424',
  border: '#2e2e32',
  text: '#ededed',
  secondary: '#c6c6c6',
  muted: '#9b9b9b',
  accent: '#007fd4',
};

export type AgentId = 'claude' | 'codex' | 'opencode' | 'cursor' | 'brightsy';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ComposerOptions = {
  agent: AgentId;
  model: string | null;
  effort: Effort;
  fast: boolean;
  planMode: boolean;
  autonomy: 'default' | 'full';
};

export const DEFAULT_OPTIONS: ComposerOptions = {
  agent: 'claude',
  model: null,
  effort: 'medium',
  fast: false,
  planMode: false,
  autonomy: 'default',
};

export type FileChip = PickedFile & { id: string };
export type LinkChip = { ref: string; title: string; url?: string };
export type SourceRow = { ref: string; title: string; url?: string };
export type PhoneSources = {
  prs: SourceRow[];
  branches: SourceRow[];
  issues: SourceRow[];
  warnings?: string[];
};

const AGENTS: Array<{ id: AgentId; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'brightsy', label: 'Brightsy' },
];

const EFFORTS: Array<{ id: Effort; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra' },
  { id: 'max', label: 'Max' },
];

function agentLabel(agent: AgentId): string {
  return AGENTS.find((row) => row.id === agent)?.label ?? agent;
}

function effortLabel(effort: Effort): string {
  return EFFORTS.find((row) => row.id === effort)?.label ?? effort;
}

function modelLabel(options: ComposerOptions, models: Array<{ id: string; label: string }>): string {
  if (!options.model || options.model === 'default') return 'Auto';
  return models.find((row) => row.id === options.model)?.label ?? options.model;
}

export function ComposerDock(props: {
  draft: string;
  placeholder: string;
  onChangeDraft: (value: string) => void;
  onSend: () => void;
  files: FileChip[];
  links: LinkChip[];
  onRemoveFile: (id: string) => void;
  onRemoveLink: (ref: string) => void;
  options: ComposerOptions;
  onChangeOptions: (next: ComposerOptions) => void;
  models: Array<{ id: string; label: string }>;
  onNeedModels: (agent: AgentId) => void;
  allowBrightsy: boolean;
  listening: boolean;
  onMic: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onFiles: () => void;
  onLinkIssue?: () => void;
  allowEmpty?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const canSend = Boolean(props.allowEmpty || props.draft.trim() || props.files.length || props.links.length);
  return (
    <View style={styles.shell}>
      <View style={styles.box}>
        <Chips files={props.files} links={props.links} onRemoveFile={props.onRemoveFile} onRemoveLink={props.onRemoveLink} />
        {props.options.planMode ? <Text style={styles.banner}>Plan mode stays on until you turn it off.</Text> : null}
        <TextInput
          style={styles.input}
          placeholder={props.placeholder}
          placeholderTextColor={palette.muted}
          value={props.draft}
          onChangeText={props.onChangeDraft}
          multiline
        />
        <View style={styles.actions}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips}>
            <Pressable
              style={styles.chip}
              onPress={() => {
                setMenu(false);
                props.onNeedModels(props.options.agent);
                setAgentOpen(true);
              }}
            >
              <AgentKindIcon agent={props.options.agent} />
              <Text style={styles.chipText}>{agentLabel(props.options.agent)} · {modelLabel(props.options, props.models)}</Text>
            </Pressable>
            <Pressable
              style={styles.chip}
              onPress={() => {
                const index = EFFORTS.findIndex((row) => row.id === props.options.effort);
                const next = EFFORTS[(index + 1) % EFFORTS.length]!;
                props.onChangeOptions({ ...props.options, effort: next.id });
              }}
            >
              <Text style={styles.chipText}>{effortLabel(props.options.effort)}</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, props.options.planMode && styles.chipOn]}
              onPress={() => props.onChangeOptions({ ...props.options, planMode: !props.options.planMode })}
            >
              <Text style={styles.chipText}>Plan</Text>
            </Pressable>
            {props.options.agent === 'cursor' ? (
              <Pressable
                style={[styles.chip, props.options.fast && styles.chipOn]}
                onPress={() => props.onChangeOptions({ ...props.options, fast: !props.options.fast })}
              >
                <Text style={styles.chipText}>Fast</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <Pressable style={[styles.round, props.listening && styles.roundOn]} onPress={props.onMic}>
            <Text style={styles.roundText}>{props.listening ? '●' : '🎤'}</Text>
          </Pressable>
          <Pressable style={styles.round} onPress={() => setMenu((open) => !open)}>
            <Text style={styles.roundText}>+</Text>
          </Pressable>
          <Pressable style={[styles.send, !canSend && styles.sendOff]} onPress={props.onSend} disabled={!canSend}>
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
        {menu ? (
          <View style={styles.menu}>
            <MenuRow label="Take photo" onPress={() => { setMenu(false); props.onCamera(); }} />
            <MenuRow label="Photo library" onPress={() => { setMenu(false); props.onPhotos(); }} />
            <MenuRow label="Choose file" onPress={() => { setMenu(false); props.onFiles(); }} />
            {props.onLinkIssue ? (
              <MenuRow label="Link issue" onPress={() => { setMenu(false); props.onLinkIssue?.(); }} />
            ) : null}
          </View>
        ) : null}
      </View>
      <AgentSheet
        open={agentOpen}
        options={props.options}
        models={props.models}
        allowBrightsy={props.allowBrightsy}
        onNeedModels={props.onNeedModels}
        onClose={() => setAgentOpen(false)}
        onChange={props.onChangeOptions}
      />
    </View>
  );
}

function Chips(props: {
  files: FileChip[];
  links: LinkChip[];
  onRemoveFile: (id: string) => void;
  onRemoveLink: (ref: string) => void;
}) {
  if (props.files.length === 0 && props.links.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileRow}>
      {props.files.map((file) => (
        <Pressable key={file.id} style={styles.fileChip} onPress={() => props.onRemoveFile(file.id)}>
          {file.previewUri ? <Image source={{ uri: file.previewUri }} style={styles.thumb} /> : null}
          <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
          <Text style={styles.fileX}>×</Text>
        </Pressable>
      ))}
      {props.links.map((link) => (
        <Pressable key={link.ref} style={styles.fileChip} onPress={() => props.onRemoveLink(link.ref)}>
          <Text style={styles.fileName} numberOfLines={1}>{link.ref}</Text>
          <Text style={styles.fileX}>×</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function MenuRow(props: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.menuRow} onPress={props.onPress}>
      <Text style={styles.menuText}>{props.label}</Text>
    </Pressable>
  );
}

function AgentSheet(props: {
  open: boolean;
  options: ComposerOptions;
  models: Array<{ id: string; label: string }>;
  allowBrightsy: boolean;
  onNeedModels: (agent: AgentId) => void;
  onClose: () => void;
  onChange: (next: ComposerOptions) => void;
}) {
  const agents = props.allowBrightsy ? AGENTS : AGENTS.filter((row) => row.id !== 'brightsy');
  return (
    <Modal visible={props.open} animationType="slide" transparent onRequestClose={props.onClose}>
      <Pressable style={styles.backdrop} onPress={props.onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>Agent</Text>
          <View style={styles.wrap}>
            {agents.map((agent) => (
              <Pressable
                key={agent.id}
                style={[styles.chip, props.options.agent === agent.id && styles.chipOn]}
                onPress={() => {
                  props.onNeedModels(agent.id);
                  props.onChange({
                    ...props.options,
                    agent: agent.id,
                    model: agent.id === 'cursor' ? 'default' : null,
                    fast: agent.id === 'cursor' ? props.options.fast : false,
                  });
                }}
              >
                <AgentKindIcon agent={agent.id} />
                <Text style={styles.chipText}>{agent.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sheetLabel}>Model</Text>
          <ScrollView style={styles.modelList}>
            <Pressable
              style={styles.menuRow}
              onPress={() => props.onChange({ ...props.options, model: props.options.agent === 'cursor' ? 'default' : null })}
            >
              <Text style={styles.menuText}>
                {(props.options.model == null || props.options.model === 'default') ? '✓ ' : ''}Auto
              </Text>
            </Pressable>
            {props.models.map((model) => (
              <Pressable
                key={model.id}
                style={styles.menuRow}
                onPress={() => props.onChange({ ...props.options, model: model.id })}
              >
                <Text style={styles.menuText}>{props.options.model === model.id ? '✓ ' : ''}{model.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.sheetLabel}>Effort</Text>
          <View style={styles.wrap}>
            {EFFORTS.map((effort) => (
              <Pressable
                key={effort.id}
                style={[styles.chip, props.options.effort === effort.id && styles.chipOn]}
                onPress={() => props.onChange({ ...props.options, effort: effort.id })}
              >
                <Text style={styles.chipText}>{effort.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.wrap}>
            <Pressable
              style={[styles.chip, props.options.autonomy === 'default' && styles.chipOn]}
              onPress={() => props.onChange({ ...props.options, autonomy: 'default' })}
            >
              <Text style={styles.chipText}>Default</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, props.options.autonomy === 'full' && styles.chipOn]}
              onPress={() => props.onChange({ ...props.options, autonomy: 'full' })}
            >
              <Text style={styles.chipText}>Full autonomy</Text>
            </Pressable>
          </View>
          <Pressable style={styles.primary} onPress={props.onClose}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type CreateMode =
  | { kind: 'orchestration' }
  | { kind: 'project'; repoPath: string; name: string }
  | { kind: 'worktree'; chatId: string; label: string };

export type CreateSelection =
  | { kind: 'default' }
  | { kind: 'branch'; ref: string; title: string }
  | { kind: 'pr'; ref: string; title: string }
  | { kind: 'ticket'; ref: string; title: string; url?: string };

export function CreateChatSheet(props: {
  mode: CreateMode;
  sources: PhoneSources | null;
  onClose: () => void;
  onSubmit: (body: {
    text: string;
    files: FileChip[];
    links: LinkChip[];
    options: ComposerOptions;
    selection: CreateSelection;
    cowboy: boolean;
  }) => void;
  onRequestSources: (query: string) => void;
  models: Array<{ id: string; label: string }>;
  onNeedModels: (agent: AgentId) => void;
  listening: boolean;
  onMic: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onFiles: () => void;
  draft: string;
  onChangeDraft: (value: string) => void;
  files: FileChip[];
  links: LinkChip[];
  onRemoveFile: (id: string) => void;
  onRemoveLink: (ref: string) => void;
  options: ComposerOptions;
  onChangeOptions: (next: ComposerOptions) => void;
}) {
  const [tab, setTab] = useState<'prs' | 'branches' | 'issues'>('prs');
  const [selection, setSelection] = useState<CreateSelection>({ kind: 'default' });
  const [cowboy, setCowboy] = useState(false);
  const [query, setQuery] = useState('');
  const project = props.mode.kind === 'project';
  const title =
    props.mode.kind === 'orchestration'
      ? 'New orchestration'
      : props.mode.kind === 'project'
        ? props.mode.name
        : props.mode.label;
  const rows =
    tab === 'prs' ? props.sources?.prs ?? [] : tab === 'branches' ? props.sources?.branches ?? [] : props.sources?.issues ?? [];
  const selectedLabel =
    cowboy
      ? 'on main'
      : selection.kind === 'default'
        ? 'Default branch'
        : selection.kind === 'pr'
          ? `PR #${selection.ref}`
          : selection.ref;
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.createScreen}>
        <View style={styles.createHead}>
          <Pressable onPress={props.onClose} hitSlop={8}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
          <Text style={styles.createTitle} numberOfLines={1}>{title}</Text>
          <View style={styles.headGap} />
        </View>
        {project ? (
          <View style={styles.sourceBlock}>
            <View style={styles.sourceHead}>
              <Text style={styles.selected} numberOfLines={1}>{selectedLabel}</Text>
              <Pressable
                style={[styles.chip, cowboy && styles.chipOn]}
                onPress={() => {
                  setCowboy((value) => !value);
                  setSelection({ kind: 'default' });
                }}
              >
                <Text style={styles.chipText}>Cowboy</Text>
              </Pressable>
            </View>
            {cowboy ? (
              <Text style={styles.banner}>Cowboy edits the project folder on the default branch.</Text>
            ) : (
              <>
                <View style={styles.wrap}>
                  {(['prs', 'branches', 'issues'] as const).map((id) => (
                    <Pressable key={id} style={[styles.chip, tab === id && styles.chipOn]} onPress={() => setTab(id)}>
                      <Text style={styles.chipText}>{id === 'prs' ? 'PRs' : id === 'branches' ? 'Branches' : 'Issues'}</Text>
                    </Pressable>
                  ))}
                  <Pressable style={[styles.chip, selection.kind === 'default' && styles.chipOn]} onPress={() => setSelection({ kind: 'default' })}>
                    <Text style={styles.chipText}>Default</Text>
                  </Pressable>
                </View>
                <TextInput
                  style={styles.search}
                  placeholder="Search"
                  placeholderTextColor={palette.muted}
                  value={query}
                  onChangeText={(value) => {
                    setQuery(value);
                    props.onRequestSources(value.trim());
                  }}
                />
                <ScrollView style={styles.sourceList}>
                  {(props.sources?.warnings ?? []).map((warning) => (
                    <Text key={warning} style={styles.warn}>{warning}</Text>
                  ))}
                  {rows.map((row) => {
                    const kind = tab === 'prs' ? 'pr' : tab === 'branches' ? 'branch' : 'ticket';
                    const on = selection.kind === kind && selection.ref === row.ref;
                    return (
                      <Pressable
                        key={`${kind}:${row.ref}`}
                        style={styles.menuRow}
                        onPress={() =>
                          setSelection(
                            kind === 'ticket'
                              ? { kind, ref: row.ref, title: row.title, url: row.url }
                              : { kind, ref: row.ref, title: row.title },
                          )
                        }
                      >
                        <Text style={styles.menuText} numberOfLines={2}>
                          {on ? '✓ ' : ''}
                          {kind === 'pr' ? `#${row.ref} ` : `${row.ref} `}
                          {row.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {props.sources && rows.length === 0 ? <Text style={styles.meta}>Nothing matched.</Text> : null}
                  {!props.sources ? <Text style={styles.meta}>Loading from the Mac…</Text> : null}
                </ScrollView>
              </>
            )}
          </View>
        ) : null}
        <ComposerDock
          draft={props.draft}
          placeholder={
            props.mode.kind === 'orchestration'
              ? 'Coordination goal across threads…'
              : selection.kind === 'ticket'
                ? 'Optional — leave blank to resolve the issue'
                : 'What do you want to work on?'
          }
          onChangeDraft={props.onChangeDraft}
          onSend={() =>
            props.onSubmit({
              text: props.draft.trim(),
              files: props.files,
              links: props.links,
              options: props.options,
              selection,
              cowboy,
            })
          }
          files={props.files}
          links={props.links}
          onRemoveFile={props.onRemoveFile}
          onRemoveLink={props.onRemoveLink}
          options={props.options}
          onChangeOptions={props.onChangeOptions}
          models={props.models}
          onNeedModels={props.onNeedModels}
          allowBrightsy={props.mode.kind !== 'orchestration'}
          listening={props.listening}
          onMic={props.onMic}
          onCamera={props.onCamera}
          onPhotos={props.onPhotos}
          onFiles={props.onFiles}
          allowEmpty={props.mode.kind !== 'orchestration'}
        />
      </View>
    </Modal>
  );
}

export function IssuePicker(props: {
  sources: PhoneSources | null;
  onClose: () => void;
  onPick: (row: SourceRow) => void;
  onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      <View style={styles.createScreen}>
        <View style={styles.createHead}>
          <Pressable onPress={props.onClose} hitSlop={8}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
          <Text style={styles.createTitle}>Link issue</Text>
          <View style={styles.headGap} />
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search issues"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            props.onSearch(value.trim());
          }}
        />
        <ScrollView>
          {(props.sources?.issues ?? []).map((issue) => (
            <Pressable key={issue.ref} style={styles.menuRow} onPress={() => props.onPick(issue)}>
              <Text style={styles.menuText} numberOfLines={2}>{issue.ref} {issue.title}</Text>
            </Pressable>
          ))}
          {!props.sources ? <Text style={styles.meta}>Loading from the Mac…</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, backgroundColor: palette.bg },
  box: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    backgroundColor: palette.elevated,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  input: { color: palette.text, fontSize: 16, lineHeight: 22, minHeight: 44, maxHeight: 120, padding: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipScroll: { flex: 1 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: palette.bg,
  },
  chipOn: { borderColor: palette.accent, backgroundColor: '#143044' },
  chipText: { color: palette.secondary, fontSize: 12, fontWeight: '600' },
  round: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.hover,
  },
  roundOn: { backgroundColor: '#5a1d1d' },
  roundText: { color: palette.text, fontSize: 16 },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.text,
  },
  sendOff: { opacity: 0.35 },
  sendText: { color: palette.bg, fontSize: 16, fontWeight: '700', marginTop: -1 },
  menu: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 4 },
  menuRow: { paddingVertical: 10, paddingHorizontal: 4 },
  menuText: { color: palette.text, fontSize: 15 },
  fileRow: { gap: 8 },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 180,
  },
  thumb: { width: 28, height: 28, borderRadius: 4 },
  fileName: { color: palette.secondary, fontSize: 12, flexShrink: 1 },
  fileX: { color: palette.muted, fontSize: 16 },
  banner: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: palette.elevated,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 10,
    maxHeight: '88%',
  },
  sheetTitle: { color: palette.text, fontSize: 18, fontWeight: '600' },
  sheetLabel: { color: palette.muted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modelList: { maxHeight: 160 },
  primary: {
    marginTop: 8,
    backgroundColor: palette.text,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 12,
  },
  primaryText: { color: palette.bg, fontWeight: '700', fontSize: 16 },
  createScreen: { flex: 1, backgroundColor: palette.bg, paddingTop: 54 },
  createHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  createTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 16, fontWeight: '600' },
  link: { color: palette.accent, fontSize: 16 },
  headGap: { width: 48 },
  sourceBlock: { paddingHorizontal: 16, gap: 8, maxHeight: 280 },
  sourceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selected: { color: palette.text, fontSize: 15, fontWeight: '600', flex: 1 },
  search: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    color: palette.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 16,
  },
  sourceList: { maxHeight: 160 },
  meta: { color: palette.muted, fontSize: 13, padding: 8 },
  warn: { color: '#f87171', fontSize: 12, paddingHorizontal: 4, paddingBottom: 4 },
});

import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import type { FilePathLink } from './file-link';
import { MarkdownText } from './markdown';
import { palette } from './styles';

export type PhoneViewerModel =
  | { status: 'loading'; title: string }
  | { status: 'error'; title: string; message: string }
  | {
      status: 'file';
      title: string;
      path: string;
      content: string;
      encoding: 'utf8' | 'base64';
      binary?: boolean;
      directory?: boolean;
      truncated?: boolean;
      mime?: string;
      startLine?: number;
      endLine?: number;
    }
  | {
      status: 'artifact';
      title: string;
      kind: 'html' | 'svg' | 'markdown' | 'react' | 'text';
      content: string;
      truncated?: boolean;
    };

export type PhoneViewerDecision = { handled: false } | { handled: true; viewer: PhoneViewerModel | null };

function textField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** File and artifact replies become a phone viewer. Other control messages are left alone. */
export function viewerFromPhoneReply(
  control: object,
  current: PhoneViewerModel | null,
  openingFile: boolean,
  activeChatId: string | null,
): PhoneViewerDecision {
  const record = control as Record<string, unknown>;
  const op = typeof record.op === 'string' ? record.op : '';
  const chatId = textField(record.chatId);
  const otherChat = Boolean(chatId && activeChatId && chatId !== activeChatId);
  if (op === 'file' || op === 'artifact') {
    if (otherChat) return { handled: false };
    const content = textField(record.content);
    if (content == null) return { handled: false };
    if (op === 'file') {
      const path = textField(record.path);
      if (!path) return { handled: false };
      return {
        handled: true,
        viewer: {
          status: 'file',
          title: path,
          path,
          content,
          encoding: record.encoding === 'base64' ? 'base64' : 'utf8',
          binary: record.binary === true ? true : undefined,
          directory: record.directory === true ? true : undefined,
          truncated: record.truncated === true ? true : undefined,
          mime: textField(record.mime),
          startLine: typeof record.startLine === 'number' ? record.startLine : undefined,
          endLine: typeof record.endLine === 'number' ? record.endLine : undefined,
        },
      };
    }
    const title = textField(record.title);
    if (!title) return { handled: false };
    const kind = record.kind;
    return {
      handled: true,
      viewer: {
        status: 'artifact',
        title,
        kind: kind === 'html' || kind === 'svg' || kind === 'markdown' || kind === 'react' ? kind : 'text',
        content,
        truncated: record.truncated === true ? true : undefined,
      },
    };
  }
  if (op === 'error' && openingFile && !otherChat && current?.status === 'loading') {
    const raw = textField(record.message) || '';
    const forOpen =
      raw === 'invalid phone command' ||
      raw === 'That agent is not on this Mac.' ||
      raw.startsWith('That file ') ||
      raw.startsWith('That artifact ');
    if (!forOpen) return { handled: false };
    const message =
      raw === 'invalid phone command'
        ? 'This Mac’s Sideboard app can’t open that on the phone yet. Update Sideboard on the Mac.'
        : raw || 'Could not open that.';
    return { handled: true, viewer: { status: 'error', title: current.title, message } };
  }
  return { handled: false };
}

function viewerHtml(kind: 'html' | 'svg', content: string): string {
  if (kind === 'html' || /<html[\s>]/i.test(content)) return content;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:${palette.elevated}}svg{max-width:100%;height:auto}</style></head><body>${content}</body></html>`;
}

function FileText({
  content,
  startLine,
  endLine,
}: {
  content: string;
  startLine?: number;
  endLine?: number;
}) {
  const lines = content.split('\n');
  const end = endLine ?? startLine;
  if (startLine == null || end == null || lines.length > 2500) {
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Text selectable style={styles.code}>
          {content || ' '}
        </Text>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.pad}>
      {lines.map((line, index) => {
        const n = index + 1;
        const on = n >= startLine && n <= end;
        return (
          <Text key={n} selectable style={[styles.code, on && styles.mark]}>
            {line.length ? line : ' '}
          </Text>
        );
      })}
    </ScrollView>
  );
}

function DirectoryList({
  path,
  content,
  onOpenPath,
}: {
  path: string;
  content: string;
  onOpenPath: (link: FilePathLink) => void;
}) {
  const names = content.split('\n').filter(Boolean);
  if (names.length === 0) {
    return <Text style={styles.note}>Empty folder</Text>;
  }
  return (
    <ScrollView contentContainerStyle={styles.pad}>
      {names.map((name) => {
        const more = name.startsWith('…');
        return (
          <Pressable
            key={name}
            disabled={more}
            onPress={() => onOpenPath({ path: `${path}/${name.replace(/\/+$/, '')}` })}
          >
            <Text style={[styles.code, !more && styles.dirRow]}>{name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ViewerBody({
  viewer,
  onOpenPath,
}: {
  viewer: PhoneViewerModel;
  onOpenPath: (link: FilePathLink) => void;
}) {
  if (viewer.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.accent} />
        <Text style={styles.note}>Opening…</Text>
      </View>
    );
  }
  if (viewer.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{viewer.message}</Text>
      </View>
    );
  }
  if (viewer.status === 'artifact' && (viewer.kind === 'html' || viewer.kind === 'svg')) {
    return (
      <WebView
        originWhitelist={['*']}
        source={{ html: viewerHtml(viewer.kind, viewer.content) }}
        style={styles.web}
      />
    );
  }
  if (viewer.status === 'artifact' && viewer.kind === 'markdown') {
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <MarkdownText text={viewer.content} onFileLink={onOpenPath} />
      </ScrollView>
    );
  }
  if (viewer.status === 'file' && viewer.directory) {
    return <DirectoryList path={viewer.path} content={viewer.content} onOpenPath={onOpenPath} />;
  }
  if (viewer.status === 'file' && viewer.mime === 'image/svg+xml') {
    return <WebView originWhitelist={['*']} source={{ html: viewerHtml('svg', viewer.content) }} style={styles.web} />;
  }
  if (
    viewer.status === 'file' &&
    viewer.encoding === 'base64' &&
    viewer.mime?.startsWith('image/') &&
    viewer.content.startsWith('data:')
  ) {
    return <Image source={{ uri: viewer.content }} style={styles.image} resizeMode="contain" />;
  }
  const content = viewer.content;
  return (
    <FileText
      content={content}
      startLine={viewer.status === 'file' ? viewer.startLine : undefined}
      endLine={viewer.status === 'file' ? viewer.endLine : undefined}
    />
  );
}

/** Full-screen file or artifact. The Mac sends the body; this phone draws it. */
export function PhoneViewer({
  viewer,
  onClose,
  onOpenPath,
  inline = false,
}: {
  viewer: PhoneViewerModel | null;
  onClose: () => void;
  onOpenPath: (link: FilePathLink) => void;
  /** Under the open-files row. Chat stays on the row above. */
  inline?: boolean;
}) {
  const truncated =
    viewer && viewer.status !== 'loading' && viewer.status !== 'error' && viewer.truncated
      ? viewer.status === 'artifact'
        ? 'Showing the start of this document.'
        : 'Showing the start. The rest stayed on the Mac.'
      : null;
  const body = (
    <View style={styles.screen}>
      <View style={styles.chrome}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.link}>Close</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {viewer?.title ?? ''}
        </Text>
      </View>
      {viewer?.status === 'artifact' && viewer.kind === 'react' ? <Text style={styles.caption}>React source</Text> : null}
      {truncated ? <Text style={styles.caption}>{truncated}</Text> : null}
      {viewer ? <ViewerBody viewer={viewer} onOpenPath={onOpenPath} /> : null}
    </View>
  );
  if (inline) return body;
  return (
    <Modal visible={viewer != null} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.screen}>{body}</SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  chrome: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  link: { color: palette.accent, fontSize: 14, fontWeight: '600' },
  title: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '600' },
  caption: { color: palette.muted, fontSize: 12, paddingHorizontal: 16, paddingTop: 8 },
  pad: { padding: 16, paddingBottom: 32 },
  code: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  mark: { backgroundColor: palette.accentSoft },
  dirRow: { paddingVertical: 6 },
  note: { color: palette.muted, fontSize: 14, marginTop: 12 },
  error: { color: palette.err, fontSize: 15, lineHeight: 22, textAlign: 'center', paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  web: { flex: 1, backgroundColor: palette.elevated },
  image: { flex: 1, backgroundColor: palette.elevated },
});

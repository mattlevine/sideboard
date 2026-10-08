import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { linkifyChatUrls, parseChatLink } from './chat-link';
import { fenceLanguage, highlightCode } from './code-highlight';
import { parseFilePathLink, type FilePathLink } from './file-link';
import { peekImage, watchImage } from './media-cache';
import { MermaidView } from './mermaid-view';

const text = '#ededed';
const secondary = '#c6c6c6';
const muted = '#9b9b9b';
const border = '#2e2e32';
const bg = '#121212';
const elevated = '#18191a';
const link = '#3794ff';

const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
});

/** Shimmer label. Empty while the answer itself is the live signal. */
export function streamVerb(activity: string | undefined, hasText: boolean): string {
  const trimmed = (activity ?? '').trim();
  const quiet = !trimmed || trimmed === 'Working…' || trimmed === 'Writing reply…';
  if (!hasText) return quiet ? 'Thinking' : trimmed;
  return quiet ? '' : trimmed;
}

function isWebUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:');
}

function isRemoteImage(src: string): boolean {
  return src.startsWith('https://') || src.startsWith('http://') || src.startsWith('data:image/');
}

function FileChip({ link, label }: { link: FilePathLink; label: string }) {
  return (
    <Text style={fileChip} onPress={() => fileLinkHandler?.(link)}>
      {label}
    </Text>
  );
}

function ChatImage({ src, alt }: { src: string; alt: string }) {
  const remote = isRemoteImage(src);
  const [local, setLocal] = useState<string | null | undefined>(() => (remote ? src : peekImage(src)));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (remote) return;
    return watchImage(src, setLocal);
  }, [remote, src]);
  useEffect(() => {
    if (remote || peekImage(src) !== undefined) return;
    imageRequestHandler?.(src);
  }, [remote, src]);
  const uri = remote ? src : local;
  if (!remote && local === undefined) {
    return <Text style={imageWait}>{alt.trim() || 'Image'}</Text>;
  }
  if (!uri) {
    const link = parseFilePathLink(src) ?? { path: src };
    const name = link.path.split('/').pop() || link.path;
    return (
      <Text style={fileChip} onPress={() => fileLinkHandler?.(link)}>
        {alt.trim() || name}
      </Text>
    );
  }
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={imageFrame}>
        <Image source={{ uri }} style={imageThumb} resizeMode="contain" accessibilityLabel={alt || 'Image'} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={imageScrim} onPress={() => setOpen(false)}>
          <Image source={{ uri }} style={imageFull} resizeMode="contain" />
        </Pressable>
      </Modal>
    </>
  );
}

let fileLinkHandler: ((link: FilePathLink) => void) | undefined;
let imageRequestHandler: ((src: string) => void) | undefined;

function markdownRules(streaming: boolean): RenderRules {
  return {
    fence: (node) => {
      const info = (node as { sourceInfo?: string }).sourceInfo;
      const language = fenceLanguage(info);
      const content = String(node.content ?? '').replace(/\n$/, '');
      const file = parseFilePathLink(language);
      if (file) {
        return <FileChip key={node.key} link={file} label={file.path} />;
      }
      if (language === 'mermaid') {
        if (streaming) {
          const preview = content.length > 100 ? `${content.slice(0, 100)}…` : content;
          return (
            <View key={node.key} style={fenceChrome.mermaidWait}>
              <Text style={fenceChrome.mermaidLabel}>Generating diagram…</Text>
              <Text style={fenceChrome.mermaidSource} numberOfLines={4}>
                {preview}
              </Text>
            </View>
          );
        }
        return <MermaidView key={node.key} chart={content} />;
      }
      return (
        <ScrollView
          key={node.key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={fenceChrome.scroll}
          contentContainerStyle={fenceChrome.scrollContent}
        >
          <Text style={fenceChrome.code}>{highlightCode(content, language, String(node.key))}</Text>
        </ScrollView>
      );
    },
    code_inline: (node, children, _parent, styles) => {
      const raw = String(node.content ?? '');
      const file = parseFilePathLink(raw);
      if (file) return <FileChip key={node.key} link={file} label={raw} />;
      return (
        <Text key={node.key} style={styles.code_inline}>
          {children}
        </Text>
      );
    },
    image: (node) => {
      const src = typeof node.attributes?.src === 'string' ? node.attributes.src : '';
      const alt = typeof node.attributes?.alt === 'string' ? node.attributes.alt : '';
      if (!src) return null;
      return <ChatImage key={node.key} src={src} alt={alt} />;
    },
  };
}

export function MarkdownText({
  text: source,
  tone = 'agent',
  streaming = false,
  onChatLink,
  onFileLink,
  onLocalImage,
}: {
  text: string;
  tone?: 'agent' | 'user' | 'ask';
  /** Live reply: mermaid stays a preview until the fence is finished, same as desktop. */
  streaming?: boolean;
  onChatLink?: (chatId: string) => void;
  /** Backtick paths and workspace images: the Mac opens the file. */
  onFileLink?: (link: FilePathLink) => void;
  /** Ask the Mac for a worktree image that is not already an https URL. */
  onLocalImage?: (src: string) => void;
}) {
  const onChatLinkRef = useRef(onChatLink);
  onChatLinkRef.current = onChatLink;
  fileLinkHandler = onFileLink;
  imageRequestHandler = onLocalImage;
  const onLinkPress = useCallback((url: string) => {
    const chatId = parseChatLink(url);
    if (chatId) {
      onChatLinkRef.current?.(chatId);
      return false;
    }
    if (isWebUrl(url)) return true;
    const file = parseFilePathLink(url);
    if (file) {
      fileLinkHandler?.(file);
      return false;
    }
    return false;
  }, []);
  const rules = useMemo(() => markdownRules(streaming), [streaming]);
  const body = linkifyChatUrls(source);
  if (!body.trim()) return null;
  return (
    <Markdown
      style={tone === 'user' ? userMarkdown : tone === 'ask' ? askMarkdown : agentMarkdown}
      rules={rules}
      onLinkPress={onLinkPress}
    >
      {body}
    </Markdown>
  );
}

const shared = {
  body: {
    color: text,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  text: {
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 10,
  },
  heading1: {
    color: text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    letterSpacing: -0.3,
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    color: text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600' as const,
    letterSpacing: -0.3,
    marginTop: 12,
    marginBottom: 4,
  },
  heading3: {
    color: text,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
    marginTop: 10,
    marginBottom: 4,
  },
  heading4: {
    color: text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
    marginTop: 8,
    marginBottom: 4,
  },
  heading5: {
    color: text,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
    marginTop: 8,
    marginBottom: 4,
  },
  heading6: {
    color: text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600' as const,
    marginTop: 8,
    marginBottom: 4,
  },
  strong: { color: text, fontWeight: '600' as const },
  em: { fontStyle: 'italic' as const },
  s: { color: muted, textDecorationLine: 'line-through' as const },
  link: { color: link, textDecorationLine: 'underline' as const },
  blocklink: { color: link, textDecorationLine: 'underline' as const },
  blockquote: {
    backgroundColor: 'transparent',
    borderColor: border,
    borderLeftWidth: 2,
    marginLeft: 0,
    paddingLeft: 10,
    paddingVertical: 2,
  },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  list_item: { marginBottom: 4 },
  bullet_list_icon: { color: text, marginLeft: 2, marginRight: 8, lineHeight: 26 },
  ordered_list_icon: { color: text, marginLeft: 2, marginRight: 8, lineHeight: 26 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: border, height: 1, marginVertical: 10 },
  code_inline: {
    fontFamily: mono,
    fontSize: 14,
    color: secondary,
    backgroundColor: '#0e0e0e',
    borderColor: '#262626',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 4,
  },
  code_block: {
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 18,
    color: text,
    backgroundColor: bg,
    borderColor: border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
  },
  fence: {
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 18,
    color: text,
    backgroundColor: bg,
    borderColor: border,
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  table: { borderColor: border, borderWidth: 1, borderRadius: 6 },
  th: { color: text, padding: 6, borderColor: border, fontWeight: '600' as const },
  td: { color: secondary, padding: 6, borderColor: border },
  tr: { borderColor: border },
};

const agentMarkdown = StyleSheet.create(shared);

const userMarkdown = StyleSheet.create(shared);

const fileChip = {
  color: link,
  textDecorationLine: 'underline' as const,
  fontSize: 16,
  lineHeight: 26,
};

const imageWait = { color: muted, fontSize: 13, marginBottom: 8 };
const imageFrame = { marginBottom: 10, borderRadius: 6, overflow: 'hidden' as const, backgroundColor: bg };
const imageThumb = { width: '100%' as const, height: 220, backgroundColor: bg };
const imageScrim = {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.88)',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: 16,
};
const imageFull = { width: '100%' as const, height: '80%' as const };

const fenceChrome = StyleSheet.create({
  scroll: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    backgroundColor: bg,
  },
  scrollContent: { paddingHorizontal: 12, paddingVertical: 10 },
  code: { fontFamily: mono, fontSize: 12, lineHeight: 18, color: text, alignSelf: 'flex-start' },
  mermaidWait: {
    marginBottom: 10,
    padding: 12,
    minHeight: 64,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    backgroundColor: elevated,
  },
  mermaidLabel: { color: muted, fontSize: 12, marginBottom: 6 },
  mermaidSource: { color: muted, fontSize: 11, lineHeight: 16 },
});

const askMarkdown = StyleSheet.create({
  ...shared,
  body: { ...shared.body, fontSize: 16, lineHeight: 22 },
  text: { ...shared.text, fontSize: 16, lineHeight: 22, fontWeight: '500' },
  paragraph: { marginTop: 0, marginBottom: 4 },
});

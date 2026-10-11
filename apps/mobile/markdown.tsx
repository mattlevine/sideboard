import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Markdown, { type RenderRules } from 'react-native-markdown-display';
import { linkifyChatUrls, parseChatLink } from './chat-link';
import { chatSearchQuery, highlightSegments } from './chat-search';
import { fenceLanguage, highlightCode } from './code-highlight';
import { parseFilePathLink, type FilePathLink } from './file-link';
import { imageCacheKey, peekImage, watchImage } from './media-cache';
import { MermaidView } from './mermaid-view';
import {
  agentMarkdown,
  askMarkdown,
  fenceChrome,
  fileChip,
  imageFrame,
  imageFull,
  imageScrim,
  imageThumb,
  imageWait,
  userMarkdown,
} from './markdown-styles';

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

export type ArtifactLink = { title: string; hint?: string };

function FileChip({
  link,
  onPress,
  children,
}: {
  link: FilePathLink;
  onPress?: (link: FilePathLink) => void;
  children: ReactNode;
}) {
  return (
    <Text style={fileChip} onPress={() => onPress?.(link)}>
      {children}
    </Text>
  );
}

function ArtifactChip({
  title,
  hint,
  onPress,
  children,
}: {
  title: string;
  hint?: string;
  onPress?: (artifact: ArtifactLink) => void;
  children: ReactNode;
}) {
  const artifact = hint ? { title, hint } : { title };
  return (
    <Text style={fileChip} onPress={() => onPress?.(artifact)}>
      {children}
    </Text>
  );
}

function ChatImage({
  chatId,
  src,
  alt,
  onFile,
  onRequest,
}: {
  chatId: string;
  src: string;
  alt: string;
  onFile?: (link: FilePathLink) => void;
  onRequest?: (src: string) => void;
}) {
  const remote = isRemoteImage(src);
  const key = imageCacheKey(chatId, src);
  const [local, setLocal] = useState<string | null | undefined>(() => (remote ? src : peekImage(key)));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (remote) return;
    return watchImage(key, setLocal);
  }, [remote, key]);
  useEffect(() => {
    if (remote || peekImage(key) !== undefined) return;
    onRequest?.(src);
  }, [remote, key, src, onRequest]);
  const uri = remote ? src : local;
  if (!remote && local === undefined) {
    return <Text style={imageWait}>{alt.trim() || 'Image'}</Text>;
  }
  if (!uri) {
    const link = parseFilePathLink(src) ?? { path: src };
    const name = link.path.split('/').pop() || link.path;
    return (
      <Text style={fileChip} onPress={() => onFile?.(link)}>
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

type FindPaint = { query: string; currentLocal: number; occur: { n: number } };

const findHit = { backgroundColor: '#7a5f14', color: '#fff6cc' };
const findCurrent = { backgroundColor: '#e6c200', color: '#1a1a1a' };

function paintFind(content: string, paint: FindPaint, key: string) {
  if (!chatSearchQuery(paint.query)) return content;
  const parts = highlightSegments(content, paint.query);
  if (parts.every((part) => !part.match)) return content;
  return parts.map((part, index) => {
    if (!part.match) return part.text;
    const local = paint.occur.n++;
    return (
      <Text key={`${key}-${index}`} style={local === paint.currentLocal ? findCurrent : findHit}>
        {part.text}
      </Text>
    );
  });
}

function markdownRules(
  streaming: boolean,
  chatId: string,
  onFileLink: (link: FilePathLink) => void,
  onLocalImage: (src: string) => void,
  onArtifact: (artifact: ArtifactLink) => void,
  findPaint: FindPaint,
): RenderRules {
  return {
    fence: (node) => {
      const info = (node as { sourceInfo?: string }).sourceInfo;
      const language = fenceLanguage(info);
      const content = String(node.content ?? '').replace(/\n$/, '');
      if (language === 'sb-artifact') {
        const [titleLine, hintLine] = content.split('\n');
        const title = titleLine?.trim() || 'Artifact';
        const hint = hintLine?.trim();
        return (
          <ArtifactChip key={node.key} title={title} hint={hint} onPress={onArtifact}>
            {paintFind(title, findPaint, String(node.key))}
          </ArtifactChip>
        );
      }
      const file = parseFilePathLink(language);
      if (file) {
        return (
          <FileChip key={node.key} link={file} onPress={onFileLink}>
            {paintFind(file.path, findPaint, String(node.key))}
          </FileChip>
        );
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
      const painted = paintFind(content, findPaint, String(node.key));
      return (
        <ScrollView
          key={node.key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          style={fenceChrome.scroll}
          contentContainerStyle={fenceChrome.scrollContent}
        >
          <Text style={fenceChrome.code}>
            {painted === content ? highlightCode(content, language, String(node.key)) : painted}
          </Text>
        </ScrollView>
      );
    },
    code_block: (node, _children, _parent, styles) => {
      const content = String(node.content ?? '').replace(/\n$/, '');
      return (
        <Text key={node.key} style={styles.code_block}>
          {paintFind(content, findPaint, String(node.key))}
        </Text>
      );
    },
    code_inline: (node, children, _parent, styles) => {
      const raw = String(node.content ?? '');
      const file = parseFilePathLink(raw);
      if (file) {
        return (
          <FileChip key={node.key} link={file} onPress={onFileLink}>
            {paintFind(raw, findPaint, String(node.key))}
          </FileChip>
        );
      }
      return (
        <Text key={node.key} style={styles.code_inline}>
          {raw ? paintFind(raw, findPaint, String(node.key)) : children}
        </Text>
      );
    },
    text: (node, _children, _parent, styles, inheritedStyles = {}) => (
      <Text key={node.key} style={[inheritedStyles, styles.text]}>
        {paintFind(String(node.content ?? ''), findPaint, String(node.key))}
      </Text>
    ),
    textgroup: (node, children, _parent, styles) => (
      <Text key={node.key} style={styles.textgroup}>
        {children}
      </Text>
    ),
    // Cells size to their text. A flex row with flex:1 measures that text at width 0, so only borders show.
    table: (node, children, _parent, styles) => (
      <ScrollView
        key={node.key}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.table_scroll}
      >
        <View style={styles._VIEW_SAFE_table}>{children}</View>
      </ScrollView>
    ),
    image: (node) => {
      const src = typeof node.attributes?.src === 'string' ? node.attributes.src : '';
      const alt = typeof node.attributes?.alt === 'string' ? node.attributes.alt : '';
      if (!src) return null;
      return (
        <ChatImage
          key={node.key}
          chatId={chatId}
          src={src}
          alt={alt}
          onFile={onFileLink}
          onRequest={onLocalImage}
        />
      );
    },
  };
}

export function MarkdownText({
  text: source,
  tone = 'agent',
  streaming = false,
  chatId = '',
  onChatLink,
  onFileLink,
  onLocalImage,
  onArtifact,
  findQuery = '',
  findLocal = -1,
}: {
  text: string;
  tone?: 'agent' | 'user' | 'ask';
  /** Live reply: mermaid stays a preview until the fence is finished, same as desktop. */
  streaming?: boolean;
  /** Worktree images are cached per chat, not by path alone. */
  chatId?: string;
  onChatLink?: (chatId: string) => void;
  /** Backtick paths and workspace images: the Mac opens the file. */
  onFileLink?: (link: FilePathLink) => void;
  /** Ask the Mac for a worktree image that is not already an https URL. */
  onLocalImage?: (src: string) => void;
  /** Document artifacts open on the Mac, the same way file paths do. */
  onArtifact?: (artifact: ArtifactLink) => void;
  /** Open find query. Empty leaves the prose unhighlighted. */
  findQuery?: string;
  /** Occurrence inside this bubble that is the current hit, or -1. */
  findLocal?: number;
}) {
  const onChatLinkRef = useRef(onChatLink);
  onChatLinkRef.current = onChatLink;
  const onFileLinkRef = useRef(onFileLink);
  onFileLinkRef.current = onFileLink;
  const onLocalImageRef = useRef(onLocalImage);
  onLocalImageRef.current = onLocalImage;
  const onArtifactRef = useRef(onArtifact);
  onArtifactRef.current = onArtifact;
  const findOccur = useRef({ n: 0 });
  findOccur.current.n = 0;
  const onLinkPress = useCallback((url: string) => {
    const linked = parseChatLink(url);
    if (linked) {
      onChatLinkRef.current?.(linked);
      return false;
    }
    if (isWebUrl(url)) return true;
    const file = parseFilePathLink(url);
    if (file) {
      onFileLinkRef.current?.(file);
      return false;
    }
    return false;
  }, []);
  const rules = useMemo(
    () =>
      markdownRules(
        streaming,
        chatId,
        (link) => onFileLinkRef.current?.(link),
        (src) => onLocalImageRef.current?.(src),
        (artifact) => onArtifactRef.current?.(artifact),
        { query: findQuery, currentLocal: findLocal, occur: findOccur.current },
      ),
    [streaming, chatId, findQuery, findLocal],
  );
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


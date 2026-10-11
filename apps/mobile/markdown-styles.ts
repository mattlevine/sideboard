import { Platform, StyleSheet } from 'react-native';

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

const shared = {
  body: {
    color: text,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  text: {
    color: text,
    fontSize: 16,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  textgroup: {
    color: text,
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
  table_scroll: { marginBottom: 10, alignSelf: 'stretch' as const },
  table: { borderColor: border, borderWidth: 1, borderRadius: 6 },
  th: {
    flex: 0,
    color: text,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderColor: border,
    fontWeight: '600' as const,
  },
  td: {
    flex: 0,
    color: secondary,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderColor: border,
  },
  tr: { borderColor: border },
};

export const agentMarkdown = StyleSheet.create(shared);

export const userMarkdown = StyleSheet.create(shared);

export const fileChip = {
  color: link,
  textDecorationLine: 'underline' as const,
  fontSize: 16,
  lineHeight: 26,
};

export const imageWait = { color: muted, fontSize: 13, marginBottom: 8 };
export const imageFrame = { marginBottom: 10, borderRadius: 6, overflow: 'hidden' as const, backgroundColor: bg };
export const imageThumb = { width: '100%' as const, height: 220, backgroundColor: bg };
export const imageScrim = {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.88)',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  padding: 16,
};
export const imageFull = { width: '100%' as const, height: '80%' as const };

export const fenceChrome = StyleSheet.create({
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

export const askMarkdown = StyleSheet.create({
  ...shared,
  body: { ...shared.body, fontSize: 16, lineHeight: 22 },
  text: { ...shared.text, fontSize: 16, lineHeight: 22, fontWeight: '500' },
  paragraph: { marginTop: 0, marginBottom: 4 },
});

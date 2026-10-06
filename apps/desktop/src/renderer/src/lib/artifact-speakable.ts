import type { ChatArtifact } from './artifacts';

/** Plain text for TTS — strip markup so HTML/React/SVG artifacts are speakable. */
export function stripMarkupForSpeech(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function artifactSpeakableText(artifact: ChatArtifact): string {
  const raw = artifact.content ?? '';
  if (artifact.kind === 'html' || artifact.kind === 'react' || artifact.kind === 'svg') {
    return stripMarkupForSpeech(raw);
  }
  return raw.trim();
}

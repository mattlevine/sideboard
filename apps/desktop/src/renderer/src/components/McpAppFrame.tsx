import { useEffect, useRef, useState } from 'react';
import type { AgentKind, MessagePart } from '@sideboard-ai/core';
import {
  agentTextToCallToolResult,
  embeddedMcpUiFromText,
  guestBridgeEffects,
  legacyAck,
  legacyResponse,
  mcpUiContentSecurityPolicy,
  mcpUiFrameId,
  resourceTeardownRequest,
  rpcError,
  rpcResult,
  toolInputNotification,
  toolResultNotification,
  type McpUiView,
} from '@sideboard/mcp-ui';

type ToolPart = Extract<MessagePart, { type: 'tool' }>;

function ToolOutputTail({ text, live }: { text: string; live: boolean }) {
  const preRef = useRef<HTMLPreElement>(null);
  const pinToEnd = useRef(true);
  useEffect(() => {
    const el = preRef.current;
    if (!el || !pinToEnd.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={preRef}
      className={`turn-tool-tail${live ? ' live' : ''}`}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
    >
      {text.length <= 12000 ? text : `…${text.slice(-12000)}`}
    </pre>
  );
}

export function ToolRowFooter({
  showTail,
  result,
  agent,
  part,
  threadId,
}: {
  showTail: boolean;
  result?: string;
  agent?: AgentKind;
  part: ToolPart;
  threadId?: string;
}) {
  const app = agent === 'claude' && part.status !== 'running' && part.name.startsWith('mcp__');
  if (!showTail && !app) return null;
  return (
    <>
      {showTail && result ? <ToolOutputTail text={result} live /> : null}
      {app ? (
        <McpAppFrame
          toolCallId={part.id}
          toolName={part.name}
          input={part.input}
          result={part.result}
          isError={part.status === 'error'}
          threadId={threadId}
        />
      ) : null}
    </>
  );
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 720;
const PREVIEW_CLEAR_MS = 250;
const pendingPreviewClears = new Map<string, ReturnType<typeof window.setTimeout>>();

function cancelPreviewClear(frameId: string) {
  const timer = pendingPreviewClears.get(frameId);
  if (timer == null) return;
  window.clearTimeout(timer);
  pendingPreviewClears.delete(frameId);
}

function schedulePreviewClear(frameId: string) {
  cancelPreviewClear(frameId);
  pendingPreviewClears.set(
    frameId,
    window.setTimeout(() => {
      pendingPreviewClears.delete(frameId);
      void window.sideboard.clearMcpUiPreview(frameId);
    }, PREVIEW_CLEAR_MS),
  );
}

type Props = {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  result?: string;
  isError: boolean;
  threadId?: string;
};

export function McpAppFrame({ toolCallId, toolName, input, result, isError, threadId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [height, setHeight] = useState(280);
  const viewRef = useRef<McpUiView | null>(null);

  useEffect(() => {
    const frameId = mcpUiFrameId(toolCallId);
    cancelPreviewClear(frameId);
    if (!toolName.startsWith('mcp__')) return;
    let cancelled = false;
    void loadView(toolName, result, threadId)
      .then(async (view) => {
        if (cancelled || !view) return;
        viewRef.current = view;
        const published = await window.sideboard.publishMcpUiPreview(frameId, view.html, view.csp);
        if (!cancelled) setUrl(published.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      iframeRef.current?.contentWindow?.postMessage(
        resourceTeardownRequest(`td-${frameId}`, 'unmount'),
        '*',
      );
      schedulePreviewClear(frameId);
    };
  }, [toolCallId, toolName, result]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !url) return;
    let ready = false;
    const post = (message: Record<string, unknown>) => {
      iframe.contentWindow?.postMessage(message, '*');
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const effects = guestBridgeEffects(event.data, hostContext(iframe));
      for (const effect of effects) {
        if (effect.type === 'reply') post(effect.message);
        else if (effect.type === 'ready' && !ready) {
          ready = true;
          post(toolInputNotification(input));
          post(toolResultNotification(agentTextToCallToolResult(result, isError)));
        } else if (effect.type === 'resize' && effect.height != null) {
          setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(effect.height))));
        } else if (effect.type === 'open-link') {
          void window.sideboard.openExternal(effect.url).then(
            () => post(rpcResult(effect.id, {})),
            () => post(rpcError(effect.id, 'Link opening denied')),
          );
        } else if (effect.type === 'chat') {
          if (!threadId) {
            post(rpcError(effect.id, 'Message sending denied'));
            continue;
          }
          void window.sideboard.sendToThread(threadId, effect.text).then(
            () => post(rpcResult(effect.id, {})),
            () => post(rpcError(effect.id, 'Message sending denied')),
          );
        } else if (effect.type === 'update-context') {
          if (!threadId) {
            post(rpcError(effect.id, 'Context update denied'));
            continue;
          }
          void window.sideboard.mcpUiUpdateModelContext(threadId, effect.text).then(
            () => post(rpcResult(effect.id, {})),
            () => post(rpcError(effect.id, 'Context update denied')),
          );
        } else if (effect.type === 'call-tool' || effect.type === 'read-resource') {
          const server = viewRef.current?.server;
          if (!server) {
            post(rpcError(effect.id, 'MCP server is not connected'));
            continue;
          }
          const pending =
            effect.type === 'call-tool'
              ? window.sideboard.mcpUiCallTool(server, effect.name, effect.args, threadId)
              : window.sideboard.mcpUiReadResource(server, effect.uri, threadId);
          void pending.then(
            (value) => post(rpcResult(effect.id, value)),
            (err) => post(rpcError(effect.id, err instanceof Error ? err.message : 'Request failed')),
          );
        } else if (effect.type === 'legacy-call-tool') {
          if (effect.messageId) post(legacyAck(effect.messageId));
          const server = viewRef.current?.server;
          if (!server) {
            if (effect.messageId) post(legacyResponse(effect.messageId, undefined, { message: 'MCP server is not connected' }));
            continue;
          }
          void window.sideboard.mcpUiCallTool(server, effect.name, effect.args, threadId).then(
            (value) => {
              if (effect.messageId) post(legacyResponse(effect.messageId, value));
            },
            (err) => {
              if (effect.messageId) {
                post(legacyResponse(effect.messageId, undefined, { message: err instanceof Error ? err.message : 'Request failed' }));
              }
            },
          );
        } else if (effect.type === 'legacy-chat' && threadId) {
          void window.sideboard.sendToThread(threadId, effect.text);
        } else if (effect.type === 'legacy-link') {
          void window.sideboard.openExternal(effect.url);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url, input, result, isError, threadId]);

  if (!url) return null;
  return (
    <iframe
      ref={iframeRef}
      className="mcp-app-frame"
      title={toolName}
      sandbox="allow-scripts allow-forms allow-same-origin"
      style={{ height }}
      src={url}
    />
  );
}

async function loadView(
  toolName: string,
  result: string | undefined,
  threadId?: string,
): Promise<McpUiView | null> {
  const remote = await window.sideboard.mcpUiLookup(toolName, threadId);
  if (remote) return remote;
  const embedded = embeddedMcpUiFromText(result);
  if (!embedded) return null;
  return {
    server: '',
    tool: toolName,
    uri: embedded.uri,
    mimeType: embedded.mimeType,
    html: embedded.html,
    csp: mcpUiContentSecurityPolicy(embedded.csp),
  };
}

function hostContext(iframe: HTMLIFrameElement): Record<string, unknown> {
  const style = getComputedStyle(document.documentElement);
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    theme: dark ? 'dark' : 'light',
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    platform: 'desktop',
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    containerDimensions: {
      maxWidth: Math.max(320, Math.round(iframe.clientWidth || 640)),
      maxHeight: MAX_HEIGHT,
    },
    styles: {
      variables: {
        '--color-background-primary': style.getPropertyValue('--bg').trim() || undefined,
        '--color-text-primary': style.getPropertyValue('--text').trim() || undefined,
      },
    },
  };
}

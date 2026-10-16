import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import WebView from 'react-native-webview';

export type PhoneMcpAppRef = { id: string; tool: string };

export type PhoneMcpUiControl =
  | { op: 'mcp-ui'; chatId: string; reqId: string; view?: unknown }
  | { op: 'mcp-ui-call'; chatId: string; reqId: string; result?: unknown; error?: string }
  | { op: 'mcp-ui-read'; chatId: string; reqId: string; result?: unknown; error?: string };

type McpView = {
  server: string;
  tool: string;
  html: string;
  csp: string;
  input: Record<string, unknown>;
  resultText: string;
  isError: boolean;
};

type Reply = {
  op?: string;
  reqId?: string;
  view?: McpView | null;
  result?: unknown;
  error?: string;
};

const waiters = new Map<string, (reply: Reply) => void>();

export function deliverPhoneMcpUi(control: { op?: string; reqId?: string }): boolean {
  if (control.op !== 'mcp-ui' && control.op !== 'mcp-ui-call' && control.op !== 'mcp-ui-read') return false;
  const wait = control.reqId ? waiters.get(control.reqId) : undefined;
  if (wait && control.reqId) {
    waiters.delete(control.reqId);
    wait(control as Reply);
  }
  return true;
}

function ask(send: (payload: object) => void, payload: { reqId: string }): Promise<Reply | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (waiters.get(payload.reqId)) {
        waiters.delete(payload.reqId);
        resolve(null);
      }
    }, 20_000);
    waiters.set(payload.reqId, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });
    send(payload);
  });
}

export function PhoneMcpApps({
  apps,
  chatId,
  send,
}: {
  apps: PhoneMcpAppRef[];
  chatId: string;
  send: (payload: object) => void;
}) {
  return (
    <View>
      {apps.map((app) => (
        <PhoneMcpApp key={app.id} app={app} chatId={chatId} send={send} />
      ))}
    </View>
  );
}

function PhoneMcpApp({
  app,
  chatId,
  send,
}: {
  app: PhoneMcpAppRef;
  chatId: string;
  send: (payload: object) => void;
}) {
  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [height, setHeight] = useState(280);
  const serverRef = useRef('');

  useEffect(() => {
    const reqId = `ui-${app.id}`.slice(0, 40);
    let cancel = false;
    void ask(send, { op: 'mcp-ui', chatId, tool: app.tool, callId: app.id, reqId }).then((reply) => {
      if (cancel || !reply?.view) return;
      serverRef.current = reply.view.server;
      setHtml(shellHtml(reply.view));
    });
    return () => {
      cancel = true;
    };
  }, [app.id, app.tool, chatId, send]);

  if (!html) return null;
  return (
    <View style={{ height, marginTop: 8, borderRadius: 8, overflow: 'hidden' }}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        scrollEnabled={false}
        onMessage={(event) => {
          void onGuest(event.nativeEvent.data, {
            chatId,
            send,
            server: serverRef.current,
            webRef,
            setHeight,
          });
        }}
      />
    </View>
  );
}

async function onGuest(
  raw: string,
  ctx: {
    chatId: string;
    send: (payload: object) => void;
    server: string;
    webRef: { current: WebView | null };
    setHeight: (height: number) => void;
  },
) {
  let msg: {
    kind?: string;
    id?: string | number;
    name?: string;
    args?: Record<string, unknown>;
    uri?: string;
    url?: string;
    text?: string;
    height?: number;
    messageId?: string;
  };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }
  const post = (body: object) => ctx.webRef.current?.postMessage(JSON.stringify(body));
  if (msg.kind === 'height' && typeof msg.height === 'number') {
    ctx.setHeight(Math.min(640, Math.max(120, Math.round(msg.height))));
    return;
  }
  if (msg.kind === 'link' && msg.url && /^https?:\/\//.test(msg.url)) {
    await Linking.openURL(msg.url).catch(() => undefined);
    if (msg.id != null) post({ kind: 'rpc', id: msg.id, result: {} });
    return;
  }
  if (msg.kind === 'chat' && msg.text?.trim()) {
    ctx.send({ op: 'prompt', chatId: ctx.chatId, text: msg.text.trim().slice(0, 8000) });
    if (msg.id != null) post({ kind: 'rpc', id: msg.id, result: {} });
    return;
  }
  if (!ctx.server) return;
  if (msg.kind === 'call' && msg.name && msg.id != null) {
    const reqId = `call-${String(msg.id)}`.slice(0, 40);
    const reply = await ask(ctx.send, {
      op: 'mcp-ui-call',
      chatId: ctx.chatId,
      reqId,
      server: ctx.server,
      tool: msg.name,
      args: msg.args ?? {},
    });
    post({ kind: 'rpc', id: msg.id, result: reply?.result, error: reply?.error });
    return;
  }
  if (msg.kind === 'legacy-call' && msg.name) {
    const reqId = `leg-${msg.messageId ?? msg.name}`.slice(0, 40);
    const reply = await ask(ctx.send, {
      op: 'mcp-ui-call',
      chatId: ctx.chatId,
      reqId,
      server: ctx.server,
      tool: msg.name,
      args: msg.args ?? {},
    });
    post({
      kind: 'rpc',
      legacyMessageId: msg.messageId,
      result: reply?.result,
      error: reply?.error,
    });
    return;
  }
  if (msg.kind === 'read' && msg.uri && msg.id != null) {
    const reqId = `read-${String(msg.id)}`.slice(0, 40);
    const reply = await ask(ctx.send, {
      op: 'mcp-ui-read',
      chatId: ctx.chatId,
      reqId,
      server: ctx.server,
      uri: msg.uri,
    });
    post({ kind: 'rpc', id: msg.id, result: reply?.result, error: reply?.error });
  }
}

function shellHtml(view: McpView): string {
  const csp = view.csp.replace(/"/g, '');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const appHtml = /<head[^>]*>/i.test(view.html)
    ? view.html.replace(/<head[^>]*>/i, (tag) => `${tag}${meta}`)
    : `<!DOCTYPE html><html><head>${meta}</head><body>${view.html}</body></html>`;
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#121212">
<iframe id="app" sandbox="allow-scripts allow-forms allow-same-origin" style="border:0;width:100%;height:100vh"></iframe>
<script>
const APP_HTML = ${JSON.stringify(appHtml)};
const INPUT = ${JSON.stringify(view.input ?? {})};
const RESULT_TEXT = ${JSON.stringify(view.resultText ?? '')};
const IS_ERROR = ${view.isError ? 'true' : 'false'};
const frame = document.getElementById('app');
frame.srcdoc = APP_HTML;
function post(msg) { if (frame.contentWindow) frame.contentWindow.postMessage(msg, '*'); }
function reply(id, result, error) {
  post(error ? { jsonrpc: '2.0', id: id, error: { code: -32000, message: String(error) } }
    : { jsonrpc: '2.0', id: id, result: result === undefined ? {} : result });
}
function send(payload) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
}
let ready = false;
window.addEventListener('message', function (event) {
  if (event.source !== frame.contentWindow) {
    if (typeof event.data === 'string') fromHost(event.data);
    return;
  }
  const msg = event.data || {};
  const id = msg.id;
  const params = msg.params || {};
  if (msg.jsonrpc === '2.0' && msg.method === 'ui/initialize' && id != null) {
    reply(id, {
      protocolVersion: '2026-01-26',
      hostInfo: { name: 'sideboard-phone', version: '1.0.0' },
      hostCapabilities: { openLinks: {}, serverTools: {}, serverResources: {} },
      hostContext: { theme: 'dark', displayMode: 'inline', platform: 'mobile', containerDimensions: { maxWidth: window.innerWidth || 390, maxHeight: 640 } }
    });
    return;
  }
  if (msg.method === 'ui/notifications/initialized' && !ready) {
    ready = true;
    var structured;
    try {
      var parsed = JSON.parse(RESULT_TEXT);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) structured = parsed;
    } catch (e) {}
    post({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: INPUT } });
    post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: Object.assign(
      { content: [{ type: 'text', text: RESULT_TEXT }] },
      structured ? { structuredContent: structured } : {},
      IS_ERROR ? { isError: true } : {}
    ) });
    return;
  }
  if (msg.method === 'ui/notifications/size-changed') { send({ kind: 'height', height: params.height }); return; }
  if (msg.method === 'tools/call' && id != null) { send({ kind: 'call', id: id, name: params.name, args: params.arguments || {} }); return; }
  if (msg.method === 'resources/read' && id != null) { send({ kind: 'read', id: id, uri: params.uri }); return; }
  if (msg.method === 'ui/open-link' && id != null) { send({ kind: 'link', id: id, url: params.url }); return; }
  if (msg.method === 'ui/message' && id != null) {
    send({ kind: 'chat', id: id, text: (params.content && params.content.text) || params.text || '' });
    return;
  }
  if (msg.method === 'ping' && id != null) { reply(id, {}); return; }
  if (msg.type === 'tool' && msg.payload && msg.payload.toolName) {
    send({ kind: 'legacy-call', messageId: msg.messageId, name: msg.payload.toolName, args: msg.payload.params || {} });
  }
});
function fromHost(raw) {
  var data = raw;
  if (typeof raw === 'string') { try { data = JSON.parse(raw); } catch (e) { return; } }
  if (!data || data.kind !== 'rpc') return;
  if (data.legacyMessageId) {
    post({ type: 'ui-message-response', messageId: data.legacyMessageId, payload: data.error ? { error: { message: data.error } } : { response: data.result } });
    return;
  }
  reply(data.id, data.result, data.error);
}
document.addEventListener('message', function (e) { fromHost(e.data); });
</script></body></html>`;
}

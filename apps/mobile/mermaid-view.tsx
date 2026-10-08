import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';

const border = '#2e2e32';
const elevated = '#18191a';
const muted = '#9b9b9b';
const err = '#f87171';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function diagramHtml(chart: string): string {
  const source = escapeHtml(chart);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; background: ${elevated}; color: ${muted}; }
  #out { display: flex; justify-content: center; padding: 8px; }
  svg { max-width: 100%; height: auto; }
</style>
</head>
<body>
<pre class="mermaid">${source}</pre>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js"></script>
<script>
  function send(payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      suppressErrorRendering: true
    });
    mermaid.run({ querySelector: '.mermaid' }).then(function () {
      send({ height: Math.ceil(document.body.scrollHeight) });
    }).catch(function (error) {
      send({ error: String(error && error.message ? error.message : error) });
    });
  } catch (error) {
    send({ error: String(error && error.message ? error.message : error) });
  }
</script>
</body>
</html>`;
}

/** Finished ```mermaid fence. While the reply is still streaming, the caller shows the source. */
export function MermaidView({ chart }: { chart: string }) {
  const html = useMemo(() => diagramHtml(chart), [chart]);
  const [height, setHeight] = useState(160);
  const [error, setError] = useState<string | null>(null);
  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>Couldn’t draw this diagram</Text>
        <Text style={styles.source} numberOfLines={6}>
          {chart}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.frame, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://cdn.jsdelivr.net' }}
        scrollEnabled={false}
        style={styles.web}
        onMessage={(event) => {
          try {
            const payload = JSON.parse(event.nativeEvent.data) as { height?: number; error?: string };
            if (payload.error) {
              setError(payload.error);
              return;
            }
            if (typeof payload.height === 'number' && payload.height > 0) {
              setHeight(Math.min(560, Math.max(88, payload.height + 8)));
            }
          } catch {
            setError('Couldn’t draw this diagram');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: border,
    borderRadius: 6,
    backgroundColor: elevated,
    overflow: 'hidden',
  },
  web: { flex: 1, backgroundColor: elevated },
  errorBox: {
    marginBottom: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#5c3030',
    borderRadius: 6,
    backgroundColor: '#2a1616',
  },
  errorTitle: { color: err, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  source: { color: muted, fontSize: 11, lineHeight: 16 },
});

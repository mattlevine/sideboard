/**
 * Browser page after an OAuth redirect on the relay (git hosts and Slack).
 * Self-contained so relay.sideboard.build matches the marketing site
 * (dark ground, blue mark) without serving site CSS.
 */
export function oauthReturnPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #09090b;
    --card: #16171b;
    --line: rgba(255, 255, 255, 0.08);
    --text: #f4f5f7;
    --muted: #9aa3ad;
    --blue: #3b9eff;
    --blue-fill: #0f7ed4;
  }
  * { box-sizing: border-box }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 48px 24px;
    background:
      radial-gradient(closest-side, rgba(15, 126, 212, 0.22), transparent 72%) center -120px / 720px 480px no-repeat,
      var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main {
    width: min(28rem, 100%);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 28px 28px 32px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 22px;
    font-weight: 650;
    font-size: 17px;
    letter-spacing: -0.02em;
  }
  .mark { position: relative; display: inline-block; width: 26px; height: 26px; flex: none }
  .mark i { position: absolute; width: 18px; height: 18px; border-radius: 3px; transform: rotate(14deg) }
  .mark i:first-child { left: 6px; top: 6px; background: var(--blue-fill) }
  .mark i:last-child { left: 1px; top: 1px; border: 2px solid #d7dbdf }
  h1 { margin: 0; font-size: 1.5rem; line-height: 1.2; letter-spacing: -0.03em; font-weight: 650 }
  p { margin: 10px 0 0; line-height: 1.55; color: var(--muted) }
  strong { color: var(--text); font-weight: 650 }
  a { color: var(--blue) }
</style>
</head>
<body>
<main>
  <div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i></span>Sideboard</div>
  ${body}
</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

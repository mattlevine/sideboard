#!/usr/bin/env python3
"""Render site/docs/_src/*.md into static HTML with marketing chrome."""

from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "site" / "docs" / "_src"
DL = "https://download.sideboard.cloud/Sideboard-latest-arm64.dmg"

PAGES = {
    "agents.md": {
        "out": "agents/index.html",
        "title": "Agents — Sideboard",
        "description": "Install Claude Code, Codex, OpenCode, and Cursor for Sideboard.",
        "h1": "Agents",
    },
    "remote.md": {
        "out": "remote/index.html",
        "title": "Remote integrations — Sideboard",
        "description": "Settings map, Slack relay, connectors, and what leaves the Mac.",
        "h1": "Remote integrations",
    },
    "skills.md": {
        "out": "skills/index.html",
        "title": "Process skills — Sideboard",
        "description": "Recurring guides in .claude/skills so Claude Code and attach load them.",
        "h1": "Process skills",
    },
    "compare.md": {
        "out": "compare/index.html",
        "title": "Compare — Sideboard",
        "description": "Sideboard vs Conductor, Cursor, and other local boards.",
        "h1": "Compare",
    },
    "security.md": {
        "out": "security/index.html",
        "title": "Security — Sideboard",
        "description": "Where credentials live, what the relay sees, and how to report issues.",
        "h1": "Security",
    },
}


def inline(text: str) -> str:
    parts: list[str] = []
    i = 0
    pattern = re.compile(
        r"(`+)(.+?)\1|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*"
    )
    for m in pattern.finditer(text):
        parts.append(html.escape(text[i : m.start()]))
        if m.group(1):
            parts.append(f"<code>{html.escape(m.group(2))}</code>")
        elif m.group(3) is not None:
            href = html.escape(m.group(4), quote=True)
            parts.append(f'<a href="{href}">{html.escape(m.group(3))}</a>')
        elif m.group(5) is not None:
            parts.append(f"<strong>{html.escape(m.group(5))}</strong>")
        else:
            parts.append(f"<em>{html.escape(m.group(6))}</em>")
        i = m.end()
    parts.append(html.escape(text[i:]))
    return "".join(parts)


def md_to_html(md: str) -> str:
    lines = md.splitlines()
    # drop leading H1 — chrome already has the title
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
        if lines and not lines[0].strip():
            lines = lines[1:]

    out: list[str] = []
    i = 0
    in_ul = False
    in_ol = False
    in_table = False

    def close_lists() -> None:
        nonlocal in_ul, in_ol
        if in_ul:
            out.append("</ul>")
            in_ul = False
        if in_ol:
            out.append("</ol>")
            in_ol = False

    def close_table() -> None:
        nonlocal in_table
        if in_table:
            out.append("</tbody></table>")
            in_table = False

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            close_lists()
            close_table()
            fence = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                fence.append(lines[i])
                i += 1
            i += 1
            out.append(
                "<pre><code>"
                + html.escape("\n".join(fence))
                + "</code></pre>"
            )
            continue

        if re.match(r"^\|", line):
            close_lists()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            body = [r for r in rows if not re.match(r"^\|\s*[-: ]+\|", r)]
            if not body:
                continue
            def cells(row: str) -> list[str]:
                return [c.strip() for c in row.strip().strip("|").split("|")]
            header = cells(body[0])
            out.append("<table><thead><tr>")
            for c in header:
                out.append(f"<th>{inline(c) if c else '&nbsp;'}</th>")
            out.append("</tr></thead><tbody>")
            for row in body[1:]:
                out.append("<tr>")
                for c in cells(row):
                    out.append(f"<td>{inline(c) if c else '&nbsp;'}</td>")
                out.append("</tr>")
            out.append("</tbody></table>")
            continue

        m = re.match(r"^(#{2,3})\s+(.*)$", line)
        if m:
            close_lists()
            close_table()
            level = len(m.group(1))
            out.append(f"<h{level}>{inline(m.group(2))}</h{level}>")
            i += 1
            continue

        m = re.match(r"^[-*]\s+(.*)$", line)
        if m:
            close_table()
            if not in_ul:
                close_lists()
                out.append("<ul>")
                in_ul = True
            out.append(f"<li>{inline(m.group(1))}</li>")
            i += 1
            continue

        m = re.match(r"^(\d+)\.\s+(.*)$", line)
        if m:
            close_table()
            if not in_ol:
                close_lists()
                out.append("<ol>")
                in_ol = True
            out.append(f"<li>{inline(m.group(2))}</li>")
            i += 1
            continue

        if not line.strip():
            close_lists()
            close_table()
            i += 1
            continue

        close_lists()
        close_table()
        out.append(f"<p>{inline(line)}</p>")
        i += 1

    close_lists()
    close_table()
    return "\n".join(out)


def page(meta: dict, body: str) -> str:
    title = html.escape(meta["title"])
    desc = html.escape(meta["description"])
    h1 = html.escape(meta["h1"])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:type" content="website">
<meta property="og:url" content="https://www.sideboard.cloud/docs/">
<meta property="og:image" content="https://www.sideboard.cloud/desktop.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.png">
<style>html{{scroll-padding-top:84px}}body{{margin:0;background:#17181a;color:#edf0f3;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}}::selection{{background:rgba(15,126,212,.35)}}a{{color:#57aeee}}a:hover{{color:#8cc8f5}}:focus-visible{{outline:2px solid #0f7ed4;outline-offset:2px}}code,pre{{font-family:ui-monospace,"SF Mono",Menlo,monospace}}article h2{{font-weight:700;font-size:28px;letter-spacing:-.02em;margin:40px 0 12px}}article h3{{font-weight:700;font-size:20px;margin:28px 0 10px}}article p{{font-size:16.5px;line-height:1.65;color:#b3bcc4;margin:0 0 14px}}article li{{font-size:16.5px;line-height:1.6;color:#b3bcc4;margin:0 0 8px}}article ul,article ol{{margin:0 0 18px;padding-left:22px}}article pre{{margin:0 0 18px;padding:20px;border-radius:18px;background:#0e0f11;border:1px solid #2c3036;color:#dfe5ea;font-size:14px;line-height:1.8;overflow-x:auto}}article code{{font-size:13.5px;color:#8cc8f5}}article pre code{{color:#dfe5ea}}article table{{width:100%;border-collapse:collapse;margin:0 0 22px;font-size:14.5px}}article th,article td{{text-align:left;padding:10px 12px;border:1px solid #2c3036;vertical-align:top;color:#b3bcc4}}article th{{color:#edf0f3;background:#202226}}</style>
<style>.nav-link:hover{{color:#edf0f3}}.btn-blue:hover{{background:#2a95e6}}</style>
</head>
<body>
<header style="position:sticky;top:0;z-index:50;background:#17181a;border-bottom:1px solid #26292d">
<div style="display:flex;align-items:center;gap:26px;padding:18px 40px;max-width:1180px;margin:0 auto;flex-wrap:wrap">
<a href="/" style="display:flex;align-items:center;gap:11px;margin-right:auto;text-decoration:none;color:#edf0f3">
<span style="position:relative;display:inline-block;width:28px;height:28px;flex:none">
<span style="position:absolute;left:7px;top:7px;width:19px;height:19px;border-radius:3px;background:#0f7ed4;transform:rotate(14deg)"></span>
<span style="position:absolute;left:2px;top:2px;width:19px;height:19px;border-radius:3px;border:2px solid #d7dbdf;transform:rotate(14deg)"></span>
</span>
<span style="font-weight:700;font-size:21px;letter-spacing:-.01em">Sideboard</span>
</a>
<a href="/" style="color:#c3cad1;text-decoration:none;font-size:15px" class="nav-link">Home</a>
<a href="/docs/" style="color:#c3cad1;text-decoration:none;font-size:15px" class="nav-link">Docs</a>
<a href="/slack/" style="color:#c3cad1;text-decoration:none;font-size:15px" class="nav-link">Slack</a>
<a href="{DL}" style="display:inline-flex;align-items:center;padding:9px 20px;border-radius:999px;background:#0f7ed4;color:#fff;text-decoration:none;font-weight:700;font-size:14px" class="btn-blue">Download for Mac</a>
</div>
</header>
<div style="max-width:800px;margin:0 auto;padding:56px 40px 110px">
<p style="margin:0 0 8px"><a href="/docs/" style="color:#8b949c;text-decoration:none;font-size:14px">← Docs</a></p>
<h1 style="font-weight:700;font-size:44px;line-height:1.1;letter-spacing:-.02em;margin:0 0 24px">{h1}</h1>
<article>
{body}
</article>
</div>
<footer style="border-top:1px solid #26292d">
<div style="max-width:1180px;margin:0 auto;padding:36px 40px;display:flex;flex-wrap:wrap;align-items:center;gap:22px">
<span style="font-weight:700;font-size:16px;margin-right:auto">sideboard.cloud</span>
<a href="/docs/" style="color:#8b949c;text-decoration:none;font-size:14px" class="nav-link">Docs</a>
<a href="/slack/" style="color:#8b949c;text-decoration:none;font-size:14px" class="nav-link">Slack</a>
<a href="/privacy/" style="color:#8b949c;text-decoration:none;font-size:14px" class="nav-link">Privacy</a>
<a href="/support/" style="color:#8b949c;text-decoration:none;font-size:14px" class="nav-link">Support</a>
<a href="https://www.npmjs.com/package/@sideboard-ai/cli" style="color:#8b949c;text-decoration:none;font-size:14px" class="nav-link">npm</a>
</div>
</footer>
</body>
</html>
"""


def main() -> None:
    for name, meta in PAGES.items():
        md = (SRC / name).read_text()
        dest = ROOT / "site" / "docs" / meta["out"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(page(meta, md_to_html(md)))
        print(dest.relative_to(ROOT))


if __name__ == "__main__":
    main()

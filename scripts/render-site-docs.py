#!/usr/bin/env python3
"""Render site/docs/_src/*.md into static HTML with marketing chrome."""

from __future__ import annotations

import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "site" / "docs" / "_src"
# Public Tigris host (custom domain download.sideboard.cloud CNAME is live;
# TLS on that hostname is not issued yet).
DL = "https://sideboard-downloads.t3.tigrisfiles.io/Sideboard-latest-arm64.dmg"

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
        "description": "Settings map, phone remote, connectors, and what leaves the Mac.",
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
        "description": "Sideboard vs Conductor, Orca, Cursor, and other local boards.",
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
<link rel="stylesheet" href="/styles.css?v=20261004-2">
</head>
<body>
<header class="nav">
<div class="nav-inner">
<a class="brand" href="/"><span class="mark" aria-hidden="true"><i></i><i></i></span>Sideboard</a>
<nav class="nav-links">
<a href="/docs/">Docs</a>
<a href="/docs/compare/">Compare</a>
<a href="/slack/">Slack</a>
<a href="https://github.com/mattlevine/sideboard" target="_blank" rel="noopener">GitHub</a>
</nav>
<a class="btn btn-primary btn-sm" href="{DL}">Download for Mac</a>
</div>
</header>
<div class="page">
<p style="margin:0 0 8px"><a class="back" href="/docs/">← Docs</a></p>
<h1>{h1}</h1>
<article>
{body}
</article>
</div>
<footer class="foot">
<div class="foot-inner">
<a class="brand" href="/"><span class="mark mark-sm" aria-hidden="true"><i></i><i></i></span>sideboard.cloud</a>
<nav>
<a href="/docs/">Docs</a>
<a href="/docs/compare/">Compare</a>
<a href="/slack/">Slack</a>
<a href="/privacy/">Privacy</a>
<a href="/support/">Support</a>
<a href="https://www.npmjs.com/package/@sideboard-ai/cli">npm</a>
</nav>
<span class="muted">Apache-2.0</span>
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

"""Tiny Markdown -> HTML converter (headings, lists, tables, code, bold/italic/links) so the concept docs
and the faculty handout can be opened and printed from the browser with no extra dependency."""
import html
import re

CSS = """
:root{color-scheme:light dark}
body{font:15px/1.6 'Segoe UI',system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 20px;color:#1e293b;background:#fff}
h1,h2,h3{line-height:1.25;margin:1.6em 0 .5em}h1{font-size:28px;border-bottom:2px solid #0ea5b7;padding-bottom:6px}
h2{font-size:21px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}h3{font-size:17px}
code{font:13px Consolas,'Cascadia Code',monospace;background:#f1f5f9;padding:1px 5px;border-radius:4px}
pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:8px;overflow:auto;font:12.5px/1.45 Consolas,'Cascadia Code',monospace}
pre code{background:none;padding:0;color:inherit}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid #cbd5e1;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#f1f5f9}blockquote{margin:12px 0;padding:6px 14px;border-left:4px solid #0ea5b7;background:#f0fdfa;color:#134e4a}
a{color:#0369a1}img{max-width:100%}hr{border:0;border-top:1px solid #e2e8f0;margin:24px 0}
@media print{body{margin:0;max-width:none;font-size:12px}pre{white-space:pre-wrap}h2{break-after:avoid}table,pre{break-inside:avoid}}
"""


def _inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", lambda m: f"<code>{m.group(1)}</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img alt="\1" src="\2">', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def _cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def render(md: str, title="SecureTransfer") -> str:
    lines, out, i = md.replace("\r\n", "\n").split("\n"), [], 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(html.escape(lines[i]))
                i += 1
            out.append("<pre><code>" + "\n".join(code) + "</code></pre>")
        elif ln.startswith("<!--"):
            pass
        elif re.match(r"#{1,4} ", ln):
            n = len(ln.split(" ")[0])
            out.append(f"<h{n}>{_inline(ln[n + 1:])}</h{n}>")
        elif ln.strip() in ("---", "***"):
            out.append("<hr>")
        elif ln.startswith("|") and i + 1 < len(lines) and re.match(r"\|[\s:|-]+\|?\s*$", lines[i + 1]):
            head, rows = _cells(ln), []
            i += 2
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            i -= 1
            out.append("<table><tr>" + "".join(f"<th>{_inline(c)}</th>" for c in head) + "</tr>"
                       + "".join("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in rows)
                       + "</table>")
        elif re.match(r"\s*([-*]|\d+\.) ", ln):
            tag = "ol" if re.match(r"\s*\d+\.", ln) else "ul"
            items = []
            while i < len(lines) and re.match(r"\s*([-*]|\d+\.) ", lines[i]):
                items.append(_inline(re.sub(r"^\s*([-*]|\d+\.) ", "", lines[i])))
                i += 1
            i -= 1
            out.append(f"<{tag}>" + "".join(f"<li>{x}</li>" for x in items) + f"</{tag}>")
        elif ln.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(lines[i].lstrip("> "))
                i += 1
            i -= 1
            out.append("<blockquote>" + _inline(" ".join(quote)) + "</blockquote>")
        elif ln.strip():
            para = [ln]
            while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"(#|```|\||>|\s*([-*]|\d+\.) )", lines[i + 1]):
                i += 1
                para.append(lines[i])
            out.append("<p>" + _inline(" ".join(para)) + "</p>")
        i += 1
    return (f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' "
            f"content='width=device-width,initial-scale=1'><title>{html.escape(title)}</title>"
            f"<style>{CSS}</style></head><body>" + "\n".join(out) + "</body></html>")

#!/usr/bin/env python3
"""Cache city.cv.ua pages and council documents into D1.

city.cv.ua blocks requests from Cloudflare Workers and from most datacenter IPs.
Run this script from a Ukrainian network, then import the generated SQL:

    python3 scripts/sync_city.py
    npx wrangler d1 execute chernivtsi-city --remote --file=seed/city_sync.sql

The script only reads public pages.
"""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "seed" / "city_sync.sql"
BASE = "https://city.cv.ua"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

PAGES = [
    "/mt/meshkantsiu",
    "/mt/meshkantsiu/administratyvni-poslugi-64",
    "/mt/meshkantsiu/stavki-zemelnogo-podatku-104",
    "/mt/meshkantsiu/tarify-ta-komunalni-poslugi-180",
    "/mt/meshkantsiu/gumanitarna-dopomoga-248",
    "/mt/meshkantsiu/bezpeka-68",
    "/mt/transport",
    "/mt/transport/gromadskii-transport-13",
    "/mt/rizne/mistsevi-podatki-i-zbori-192",
    "/mt/rizne/garyacha-liniya-236",
    "/mt/biznesu",
    "/mt/biznesu/administratyvny-poslugy-57",
    "/mt/komunalne-nerukhome-majno",
    "/mt/pro-misto",
    "/mt/pro-misto/vidkryti-dani-7",
    "/mt/mystetstvo-i-dozvillia",
    "/city",
    "/city/budget",
    "/community",
    "/community/elektronni-petitsiji",
    "/community/gromadski-slukhannya",
    "/contacts",
]


def fetch(path: str) -> str:
    url = path if path.startswith("http") else BASE + path
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def q(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def strip_tags(value: str) -> str:
    value = re.sub(r"<script\b[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style\b[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"</(p|div|li|tr|h[1-6])>", "\n", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n[ \t]+", "\n", value)
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def one_line(value: str) -> str:
    return re.sub(r"\s+", " ", strip_tags(value)).strip()


def extract_main(page: str) -> str:
    start = re.search(r"<main\b", page, re.I)
    if not start:
        return page
    end = page.find("</main>", start.end())
    return page[start.start():end if end > start.start() else None]


def page_title(page: str) -> str:
    main = extract_main(page)
    for pattern in [
        r'<h1[^>]*class="[^"]*title-advert[^"]*"[^>]*>([\s\S]*?)</h1>',
        r'<span class="text-title">([\s\S]*?)</span>',
        r"<title>([\s\S]*?)</title>",
    ]:
        match = re.search(pattern, main, re.I)
        if match:
            return one_line(match.group(1))
    return ""


def page_body(page: str) -> str:
    main = extract_main(page)
    article = re.search(r"<article[^>]*>([\s\S]*?)</article>", main, re.I)
    if article:
        return strip_tags(article.group(1))
    artical = re.search(r'<div class="artical"[\s\S]*?<div class="text"[^>]*>([\s\S]*?)</div>', main, re.I)
    if artical:
        return strip_tags(artical.group(1))
    return ""


def page_attachments(page: str) -> list[dict[str, str]]:
    main = extract_main(page)
    output = []
    seen = set()
    for match in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', main, re.I):
        url = urllib.parse.urljoin(BASE, html.unescape(match.group(1)))
        if not re.search(r"/storage/|/download/|\.(pdf|docx?|xlsx?|zip|rar|ppt|pptx|odt)(\?|$)", url, re.I):
            continue
        if url in seen:
            continue
        seen.add(url)
        name = one_line(match.group(2)) or url.rsplit("/", 1)[-1]
        ext = re.search(r"\.([a-z0-9]+)(?:\?|$)", url, re.I)
        output.append({"name": name[:160], "url": url, "type": ext.group(1).lower() if ext else "file"})
    return output


def parse_documents(page: str) -> list[dict[str, object]]:
    rows = re.findall(r'<tr[^>]*scope="row"[^>]*>([\s\S]*?)</tr>', page, re.I)
    documents = []
    for row in rows:
        cells = re.findall(r"<td[^>]*>([\s\S]*?)</td>", row, re.I)
        if len(cells) < 3:
            continue
        date = re.search(r"(\d{2}\.\d{2}\.\d{4})", strip_tags(cells[1]))
        title = one_line(cells[2])
        title = re.sub(r"завантажити(?:\s+проект)?\s+\.?docx?", " ", title, flags=re.I)
        title = re.sub(r"Залишити коментар або пропозицію до проекту рішення", " ", title, flags=re.I)
        title = re.sub(r"нове надходження", " ", title, flags=re.I)
        title = re.sub(r"\s+", " ", title).strip()
        if not title:
            continue
        links = re.findall(r'<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', cells[2], re.I)
        download = next((urllib.parse.urljoin(BASE, link[0]) for link in links if "завантажити" in one_line(link[1])), None)
        additions = [
            urllib.parse.urljoin(BASE, link[0])
            for link in links
            if "additions_download" in link[0] or "Додат" in one_line(link[1])
        ]
        doc_id = download.rsplit("/", 1)[-1] if download else title
        documents.append(
            {
                "id": doc_id,
                "title": title,
                "date": date.group(1) if date else None,
                "executor": one_line(cells[3]) if len(cells) > 3 else None,
                "download": download,
                "additions": additions,
            }
        )
    return documents


def main() -> None:
    statements: list[str] = []
    counts = {"pages": 0, "documents": 0}
    errors: list[str] = []

    for path in PAGES:
        try:
            page = fetch(path)
            url = BASE + path
            title = page_title(page)
            body = page_body(page)
            if not title or not body:
                errors.append(f"{path}: empty title/body")
                continue
            attachments = json.dumps(page_attachments(page), ensure_ascii=False)
            statements.append(
                "INSERT OR REPLACE INTO page_cache (url, title, body, attachments_json, updated_at, fetched_at) VALUES "
                f"({q(url)}, {q(title)}, {q(body)}, {q(attachments)}, NULL, CURRENT_TIMESTAMP);\n"
            )
            counts["pages"] += 1
        except Exception as error:  # noqa: BLE001
            errors.append(f"{path}: {error}")

    for doc_type in ["1", "2", "3", "4", "5"]:
        for page_number in [1, 2]:
            try:
                path = f"/search/documents?type={doc_type}" + (f"&page={page_number}" if page_number > 1 else "")
                page = fetch(path)
                for document in parse_documents(page):
                    statements.append(
                        "INSERT OR REPLACE INTO document_cache (id, type, title, date, executor, download_url, additions_json, fetched_at) VALUES "
                        f"({q(document['id'])}, {q(doc_type)}, {q(document['title'])}, {q(document['date'])}, "
                        f"{q(document['executor'])}, {q(document['download'])}, {q(json.dumps(document['additions'], ensure_ascii=False))}, CURRENT_TIMESTAMP);\n"
                    )
                    counts["documents"] += 1
            except Exception as error:  # noqa: BLE001
                errors.append(f"documents type={doc_type} page={page_number}: {error}")

    queries = ["оренда", "бюджет", "земля", "тариф", "транспорт"]
    for query in queries:
        for page_number in [1, 2]:
            try:
                path = "/search/documents?type=all&q=" + urllib.parse.quote(query) + (f"&page={page_number}" if page_number > 1 else "")
                page = fetch(path)
                for document in parse_documents(page):
                    statements.append(
                        "INSERT OR REPLACE INTO document_cache (id, type, title, date, executor, download_url, additions_json, fetched_at) VALUES "
                        f"({q(document['id'])}, 'all', {q(document['title'])}, {q(document['date'])}, "
                        f"{q(document['executor'])}, {q(document['download'])}, {q(json.dumps(document['additions'], ensure_ascii=False))}, CURRENT_TIMESTAMP);\n"
                    )
                    counts["documents"] += 1
            except Exception as error:  # noqa: BLE001
                errors.append(f"documents query={query} page={page_number}: {error}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("".join(statements), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "counts": counts, "errors": errors, "generated_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

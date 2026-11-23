import type {
  CityArticle,
  CityAttachment,
  CityDocument,
  CityListItem,
  CityListResult,
  Env,
} from "../types";
import { parseCityListDate, parseUkrainianDate } from "../lib/date";
import {
  absoluteUrl,
  decodeEntities,
  firstMatch,
  slugFromUrl,
  stripTags,
  stripTagsOneLine,
  truncate,
} from "../lib/html";
import { fetchText } from "../lib/http";
import { ToolError } from "../lib/errors";
import { fetchTelegramPosts } from "./telegram";

export const CITY_BASE = "https://city.cv.ua";

export const CITY_SECTIONS = {
  announcements: { path: "/press-center/ogoloshennia", label: "Оголошення" },
  anonsy: { path: "/press-center/anonsy", label: "Анонси" },
  news: { path: "/press-center/novyny", label: "Новини" },
} as const;

export type CitySection = keyof typeof CITY_SECTIONS;

export function sectionUrl(section: CitySection, page = 1): string {
  const base = `${CITY_BASE}${CITY_SECTIONS[section].path}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

function listBlockItems(html: string, section: CitySection): CityListItem[] {
  const blocks = html.split(/<div class="(?:row )?article-item">/i).slice(1);
  const items: CityListItem[] = [];

  for (const block of blocks) {
    const anchor =
      /<a[^>]+href="([^"]+)"[^>]*class="(?:advert|article)-name"[^>]*>([\s\S]*?)<\/a>/i.exec(block) ??
      /<a[^>]+class="(?:advert|article)-name"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;

    const url = absoluteUrl(CITY_BASE, anchor[1]!);
    const title = stripTagsOneLine(anchor[2]!);
    if (!title) continue;

    const dateChunk = /<span class="publish-date">([\s\S]{0,400}?)<\/span>\s*<\/span>/i.exec(block)?.[1] ?? "";
    const publishedAt = parseCityListDate(stripTagsOneLine(dateChunk) || stripTagsOneLine(block));
    const image = firstMatch(block, /<img[^>]+src="([^"]+)"/i);
    items.push({
      id: slugFromUrl(url),
      title,
      url,
      publishedAt,
      image: image ? absoluteUrl(CITY_BASE, image) : undefined,
      section,
    });
  }

  return items;
}

export function parseCityListPage(
  html: string,
  section: CitySection,
  page = 1,
): CityListResult {
  const pageNumbers = [...html.matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]));
  const totalPages = pageNumbers.length > 0 ? Math.max(...pageNumbers) : page;
  return {
    section,
    page,
    totalPages,
    items: listBlockItems(html, section),
    source: sectionUrl(section, page),
  };
}

export async function fetchCityList(
  env: Env,
  section: CitySection,
  page = 1,
  ttlSeconds = 300,
): Promise<CityListResult> {
  const url = sectionUrl(section, page);
  const html = await fetchText(url, {
    ttlSeconds,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `city-list:${section}:${page}`,
  });
  return parseCityListPage(html, section, page);
}

function extractMain(html: string): string {
  const start = html.search(/<main\b/i);
  if (start < 0) return html;
  const end = html.indexOf("</main>", start);
  return html.slice(start, end > start ? end : undefined);
}

function extractArticleSection(html: string): string {
  const main = extractMain(html);
  const start = main.search(/<div class="artical"/i);
  if (start < 0) return "";
  const end = main.indexOf('<div class="bottom-share-block', start);
  return main.slice(start, end > start ? end : undefined);
}

function extractBody(html: string): string {
  const main = extractMain(html);
  const articleTag = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(main);
  if (articleTag?.[1]) {
    return stripTags(articleTag[1]).replace(/\n{3,}/g, "\n\n").trim();
  }
  const article = extractArticleSection(html);
  if (!article) return "";
  const textBlock =
    /<div class="text"[^>]*>([\s\S]*?)<\/div>/i.exec(article)?.[1] ?? article;
  return stripTags(textBlock)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractAttachments(html: string): CityAttachment[] {
  const article = extractArticleSection(html);
  const source = article || extractMain(html);
  const attachments: CityAttachment[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorRe)) {
    const url = absoluteUrl(CITY_BASE, match[1]!);
    if (
      !/\/storage\/|\/download\/|\.(pdf|docx?|xlsx?|zip|rar|ppt|pptx|odt)(\?|$)/i.test(url)
    ) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const name = stripTagsOneLine(match[2]!) || url.split("/").pop() || "attachment";
    const extension = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? "file";
    attachments.push({ name: truncate(name, 160), url, type: extension });
  }
  return attachments;
}

function extractTitle(html: string): string {
  const main = extractMain(html);
  return (
    stripTagsOneLine(firstMatch(main, /<h1[^>]*class="[^"]*title-advert[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ?? "") ||
    stripTagsOneLine(firstMatch(main, /<span class="text-title">([\s\S]*?)<\/span>/i) ?? "") ||
    stripTagsOneLine(firstMatch(html, /<title>([\s\S]*?)<\/title>/i) ?? "").replace(
      /\.\s*(Оголошення|Анонси|Новини|Матеріал).*$/i,
      "",
    )
  );
}

function extractPublishedAt(html: string): string | undefined {
  const lastEdit = /<div class="last-edit">([\s\S]{0,500}?)<\/div>/i.exec(html)?.[1];
  if (lastEdit) {
    const value = parseCityListDate(stripTagsOneLine(lastEdit));
    if (value) return value;
  }
  const subInfo = /<div class="advert-sub-info[^"]*">([\s\S]{0,500}?)<\/div>/i.exec(html)?.[1];
  if (subInfo) {
    const value = parseCityListDate(stripTagsOneLine(subInfo));
    if (value) return value;
  }
  return undefined;
}

export function parseCityArticlePage(
  html: string,
  url: string,
  section: CitySection = "announcements",
): CityArticle {
  const title = extractTitle(html);
  if (!title) {
    throw new ToolError(`Could not parse city page ${url}`, "The page layout may have changed.");
  }
  return {
    id: slugFromUrl(url),
    title,
    url,
    publishedAt: extractPublishedAt(html),
    image: firstMatch(html, /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i),
    section,
    body: extractBody(html),
    attachments: extractAttachments(html),
    source: CITY_BASE,
  };
}

export async function fetchCityArticle(
  env: Env,
  idOrUrl: string,
  section: CitySection = "announcements",
): Promise<CityArticle> {
  let url: string;
  if (/^https?:\/\//i.test(idOrUrl)) {
    url = idOrUrl;
  } else if (idOrUrl.startsWith("/")) {
    url = `${CITY_BASE}${idOrUrl}`;
  } else {
    url = `${CITY_BASE}${CITY_SECTIONS[section].path}/${idOrUrl}`;
  }
  if (!url.startsWith(CITY_BASE)) {
    throw new ToolError("Only city.cv.ua URLs are supported.", "Pass a city.cv.ua link or a page id.");
  }
  const html = await fetchText(url, {
    ttlSeconds: 600,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `city-article:${url}`,
  });
  return parseCityArticlePage(html, url, section);
}

export interface StaticPage {
  title: string;
  url: string;
  updatedAt?: string;
  body: string;
  attachments: CityAttachment[];
  source: string;
}

const ALLOWED_PAGE_PREFIXES = [
  "/mt/",
  "/city/",
  "/community/",
  "/press-center/",
  "/contacts",
];

export function validateCityPageUrl(urlOrPath: string): string {
  const url = /^https?:\/\//i.test(urlOrPath)
    ? new URL(urlOrPath)
    : new URL(urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`, CITY_BASE);
  if (url.hostname !== "city.cv.ua") {
    throw new ToolError("Only city.cv.ua pages are supported.");
  }
  if (url.pathname.startsWith("/administrator/")) {
    throw new ToolError("Administrator pages are not available.");
  }
  if (!ALLOWED_PAGE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    throw new ToolError(
      "This city.cv.ua section is not in the allowlist.",
      `Allowed prefixes: ${ALLOWED_PAGE_PREFIXES.join(", ")}`,
    );
  }
  return url.toString();
}

export async function fetchStaticPage(env: Env, urlOrPath: string): Promise<StaticPage> {
  const url = validateCityPageUrl(urlOrPath);
  try {
    const html = await fetchText(url, {
      ttlSeconds: 1800,
      userAgent: env.UPSTREAM_USER_AGENT,
      cacheKey: `city-page:${url}`,
    });
    const page: StaticPage = {
      title: extractTitle(html),
      url,
      updatedAt: extractPublishedAt(html),
      body: extractBody(html),
      attachments: extractAttachments(html),
      source: CITY_BASE,
    };
    if (env.DB) {
      try {
        await env.DB.prepare(
          `INSERT INTO page_cache (url, title, body, attachments_json, updated_at, fetched_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(url) DO UPDATE SET title=excluded.title, body=excluded.body,
             attachments_json=excluded.attachments_json, updated_at=excluded.updated_at,
             fetched_at=CURRENT_TIMESTAMP`,
        )
          .bind(url, page.title, page.body, JSON.stringify(page.attachments), page.updatedAt ?? null)
          .run();
      } catch {
        // cache is best effort
      }
    }
    return page;
  } catch (error) {
    if (env.DB) {
      const row = await env.DB.prepare(
        `SELECT title, body, attachments_json, updated_at FROM page_cache WHERE url = ?`,
      )
        .bind(url)
        .first<{ title: string; body: string; attachments_json: string | null; updated_at: string | null }>();
      if (row) {
        return {
          title: row.title,
          url,
          updatedAt: row.updated_at ?? undefined,
          body: row.body,
          attachments: row.attachments_json ? JSON.parse(row.attachments_json) : [],
          source: "local city page cache",
        };
      }
    }
    throw new ToolError(
      `city.cv.ua is not reachable from the deployed server: ${error instanceof Error ? error.message : String(error)}`,
      "Run scripts/sync_city.py from a Ukrainian network to refresh the page cache, or open the URL directly.",
    );
  }
}

function documentTypeLabel(type: string): string {
  return (
    {
      all: "all documents",
      "1": "draft city council decisions",
      "2": "draft executive committee decisions",
      "3": "city council decisions",
      "4": "executive committee decisions",
      "5": "mayor orders",
    } as Record<string, string>
  )[type] ?? type;
}

export function parseDocumentSearchPage(html: string, page = 1): {
  page: number;
  totalPages?: number;
  documents: CityDocument[];
  source: string;
} {
  const rows = [...html.matchAll(/<tr[^>]*scope="row"[^>]*>([\s\S]*?)<\/tr>/gi)].map(
    (match) => match[1]!,
  );
  const documents: CityDocument[] = [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]!);
    if (cells.length < 3) continue;
    const date = /(\d{2}\.\d{2}\.\d{4})/.exec(stripTags(cells[1] ?? ""))?.[1];
    const title = stripTagsOneLine(cells[2] ?? "")
      .replace(/завантажити(?:\s+проект)?\s+\.?docx?/gi, " ")
      .replace(/Залишити коментар або пропозицію до проекту рішення/gi, " ")
      .replace(/нове надходження/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const links = [...(cells[2] ?? "").matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const download = links.find((link) => /завантажити/i.test(stripTags(link[2]!)));
    const additions = links
      .filter((link) => /additions_download|Додат/i.test(link[1]! + link[2]!))
      .map((link) => absoluteUrl(CITY_BASE, link[1]!));
    const docUrl = download ? absoluteUrl(CITY_BASE, download[1]!) : undefined;
    documents.push({
      id: docUrl ? slugFromUrl(docUrl) : title,
      title,
      date,
      executor: stripTagsOneLine(cells[3] ?? "") || undefined,
      downloadUrl: docUrl,
      additions,
      type: documentTypeLabel("all"),
    });
  }

  const pageNumbers = [...html.matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]));
  return {
    page,
    totalPages: pageNumbers.length > 0 ? Math.max(...pageNumbers) : page,
    documents,
    source: `${CITY_BASE}/search/documents`,
  };
}

export async function searchCityDocuments(
  env: Env,
  options: {
    query?: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  },
): Promise<{ page: number; totalPages?: number; documents: CityDocument[]; source: string; typeLabel: string; warning?: string }> {
  const params = new URLSearchParams();
  const type = options.type ?? "all";
  params.set("type", type);
  if (options.query) params.set("q", options.query);
  if (options.dateFrom) params.set("date_from", options.dateFrom);
  if (options.dateTo) params.set("date_to", options.dateTo);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  const url = `${CITY_BASE}/search/documents?${params.toString()}`;
  try {
    const html = await fetchText(url, {
      ttlSeconds: 300,
      userAgent: env.UPSTREAM_USER_AGENT,
      cacheKey: `city-documents:${params.toString()}`,
      timeoutMs: 45_000,
      retries: 2,
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    const parsed = parseDocumentSearchPage(html, options.page ?? 1);
    const documents = parsed.documents.slice(0, options.limit ?? 30);
    if (env.DB && documents.length > 0) {
      try {
        await env.DB.batch(
          documents.map((document) =>
            env.DB.prepare(
              `INSERT INTO document_cache (id, type, title, date, executor, download_url, additions_json, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(id) DO UPDATE SET title=excluded.title, date=excluded.date,
                 executor=excluded.executor, download_url=excluded.download_url,
                 additions_json=excluded.additions_json, fetched_at=CURRENT_TIMESTAMP`,
            ).bind(
              document.id,
              type,
              document.title,
              document.date ?? null,
              document.executor ?? null,
              document.downloadUrl ?? null,
              JSON.stringify(document.additions),
            ),
          ),
        );
      } catch {
        // cache is best effort
      }
    }
    return {
      ...parsed,
      documents,
      source: url,
      typeLabel: documentTypeLabel(type),
    };
  } catch (error) {
    if (env.DB) {
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (type !== "all") {
        clauses.push("type = ?");
        values.push(type);
      }
      if (options.query) {
        clauses.push("lower(title) LIKE ?");
        values.push(`%${options.query.toLowerCase()}%`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const select = `SELECT id, title, date, executor, download_url, additions_json
         FROM document_cache ${where}
         ORDER BY date DESC LIMIT ?`;
      let rows = await env.DB.prepare(select)
        .bind(...values, options.limit ?? 30)
        .all<{
          id: string;
          title: string;
          date: string | null;
          executor: string | null;
          download_url: string | null;
          additions_json: string | null;
        }>();
      let warning: string | undefined;
      if ((rows.results ?? []).length === 0 && options.query) {
        const stem = options.query.toLowerCase().slice(0, Math.max(4, options.query.length - 2));
        const stemClauses = [...clauses];
        const stemValues = [...values];
        const last = stemClauses.length - 1;
        if (last >= 0) stemClauses[last] = "lower(title) LIKE ?";
        else stemClauses.push("lower(title) LIKE ?");
        stemValues[stemValues.length - 1] = `%${stem}%`;
        rows = await env.DB.prepare(
          `SELECT id, title, date, executor, download_url, additions_json
           FROM document_cache WHERE ${stemClauses.join(" AND ")}
           ORDER BY date DESC LIMIT ?`,
        )
          .bind(...stemValues, options.limit ?? 30)
          .all<{
            id: string;
            title: string;
            date: string | null;
            executor: string | null;
            download_url: string | null;
            additions_json: string | null;
          }>();
        warning = "Used a shortened search term against the local document cache.";
      }
      if ((rows.results ?? []).length === 0) {
        rows = await env.DB.prepare(
          `SELECT id, title, date, executor, download_url, additions_json
           FROM document_cache ORDER BY date DESC LIMIT ?`,
        )
          .bind(options.limit ?? 30)
          .all<{
            id: string;
            title: string;
            date: string | null;
            executor: string | null;
            download_url: string | null;
            additions_json: string | null;
          }>();
        warning =
          "No cached documents matched the query; showing the most recent cached documents. Run scripts/sync_city.py to refresh the cache.";
      }
      if ((rows.results ?? []).length > 0) {
        return {
          page: 1,
          totalPages: 1,
          documents: (rows.results ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            date: row.date ?? undefined,
            executor: row.executor ?? undefined,
            downloadUrl: row.download_url ?? undefined,
            additions: row.additions_json ? JSON.parse(row.additions_json) : [],
            type: documentTypeLabel(type),
          })),
          source: "local city documents cache",
          typeLabel: documentTypeLabel(type),
          warning,
        };
      }
    }
    throw new ToolError(
      `city.cv.ua document search is not reachable from the deployed server: ${error instanceof Error ? error.message : String(error)}`,
      "Run scripts/sync_city.py from a Ukrainian network to refresh the documents cache.",
    );
  }
}

export async function searchCitySection(
  env: Env,
  section: CitySection,
  query: string,
  maxPages = 4,
): Promise<CityListItem[]> {
  const needle = query.trim().toLowerCase();
  const pages = await Promise.all(
    Array.from({ length: maxPages }, (_, index) => fetchCityList(env, section, index + 1)),
  );
  return pages
    .flatMap((page) => page.items)
    .filter((item) => item.title.toLowerCase().includes(needle))
    .slice(0, 50);
}

export function officialDateFromTitle(title: string): string | undefined {
  return parseUkrainianDate(title, new Date(), true);
}

export async function refreshAnnouncements(env: Env): Promise<void> {
  if (!env.DB) return;
  const statements: D1PreparedStatement[] = [];
  for (const section of ["announcements", "anonsy"] as const) {
    let pages: Awaited<ReturnType<typeof fetchCityList>>[] = [];
    try {
      pages = await Promise.all([fetchCityList(env, section, 1, 60), fetchCityList(env, section, 2, 60)]);
    } catch {
      // city.cv.ua blocks Cloudflare egress; Telegram below is the fallback.
    }
    for (const page of pages) {
      for (const item of page.items) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO announcement (id, section, title, url, published_at, summary, source)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title, url=excluded.url, published_at=excluded.published_at,
               summary=excluded.summary, fetched_at=CURRENT_TIMESTAMP`,
          ).bind(
            item.id,
            section,
            item.title,
            item.url,
            item.publishedAt ?? null,
            null,
            CITY_BASE,
          ),
        );
      }
    }
  }
  try {
    const posts = await fetchTelegramPosts(env);
    for (const post of posts) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO announcement (id, section, title, url, published_at, summary, source)
           VALUES (?, 'telegram', ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, url=excluded.url, published_at=excluded.published_at,
             summary=excluded.summary, fetched_at=CURRENT_TIMESTAMP`,
        ).bind(post.id, post.title, post.url, post.publishedAt ?? null, post.text.slice(0, 1200), "https://t.me/ChernivtsiCityCouncil"),
      );
    }
  } catch {
    // Telegram is a fallback; keep whatever city data was fetched.
  }
  if (statements.length > 0) {
    for (let i = 0; i < statements.length; i += 50) {
      await env.DB.batch(statements.slice(i, i + 50));
    }
  }
}

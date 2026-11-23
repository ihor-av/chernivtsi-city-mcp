import type { Env } from "../types";
import { cookiesToHeader, fetchWithCookies } from "../lib/http";
import { ToolError } from "../lib/errors";
import { parseCsv, toObjects } from "../lib/csv";

export const GEOPORTAL_BASE = "https://map.city.cv.ua";

export async function listGeoportalDatasets(env: Env, query?: string) {
  if (!env.DB) return { datasets: [], note: "D1 database is not available." };
  const normalized = query?.toLowerCase().trim();
  const result = normalized
    ? await env.DB.prepare(
        `SELECT id, title, page, modified, resource_count, notes FROM dataset
         WHERE source = 'map.city.cv.ua' AND (lower(title) LIKE ? OR lower(coalesce(notes,'')) LIKE ?)
         ORDER BY title LIMIT 100`,
      )
        .bind(`%${normalized}%`, `%${normalized}%`)
        .all<{
          id: string;
          title: string;
          page: string | null;
          modified: string | null;
          resource_count: number | null;
          notes: string | null;
        }>()
    : await env.DB.prepare(
        `SELECT id, title, page, modified, resource_count, notes FROM dataset
         WHERE source = 'map.city.cv.ua' ORDER BY title LIMIT 100`,
      ).all<{
        id: string;
        title: string;
        page: string | null;
        modified: string | null;
        resource_count: number | null;
        notes: string | null;
      }>();

  return {
    datasets: (result.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      page: row.page,
      modified: row.modified,
      resourceCount: row.resource_count,
      notes: row.notes,
    })),
    source: "map.city.cv.ua geoportal catalog",
  };
}

const CACHE_KEY_PREFIX = "geoportal-csv:";

function defaultCache(): Cache | undefined {
  if (typeof caches === "undefined") return undefined;
  return (caches as unknown as { default?: Cache }).default;
}

async function readCache(key: string): Promise<string | undefined> {
  const cache = defaultCache();
  if (!cache) return undefined;
  try {
    const response = await cache.match(new Request(key));
    return response ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(key: string, text: string): Promise<void> {
  const cache = defaultCache();
  if (!cache) return;
  try {
    await cache.put(
      new Request(key),
      new Response(text, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "public, max-age=21600",
        },
      }),
    );
  } catch {
    // best-effort
  }
}

export async function exportGeoportalCsv(env: Env, datasetId: string): Promise<string> {
  const cacheKey = `${CACHE_KEY_PREFIX}${datasetId}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  const detailUrl = `${GEOPORTAL_BASE}/ua/data_detail/${datasetId}`;
  const { response: detailResponse, cookies } = await fetchWithCookies(detailUrl, {
    userAgent: env.UPSTREAM_USER_AGENT,
    timeoutMs: 20_000,
  });
  if (!detailResponse.ok) {
    throw new ToolError(`Geoportal dataset page returned HTTP ${detailResponse.status}.`);
  }
  const detailHtml = await detailResponse.text();
  const token = /api-user\/exportTable\?accessToken=([A-Za-z0-9_-]+)/.exec(detailHtml)?.[1];
  if (!token) {
    throw new ToolError(
      "Could not find a geoportal export token.",
      "The portal export flow may have changed; use the dataset page in a browser.",
    );
  }

  const cookieHeader = cookiesToHeader(cookies);
  const exportUrl = `${GEOPORTAL_BASE}/api-user/exportTable?accessToken=${token}`;
  const first = await fetchWithCookies(exportUrl, {
    cookie: cookieHeader,
    userAgent: env.UPSTREAM_USER_AGENT,
    timeoutMs: 30_000,
  });
  if (!first.response.ok) {
    throw new ToolError(`Geoportal export returned HTTP ${first.response.status}.`);
  }
  const contentType = first.response.headers.get("content-type") ?? "";
  if (/text\/csv|application\/csv/i.test(contentType)) {
    const text = await first.response.text();
    await writeCache(cacheKey, text);
    return text;
  }

  // The first request starts an SSE export job; consume it, then download.
  await first.response.text();
  const second = await fetchWithCookies(exportUrl, {
    cookie: cookiesToHeader([...cookies, ...first.cookies]),
    userAgent: env.UPSTREAM_USER_AGENT,
    timeoutMs: 30_000,
  });
  if (!second.response.ok) {
    throw new ToolError(`Geoportal download returned HTTP ${second.response.status}.`);
  }
  const text = await second.response.text();
  if (text.trimStart().startsWith("data:")) {
    throw new ToolError(
      "Geoportal export did not finish in time.",
      "Try again; the portal generates large CSV exports asynchronously.",
    );
  }
  await writeCache(cacheKey, text);
  return text;
}

export async function previewGeoportalDataset(
  env: Env,
  options: { datasetId: string; query?: string; limit?: number },
): Promise<{
  datasetId: string;
  format: "CSV";
  headers: string[];
  rows: Record<string, string>[];
  matchedRows: number;
  truncated: boolean;
  source: string;
}> {
  const text = await exportGeoportalCsv(env, options.datasetId);
  const table = parseCsv(text);
  let rows = toObjects(table);
  if (options.query) {
    const needle = options.query.toLowerCase();
    rows = rows.filter((row) =>
      Object.values(row).some((value) => value.toLowerCase().includes(needle)),
    );
  }
  const limit = Math.min(options.limit ?? 20, 100);
  return {
    datasetId: options.datasetId,
    format: "CSV",
    headers: table.headers,
    rows: rows.slice(0, limit),
    matchedRows: rows.length,
    truncated: rows.length > limit,
    source: `${GEOPORTAL_BASE}/ua/data_detail/${options.datasetId}`,
  };
}

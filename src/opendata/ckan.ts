import type { Env } from "../types";
import { fetchJson, fetchText } from "../lib/http";
import { ToolError } from "../lib/errors";
import { isCsvFormat, isJsonFormat, parseCsv, toObjects } from "../lib/csv";

export const CKAN_BASE = "https://data.gov.ua/api/3/action";
export const CHERNIVTSI_ORG_ID = "5e290d50-adb0-44fe-a4b7-c594ac6a05eb";
export const CHERNIVTSI_ORG_SLUG = "vykonavchyi-komitet-chernivetskoi-miskoi-rady";

interface CkanResource {
  id: string;
  name: string;
  format?: string;
  url: string;
  size?: number;
  file_size?: number;
  created?: string;
  last_modified?: string;
  description?: string;
}

interface CkanDataset {
  id: string;
  title: string;
  name?: string;
  notes?: string;
  metadata_modified?: string;
  organization?: { title?: string; id?: string };
  resources?: CkanResource[];
}

interface CkanSearchResponse {
  success: boolean;
  result?: {
    count: number;
    results: CkanDataset[];
  };
}

interface CkanDatasetResponse {
  success: boolean;
  result?: CkanDataset;
}

interface CkanResourceResponse {
  success: boolean;
  result?: CkanResource;
}

function mapResource(resource: CkanResource) {
  return {
    id: resource.id,
    name: resource.name,
    format: resource.format,
    url: resource.url,
    size: resource.size ?? resource.file_size,
    modified: resource.last_modified ?? resource.created,
    description: resource.description?.slice(0, 300),
  };
}

function mapDataset(dataset: CkanDataset) {
  return {
    id: dataset.id,
    title: dataset.title,
    name: dataset.name,
    notes: dataset.notes?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 700),
    modified: dataset.metadata_modified,
    organization: dataset.organization?.title,
    resourceCount: dataset.resources?.length ?? 0,
    page: `https://data.gov.ua/dataset/${dataset.id}`,
    resources: dataset.resources?.slice(0, 30).map(mapResource) ?? [],
  };
}

export async function searchCkanDatasets(
  env: Env,
  options: { query?: string; format?: string; page?: number; limit?: number; allOrganizations?: boolean },
) {
  const params = new URLSearchParams();
  params.set("q", options.query ?? "");
  params.set("rows", String(options.limit ?? 20));
  params.set("start", String(((options.page ?? 1) - 1) * (options.limit ?? 20)));
  if (!options.allOrganizations) params.set("fq", `organization:${CHERNIVTSI_ORG_SLUG}`);
  if (options.format) params.set("res_format", options.format.toUpperCase());
  const url = `${CKAN_BASE}/package_search?${params.toString()}`;
  const data = await fetchJson<CkanSearchResponse>(url, {
    ttlSeconds: 900,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `ckan-search:${params.toString()}`,
  });
  if (!data.success || !data.result) {
    throw new ToolError("CKAN dataset search failed.");
  }
  return {
    count: data.result.count,
    page: options.page ?? 1,
    datasets: data.result.results.map(mapDataset),
    source: "data.gov.ua CKAN API",
  };
}

export async function getCkanDataset(env: Env, id: string) {
  const url = `${CKAN_BASE}/package_show?id=${encodeURIComponent(id)}`;
  const data = await fetchJson<CkanDatasetResponse>(url, {
    ttlSeconds: 900,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `ckan-dataset:${id}`,
  });
  if (!data.success || !data.result) throw new ToolError(`Dataset ${id} was not found.`);
  return mapDataset(data.result);
}

export async function getCkanResource(env: Env, id: string) {
  const url = `${CKAN_BASE}/resource_show?id=${encodeURIComponent(id)}`;
  const data = await fetchJson<CkanResourceResponse>(url, {
    ttlSeconds: 900,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `ckan-resource:${id}`,
  });
  if (!data.success || !data.result) throw new ToolError(`Resource ${id} was not found.`);
  return mapResource(data.result);
}

export interface ResourcePreview {
  url: string;
  format: string;
  headers?: string[];
  rows?: Record<string, string>[];
  matchedRows?: number;
  truncated?: boolean;
  note?: string;
  downloadUrl: string;
}

function csvPreview(text: string, query: string | undefined, limit: number): ResourcePreview {
  const table = parseCsv(text);
  let objects = toObjects(table);
  if (query) {
    const needle = query.toLowerCase();
    objects = objects.filter((row) =>
      Object.values(row).some((value) => value.toLowerCase().includes(needle)),
    );
  }
  const matchedRows = objects.length;
  return {
    url: "",
    format: "CSV",
    headers: table.headers,
    rows: objects.slice(0, limit),
    matchedRows,
    truncated: matchedRows > limit,
    downloadUrl: "",
  };
}

export async function previewCkanResource(
  env: Env,
  options: { url?: string; resourceId?: string; query?: string; limit?: number },
): Promise<ResourcePreview> {
  let resource: ReturnType<typeof mapResource> | undefined;
  if (options.resourceId) resource = await getCkanResource(env, options.resourceId);
  const url = options.url ?? resource?.url;
  if (!url) throw new ToolError("Provide a resource URL or resource id.");

  const format = resource?.format ?? url.split(".").pop() ?? "";
  const limit = Math.min(options.limit ?? 20, 100);
  if (isCsvFormat(format) || /\.csv(\?|$)/i.test(url)) {
    const text = await fetchText(url, {
      ttlSeconds: 3600,
      userAgent: env.UPSTREAM_USER_AGENT,
      cacheKey: `ckan-resource-text:${url}`,
      headers: { Range: "bytes=0-800000" },
    });
    const preview = csvPreview(text, options.query, limit);
    return { ...preview, url, downloadUrl: url };
  }

  if (isJsonFormat(format) || /\.(json|geojson)(\?|$)/i.test(url)) {
    const text = await fetchText(url, {
      ttlSeconds: 3600,
      userAgent: env.UPSTREAM_USER_AGENT,
      cacheKey: `ckan-resource-text:${url}`,
    });
    const parsed: unknown = JSON.parse(text);
    let rows: unknown[] = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { features?: unknown[] }).features)
        ? (parsed as { features: unknown[] }).features
        : [parsed];
    if (options.query) {
      const needle = options.query.toLowerCase();
      rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
    }
    return {
      url,
      format: format.toUpperCase() || "JSON",
      rows: rows.slice(0, limit) as Record<string, string>[],
      matchedRows: rows.length,
      truncated: rows.length > limit,
      downloadUrl: url,
    };
  }

  return {
    url,
    format: format.toUpperCase() || "unknown",
    downloadUrl: url,
    note:
      "This resource is not CSV/JSON. Runtime conversion is not available; use the download URL and convert it locally.",
  };
}

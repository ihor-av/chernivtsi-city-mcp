import type { Env } from "../types";

interface DatasetRow {
  id: string;
  title: string;
  source: string;
  page: string | null;
  modified: string | null;
  resource_count: number | null;
  notes: string | null;
}

interface ResourceRow {
  id: string;
  dataset_id: string;
  name: string;
  format: string | null;
  url: string;
  bytes: number | null;
  status: string | null;
  file: string | null;
}

function mapDataset(row: DatasetRow) {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    page: row.page,
    modified: row.modified,
    resourceCount: row.resource_count,
    notes: row.notes,
  };
}

export async function searchCatalog(
  env: Env,
  options: { query?: string; source?: string; limit?: number },
) {
  if (!env.DB) return { datasets: [], note: "D1 database is not available." };
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.query) {
    clauses.push("(lower(title) LIKE ? OR lower(coalesce(notes,'')) LIKE ?)");
    const like = `%${options.query.toLowerCase()}%`;
    values.push(like, like);
  }
  if (options.source) {
    clauses.push("source = ?");
    values.push(options.source);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(
    `SELECT id, title, source, page, modified, resource_count, notes
     FROM dataset ${where}
     ORDER BY title LIMIT ?`,
  )
    .bind(...values, Math.min(options.limit ?? 40, 100))
    .all<DatasetRow>();
  return {
    datasets: (result.results ?? []).map(mapDataset),
    source: "Chernivtsi data catalog (data.gov.ua + map.city.cv.ua)",
  };
}

export async function getCatalogDataset(env: Env, id: string) {
  if (!env.DB) return { dataset: undefined, resources: [], note: "D1 database is not available." };
  const dataset = await env.DB.prepare(
    `SELECT id, title, source, page, modified, resource_count, notes FROM dataset WHERE id = ?`,
  )
    .bind(id)
    .first<DatasetRow>();
  const resources = await env.DB.prepare(
    `SELECT id, dataset_id, name, format, url, bytes, status, file
     FROM resource WHERE dataset_id = ? ORDER BY name LIMIT 200`,
  )
    .bind(id)
    .all<ResourceRow>();
  return {
    dataset: dataset ? mapDataset(dataset) : undefined,
    resources: (resources.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      format: row.format,
      url: row.url,
      bytes: row.bytes,
      status: row.status,
      localFile: row.file,
    })),
    source: "Chernivtsi data catalog",
  };
}

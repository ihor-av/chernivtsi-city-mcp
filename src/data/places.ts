import type { Env, Place } from "../types";
import { normalizeText } from "../lib/text";
import { boundingBox, haversineKm, roundKm } from "../lib/geo";

interface PlaceRow {
  id: number;
  category: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  website: string | null;
  source: string;
}

function mapPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    address: row.address ?? undefined,
    lat: row.lat ?? undefined,
    lon: row.lon ?? undefined,
    phone: row.phone ?? undefined,
    website: row.website ?? undefined,
    source: row.source,
  };
}

export async function searchPlaceRows(
  env: Env,
  options: {
    query?: string;
    category?: string;
    limit?: number;
    near?: { lat: number; lon: number };
    radiusKm?: number;
  },
): Promise<Place[]> {
  if (!env.DB) return [];
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.query) {
    clauses.push("(search_text LIKE ? OR category LIKE ?)");
    values.push(`%${normalizeText(options.query)}%`, `%${normalizeText(options.query)}%`);
  }
  if (options.category) {
    clauses.push("category = ?");
    values.push(options.category);
  }
  let orderBy = "name";
  if (options.near) {
    const box = boundingBox(options.near, options.radiusKm ?? 10);
    clauses.push("lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?");
    values.push(box.minLat, box.maxLat, box.minLon, box.maxLon);
    orderBy = `((lat - ${options.near.lat}) * (lat - ${options.near.lat}) + (lon - ${options.near.lon}) * (lon - ${options.near.lon}))`;
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT id, category, name, address, lat, lon, phone, website, source
               FROM place ${where}
               ORDER BY ${orderBy} LIMIT ?`;
  values.push(options.limit ?? 30);
  const result = await env.DB.prepare(sql).bind(...values).all<PlaceRow>();
  let places = (result.results ?? []).map(mapPlace);

  if (options.near) {
    const radius = options.radiusKm ?? 10;
    places = places
      .map((place) =>
        place.lat !== undefined && place.lon !== undefined
          ? { ...place, distanceKm: roundKm(haversineKm(options.near!, { lat: place.lat, lon: place.lon })) }
          : place,
      )
      .filter((place) => place.distanceKm === undefined || place.distanceKm <= radius)
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
  }
  return places;
}

export async function findPlaceByVenue(env: Env, venue: string): Promise<Place | undefined> {
  if (!env.DB) return undefined;
  const normalized = normalizeText(venue).slice(0, 80);
  if (!normalized) return undefined;
  const row = await env.DB.prepare(
    `SELECT id, category, name, address, lat, lon, phone, website, source
     FROM place
     WHERE instr(search_text, ?1) > 0 AND lat IS NOT NULL AND lon IS NOT NULL
     ORDER BY CASE WHEN search_text = ?2 THEN 0 ELSE 1 END, length(name)
     LIMIT 1`,
  )
    .bind(normalized, normalized)
    .first<PlaceRow>();
  return row ? mapPlace(row) : undefined;
}

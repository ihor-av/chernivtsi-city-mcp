import type { AddressPoint, Env } from "../types";
import { normalizeText } from "../lib/text";

interface AddressRow {
  id: number;
  street: string;
  house: string;
  settlement: string | null;
  lat: number;
  lon: number;
  search_text: string;
}

export async function searchAddressRows(
  env: Env,
  query: string,
  limit = 10,
): Promise<AddressPoint[]> {
  if (!env.DB) return [];
  const normalized = normalizeText(query);
  if (!normalized) return [];
  const like = `%${normalized}%`;
  const result = await env.DB.prepare(
    `SELECT id, street, house, settlement, lat, lon, search_text
     FROM address_point
     WHERE search_text LIKE ?1
     ORDER BY
       CASE WHEN settlement = 'м.Чернівці' THEN 0 ELSE 1 END,
       CASE WHEN search_text = ?2 THEN 0
            WHEN search_text LIKE ?3 THEN 1
            ELSE 2 END,
       length(search_text), street, house
     LIMIT ?4`,
  )
    .bind(like, normalized, `${normalized}%`, limit)
    .all<AddressRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    street: row.street,
    house: row.house,
    settlement: row.settlement ?? undefined,
    lat: row.lat,
    lon: row.lon,
    searchText: row.search_text,
  }));
}

export async function getAddressById(env: Env, id: number): Promise<AddressPoint | undefined> {
  if (!env.DB) return undefined;
  const row = await env.DB.prepare(
    `SELECT id, street, house, settlement, lat, lon, search_text FROM address_point WHERE id = ?`,
  )
    .bind(id)
    .first<AddressRow>();
  if (!row) return undefined;
  return {
    id: row.id,
    street: row.street,
    house: row.house,
    settlement: row.settlement ?? undefined,
    lat: row.lat,
    lon: row.lon,
    searchText: row.search_text,
  };
}

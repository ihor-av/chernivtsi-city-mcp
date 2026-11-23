import type { Env, GeoPoint, Place } from "../types";
import { fetchJson } from "../lib/http";
import { searchAddressRows } from "../data/address";
import { findPlaceByVenue, searchPlaceRows } from "../data/places";
import { ToolError } from "../lib/errors";
import { normalizeText } from "../lib/text";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
}

function parseCoordinates(value: string): GeoPoint | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { lat, lon, label: `${lat}, ${lon}`, source: "coordinates" };
}

export async function nominatimSearch(
  env: Env,
  query: string,
  limit = 3,
): Promise<GeoPoint[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(limit),
    countrycodes: "ua",
    "accept-language": "uk",
    viewbox: "25.75,48.45,26.15,48.15",
    bounded: "1",
    addressdetails: "1",
  });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const results = await fetchJson<NominatimResult[]>(url, {
    ttlSeconds: 86_400,
    userAgent: env.UPSTREAM_USER_AGENT ?? "ChernivtsiCityMCP/1.0",
    cacheKey: `nominatim:${normalizeText(query)}:${limit}`,
  });
  return results
    .map((result) => ({
      lat: Number(result.lat),
      lon: Number(result.lon),
      label: result.display_name,
      source: "OpenStreetMap Nominatim",
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

export async function geocodeQuery(env: Env, query: string): Promise<GeoPoint> {
  const direct = parseCoordinates(query);
  if (direct) return direct;

  const addresses = await searchAddressRows(env, query, 5);
  const firstAddress = addresses[0];
  if (firstAddress) {
    return {
      lat: firstAddress.lat,
      lon: firstAddress.lon,
      label: `${firstAddress.street}, ${firstAddress.house}${firstAddress.settlement ? `, ${firstAddress.settlement}` : ""}`,
      source: "city address register",
    };
  }

  const places = await searchPlaceRows(env, { query, limit: 5 });
  const firstPlace = places.find((place) => place.lat !== undefined && place.lon !== undefined);
  if (firstPlace) {
    return {
      lat: firstPlace.lat!,
      lon: firstPlace.lon!,
      label: `${firstPlace.name}${firstPlace.address ? `, ${firstPlace.address}` : ""}`,
      source: "city places register",
    };
  }

  const results = await nominatimSearch(env, `${query}, Чернівці`, 3);
  const firstResult = results[0];
  if (firstResult) return firstResult;

  throw new ToolError(
    `Could not resolve location "${query}" in Chernivtsi.`,
    "Try a street name with a house number, a known venue, or coordinates like 48.29,25.94.",
  );
}

export async function geocodeVenue(env: Env, venue: string): Promise<GeoPoint | undefined> {
  let place: Place | undefined;
  try {
    place = await findPlaceByVenue(env, venue);
  } catch {
    place = undefined;
  }
  if (place?.lat !== undefined && place?.lon !== undefined) {
    return {
      lat: place.lat,
      lon: place.lon,
      label: place.name,
      source: "city places register",
    };
  }
  try {
    const results = await nominatimSearch(env, `${venue}, Чернівці`, 1);
    return results[0];
  } catch {
    return undefined;
  }
}

export function placeToGeoPoint(place: Place): GeoPoint | undefined {
  if (place.lat === undefined || place.lon === undefined) return undefined;
  return {
    lat: place.lat,
    lon: place.lon,
    label: place.name,
    source: place.source,
  };
}

import type { Env, TransitRoute } from "../types";
import { normalizeText, normalizeStreet } from "../lib/text";

interface RouteRow {
  route_number: string;
  route_name: string;
  route_type: string | null;
  description: string | null;
  work_hours: string | null;
  interval: string | null;
  length: string | null;
}

interface StopRow {
  route_number: string;
  stop_name: string;
  search_text: string;
  lat: number | null;
  lon: number | null;
}

function mapRoute(row: RouteRow, stops: string[]): TransitRoute {
  return {
    routeNumber: row.route_number,
    routeName: row.route_name,
    routeType: row.route_type ?? "transport",
    description: row.description ?? undefined,
    workHours: row.work_hours ?? undefined,
    interval: row.interval ?? undefined,
    length: row.length ?? undefined,
    stops,
  };
}

export async function searchTransitRoutes(env: Env, query: string, limit = 20): Promise<TransitRoute[]> {
  if (!env.DB) return [];
  const normalized = normalizeText(query);
  const result = await env.DB.prepare(
    `SELECT DISTINCT r.route_number, r.route_name, r.route_type, r.description,
            r.work_hours, r.interval, r.length
     FROM transit_route r
     JOIN transit_stop s ON s.route_number = r.route_number
     WHERE r.route_number LIKE ?1 OR r.route_name LIKE ?1 OR s.search_text LIKE ?1
     ORDER BY r.route_number LIMIT ?2`,
  )
    .bind(`%${normalized}%`, limit)
    .all<RouteRow>();
  const routes: TransitRoute[] = [];
  for (const row of result.results ?? []) {
    const stops = await env.DB.prepare(
      `SELECT stop_name FROM transit_stop WHERE route_number = ? ORDER BY sequence, id`,
    )
      .bind(row.route_number)
      .all<{ stop_name: string }>();
    routes.push(
      mapRoute(row, [...new Set((stops.results ?? []).map((stop) => stop.stop_name))]),
    );
  }
  return routes;
}

async function routesByNumber(env: Env, routeNumbers: string[]): Promise<TransitRoute[]> {
  const routes: TransitRoute[] = [];
  for (const routeNumber of routeNumbers.slice(0, 15)) {
    const routeRow = await env.DB.prepare(
      `SELECT route_number, route_name, route_type, description, work_hours, interval, length
       FROM transit_route WHERE route_number = ?`,
    )
      .bind(routeNumber)
      .first<RouteRow>();
    if (!routeRow) continue;
    const stops = await env.DB.prepare(
      `SELECT stop_name FROM transit_stop WHERE route_number = ? ORDER BY sequence, id`,
    )
      .bind(routeNumber)
      .all<{ stop_name: string }>();
    routes.push(
      mapRoute(routeRow, [...new Set((stops.results ?? []).map((stop) => stop.stop_name))]),
    );
  }
  return routes;
}

export async function transitCandidates(
  env: Env,
  from: string,
  to: string,
): Promise<{
  routes: TransitRoute[];
  fromRoutes: TransitRoute[];
  toRoutes: TransitRoute[];
  transferNeeded: boolean;
  fromStops: string[];
  toStops: string[];
}> {
  if (!env.DB) {
    return { routes: [], fromRoutes: [], toRoutes: [], transferNeeded: false, fromStops: [], toStops: [] };
  }
  const fromStreet = normalizeStreet(from);
  const toStreet = normalizeStreet(to);
  const fromTokens = fromStreet.split(" ").filter((token) => token.length >= 3);
  const toTokens = toStreet.split(" ").filter((token) => token.length >= 3);
  const fromPattern = `%${fromTokens.slice(0, 2).join(" ")}%`;
  const toPattern = `%${toTokens.slice(0, 2).join(" ")}%`;

  const [fromRows, toRows] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT route_number, stop_name, search_text, lat, lon
       FROM transit_stop WHERE search_text LIKE ?1 LIMIT 100`,
    )
      .bind(fromPattern)
      .all<StopRow>(),
    env.DB.prepare(
      `SELECT DISTINCT route_number, stop_name, search_text, lat, lon
       FROM transit_stop WHERE search_text LIKE ?1 LIMIT 100`,
    )
      .bind(toPattern)
      .all<StopRow>(),
  ]);

  const fromRouteNumbers = [...new Set((fromRows.results ?? []).map((row) => row.route_number))];
  const toRouteNumbers = [...new Set((toRows.results ?? []).map((row) => row.route_number))];
  const toRouteSet = new Set(toRouteNumbers);
  const common = fromRouteNumbers.filter((route) => toRouteSet.has(route));
  const routes = await routesByNumber(env, common);

  const fromStops = [...new Set((fromRows.results ?? []).map((row) => row.stop_name))].slice(0, 20);
  const toStops = [...new Set((toRows.results ?? []).map((row) => row.stop_name))].slice(0, 20);

  if (routes.length > 0) {
    return { routes, fromRoutes: [], toRoutes: [], transferNeeded: false, fromStops, toStops };
  }

  const [fromCandidates, toCandidates] = await Promise.all([
    routesByNumber(env, fromRouteNumbers),
    routesByNumber(env, toRouteNumbers),
  ]);
  return {
    routes: [],
    fromRoutes: fromCandidates,
    toRoutes: toCandidates,
    transferNeeded: fromCandidates.length > 0 && toCandidates.length > 0,
    fromStops,
    toStops,
  };
}

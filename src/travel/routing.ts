import type { Env, RouteResult, RouteStep } from "../types";
import { fetchJson } from "../lib/http";
import { geocodeQuery } from "./geocode";

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
  maneuver: {
    type: string;
    modifier?: string;
  };
}

interface OsrmRoute {
  distance: number;
  duration: number;
  legs: Array<{ steps: OsrmStep[] }>;
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

function instructionFor(step: OsrmStep): string {
  const road = step.name?.trim() || step.ref?.trim();
  const onto = road ? ` на ${road}` : "";
  const type = step.maneuver.type;
  const modifier = step.maneuver.modifier;

  if (type === "depart") return road ? `Почніть рух по ${road}` : "Почніть рух";
  if (type === "arrive") return "Ви прибули до пункту призначення";
  if (type === "roundabout" || type === "rotary" || type === "exit roundabout" || type === "exit rotary") {
    return `Пройдіть перехрестя з круговим рухом${onto}`;
  }
  if (type === "merge") return `Влийтеся у потік${onto}`;
  if (type === "fork") {
    if (modifier === "left") return `Тримайтеся лівіше${onto}`;
    if (modifier === "right") return `Тримайтеся правіше${onto}`;
    return `Оберіть відповідне відгалуження${onto}`;
  }
  if (type === "on ramp") return `Виїжджайте на дорогу${onto}`;
  if (type === "off ramp") return `З'їжджайте з дороги${onto}`;
  if (type === "end of road") {
    if (modifier === "left") return `Поверніть ліворуч${onto}`;
    if (modifier === "right") return `Поверніть праворуч${onto}`;
    return `Продовжуйте рух${onto}`;
  }
  if (modifier === "left") return `Поверніть ліворуч${onto}`;
  if (modifier === "right") return `Поверніть праворуч${onto}`;
  if (modifier === "slight left") return `Плавно поверніть ліворуч${onto}`;
  if (modifier === "slight right") return `Плавно поверніть праворуч${onto}`;
  if (modifier === "sharp left") return `Різко поверніть ліворуч${onto}`;
  if (modifier === "sharp right") return `Різко поверніть праворуч${onto}`;
  if (modifier === "uturn") return "Розверніться";
  if (type === "new name" || type === "continue") return `Продовжуйте рух${onto}`;
  return `Продовжуйте рух${onto}`;
}

export async function planRoute(
  env: Env,
  fromQuery: string,
  toQuery: string,
  mode: "driving" | "walking",
): Promise<RouteResult> {
  const [from, to] = await Promise.all([
    geocodeQuery(env, fromQuery),
    geocodeQuery(env, toQuery),
  ]);

  const base =
    mode === "walking"
      ? "https://routing.openstreetmap.de/routed-foot/route/v1/driving"
      : "https://router.project-osrm.org/route/v1/driving";
  const url = `${base}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false&steps=true&alternatives=false`;
  const data = await fetchJson<OsrmResponse>(url, {
    ttlSeconds: 600,
    userAgent: env.UPSTREAM_USER_AGENT ?? "ChernivtsiCityMCP/1.0",
    cacheKey: `route:${mode}:${from.lat.toFixed(5)},${from.lon.toFixed(5)}:${to.lat.toFixed(5)},${to.lon.toFixed(5)}`,
  });

  if (data.code !== "Ok" || !data.routes?.[0]) {
    throw new Error(`Routing failed: ${data.message ?? data.code}`);
  }

  const route = data.routes[0]!;
  const steps: RouteStep[] = (route.legs[0]?.steps ?? []).map((step) => ({
    instruction: instructionFor(step),
    road: step.name || step.ref || undefined,
    distanceM: Math.round(step.distance),
    durationS: Math.round(step.duration),
  }));

  return {
    mode,
    from,
    to,
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    steps,
    source: mode === "walking" ? "OSRM foot profile (OpenStreetMap)" : "OSRM demo (OpenStreetMap)",
    disclaimer:
      "OpenStreetMap-based estimate. Check road closures, construction, and official signs before travelling.",
  };
}

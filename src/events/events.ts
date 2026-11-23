import type { CityEvent, Env } from "../types";
import { fetchText } from "../lib/http";
import { absoluteUrl, firstMatch, stripTagsOneLine } from "../lib/html";
import { isWithin, parseIsoDate, parseUkrainianDate } from "../lib/date";
import { normalizeText } from "../lib/text";
import { haversineKm, roundKm } from "../lib/geo";
import { fetchCityArticle, fetchCityList } from "../city/client";
import { geocodeQuery, geocodeVenue } from "../travel/geocode";
import { fetchTelegramPost, fetchTelegramPosts, telegramEvents } from "../city/telegram";

interface JsonLdEvent {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  eventStatus?: string;
  location?:
    | {
        name?: string;
        address?: { streetAddress?: string; addressLocality?: string } | string;
        geo?: { latitude?: number | string; longitude?: number | string };
      }
    | Array<{
        name?: string;
        address?: { streetAddress?: string; addressLocality?: string } | string;
        geo?: { latitude?: number | string; longitude?: number | string };
      }>;
  offers?:
    | {
        price?: number | string;
        lowPrice?: number | string;
        highPrice?: number | string;
        priceCurrency?: string;
      }
    | Array<{
        price?: number | string;
        lowPrice?: number | string;
        highPrice?: number | string;
        priceCurrency?: string;
      }>;
}

function collectJsonLd(value: unknown, output: JsonLdEvent[]): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, output);
    return;
  }
  if (typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  const typeValue = object["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  if (types.some((type) => typeof type === "string" && /event/i.test(type))) {
    output.push(object as JsonLdEvent);
  }
  for (const key of ["@graph", "itemListElement", "mainEntity", "item"]) {
    if (key in object) collectJsonLd(object[key], output);
  }
}

export function parseJsonLdEvents(html: string, baseUrl: string): CityEvent[] {
  const events: JsonLdEvent[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      collectJsonLd(JSON.parse(match[1]!), events);
    } catch {
      // Some sites embed invalid control characters in JSON-LD.
    }
  }

  const output: CityEvent[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (!event.name || !event.startDate) continue;
    const location = Array.isArray(event.location) ? event.location[0] : event.location;
    const addressObject =
      location && typeof location.address === "object" ? location.address : undefined;
    const street = addressObject?.streetAddress || "";
    const locality = addressObject?.addressLocality || "";
    const address = [street, locality].filter(Boolean).join(", ");
    const latRaw = location?.geo?.latitude;
    const lonRaw = location?.geo?.longitude;
    const lat = latRaw === undefined ? undefined : Number(latRaw);
    const lon = lonRaw === undefined ? undefined : Number(lonRaw);
    const offers = Array.isArray(event.offers) ? event.offers[0] : event.offers;
    const price = formatPrice(offers);
    const url = event.url ? absoluteUrl(baseUrl, event.url) : baseUrl;
    const type = Array.isArray(event["@type"]) ? event["@type"][0] : event["@type"];
    const category = categoryForType(type);
    const key = `${normalizeText(event.name)}|${String(event.startDate).slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      id: url,
      title: stripTagsOneLine(event.name),
      description: event.description
        ? stripTagsOneLine(event.description).slice(0, 600)
        : undefined,
      start: event.startDate,
      end: event.endDate,
      venue: location?.name,
      address: address || undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      url,
      source: new URL(baseUrl).hostname,
      category,
      price,
      status: event.eventStatus?.split("/").pop(),
    });
  }
  return output;
}

function categoryForType(type: string | undefined): string {
  if (!type) return "event";
  if (/MusicEvent/i.test(type)) return "music";
  if (/TheaterEvent/i.test(type)) return "theater";
  if (/ComedyEvent/i.test(type)) return "comedy";
  if (/Festival/i.test(type)) return "festival";
  if (/SportsEvent/i.test(type)) return "sport";
  if (/EducationEvent/i.test(type)) return "education";
  return "event";
}

function formatPrice(offers: JsonLdEvent["offers"]): string | undefined {
  if (!offers) return undefined;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  if (!offer) return undefined;
  const low = offer.lowPrice ?? offer.price;
  const high = offer.highPrice;
  const currency = offer.priceCurrency ?? "UAH";
  if (low === undefined && high === undefined) return undefined;
  if (high !== undefined && low !== undefined && String(low) !== String(high)) {
    return `${low}–${high} ${currency}`;
  }
  return `${low ?? high} ${currency}`;
}

async function fetchKarabas(env: Env): Promise<CityEvent[]> {
  const pages = [
    "https://chernivtsi.karabas.com/concerts",
    "https://chernivtsi.karabas.com/theatre",
    "https://chernivtsi.karabas.com/festivals",
  ];
  const results = await Promise.allSettled(
    pages.map((url) =>
      fetchText(url, {
        ttlSeconds: 1800,
        userAgent: env.UPSTREAM_USER_AGENT,
        cacheKey: `events-karabas:${url}`,
      }),
    ),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? parseJsonLdEvents(result.value, "https://chernivtsi.karabas.com/") : [],
  );
}

async function fetchConcertUa(env: Env): Promise<CityEvent[]> {
  const urls = [
    "https://concert.ua/uk/catalog/chernivtsy/all-categories",
    "https://concert.ua/uk/catalog/chernivtsy/theater",
  ];
  const results = await Promise.allSettled(
    urls.map((url) =>
      fetchText(url, {
        ttlSeconds: 1800,
        userAgent: env.UPSTREAM_USER_AGENT,
        cacheKey: `events-concert:${url}`,
      }),
    ),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? parseJsonLdEvents(result.value, "https://concert.ua/") : [],
  );
}

async function fetchFairs(env: Env): Promise<CityEvent[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare(
    `SELECT id, title, start_date, end_date, place, organizer, source_url
     FROM event_fair ORDER BY start_date LIMIT 100`,
  ).all<{
    id: string;
    title: string;
    start_date: string | null;
    end_date: string | null;
    place: string | null;
    organizer: string | null;
    source_url: string | null;
  }>();
  return (result.results ?? [])
    .filter((row) => row.start_date)
    .map((row) => ({
      id: row.id,
      title: row.title,
      start: `${row.start_date}T12:00:00+02:00`,
      end: row.end_date ? `${row.end_date}T20:00:00+02:00` : undefined,
      venue: row.place ?? undefined,
      address: row.place ?? undefined,
      url: row.source_url ?? "https://data.gov.ua",
      source: "data.gov.ua fairs",
      category: "fair",
    }));
}

async function fetchOfficial(env: Env): Promise<CityEvent[]> {
  let cityEvents: CityEvent[] = [];
  try {
    const pages = await Promise.all(
      [1, 2, 3].map((page) => fetchCityList(env, "anonsy", page, 900)),
    );
    cityEvents = pages.flatMap((page) =>
      page.items.map((item) => ({
        id: item.url,
        title: item.title,
        start: parseUkrainianDate(item.title, new Date(), true) ?? item.publishedAt,
        url: item.url,
        source: "city.cv.ua",
        category: "official",
      })),
    );
  } catch {
    // city.cv.ua blocks Cloudflare egress; Telegram below is the official fallback.
  }
  try {
    const posts = await fetchTelegramPosts(env);
    return [...cityEvents, ...telegramEvents(posts)];
  } catch {
    return cityEvents;
  }
}

function dedupe(events: CityEvent[]): CityEvent[] {
  const seen = new Set<string>();
  const output: CityEvent[] = [];
  for (const event of events) {
    const key = `${normalizeText(event.title)}|${(event.start ?? "").slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(event);
  }
  return output;
}

export interface EventSearchOptions {
  query?: string;
  from?: string;
  to?: string;
  venue?: string;
  near?: string;
  radiusKm?: number;
  limit?: number;
  sources?: Array<"official" | "karabas" | "concert">;
}

export async function searchEvents(
  env: Env,
  options: EventSearchOptions = {},
): Promise<{ events: CityEvent[]; sources: string[]; warnings: string[] }> {
  const sources = options.sources ?? ["official", "karabas", "concert"];
  const tasks: Promise<CityEvent[]>[] = [fetchFairs(env)];
  if (sources.includes("official")) tasks.push(fetchOfficial(env));
  if (sources.includes("karabas")) tasks.push(fetchKarabas(env));
  if (sources.includes("concert")) tasks.push(fetchConcertUa(env));

  const settled = await Promise.allSettled(tasks);
  const warnings: string[] = [];
  const collected: CityEvent[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") collected.push(...result.value);
    else warnings.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }

  let nearPoint: Awaited<ReturnType<typeof geocodeQuery>> | undefined;
  if (options.near) {
    try {
      nearPoint = await geocodeQuery(env, options.near);
    } catch (error) {
      warnings.push(`Could not geocode near=${options.near}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 86400_000).toISOString();
  const from = options.from ?? defaultFrom;
  const to = options.to;
  const query = options.query ? normalizeText(options.query) : undefined;
  const venueQuery = options.venue ? normalizeText(options.venue) : undefined;

  const filtered: CityEvent[] = [];
  for (const event of dedupe(collected)) {
    if (!isWithin(event.start, from, to)) continue;
    if (query) {
      const haystack = normalizeText(
        [event.title, event.description, event.venue, event.address, event.category].filter(Boolean).join(" "),
      );
      if (!haystack.includes(query)) continue;
    }
    if (venueQuery) {
      const haystack = normalizeText([event.venue, event.address].filter(Boolean).join(" "));
      if (!haystack.includes(venueQuery)) continue;
    }

    if (nearPoint) {
      let lat = event.lat;
      let lon = event.lon;
      if ((!Number.isFinite(lat) || !Number.isFinite(lon)) && event.venue) {
        const venuePoint = await geocodeVenue(env, event.venue);
        if (venuePoint) {
          lat = venuePoint.lat;
          lon = venuePoint.lon;
          event.venue = event.venue ?? venuePoint.label;
        }
      }
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        event.distanceKm = roundKm(haversineKm(nearPoint, { lat: lat!, lon: lon! }));
        if (event.distanceKm > (options.radiusKm ?? 10)) continue;
      } else if (options.radiusKm) {
        continue;
      }
    }
    filtered.push(event);
  }

  filtered.sort((a, b) => {
    const aTime = parseIsoDate(a.start)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = parseIsoDate(b.start)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  return {
    events: filtered.slice(0, options.limit ?? 50),
    sources,
    warnings,
  };
}

export async function getEvent(env: Env, urlOrId: string): Promise<CityEvent> {
  if (/t\.me\//i.test(urlOrId)) {
    const post = await fetchTelegramPost(env, urlOrId);
    const start = parseUkrainianDate(post.text, new Date(), true) ?? post.publishedAt;
    const venue =
      /(?:📍|місце|локація|адреса)\s*:?\s*([^\n]{3,160})/i.exec(post.text)?.[1]?.trim();
    return {
      id: post.url,
      title: post.title,
      description: post.text.slice(0, 1500),
      start,
      venue,
      address: venue,
      url: post.url,
      source: "t.me/ChernivtsiCityCouncil",
      category: "official",
    };
  }
  if (/^https?:\/\//i.test(urlOrId) && /city\.cv\.ua/i.test(urlOrId)) {
    const article = await fetchCityArticle(env, urlOrId, "anonsy");
    const start =
      parseUkrainianDate(article.title, new Date(), true) ?? article.publishedAt;
    const address = firstMatch(article.body, /(м\.?\s*)?Чернівці[^.\n]{0,120}/i);
    return {
      id: article.url,
      title: article.title,
      description: article.body.slice(0, 1500),
      start,
      address,
      url: article.url,
      source: "city.cv.ua",
      category: "official",
    };
  }

  const eventUrl = /^https?:\/\//i.test(urlOrId)
    ? urlOrId
    : `https://chernivtsi.karabas.com/${urlOrId.replace(/^\/+/, "")}`;
  if (!/karabas\.com|concert\.ua/i.test(eventUrl)) {
    throw new Error("Only city.cv.ua, karabas.com, and concert.ua event URLs are supported.");
  }
  const html = await fetchText(eventUrl, {
    ttlSeconds: 1800,
    userAgent: env.UPSTREAM_USER_AGENT,
    cacheKey: `event:${eventUrl}`,
  });
  const events = parseJsonLdEvents(html, eventUrl);
  if (events.length === 0) {
    throw new Error(`No event metadata found at ${eventUrl}`);
  }
  return events[0]!;
}

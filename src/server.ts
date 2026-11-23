import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./types";
import { jsonResult } from "./lib/result";
import { asErrorMessage, toolFailure } from "./lib/errors";
import {
  CITY_SECTIONS,
  fetchCityArticle,
  fetchCityList,
  fetchStaticPage,
  searchCityDocuments,
  searchCitySection,
  type CitySection,
} from "./city/client";
import { getEvent, searchEvents } from "./events/events";
import { fetchTelegramPosts, fetchTelegramPost, telegramToItems } from "./city/telegram";
import {
  getCkanDataset,
  previewCkanResource,
  searchCkanDatasets,
} from "./opendata/ckan";
import {
  listGeoportalDatasets,
  previewGeoportalDataset,
} from "./opendata/geoportal";
import { searchAddressRows } from "./data/address";
import { searchPlaceRows } from "./data/places";
import { searchTransitRoutes, transitCandidates } from "./data/transit";
import { geocodeQuery } from "./travel/geocode";
import { planRoute } from "./travel/routing";
import {
  arrearsRanking,
  getLease,
  housingLookup,
  searchBudgetProjects,
  searchLandLeases,
  searchLeases,
  searchTariffs,
} from "./data/finance";
import { getCatalogDataset, searchCatalog } from "./data/catalog";
import { haversineKm, roundKm } from "./lib/geo";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const webReadOnly = { ...readOnly, openWorldHint: true } as const;
const localReadOnly = { ...readOnly, openWorldHint: false } as const;

function result(data: unknown, summary?: string) {
  return jsonResult(data, summary);
}

function failure(error: unknown) {
  return toolFailure(asErrorMessage(error), "Try a narrower query or open the source URL directly.");
}

async function listCitySectionLive(
  env: Env,
  section: CitySection,
  options: { query?: string; since?: string; page?: number; limit?: number },
) {
  if (options.query) {
    const items = await searchCitySection(env, section, options.query, 5);
    return {
      section,
      mode: "search",
      items: items.slice(0, options.limit ?? 30),
      source: CITY_SECTIONS[section].label,
    };
  }

  if (options.since) {
    const pages = await Promise.all([1, 2, 3, 4].map((page) => fetchCityList(env, section, page, 300)));
    const items = pages
      .flatMap((page) => page.items)
      .filter((item) => !item.publishedAt || item.publishedAt >= options.since!)
      .slice(0, options.limit ?? 50);
    return {
      section,
      mode: "since",
      since: options.since,
      items,
      source: CITY_SECTIONS[section].label,
    };
  }

  const page = await fetchCityList(env, section, options.page ?? 1);
  return {
    section,
    mode: "list",
    page: page.page,
    totalPages: page.totalPages,
    items: page.items.slice(0, options.limit ?? 30),
    source: page.source,
  };
}

async function listCitySection(
  env: Env,
  section: CitySection,
  options: { query?: string; since?: string; page?: number; limit?: number },
) {
  try {
    return await listCitySectionLive(env, section, options);
  } catch (error) {
    if (section !== "announcements" && section !== "anonsy" && section !== "news") throw error;
    let items = telegramToItems(await fetchTelegramPosts(env));
    if (options.query) {
      const needle = options.query.toLowerCase();
      items = items.filter((item) => item.title.toLowerCase().includes(needle));
    }
    if (options.since) {
      items = items.filter((item) => !item.publishedAt || item.publishedAt >= options.since!);
    }
    return {
      section: "telegram",
      mode: "fallback",
      items: items.slice(0, options.limit ?? 30),
      source: "https://t.me/ChernivtsiCityCouncil",
      warning:
        "city.cv.ua blocks requests from Cloudflare Workers. Showing the official Chernivtsi City Council Telegram channel instead.",
      originalError: asErrorMessage(error),
    };
  }
}

export function createServer(env: Env) {
  const server = new McpServer({
    name: "chernivtsi-city",
    version: "1.0.0",
  });

  server.registerTool(
    "city_announcements_list",
    {
      title: "Chernivtsi city announcements",
      description:
        "List or search official Chernivtsi City Council announcements (оголошення). Use since to catch announcements you may have missed. Returns titles, dates, and source URLs.",
      inputSchema: z.object({
        query: z.string().optional().describe("Optional text to search in announcement titles, e.g. 'слухання' or 'конкурс'"),
        since: z.string().optional().describe("ISO date/time; only return announcements published at or after this time"),
        page: z.number().int().min(1).optional().describe("Page number, 1-based"),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results, default 30"),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await listCitySection(env, "announcements", input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "city_announcement_get",
    {
      title: "Get a Chernivtsi announcement",
      description:
        "Fetch the full text, publication date, and attachments of one city.cv.ua announcement or anons.",
      inputSchema: z.object({
        idOrUrl: z.string().describe("Announcement id/slug or full city.cv.ua URL"),
        section: z.enum(["announcements", "anonsy", "news"]).optional().default("announcements"),
      }),
      annotations: webReadOnly,
    },
    async ({ idOrUrl, section }) => {
      try {
        if (/t\.me\//i.test(idOrUrl)) {
          const post = await fetchTelegramPost(env, idOrUrl);
          return result({
            id: post.id,
            title: post.title,
            url: post.url,
            publishedAt: post.publishedAt,
            section: "telegram",
            body: post.text,
            attachments: [],
            source: "https://t.me/ChernivtsiCityCouncil",
          });
        }
        return result(await fetchCityArticle(env, idOrUrl, section));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "city_news_list",
    {
      title: "Chernivtsi city news",
      description:
        "List or search recent official Chernivtsi city news. Useful for finding events, service changes, and city updates.",
      inputSchema: z.object({
        query: z.string().optional(),
        since: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await listCitySection(env, "news", input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "city_events_search",
    {
      title: "Search events in Chernivtsi",
      description:
        "Find upcoming events in Chernivtsi. Aggregates official city anonsy with Karabas and Concert.ua cultural events. Supports date range, free-text, venue, and proximity filters. Returns source-labelled links; it does not sell tickets.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free-text search, e.g. 'концерт', 'виставка', 'стендап'"),
        from: z.string().optional().describe("ISO date/time lower bound, default slightly in the past"),
        to: z.string().optional().describe("ISO date/time upper bound"),
        venue: z.string().optional().describe("Venue name or part of the address"),
        near: z.string().optional().describe("Address, venue, or coordinates to search near"),
        radiusKm: z.number().positive().max(50).optional().default(10),
        sources: z
          .array(z.enum(["official", "karabas", "concert"]))
          .optional()
          .describe("Optional source subset; default all three"),
        limit: z.number().int().min(1).max(100).optional().default(30),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await searchEvents(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "city_event_get",
    {
      title: "Get a Chernivtsi event",
      description:
        "Fetch one event by city.cv.ua, Karabas, or Concert.ua URL. Returns dates, venue, price, and description.",
      inputSchema: z.object({
        urlOrId: z.string().describe("Full event URL or a Karabas slug"),
      }),
      annotations: webReadOnly,
    },
    async ({ urlOrId }) => {
      try {
        return result(await getEvent(env, urlOrId));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "city_documents_search",
    {
      title: "Search Chernivtsi council documents",
      description:
        "Search city council decisions, draft decisions, executive committee decisions, and mayor orders on city.cv.ua. Returns dates, titles, and document download links.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search text, e.g. 'оренда' or 'бюджет'"),
        type: z
          .enum(["all", "1", "2", "3", "4", "5"])
          .optional()
          .default("all")
          .describe("1 draft council decisions, 2 draft executive decisions, 3 council decisions, 4 executive decisions, 5 mayor orders"),
        dateFrom: z.string().optional().describe("YYYY-MM-DD"),
        dateTo: z.string().optional().describe("YYYY-MM-DD"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional().default(30),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await searchCityDocuments(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "city_page_get",
    {
      title: "Read a city.cv.ua page",
      description:
        "Read an allowlisted city.cv.ua service page: administrative services, transport, local taxes, contacts, community pages, and similar material pages.",
      inputSchema: z.object({
        urlOrPath: z.string().describe("city.cv.ua URL or path such as /mt/meshkantsiu/administratyvni-poslugi-64"),
      }),
      annotations: webReadOnly,
    },
    async ({ urlOrPath }) => {
      try {
        return result(await fetchStaticPage(env, urlOrPath));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "opendata_search",
    {
      title: "Search Chernivtsi open data",
      description:
        "Search the data.gov.ua CKAN catalog for Chernivtsi City Council datasets. Returns dataset ids, titles, resource counts, and links.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search terms, e.g. 'оренда', 'тарифи', 'транспорт'"),
        format: z.string().optional().describe("Optional resource format, e.g. CSV, XLSX, JSON"),
        page: z.number().int().min(1).optional().default(1),
        limit: z.number().int().min(1).max(100).optional().default(20),
        allOrganizations: z.boolean().optional().default(false).describe("Search all of data.gov.ua instead of only Chernivtsi city council"),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await searchCkanDatasets(env, input));
      } catch (error) {
        const local = await searchCatalog(env, { query: input.query, limit: input.limit });
        return result(
          {
            ...local,
            fallback: true,
            warning:
              "data.gov.ua blocks requests from Cloudflare Workers; showing the bundled catalog snapshot. Run scripts/build_seed.py from the HelloData checkout to refresh it.",
            originalError: asErrorMessage(error),
          },
          undefined,
        );
      }
    },
  );

  server.registerTool(
    "opendata_dataset_get",
    {
      title: "Get an open-data dataset",
      description: "Fetch CKAN dataset metadata and resource links from data.gov.ua.",
      inputSchema: z.object({ id: z.string().describe("CKAN dataset id or name") }),
      annotations: webReadOnly,
    },
    async ({ id }) => {
      try {
        return result(await getCkanDataset(env, id));
      } catch (error) {
        const local = await getCatalogDataset(env, id);
        if (local.dataset) {
          return result({
            ...local,
            fallback: true,
            warning:
              "data.gov.ua blocks requests from Cloudflare Workers; showing the bundled catalog snapshot.",
          });
        }
        return failure(error);
      }
    },
  );

  server.registerTool(
    "opendata_resource_preview",
    {
      title: "Preview an open-data resource",
      description:
        "Preview a data.gov.ua resource by URL or resource id. Parses CSV/JSON with a row cap. XLSX/XLS resources return metadata and a download link.",
      inputSchema: z.object({
        url: z.string().optional().describe("Direct resource URL"),
        resourceId: z.string().optional().describe("CKAN resource id"),
        query: z.string().optional().describe("Optional case-insensitive text filter"),
        limit: z.number().int().min(1).max(100).optional().default(20),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await previewCkanResource(env, input));
      } catch (error) {
        return result({
          url: input.url,
          resourceId: input.resourceId,
          format: "unknown",
          downloadUrl: input.url,
          note:
            "Direct data.gov.ua downloads are blocked from Cloudflare Workers. Open the URL in a browser, or run the local sync script and use the D1-backed tools. " +
            asErrorMessage(error),
        });
      }
    },
  );

  server.registerTool(
    "geoportal_datasets",
    {
      title: "List Chernivtsi geoportal datasets",
      description:
        "List the map.city.cv.ua geoportal datasets: schools, kindergartens, healthcare, culture, housing, land leases, and more.",
      inputSchema: z.object({ query: z.string().optional() }),
      annotations: localReadOnly,
    },
    async ({ query }) => {
      try {
        return result(await listGeoportalDatasets(env, query));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "geoportal_preview",
    {
      title: "Preview a geoportal dataset",
      description:
        "Export and preview a map.city.cv.ua dataset as CSV. Reproduces the portal's two-step export flow on demand; results are cached.",
      inputSchema: z.object({
        datasetId: z.string().describe("Geoportal dataset id from geoportal_datasets"),
        query: z.string().optional().describe("Optional case-insensitive filter across row values"),
        limit: z.number().int().min(1).max(100).optional().default(20),
      }),
      annotations: webReadOnly,
    },
    async (input) => {
      try {
        return result(await previewGeoportalDataset(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "catalog_search",
    {
      title: "Search the local Chernivtsi data catalog",
      description:
        "Search the bundled catalog of Chernivtsi datasets and resources (data.gov.ua + geoportal), including snapshot metadata.",
      inputSchema: z.object({
        query: z.string().optional(),
        source: z.enum(["data.gov.ua", "map.city.cv.ua"]).optional(),
        limit: z.number().int().min(1).max(100).optional().default(40),
      }),
      annotations: localReadOnly,
    },
    async (input) => {
      try {
        return result(await searchCatalog(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "catalog_dataset_get",
    {
      title: "Get a catalog dataset",
      description: "Get one local catalog dataset and its resource list.",
      inputSchema: z.object({ id: z.string() }),
      annotations: localReadOnly,
    },
    async ({ id }) => {
      try {
        return result(await getCatalogDataset(env, id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "address_search",
    {
      title: "Search Chernivtsi addresses",
      description:
        "Find Chernivtsi addresses in the city address register and return coordinates. Use it before routing or nearby searches.",
      inputSchema: z.object({
        query: z.string().describe("Street and optional house, e.g. 'Головна 100' or 'вул. Кобилянської 2'"),
        limit: z.number().int().min(1).max(30).optional().default(10),
      }),
      annotations: localReadOnly,
    },
    async ({ query, limit }) => {
      try {
        return result({ addresses: await searchAddressRows(env, query, limit), source: "city address register" });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "place_search",
    {
      title: "Search city places",
      description:
        "Find schools, kindergartens, hospitals, clinics, cultural venues, parks, playgrounds, waste points, dog areas, shelters, and other city places. Supports category and proximity filters.",
      inputSchema: z.object({
        query: z.string().optional().describe("Place name or address text"),
        category: z.string().optional().describe("Category key, e.g. school, kindergarten, healthcare, culture, park, playground, waste, dog_area, shelter, parking"),
        near: z.string().optional().describe("Address, venue, or coordinates"),
        radiusKm: z.number().positive().max(50).optional().default(5),
        limit: z.number().int().min(1).max(100).optional().default(30),
      }),
      annotations: localReadOnly,
    },
    async ({ query, category, near, radiusKm, limit }) => {
      try {
        const nearPoint = near ? await geocodeQuery(env, near) : undefined;
        const places = await searchPlaceRows(env, {
          query,
          category,
          near: nearPoint ? { lat: nearPoint.lat, lon: nearPoint.lon } : undefined,
          radiusKm,
          limit,
        });
        return result({ places, near: nearPoint, source: "city places register" });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "travel_route",
    {
      title: "Plan a route in Chernivtsi",
      description:
        "Plan driving or walking directions between two Chernivtsi addresses, venues, or coordinates. Returns distance, duration, and turn-by-turn steps from OpenStreetMap/OSRM.",
      inputSchema: z.object({
        from: z.string().describe("Origin address, venue, or 'lat,lon'"),
        to: z.string().describe("Destination address, venue, or 'lat,lon'"),
        mode: z.enum(["driving", "walking"]).optional().default("driving"),
      }),
      annotations: webReadOnly,
    },
    async ({ from, to, mode }) => {
      try {
        return result(await planRoute(env, from, to, mode));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "transit_candidates",
    {
      title: "Find public transport routes",
      description:
        "Find bus/trolleybus routes whose stop lists connect two Chernivtsi streets or areas. This is route-level guidance from city open data, not live arrival times.",
      inputSchema: z.object({
        from: z.string().describe("Origin street or area, e.g. 'вул. Головна'"),
        to: z.string().describe("Destination street or area, e.g. 'вул. Руська'"),
      }),
      annotations: localReadOnly,
    },
    async ({ from, to }) => {
      try {
        const data = await transitCandidates(env, from, to);
        return result({
          ...data,
          note:
            "Route-level candidates from the city open-data route/stop lists. Schedules and live vehicle positions are not available in the open data.",
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "transit_routes_search",
    {
      title: "Search transit routes",
      description: "Search Chernivtsi bus and trolleybus route numbers, names, and stop lists.",
      inputSchema: z.object({
        query: z.string().describe("Route number, route name, or stop name"),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      annotations: localReadOnly,
    },
    async ({ query, limit }) => {
      try {
        return result({ routes: await searchTransitRoutes(env, query, limit), source: "city transport open data" });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "nearby_search",
    {
      title: "Find places and events nearby",
      description:
        "Find city places and upcoming events within a radius of an address, venue, or coordinate.",
      inputSchema: z.object({
        near: z.string().describe("Address, venue, or 'lat,lon'"),
        radiusKm: z.number().positive().max(50).optional().default(3),
        categories: z.array(z.string()).optional().describe("Optional place category filter"),
        includeEvents: z.boolean().optional().default(true),
      }),
      annotations: webReadOnly,
    },
    async ({ near, radiusKm, categories, includeEvents }) => {
      try {
        const point = await geocodeQuery(env, near);
        const places = await searchPlaceRows(env, {
          near: { lat: point.lat, lon: point.lon },
          radiusKm,
          limit: 50,
        });
        const filteredPlaces = categories?.length
          ? places.filter((place) => categories.includes(place.category))
          : places;
        let events: unknown[] = [];
        if (includeEvents) {
          const eventResult = await searchEvents(env, {
            near,
            radiusKm,
            limit: 30,
          });
          events = eventResult.events;
        }
        return result({
          center: point,
          radiusKm,
          places: filteredPlaces.map((place) => ({
            ...place,
            distanceKm:
              place.lat !== undefined && place.lon !== undefined
                ? roundKm(haversineKm(point, { lat: place.lat, lon: place.lon }))
                : place.distanceKm,
          })),
          events,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "leases_search",
    {
      title: "Search communal property leases",
      description:
        "Search Chernivtsi communal building leases by tenant, address, intended use, debt, or expiry. Individual tenants are anonymised.",
      inputSchema: z.object({
        query: z.string().optional(),
        street: z.string().optional(),
        minDebt: z.number().optional().describe("Minimum debt in UAH"),
        expiringBefore: z.string().optional().describe("YYYY-MM-DD"),
        limit: z.number().int().min(1).max(100).optional().default(30),
      }),
      annotations: localReadOnly,
    },
    async (input) => {
      try {
        return result(await searchLeases(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "lease_get",
    {
      title: "Get a communal lease",
      description: "Get one communal building lease by numeric id or contract number.",
      inputSchema: z.object({ idOrContract: z.string() }),
      annotations: localReadOnly,
    },
    async ({ idOrContract }) => {
      try {
        return result({ lease: await getLease(env, idOrContract) });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "arrears_ranking",
    {
      title: "Rank communal lease arrears",
      description:
        "Rank building-lease arrears by anonymised tenant or by street. Uses the 2026-10-01 snapshot.",
      inputSchema: z.object({
        by: z.enum(["tenant", "street"]).optional().default("street"),
        limit: z.number().int().min(1).max(50).optional().default(10),
      }),
      annotations: localReadOnly,
    },
    async ({ by, limit }) => {
      try {
        return result(await arrearsRanking(env, by, limit));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "land_leases_search",
    {
      title: "Search land lease contracts",
      description:
        "Search Chernivtsi communal land lease contracts by tenant, address, cadastral number, or status. Individual tenants are anonymised.",
      inputSchema: z.object({
        query: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional().default(30),
      }),
      annotations: localReadOnly,
    },
    async (input) => {
      try {
        return result(await searchLandLeases(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "housing_lookup",
    {
      title: "Look up a building and housing account",
      description:
        "Look up a Chernivtsi building by street and house: manager, manager EDRPOU, floors, apartments, area, debt, and recent housing invoices.",
      inputSchema: z.object({
        street: z.string(),
        house: z.string().optional(),
      }),
      annotations: localReadOnly,
    },
    async ({ street, house }) => {
      try {
        return result(await housingLookup(env, street, house));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "tariffs_search",
    {
      title: "Search communal tariffs",
      description:
        "Search Chernivtsi communal service tariffs (heat, water, waste, parking, transport) by provider, type, or date.",
      inputSchema: z.object({
        query: z.string().optional(),
        provider: z.string().optional(),
        activeOn: z.string().optional().describe("YYYY-MM-DD; only tariffs valid on this date"),
        limit: z.number().int().min(1).max(100).optional().default(40),
      }),
      annotations: localReadOnly,
    },
    async (input) => {
      try {
        return result(await searchTariffs(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "budget_projects_search",
    {
      title: "Search road and construction projects",
      description:
        "Search Chernivtsi road-repair and construction/renovation projects by text, with costs, contractors, and status.",
      inputSchema: z.object({
        query: z.string().optional(),
        type: z.enum(["road", "construction", "all"]).optional().default("all"),
        limit: z.number().int().min(1).max(50).optional().default(20),
      }),
      annotations: localReadOnly,
    },
    async (input) => {
      try {
        return result(await searchBudgetProjects(env, input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerPrompt(
    "chernivtsi_trip_brief",
    {
      title: "Chernivtsi trip brief",
      description: "Plan a trip to Chernivtsi: events, places, and routes.",
      argsSchema: {
        dates: z.string().optional().describe("Travel dates, e.g. 2026-11-05..2026-11-07"),
        interests: z.string().optional().describe("Interests, e.g. music, parks, family"),
        origin: z.string().optional().describe("Where the traveller starts"),
      },
    },
    ({ dates, interests, origin }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "You are helping a traveller with Chernivtsi, Ukraine.",
              dates ? `Travel dates: ${dates}.` : "",
              interests ? `Interests: ${interests}.` : "",
              origin ? `Origin: ${origin}.` : "",
              "1. Use city_events_search for the dates.",
              "2. Use place_search or nearby_search for places matching the interests.",
              "3. If the traveller gives an origin and destination, use travel_route and transit_candidates.",
              "Cite source URLs and mention that transit data is route-level, not live.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "city_weekly_brief",
    {
      title: "Chernivtsi weekly brief",
      description: "Summarise recent city announcements and upcoming events.",
      argsSchema: {
        since: z.string().optional().describe("Start date/time; default 7 days ago"),
      },
    },
    ({ since }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Prepare a concise Chernivtsi weekly brief.",
              since
                ? `Announcements since ${since}.`
                : "Use city_announcements_list with since set to 7 days ago.",
              "Then use city_events_search for the next 14 days.",
              "Group by: city announcements, official meetings, cultural events, and practical changes.",
              "Include dates and source links.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}

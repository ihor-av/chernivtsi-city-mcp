import { ToolError } from "./errors";

const DEFAULT_UA = "ChernivtsiCityMCP/1.0 (public-data MCP server)";
const DEFAULT_TTL = 300;

export interface FetchOptions {
  ttlSeconds?: number;
  headers?: Record<string, string>;
  cacheKey?: string;
  userAgent?: string;
  timeoutMs?: number;
  retries?: number;
  bypassCache?: boolean;
}

function defaultCache(): Cache | undefined {
  if (typeof caches === "undefined") return undefined;
  return (caches as unknown as { default?: Cache }).default;
}

function cacheAvailable(): boolean {
  return defaultCache() !== undefined;
}

function cacheRequest(url: string, key?: string): Request {
  return new Request(key ?? url, { method: "GET" });
}

export async function cachedFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const cacheKey = options.cacheKey ?? url;
  const request = cacheRequest(url, cacheKey);

  const cache = defaultCache();
  if (!options.bypassCache && cache) {
    try {
      const cached = await cache.match(request);
      if (cached) {
        const response = new Response(cached.body, cached);
        response.headers.set("x-mcp-cache", "hit");
        return response;
      }
    } catch {
      // Cache API is best-effort.
    }
  }

  const headers = new Headers(options.headers ?? {});
  headers.set("user-agent", options.userAgent ?? DEFAULT_UA);
  headers.set("accept-language", "uk,en;q=0.8");
  if (!headers.has("accept")) headers.set("accept", "*/*");

  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: "follow",
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new ToolError(`Upstream returned 404 for ${url}`, "The page or dataset may have moved.");
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
            continue;
          }
        }
        throw new ToolError(`Upstream returned HTTP ${response.status} for ${url}`);
      }

      if (cache) {
        try {
          const cacheResponse = new Response(response.clone().body, response);
          cacheResponse.headers.set("cache-control", `public, max-age=${options.ttlSeconds ?? DEFAULT_TTL}`);
          await cache.put(request, cacheResponse);
        } catch {
          // ignore cache write errors
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof ToolError) throw lastError;
  throw new ToolError(
    `Could not fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    "Try again later or open the source URL directly.",
  );
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await cachedFetch(url, options);
  return response.text();
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await cachedFetch(url, options);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ToolError(`Upstream did not return valid JSON for ${url}`);
  }
}

export async function fetchWithCookies(
  url: string,
  options: FetchOptions & { cookie?: string } = {},
): Promise<{ response: Response; cookies: string[] }> {
  const headers = new Headers(options.headers ?? {});
  headers.set("user-agent", options.userAgent ?? DEFAULT_UA);
  headers.set("accept-language", "uk,en;q=0.8");
  if (options.cookie) headers.set("cookie", options.cookie);

  const response = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") ?? "").split(/,(?=\s*[^;=]+=)/);
  return { response, cookies: setCookies.filter(Boolean) };
}

export function cookiesToHeader(setCookies: string[]): string {
  return setCookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

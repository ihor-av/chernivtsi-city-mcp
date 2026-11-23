import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";
import type { Env } from "./types";
import { refreshAnnouncements } from "./city/client";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        status: "ok",
        name: "chernivtsi-city",
        version: "1.0.0",
        mcp: `${url.origin}/mcp`,
        protocol: "MCP 2026-07-28 (stateless) with legacy fallback",
        data: {
          live: ["city.cv.ua", "karabas.com", "concert.ua", "data.gov.ua", "map.city.cv.ua"],
          local: ["address register", "places", "transit", "leases", "housing", "tariffs", "budget projects"],
          routing: ["OSRM/OpenStreetMap", "Nominatim"],
        },
        note: "Read-only public data. No payments or ticket purchases.",
      });
    }

    if (url.pathname === "/") {
      return new Response(
        `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Chernivtsi City MCP</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1rem;line-height:1.5}code{background:#eee;padding:.1rem .3rem;border-radius:4px}</style>
</head>
<body>
<h1>Chernivtsi City MCP</h1>
<p>Public, read-only MCP server for Chernivtsi: city announcements, events, open data, places, transit, leases, housing, tariffs, and routes.</p>
<p>MCP endpoint: <code>${url.origin}/mcp</code></p>
<p>Health: <a href="/health">/health</a></p>
<p>Connect with an MCP client using Streamable HTTP. Example: <code>claude mcp add --transport http chernivtsi ${url.origin}/mcp</code></p>
<p>This server does not process payments, tax filings, or ticket purchases.</p>
</body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    if (url.pathname === "/mcp") {
      const handler = createMcpHandler(() => createServer(env));
      return handler(request, env, ctx);
    }

    return json({ error: "Not found", mcp: `${url.origin}/mcp`, health: `${url.origin}/health` }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      refreshAnnouncements(env).catch((error) => {
        console.error("announcement refresh failed", error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;

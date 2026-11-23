# MCP from zero

A hands-on workshop for developers who have never used MCP.

You do **not** need to know what MCP is. You do **not** need a Cloudflare account. You need Node and a terminal.

By the end you will have built a small MCP server, connected it to a real AI client, given it data, made it survive an upstream outage, and then read the production Chernivtsi server without getting lost.

---

## What is MCP, in three sentences

MCP (Model Context Protocol) is a standard way for an AI assistant to call functions that live outside the chat.

The assistant asks your server "what tools do you have?", then "run this tool with these arguments".

That is the whole idea. The rest is plumbing.

---

## Start here

```bash
npm install
```

Then open two terminals.

**Terminal 1** — start a lesson's server:

```bash
npm run w00
```

**Terminal 2** — run its client:

```bash
npm run w00:client
```

Read the lesson's `README.md` before running it. Each one is short.

---

## The steps

| Step | Folder | What you learn | Status |
|---|---|---|---|
| 00 | [`00-json-rpc`](./00-json-rpc/README.md) | A remote function call is just JSON | Ready |
| 01 | [`01-hello-mcp`](./01-hello-mcp/README.md) | MCP is three methods | Ready |
| 02 | `02-sdk-stdio` | The official SDK and stdio | Next |
| 03 | `03-tools-in-practice` | Descriptions, schemas, errors | Next |
| 04 | `04-worker-hello` | The same server on Cloudflare Workers | Next |
| 05 | `05-worker-d1` | Real data in SQLite/D1 | Next |
| 06 | `06-cache-fallback` | Surviving an upstream outage | Next |
| 07 | `07-scrape-to-json` | Turning HTML into structured data | Next |
| 08 | `08-geo` | Coordinates, distance, nearby results | Next |
| 09 | `09-tests-evals` | Tests and evals | Next |
| 10 | `10-capstone` | Tour of the real Chernivtsi server | Next |

This is a living workshop. Steps 00-01 are ready now; the rest are being built in order. Each new step gets a tag, so you can always jump ahead or catch up:

```bash
git tag                    # list the steps
git checkout step-04-worker-hello
```

---

## How to use this repo without getting lost

- **One step at a time.** Do not open `src/` yet. It will still be there at step 10.
- **Read the output.** The client prints what it sent and what it got back. That is the lesson.
- **Break things on purpose.** Change a name, remove a field, return an error. The server is small and you can always `git checkout .`.
- **If you are stuck for more than five minutes, ask.** Struggle is useful for five minutes, not fifty.

The real server in `src/` is the destination. The workshop is the path.

---

## Where the plan lives

Facilitators and the curious can read [`../docs/WORKSHOP_PLAN.md`](../docs/WORKSHOP_PLAN.md) for the full curriculum, time budget, and hiring notes.

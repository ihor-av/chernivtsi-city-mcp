# Workshop plan: MCP from zero to this server

Status: proposed, first two lessons implemented.
Audience: aspiring developers who know a little JavaScript and can use a terminal.
Goal: a person who has never heard of MCP can start at step 00, finish at step 10, and then read and extend the real Chernivtsi server with confidence.

The workshop is deliberately **not** a trimmed copy of the current codebase. The current codebase is the destination, not the starting point. Steps 00-09 use a small, neutral example (a coffee-shop directory, a fictional events page) so nobody has to learn Ukrainian city data, Cloudflare, and MCP at the same time.

---

## Design principles

1. **One idea per step.** If a step needs two new ideas, it becomes two steps.
2. **One command to run it.** `npm run w00`, `npm run w01`, and so on.
3. **Visible result in under five minutes.** A printed value, a curl response, or a tool call from a real client.
4. **No accounts, no Docker, no build step** until the learner is ready. Node is enough for steps 00-03.
5. **No gatekeeping.** Every exercise has a checkpoint, a hint, and a solution path. Stretch goals are optional and never required to continue.
6. **The real project is the capstone.** Step 10 is a guided tour that maps every workshop concept onto `src/`.
7. **Small files.** Core lesson files stay around 40-100 lines. Big files are intimidating and hide the point.

---

## The path

| Step | Folder | The one idea | Domain | Time |
|---|---|---|---|---|
| 00 | `workshop/00-json-rpc` | A remote function call is just JSON in, JSON out | none | 20 min |
| 01 | `workshop/01-hello-mcp` | MCP is three methods: initialize, tools/list, tools/call | none | 30 min |
| 02 | `workshop/02-sdk-stdio` | The official SDK removes protocol boilerplate; stdio is one transport | none | 25 min |
| 03 | `workshop/03-tools-in-practice` | A good tool description and schema is prompt engineering | coffee shops | 30 min |
| 04 | `workshop/04-worker-hello` | The same server on Cloudflare Workers, locally | none | 30 min |
| 05 | `workshop/05-worker-d1` | Real data lives in SQLite/D1; use prepared statements | coffee shops | 40 min |
| 06 | `workshop/06-cache-fallback` | Upstreams fail; cache and degrade instead of disappearing | weather | 40 min |
| 07 | `workshop/07-scrape-to-json` | Turn messy HTML into a stable tool result using fixtures | events | 40 min |
| 08 | `workshop/08-geo` | Coordinates, distance, nearest results, optional routing | places | 40 min |
| 09 | `workshop/09-tests-evals` | Tests protect parsers; evals protect answers | all | 30 min |
| 10 | `workshop/10-capstone` | Tour the real Chernivtsi server and add one tool | Chernivtsi | 60 min |

Total: roughly 6.5 hours, or three sessions:

- **Session A (2 hours):** 00-03. Pure Node, no cloud.
- **Session B (2.5 hours):** 04-07. Local Workers, data, resilience, scraping.
- **Session C (2 hours):** 08-10. Geo, quality, capstone.

Steps 04-06 use `wrangler dev --local`. No Cloudflare account and no deploy are required. Deployment is an optional stretch goal.

---

## Repository layout

```text
.
├── README.md                 # project overview + link to the workshop
├── docs/
│   └── WORKSHOP_PLAN.md      # this document (facilitator-facing)
├── workshop/
│   ├── README.md             # the learner-facing map
│   ├── 00-json-rpc/
│   │   ├── README.md
│   │   ├── server.mjs
│   │   └── client.mjs
│   ├── 01-hello-mcp/
│   │   ├── README.md
│   │   ├── server.mjs
│   │   └── client.mjs
│   ├── 02-sdk-stdio/
│   ├── 03-tools-in-practice/
│   ├── 04-worker-hello/
│   ├── 05-worker-d1/
│   ├── 06-cache-fallback/
│   ├── 07-scrape-to-json/
│   ├── 08-geo/
│   ├── 09-tests-evals/
│   └── 10-capstone/
├── src/                      # the real server, unchanged
├── migrations/
├── seed/
├── scripts/
├── test/
└── evals/
```

Conventions:

- `workshop/NN-name/README.md` is the lesson.
- Lesson code is plain `.mjs` until step 04, then TypeScript where the Worker runtime expects it.
- Each lesson uses a different port, so previous servers can stay running:
  - 00: `3000`
  - 01: `3001`
  - 02: stdio (no port)
  - 03: `3003`
  - 04+: `8787` (Wrangler default)
- Root `package.json` exposes `w00`, `w01`, ... so nobody has to remember paths.

---

## Lesson contract

Every lesson README has the same seven sections. This consistency is what keeps the workshop from feeling scary.

```markdown
# Step NN — Title

## Goal
One sentence: what you will be able to do.

## The idea
A short plain-language explanation. One concept, one analogy.

## Run it
Two terminals: server, then client. Exact commands.

## See it
The expected output, quoted.

## Try it
Three small changes, easiest first. No trick questions.

## Checkpoint
One observable result. If you see this, you are done.

## Map to the real server
Links to the file in `src/` that uses the same idea.
```

The "Map to the real server" section is important. It turns the workshop from a toy into an on-ramp: after every step, the learner sees that the production code is the same pattern at a larger scale.

---

## What each future lesson contains

### 02 — SDK and stdio
- Replace the hand-written JSON-RPC switch with `McpServer` and `StdioServerTransport`.
- Same `add` tool, about 15 lines.
- Connect MCP Inspector and/or Claude Desktop.
- Checkpoint: Inspector lists `add`; calling it prints `2 + 3 = 5`.

### 03 — Tools in practice
- A JSON file of coffee shops plus `search_shops` and `shop_get`.
- Descriptions written for a model, not for a human.
- Zod schema with enums and defaults.
- Friendly `isError: true` results instead of stack traces.
- Checkpoint: search for `"late"` returns the late-night shop; invalid input gets a helpful message.

### 04 — First Worker
- `wrangler.jsonc` minimal config.
- `createMcpHandler(() => createServer())`.
- Same `add` tool, now at `http://localhost:8787/mcp`.
- No account, no deploy.
- Checkpoint: `curl` and MCP Inspector both work.

### 05 — D1
- Create a `shop` table, seed 20 rows.
- `search_text` column and a `LIKE` query.
- Prepared statements and `.bind()`.
- Checkpoint: `search_shops` returns rows from the database, not the JSON file.

### 06 — Cache and fallback
- A fake upstream server that can be switched to fail.
- Cache the last good response in D1.
- Return `{ mode: "fallback", warning }` when the upstream is down.
- Checkpoint: stop the upstream, call the tool again, still get data plus a warning.

### 07 — Scrape to JSON
- A saved HTML fixture of a fictional events page.
- A regex parser with a `stripTags` helper.
- A tool that returns clean objects, not HTML.
- Checkpoint: three events with title, date, venue; one malformed block ignored.

### 08 — Geo
- `haversineKm` and a bounding-box prefilter.
- `nearby` search over the coffee shops.
- Optional: call OSRM and translate one instruction.
- Checkpoint: the shop 0.3 km away appears first.

### 09 — Tests and evals
- Vitest tests for the parsers from steps 07-08 using fixtures.
- Five question/answer pairs in MCP eval XML format.
- Checkpoint: `npm test` passes; one eval question is answerable using only the tools.

### 10 — Capstone
- Guided tour of `src/index.ts`, `src/server.ts`, `src/lib/http.ts`, `src/data/*`.
- Exercise: add `shop_count`-style tool to the real server, or a new field to an existing tool.
- Exercise: add a fallback warning to an existing tool.
- No timed test. The goal is to leave with one merged change.

---

## Git workflow

The current project is committed as the baseline and tagged:

```text
baseline-chernivtsi
```

For the workshop:

- One commit per lesson, with a message such as `step 04: first Worker`.
- One tag per lesson: `step-00-json-rpc`, `step-01-hello-mcp`, ...
- `main` always contains the complete, runnable workshop.
- `git log --reverse --oneline` becomes the syllabus.
- A learner who falls behind can jump to a tag:

```bash
git checkout step-04-worker-hello
```

Tags are friendlier than branches and avoid merge pain during a workshop.

---

## Facilitating and hiring

The workshop doubles as a hiring funnel. Keep it humane:

- **Pair, do not quiz.** Sit with each person for 30 minutes and watch how they read an error.
- **Value debugging over trivia.** "What does this error tell you?" beats "What is the difference between SSE and WebSocket?"
- **Offer hints immediately.** Struggle is useful for five minutes, not fifty.
- **Stretch goals are optional.** Nobody should feel behind because they skipped the OSRM exercise.
- **Final exercise has no wrong answer.** "Add one tool you think would help a visitor" is enough to start a conversation.
- **Signals to notice:** reads the output before changing code, makes one change at a time, asks a precise question, checks the checkpoint.
- **Avoid:** timed tests, leetcode, whiteboard algorithms, and asking beginners to explain OAuth or Durable Objects.

---

## Build order and definition of done

Build in this order so each new lesson can reuse the previous one:

1. 00-01: protocol fundamentals (done).
2. 02-03: SDK and tool design.
3. 04-06: Workers and D1.
4. 07-08: parsing and geo.
5. 09-10: tests and capstone.
6. Facilitator notes, check script, and a fresh-clone walkthrough.

Definition of done:

- A fresh clone plus `npm install` runs every step.
- Every step has a checkpoint that can be verified without guessing.
- No step requires more than two files to start.
- No step requires a paid account.
- The capstone links each concept to the real `src/` file that uses it.
- A developer who has never used MCP can finish session A in one sitting.

---

## Risks and decisions

- **SDK version churn.** `@modelcontextprotocol/server` v2 is new. Pin versions in the root `package.json` and avoid features the workshop does not need.
- **Network flakiness.** Prefer local fixtures and a fake upstream. Live city sites and routing APIs are optional, not required, for checkpoints.
- **Cloudflare fear.** Steps 04-06 are local-only. Say this explicitly at the start of session B.
- **Data size.** The workshop uses tens of rows, not the real 31,845 addresses. The capstone can mention the real scale without asking anyone to load it.
- **Secrets.** `.env` is ignored and must stay ignored. No lesson needs an API key.
- **Duplication.** The workshop intentionally duplicates small patterns from `src/`. That is cheaper than asking beginners to navigate the full server on day one.

# LMApi HomeBase Integration Plan

**Status:** Approved 2026-08-16. Phased, with a stop-and-verify checkpoint
after each phase — implement one phase per session unless a session
explicitly continues further; commit at each checkpoint before moving on.
**Target repository:** LMApi (this repository)
**Requested outcome:** Add a compiled, import-safe hosted adapter so LMApi
can become one of HomeBase's integrated sibling applications, while
remaining fully usable standalone. Unlike DevPlanner's HomeBase integration,
LMApi needs **no runtime/framework migration** — it is already Node 24 /
Express 5 / TypeScript / vitest. The work here is narrower: splitting
`app.ts`'s import-time side effects into a real composition root, removing
`process.cwd()`-relative paths, namespacing Socket.IO, and adding proper
shutdown/dispose behavior.
**HomeBase references:** HomeBase's [README](../../../HomeBase/README.md),
[SPECIFICATION.md](../../../HomeBase/docs/SPECIFICATION.md), and
[TASKS.md](../../../HomeBase/docs/TASKS.md) describe the portal side of this
integration (paths are relative to a workspace where LMApi and HomeBase are
sibling checkouts — adjust if your layout differs). HomeBase Phase 4 (the
hosted adapter runtime) is complete, and DevPlanner is the first sibling
application to complete this same migration — its plan
(`C:\LocalDev\Projects\DevPlanner\docs\plans\2026-08-16-homebase-integration.md`)
and handoff doc
(`C:\LocalDev\Projects\DevPlanner\docs\features\homebase-integration-handoff.md`)
are useful precedent for phase shape, the `export =` hosted-entry pattern,
and the realtime self-filtering pattern, though LMApi's actual blockers
differ (see §2).

## Changelog

Append one entry per completed phase, newest first. Format:

```
### YYYY-MM-DD — Phase N: <name> (COMPLETE)
What was done, any deviation from this plan and why, verification run,
what's next.
```

### 2026-08-21 — Phase 1: Composition-root split (COMPLETE)

Re-verified §2's findings against the current repo first — several commits
had landed since 2026-08-16 (Swagger UI, a 220-test Vitest suite, real-time
server management), but none touched the core blockers; all findings held
exactly as documented (the stray `bun.lock` was already gone by this point,
and the "ten route modules" phrasing undercounted by one — 9 route files
plus `schemas.ts` — but this didn't affect scope).

Extracted `buildApp()` in `src/app.ts`: constructs `express()` and the raw
`http.Server` inside the function (not module scope), mounts all
middleware/static assets/dashboard routes/Swagger/all route modules/error
handler exactly as before, and returns `{ app, httpServer }` with zero I/O.
Kept `app.ts` as the standalone entry point (no new `standalone.ts` file —
not needed until phase 7 per the plan's own allowance). The former
double call to `ConfigService.loadConfig()` (once at old module scope,
once inside `start()`) collapsed to a single call in `start()`, now ahead
of `buildApp()` so `ConfigService.getPort()` still resolves correctly. No
deviation from the plan otherwise — services remain static classes, no DI
rewrite attempted, no path/logging/base-path/Socket.IO changes made (those
are phases 2–6).

**Verification:** `tsc --noEmit` clean. `npm test` — 220/220 tests pass
unchanged (they don't import `app.ts`, confirmed unaffected). `npm run dev`
booted successfully; live-checked `GET /health`, `/`, `/dashboard`,
`/history`, `/evaluator`, `/api-docs` (301 → `/api-docs/`, standard
swagger-ui redirect), and `GET /api/servers` — all responded identically
to pre-change behavior.

**Next:** Phase 2 — path/config injection. Must resolve §7.1
(`servers.json` live-mutation location: keep in repo tree vs. copy to
injected writable data dir) before or during that phase, since it
determines the phase's exact scope.

## 1. Goal and success criteria

LMApi should be loadable as one of possibly several applications inside
HomeBase's single Node process/Express app/shared `http.Server`, beneath
`/lmapi/`, while:

- remaining fully installable, buildable, testable, and runnable standalone
  from this repository, on the same Node 24/npm toolchain, with no behavior
  change to standalone mode beyond what's explicitly decided in §7 (Open
  Decisions);
- exposing a compiled JavaScript hosted entry point (`dist/host/index.js`)
  that HomeBase can `import()` without pulling in LMApi's TypeScript source
  tree;
- never listening on a port, opening files, starting watchers/timers, or
  installing process handlers merely by being imported;
- correctly self-scoping every route, static asset, Socket.IO connection,
  cookie, and browser-storage key beneath `/lmapi/` so it cannot collide
  with HomeBase or a sibling application sharing the same origin and
  `http.Server`;
- reporting honest `ready`/`degraded` status and disposing every resource it
  acquired (SQLite connection, background polling interval, Socket.IO
  server), idempotently, within HomeBase's timeout budgets; and
- using HomeBase's injected structured logger in hosted mode while keeping
  its own file-based `pino` logger in standalone mode.

Success is verified by the acceptance matrix in §6, run against a real
HomeBase checkout with LMApi registered and `enabled: true`.

## 2. Verified current-state findings

Read directly from `C:\LocalDev\Projects\LMApi` (not guessed) on
2026-08-16:

**Runtime and framework.** Node 24, npm, Express 5.2.1, TypeScript,
`"type": "commonjs"`, vitest already in place (`npm test` → `vitest run`).
No Bun/Elysia anywhere — a stray `bun.lock` exists at repo root but every
script (`ts-node`, `tsc`, `node dist/app.js`, `vitest`) confirms this has
never actually been a Bun project; that lockfile can likely be deleted as
part of cleanup (§5, phase 9) once confirmed unused.

**Server composition — the core blocker.** `src/app.ts` (116 lines) is a
run-to-completion script, not a composable module:
- Builds `const app = express()` and `const httpServer = createServer(app)`
  at module top level (not inside a function).
- Calls `ConfigService.loadConfig()`/`getPort()` at import time.
- Mounts all middleware, static assets, swagger, and all ten route modules
  unconditionally at module load.
- Defines `async function start()` (constructs `DbService`, `ProviderService`,
  `SocketService`, `ServerPoolService` via their `.initialize()` statics,
  then calls `httpServer.listen()`), and then **calls `start()`
  unconditionally at the bottom of the file** — importing this module starts
  an HTTP server as a side effect.
- Compiled `dist/app.js` has zero exports — confirmed by direct inspection,
  no `module.exports`/`exports.default` anywhere in the file.
- `process.exit(1)` occurs once, inside `start()`'s `catch` block (not in a
  constructor) — easier to remove than DevPlanner's constructor-level exit
  was.
- No `SIGINT`/`SIGTERM` handlers exist anywhere in the codebase.

**Services are static-only classes, not instances.** `ConfigService`,
`DbService`, `LogService`, `ProviderService`, `SocketService`,
`ServerPoolService`, etc. expose only `static` members — effectively
module-scoped globals. There is no `getInstance()` pattern to remove (unlike
DevPlanner), but there's also no constructor-injection seam to build on;
phase 1 below establishes one.

**`process.cwd()`-relative paths — 12 call sites across 9 files, resolved at
module-load time as `private static` field initializers:**

| File | Path | Purpose |
|---|---|---|
| `app.ts:37` | `process.cwd()/src/public` | static dashboard assets |
| `app.ts:41` | `process.cwd()/scripts` | second static mount |
| `services/ConfigService.ts:19` | `process.cwd()/src/config/servers.json` | server pool config (read) |
| `services/DbService.ts:60` | `process.cwd()/data/history.db` | SQLite (mkdir'd if missing) |
| `services/EvaluationReportService.ts:18` | `process.cwd()/reports` | eval reports |
| `services/LogService.ts:19` | `process.cwd()/logs/log` | pino-roll log base |
| `services/PromptService.ts:6` | `process.cwd()/src/config/promptExamples.json` | prompt examples (read) |
| `services/PromptTemplateService.ts:14` | `process.cwd()/src/prompts` | prompt templates (read) |
| `services/ProviderService.ts:28` | `process.cwd()/src/config/providers.json` | provider config (read) |
| `services/ReportService.ts:58,73` | `process.cwd()/reports` | reports |
| `services/ServerConfigService.ts:21` | `process.cwd()/src/config/servers.json` | server pool config (**read + write**) |

Imported into a HomeBase process whose cwd is HomeBase's own root, every one
of these resolves into the wrong directory. `ServerConfigService` actively
**mutates `servers.json` in place** at runtime (enable/disable/reorder
servers) — this is the one path decision needing explicit alignment, not a
mechanical injection (see §7).

**Logging.** `LogService.ts`'s `pino.transport(...)` file-transport worker
is constructed at **module top level** (line 5, outside any function) —
this alone violates the hosted contract's "importing an adapter must not
open files or start background work" rule and must move inside
`initialize()`/a standalone-only path for hosted mode. Console output uses
`pino-pretty` unconditionally at `'trace'` level. The `pino.Logger` itself
is lazily built via a `Proxy` on first access, but the transport worker
starts regardless.

**Realtime (Socket.IO).** `SocketService.initialize(server)` attaches a
`SocketIOServer` directly to the raw `http.Server` with **no `path`
option** — defaults to Socket.IO's standard `/socket.io/` path. HomeBase
attaches every loaded adapter's `attachRealtime` to the *same* shared
`http.Server` unconditionally with no HomeBase-side path filtering
(confirmed directly in `HomeBase/src/services/ApplicationHost.ts`) — so an
unnamespaced Socket.IO server here is a real collision risk against any
sibling adapter's own realtime channel. `SocketService` also gates real
background work: `ServerPoolService.initialize()` only runs its polling
`setInterval` while at least one dashboard client is connected, via
subscriber-count callbacks — so Socket.IO isn't cosmetic, and its disposal
needs to correctly stop that interval too (§2, `ServerPoolService`).

**SQLite.** `DbService`'s connection is a `private static` set once in
`initialize()`, WAL mode, idempotent additive `ALTER TABLE` migrations
re-run every start. **No code anywhere closes the DB** — no
`process.on('exit'/...)`, nothing. A hosted adapter needs an explicit
`dispose()` to call `db.close()`.

**Root-level routes that collide with a shared mount.** Not API-only —
LMApi serves a small server-rendered dashboard (`src/public/*.html`) at
`/`, `/dashboard`, `/history`, `/evaluator`, plus swagger UI at
`/api-docs`/`/api-docs.json`. All eight `/api/*` route mounts are trivially
re-prefixable. **`chatCompletionRoutes` is deliberately double-mounted** —
once under `/api`, once at the bare app root (commented in `app.ts` as
"OpenAI-compatible endpoint (not under /api prefix)") — so LMApi can act as
a drop-in `baseURL` for OpenAI-SDK-style clients. This root-level mount
cannot simply be prefixed without breaking that purpose, and HomeBase
reserves the bare root for itself — this needs an explicit decision, not a
mechanical rename (§7).

**Swagger.** `apis: ['./src/routes/*.ts']` in `src/swagger.ts` is
`process.cwd()`-relative and points at **TypeScript source**, not compiled
`dist` — already fragile, and another cwd dependency needing a fix
regardless of hosted mode.

**Tests already sidestep `app.ts`.** `tests/helpers/testApp.ts` builds a
minimal per-test Express app around each router directly rather than
importing real `app.ts` (which can't be safely imported today — it would
call `listen()`/`process.exit()`). `vitest.config.ts` explicitly excludes
`src/app.ts` from coverage. This confirms the team already treats today's
`app.ts` as untestable as-is — the phase 1 composition-root split is not a
controversial change to existing test expectations.

## 3. HomeBase's actual Phase 4 contract

Identical to the contract DevPlanner's plan verified against
`c:\LocalDev\Projects\HomeBase`'s `src/contracts/hostedApplication.ts` and
`src/services/ApplicationHost.ts` — re-read those files directly before
implementing phase 7 rather than trusting this summary alone, since the
contract is the load-bearing reference:

- Default export must be a synchronous `(options) => HostedApplication`
  factory; import + factory call combined must complete within 5000 ms;
  `initialize()` within 10000 ms; `attachRealtime()` within 5000 ms (timeout
  here is logged, not fatal); `getStatus()`/`getActiveWork()` within 2000 ms
  each, called live on every poll, no caching.
- If `initialize()` throws or times out, HomeBase never calls `dispose()` —
  the adapter must release anything it partially acquired itself, in a
  `finally`/`catch`, before rethrowing.
- `router` paths must be relative; HomeBase mounts via
  `app.use(basePath, instance.router)`.
- **Realtime isolation is entirely adapter-owned** — HomeBase attaches every
  loaded adapter's `attachRealtime` to the same shared `http.Server`
  unconditionally; nothing on HomeBase's side filters by path. If LMApi's
  Socket.IO server isn't namespaced under its own base path, it can
  silently steal or corrupt a sibling's realtime traffic.
- Shutdown: HomeBase closes the listener, polls `getActiveWork()` (2000 ms
  each), grants one shared 5000 ms grace window if any app reports active
  work, then disposes apps in reverse registry order, each given one
  combined 5000 ms budget for `realtimeDisposer()` + `dispose()`, under a
  20000 ms overall watchdog.
- Registry entry shape, reserved slugs, and the "compiled adapter must
  already exist on disk for an enabled app at startup" rule are unchanged
  from DevPlanner's plan §3 — see that document or HomeBase's
  `config/homebase.schema.json` directly.
- **Note for phase 7:** HomeBase's Node dynamic `import()` of a CommonJS
  compiled module needs `export =` semantics on the hosted-entry file
  specifically (not the whole app) for `imported.default` to resolve to the
  actual function rather than a `{ default: fn, __esModule: true }` wrapper
  object — DevPlanner's migration hit this concretely and documented the
  fix and its reasoning in its own plan/handoff doc. Confirm during phase 7
  whether the same split (`adapter.ts` with `export default`, imported by
  tests; `index.ts` with `export =`, only ever touched by `tsc`) is
  necessary here for hygiene/consistency even if vitest doesn't hit the
  exact transpiler bug DevPlanner's old Bun toolchain did.

## 4. Scope and exclusions

**In scope:** splitting `app.ts` into a side-effect-free composition root
plus a thin standalone entry point; removing `process.cwd()`-relative paths
in favor of injected roots; a standalone-only logging facade matching
HomeBase's `ApplicationLogger` shape; base-path-aware route mounting;
Socket.IO path namespacing and safe `attachRealtime`/dispose; SQLite/interval
shutdown correctness; the compiled hosted adapter itself; a live
verification pass against a real HomeBase checkout.

**Out of scope / deferred:** any change to LMApi's provider/model logic,
prompt/eval features, or on-disk database schema; HomeBase container/Tailnet
rollout (Phase 6); OpenTelemetry trace/span propagation; per-user
authentication; replacing the server-rendered dashboard with a SPA (unless
decided otherwise in §7); CORS/rate-limiting additions beyond what's needed
to keep existing behavior working (not introducing new capability).

## 5. Phased implementation sequence

Each phase below ends with an explicit stop point. Do not start the next
phase in the same session unless the current session has time and the user
says to continue — commit at each checkpoint, and append a Changelog entry
(top of this file) summarizing what was done, any deviation from this
plan and why, and what verification was run, so a fresh session can resume
cold.

### Phase 1 — Composition-root split (no behavior change)

Extract `buildApp()` (or similarly named factory) that constructs the
Express app and mounts every route **without** calling `listen()`, calling
any service's `.initialize()`, or otherwise performing I/O — mirroring the
shape DevPlanner's `buildApp()`/`AppDependencies` ended up with, but stay
lean since LMApi's services are static classes today, not yet
constructor-injected (that's phase 2's job for path-bearing services only —
don't do a speculative full DI rewrite here). Keep a thin
`src/standalone.ts` (or keep `app.ts` as the standalone entry, whichever
reads cleaner given the existing file) that calls `buildApp()`, then does
today's `start()` steps (service `.initialize()` calls, `httpServer.listen()`).

**Stop — verify and commit:**
- `npm run typecheck` (if present) / `tsc --noEmit` clean.
- `npm test` (`vitest run`) — all existing tests pass unchanged (they don't
  import `app.ts` today, so this should be a non-event, but confirm).
- `npm run dev` boots and `GET /health` (or equivalent) responds as before.
- Commit. Append a Changelog entry.

### Phase 2 — Path/config injection

Replace the 12 `process.cwd()`-relative resolutions (§2 table) with paths
derived from an injected root: read-only source config
(`providers.json`, `promptExamples.json`, the prompts directory) resolves
via `__dirname`/a `repositoryRoot` parameter, not `process.cwd()`; writable
runtime data (SQLite `data/`, `logs/`, `reports/`) resolves via an injected
writable data directory parameter, defaulting to today's `process.cwd()`-relative
locations in standalone mode so standalone behavior is unchanged. Resolve
the `servers.json` open decision (§7) before or during this phase — it
determines whether `ServerConfigService`'s write path also moves.

**Stop — verify and commit:**
- `npm test` — all tests pass; add/adjust tests if any service's path
  resolution was directly asserted.
- Manual: `npm run dev` from the repo root still finds `data/`, `logs/`,
  `reports/`, and the three JSON config files in their existing locations —
  no behavior change for standalone mode.
- Commit. Append a Changelog entry.

### Phase 3 — Logging facade

Add a small `Logger` interface matching HomeBase's `ApplicationLogger`
shape (`child(bindings)`, `log(level, event, message, context?)`, optional
`flush()`). Move `LogService`'s `pino.transport(...)` construction out of
module-load time into a function only called by the standalone entry point
(so importing the module performs no file I/O). Hosted mode will later pass
`options.logger` straight through with no adaptation (phase 7).

**Stop — verify and commit:**
- `npm test` clean; `npm run dev` still logs to console and the daily
  rotated file exactly as before.
- Confirm via a quick `node -e` or test that merely `require()`ing the
  refactored logging module (without calling the standalone-only init step)
  does not create `logs/log*` files.
- Commit. Append a Changelog entry.

### Phase 4 — Base-path awareness

Prefix the eight `/api/*` route mounts with an injected base path (`/` in
standalone, `/lmapi/` hosted). Resolve the root-level dashboard
(`/`, `/dashboard`, `/history`, `/evaluator`), swagger
(`/api-docs`, `/api-docs.json`), and OpenAI-compat root mount per the §7
decisions — implement whatever was decided there, don't leave it
half-resolved. Audit `src/public/scripts/*.js` for hardcoded root-relative
fetch URLs (not just the Socket.IO client bootstrap) and make them
base-path-relative.

**Stop — verify and commit:**
- `npm test` clean.
- Manual: standalone mode (`basePath: '/'`) round-trips identically to
  before — dashboard loads, `/history`, `/evaluator`, swagger UI, and (if
  kept standalone-only per §7) the root-level OpenAI-compat endpoint all
  still work unprefixed.
- Commit. Append a Changelog entry.

### Phase 5 — Realtime namespacing and safe disposal

Add a `path` option to the `SocketIOServer` constructor scoped under the
app's base path (e.g. `${basePath}socket.io/`). Update the dashboard's
client-side Socket.IO connection to match. Implement `attachRealtime`
returning a `Disposer` per HomeBase's contract. **Before considering this
phase done**, explicitly verify — by reading Socket.IO's own
documentation/source for what `Server.close()` actually does when attached
to an externally-owned `http.Server` — that disposing LMApi's Socket.IO
instance does **not** close the shared `http.Server` out from under
HomeBase and its siblings. This is the single most important correctness
requirement in this phase; do not assume, confirm it (Socket.IO's
`Server.close()` behavior differs depending on whether it created its own
HTTP server internally versus was attached to one you passed in — the
attached-server case is what applies here, but confirm directly rather than
trusting this note).

**Stop — verify and commit:**
- `npm test` clean; add a test (or manual check) confirming
  `attachRealtime()`'s returned `Disposer` detaches the path listener and
  terminates only LMApi's own Socket.IO clients without closing the
  underlying `http.Server`.
- Manual: standalone mode's dashboard still connects and receives live
  events with the new namespaced path.
- Commit. Append a Changelog entry.

### Phase 6 — Shutdown/dispose correctness

Add a `dispose()` path: close the SQLite connection idempotently (guard
with a boolean), stop `ServerPoolService`'s background polling interval
unconditionally (not just when subscriber count hits zero), and ensure
nothing throws if called twice. This is new behavior — no shutdown handling
exists today — so also decide whether standalone mode should install
`SIGINT`/`SIGTERM` handlers calling the same dispose path for its own
graceful-shutdown benefit (recommended, low-risk, but confirm it doesn't
change any test/process behavior relied upon elsewhere, e.g. `test:*`
scripts that may expect the process to exit uncleanly).

**Stop — verify and commit:**
- `npm test` clean; new test(s) for dispose idempotency and interval/DB
  cleanup.
- Manual: `Ctrl+C` against `npm run dev` exits cleanly if signal handlers
  were added; confirm no leaked handles (`--detectOpenHandles`-equivalent
  check if vitest supports it, or manual process inspection).
- Commit. Append a Changelog entry.

### Phase 7 — Hosted adapter entry point

Add `src/host/contracts.ts` (transcribed from HomeBase's
`src/contracts/hostedApplication.ts` — keep in sync manually, same note
DevPlanner's plan used), `src/host/config.ts` (Zod schema validating
`adapterConfig`, deliberately excluding `port`), `src/host/adapter.ts` (the
real factory: `initialize()` validates config and calls `buildApp()` +
service `.initialize()` calls; `getStatus()` reports `ready`/`degraded` off
whatever health signal `DbService`/`SocketService` can cheaply expose;
`dispose()` calls phase 6's dispose path; `attachRealtime()` wraps phase 5's
Socket.IO attach with the base-path scoping), `src/host/index.ts` (compiled
entry point — resolve the `export =` question from §3's note here),
`tsconfig.host.json`, and an `npm run build:host` script.

**Stop — verify and commit:**
- `npm run typecheck` (root + `tsconfig.host.json`) clean.
- `npm test` clean.
- `npm run build:host` produces `dist/host/index.js` with a working default
  export — verify directly with the same `pathToFileURL` + `import()` +
  `.default` typeof/factory-call check DevPlanner's migration used (run via
  plain `node -e`, not through HomeBase itself).
- Commit. Append a Changelog entry.

### Phase 8 — Host adapter tests + route-level base-path tests

Add `src/host/__tests__/adapter.test.ts` covering: factory call has zero
side effects; `getStatus`/`getActiveWork`/`dispose` are safe before
`initialize()`; `initialize()` rejects clearly on invalid `adapterConfig`;
`dispose()` idempotency; `getStatus`/`getActiveWork` resolve well under the
2000 ms budget; `attachRealtime()`'s listener attach/detach lifecycle
(including the Socket.IO-close-safety check from phase 5). Add route-level
tests confirming base-path-prefixed mounting behaves correctly for at least
one representative route per §2's root-level-route list.

**Stop — verify and commit:**
- `npm test` — full suite green, new coverage included.
- Commit. Append a Changelog entry.

### Phase 9 — Cleanup + live verification

Confirm the stray `bun.lock` is genuinely unused and delete it if so.
Register against the real local HomeBase checkout — `config/homebase.json`
already has a disabled `lmapi` entry with `adapterPath: "dist/host/index.js"`
ready to flip `enabled: true` and receive `adapterConfig` fields once §7's
data-path decision is settled. Run a live acceptance matrix modeled on
DevPlanner's: `GET /lmapi/` loads the dashboard with correctly prefixed
asset URLs; the dashboard's Socket.IO connects on the namespaced path and
receives live events; a second adapter running alongside (DevPlanner, if
also enabled) confirms no Socket.IO/WebSocket cross-talk; standalone mode
(`npm run dev`) still works unchanged, including the root-level OpenAI-compat
endpoint per §7's decision; disabling the entry and pointing at a missing
compiled adapter both produce HomeBase's existing expected failure modes.

**Stop — verify and commit:**
- Document the live-verification results (what was checked, what passed)
  in this file's Changelog, same level of detail as DevPlanner's handoff
  doc used.
- Commit.
- Report back so HomeBase's own `docs/TASKS.md` can be updated to reflect
  LMApi's row, per that file's own workflow — this plan does not itself
  mark HomeBase's Phase 5 LMApi task complete.

## 6. Automated tests and acceptance matrix

Automated (accumulated across phases, all must be green by phase 9):
- `npm run typecheck` (root `tsconfig.json` and `tsconfig.host.json`).
- `npm test` (`vitest run`) — every existing test plus new host-adapter and
  base-path route tests from phase 8.
- `npm run build` and `npm run build:host` both succeed.

Manual/integration (phase 9, against a real local HomeBase checkout): see
phase 9's stop point above for the full list.

## 7. Open decisions requiring alignment before or during implementation

**7.1 — `servers.json` live-mutation location.** Today `ServerConfigService`
reads and writes `src/config/servers.json` in place, inside the repo tree.
Options: (a) keep it in the repo tree even in hosted mode (matches today's
behavior, but unusual for a "trusted but separately-owned" repository
boundary, and means HomeBase's process would be writing into LMApi's
checked-out source tree); (b) copy it into the injected writable data
directory on first run and read/write there instead (cleaner separation,
but changes where a hosted operator finds/edits server config compared to
standalone). No default recommendation stated here — decide explicitly
before or during phase 2, since it determines that phase's exact scope.

**7.2 — Root-level OpenAI-compatible endpoint in hosted mode.** The
`chatCompletionRoutes` double-mount at the bare app root exists so LMApi can
be a drop-in OpenAI-SDK `baseURL`. It cannot be prefixed under `/lmapi/`
without breaking that compatibility, and HomeBase reserves the bare root
for itself. Likely answer: standalone-only, not present when hosted — but
this is a real hosted-vs-standalone behavior difference and must be a
stated decision (recorded in the Changelog when phase 4 resolves it), not a
silently dropped feature.

**7.3 — Dashboard scope.** Do the server-rendered dashboard pages
(`/dashboard`, `/history`, `/evaluator`) move under `/lmapi/` as-is in
hosted mode, or is a richer frontend planned later that would supersede
them? DevPlanner had a full SPA; LMApi's dashboard is simpler server-rendered
HTML. Default assumption unless told otherwise: move as-is, no redesign in
scope here (§4 already excludes a SPA rewrite) — confirm before phase 4.

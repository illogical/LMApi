# LMApi HomeBase Integration Plan

**Status:** Approved 2026-08-16. Phased, with a stop-and-verify checkpoint
after each phase — implement one phase per session unless a session
explicitly continues further.
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

### 2026-08-22 — Phase 8: Host adapter tests + route-level base-path tests (COMPLETE)

**Phase 7 was committed since the last entry** (`b99fac4`) — this phase's
`git status` at start was clean; the previous entry's "Not committed" line is
now stale (left as-is, historical).

Added `src/host/__tests__/adapter.test.ts` (the location the plan itself
specifies, §5 phase 8 and the phase-7 entry's own note about `adapter.ts`
being the file `__tests__` imports) — mocks every service boundary
`createLmApiAdapter()` orchestrates (`../../app`'s `buildRouter`,
`AppPaths`, `ConfigService`, `DbService`, `ProviderService`,
`ServerPoolService`, `SocketService`, `RequestRegistryService`), the same
mock-the-boundary style `ServerPoolService.test.ts` already uses, rather than
driving real `ServerPoolService.initialize()` (which would hit real network
health checks against `servers.json` entries — no part of this phase's scope
is about re-verifying routing logic, only the adapter's own orchestration).
Needed a **local override of `tests/setup.ts`'s global `SocketService`
mock**, same reason `SocketService.test.ts` already opts out — the global
stub doesn't define `isInitialized()`, which `getStatus()` depends on; unlike
that file this one still wants a mock (not the real implementation), so it
redefines the mock locally rather than `vi.unmock`-ing.

Covers, matching the plan's own list: the factory call has zero side effects
(none of the mocked services/`buildRouter`/`AppPaths.configure` are touched
merely by calling `createLmApiAdapter(options)`); `getStatus()`/
`getActiveWork()`/`dispose()` are all safe before `initialize()`;
`initialize()` rejects clearly on an invalid `adapterConfig` (a non-object,
since `hostedConfigSchema` is `z.object({}).passthrough()`) without touching
any service; `initialize()`'s call order and arguments (`AppPaths.configure`
with the exact `join(dataPath, 'servers.json')` path, `buildRouter(basePath)`,
etc.); all four `getStatus()` branches (not-initialized, DB not initialized,
realtime not attached, ready); `getActiveWork()`'s zero/non-zero registry
branches; `attachRealtime()`'s `SocketService.initialize(server, basePath)`
call and that its returned `Disposer` calls `SocketService.dispose()`;
`dispose()` clears the prune interval (fake timers — advanced 120s post-
dispose, confirmed `RequestRegistryService.pruneCompleted()` call count
doesn't grow), disposes `ServerPoolService`/`DbService`, and **does not**
call `SocketService.dispose()` (phase 7's documented split of that
responsibility to `attachRealtime()`'s own disposer); `dispose()` idempotency
(twice, and before `initialize()`).

Added `tests/routes/basePath.test.ts` for the plan's other phase-8 ask
(route-level base-path tests) — builds a real `express()` app and mounts
`buildRouter(basePath)` under that same `basePath` exactly as HomeBase's
`ApplicationHost.ts` does (`app.use(basePath, router)`), via `supertest`,
matching the existing per-route test convention
(`tests/routes/healthRoutes.test.ts`). No service mocking needed — the
routes exercised (dashboard HTML, `/api-docs.json`, the root-level OpenAI
double-mount) all resolve before touching any service, confirmed by reading
`chatCompletionRoutes.ts` first (its Zod `.parse()` runs before any service
call, so an empty `POST /v1/chat/completions` body 400s without a live
Ollama/provider). Covers: dashboard HTML at `/lmapi/` includes
`<base href="/lmapi/">`; the bare root 404s once mounted under a basePath
(confirms `buildRouter()` doesn't itself double-add the prefix — phase 4's
finding, now asserted rather than only manually spot-checked);
`/lmapi/api-docs.json`'s `servers[0].url` is rewritten to `/lmapi/`; the
root-level OpenAI-compatible endpoint stays reachable at
`/lmapi/v1/chat/completions` per §7.2's decision; standalone mode
(`basePath: '/'`) is unaffected by the same `buildRouter()` call.

**Verification:** `tsc --noEmit` (root) clean — note `src/host/__tests__/`
lives under `src/` per the plan's own specified path, so it's included in
the root `tsconfig.json`'s `src/**/*` and gets compiled into `dist/` by
`npm run build` (confirmed: `dist/host/__tests__/adapter.test.js` exists
post-build) — harmless (`dist/` is gitignored, nothing imports the compiled
test file), not worth a tsconfig carve-out for one file. `tsc -p
tsconfig.host.json --noEmit` clean (test file isn't pulled in — nothing
under `src/host/index.ts`'s import graph reaches it). `npm run build` and
`npm test` both green — 233/233 (215 pre-existing + 13 new adapter tests + 5
new basePath tests).

**Not committed** — per the user's standing preference, left for the user's
own review/commit. New: `src/host/__tests__/adapter.test.ts`,
`tests/routes/basePath.test.ts`, this plan doc.

**Next:** Phase 9 — cleanup + live verification. Confirm the stray
`bun.lock` is unused and delete it; register against a real local HomeBase
checkout (`config/homebase.json`'s disabled `lmapi` entry, `adapterPath:
"dist/host/index.js"`); run the full acceptance matrix (§6/§9) including a
second adapter running alongside to confirm no Socket.IO cross-talk, and
document the results in this Changelog at the same detail level as
DevPlanner's handoff doc.

### 2026-08-22 — Phase 7: Hosted adapter entry point (COMPLETE)

**Found and fixed a real import-safety violation this phase's own smoke test
surfaced, not a hypothetical §2 already covered:** `app.ts`'s `start()` was
still called unconditionally at module scope. §2 documented this at plan
creation time (2026-08-16), but every verification since phase 1 exercised
`app.ts` only as the executed entry point (`ts-node`/`node dist/app.js`),
never as a required library — so the bug survived phases 1–6 undetected.
`src/host/adapter.ts` imports `buildRouter` from `../app` (see below), which
means merely importing the compiled hosted adapter dragged in a second full
`start()` — second `DbService`/`ProviderService`/`ServerPoolService` init,
second `httpServer.listen()` on the real configured `PORT`, and a
"SocketService already initialized" warning — confirmed directly via a
throwaway `node -e`-style script that imported `dist/host/index.js` exactly
as HomeBase's `ApplicationHost.ts` does. Fixed with a single `require.main
=== module` guard around the `start()` call at the bottom of `app.ts`
(standard Node "only run when executed directly" idiom) — re-verified after
the fix that the double-start disappeared from the same script's output and
that `npm run dev` still boots and serves `/health`/`/`/`/api-docs.json` at
200 unchanged (guard doesn't affect the executed-directly path).

Refactored `src/app.ts`: extracted `buildRouter(basePath)` — builds an
`express.Router` with every middleware/static mount/dashboard route/Swagger
setup/API route/error handler `buildApp()` used to build directly on its
`Express` instance. `buildApp()` now just does
`const app = express(); app.use(buildRouter(basePath)); return { app,
httpServer }` — standalone behavior is byte-for-byte unchanged, but a hosted
adapter can now hand HomeBase a real `Router` (matching
`HostedApplication.router`'s declared type) instead of casting a whole
`Express` app to it. Required widening `setupSwagger()`'s parameter type
from `Express` to `IRouter` (both satisfy it; the function only calls
`.use`/`.get`) since it's now called with a bare `Router` in hosted mode.

Added `DbService.isInitialized()` and `SocketService.isInitialized()` —
cheap boolean getters (no I/O) used by the adapter's `getStatus()` as the
health signal the plan's own phase-7 note anticipated.

Added `src/host/contracts.ts` (transcribed from HomeBase's
`src/contracts/hostedApplication.ts`, re-verified directly against that file
in this session — reuses the `ApplicationLogger`/`LogLevel` types already
added in phase 3 rather than redefining them), `src/host/config.ts` (a
`hostedConfigSchema` that's currently just `z.object({}).passthrough()` —
LMApi needs no hosted-only config fields today; `ConfigService`'s existing
env-var reads plus `servers.json`/`providers.json` under `options.dataPath`
already cover everything, and `homebase.json`'s `lmapi` entry has no
`adapterConfig` block, confirming nothing is expected yet), and
`src/host/adapter.ts` (the real factory, `export default`, matching
DevPlanner's precedent of keeping `export =` out of the file `__tests__`
will import):
- `initialize()`: `AppPaths.configure({ repositoryRoot, dataDir: dataPath,
  serversConfigPath: join(dataPath, 'servers.json') })` (the §7.1-decided
  copy-into-writable-data-dir path) → `ConfigService.loadConfig()` →
  `DbService.initialize()` → `ProviderService.initialize()` →
  `router = buildRouter(basePath)` → `await ServerPoolService.initialize()`
  → starts an unref'd `setInterval` mirroring `app.ts`'s standalone
  `RequestRegistryService.pruneCompleted()` interval (omitting it would leak
  completed/failed queue entries forever in hosted mode).
- `attachRealtime(server)`: calls phase 5's `SocketService.initialize(server,
  basePath)` (only place it's safe to call — `initialize()` runs before
  HomeBase hands over its `http.Server`) and returns
  `() => SocketService.dispose()` as the `Disposer`.
- `getStatus()`: `degraded` before `initialize()`, `degraded` if
  `DbService.isInitialized()` is false (core failure), `degraded` if
  `SocketService.isInitialized()` is false (realtime not yet attached —
  dashboard-only impact, not core-API-breaking, but still worth surfacing),
  else `ready`.
- `getActiveWork()`: reports `RequestRegistryService.getActive().length` (the
  existing non-terminal-phase filter, unchanged) so HomeBase's shutdown grace
  window actually waits out in-flight LLM generations instead of cutting them
  off.
- `dispose()`: idempotent guard, clears the prune interval,
  `ServerPoolService.dispose()`, `DbService.dispose()` — deliberately does
  **not** also call `SocketService.dispose()`, since `ApplicationHost`
  already invokes `attachRealtime()`'s returned disposer before calling
  `dispose()` (confirmed directly in `ApplicationHost.ts`'s `#disposeAll()`).

Added `src/host/index.ts` — `export = createLmApiAdapter`, same
CJS-interop-shape reasoning DevPlanner's plan/handoff already documented
(Node's dynamic `import()` synthetic `.default` unwraps `module.exports`
directly for `export =`, but leaves `exports.default`'s wrapper object
in place for plain `export default` under `module: commonjs` — re-verified
against this repo's own compiled output, not just trusted from DevPlanner's
prior writeup). Added `tsconfig.host.json` (extends the root config, only
`include`s `src/host/index.ts` — `tsc` still pulls in everything it
transitively imports) and an `npm run build:host` script.

**Verification:** `tsc --noEmit` (root) clean. `tsc -p tsconfig.host.json`
clean, produced `dist/host/{index,adapter,config,contracts}.js`. `npm test`
— 228/228 pass unchanged. `npm run dev`: `/health`, `/`, `/api-docs.json`
all still 200 (confirms the `require.main` guard doesn't affect the
executed-directly path); stopped via `taskkill //PID <pid> //F` from this
non-interactive shell (same Ctrl+C sandbox limitation phase 6 already
documented — not re-litigated here). Ran a throwaway `pathToFileURL` +
`import()` script driving the **full** contract lifecycle against
`dist/host/index.js` with no HomeBase involved, mirroring DevPlanner's
migration check: confirmed `typeof imported.default === 'function'`;
`getStatus()`/`getActiveWork()`/`dispose()` are all safe and return sane
degraded/idle/no-op values before `initialize()`; `dispose()` is idempotent
(called twice, no throw); `initialize()` completes and `router` becomes a
real function (Express Router) only afterward; mounted that router on a
throwaway `http.Server` via `app.use('/lmapi/', instance.router)` (exactly
HomeBase's own mount shape) and got `GET /lmapi/health` → `200`;
`attachRealtime(server)` returned a function, after which `getStatus()`
flipped from `degraded`/"Realtime channel is not attached" to `ready`;
calling the returned realtime `Disposer` left `server.listening === true`
(confirms phase 5's close-safety property holds through the adapter, not
just at the `SocketService` unit-test level); `getActiveWork()` correctly
reported `{ hasActiveWork: false }` with no in-flight requests. The
throwaway script and its `require.main`-guard-fix verification are not
checked in (`scripts/hostAdapterSmokeTest.js` was deleted after use) —
phase 8 is where this coverage becomes real, permanent `vitest` tests.

**Not committed** — per the user's standing preference, left for the user's
own review/commit. Modified: `src/app.ts`, `src/swagger.ts`,
`src/services/DbService.ts`, `src/services/SocketService.ts`,
`package.json`, this plan doc. New: `src/host/contracts.ts`,
`src/host/config.ts`, `src/host/adapter.ts`, `src/host/index.ts`,
`tsconfig.host.json`.

**Next:** Phase 8 — host adapter tests (`src/host/__tests__/adapter.test.ts`)
covering everything this phase's throwaway script checked manually, plus
route-level base-path tests. Worth specifically asserting the
`require.main === module` guard's behavior can't regress silently
(vitest's own module loading never sets `require.main` to `app.ts`, so
existing tests already exercise the "imported, not executed" path — but a
dedicated test importing `app.ts` directly and asserting no server starts
would make the invariant explicit rather than incidental).

### 2026-08-21 — Phase 6: Shutdown/dispose correctness (COMPLETE)

Added `DbService.dispose()`: closes the `better-sqlite3` connection and drops
the reference — idempotent (safe before `initialize()` and safe to call
twice; `getDb()` transparently re-initializes on next use, matching its
existing lazy-init behavior). The `private static db` field keeps its
non-optional `Database.Database` type (used unconditionally by ~15 call
sites inside `migrate()`) — `dispose()` clears it via a single explicit
`undefined as unknown as Database.Database` cast rather than widening the
field's type everywhere, since only `dispose()` and `getDb()`'s guard ever
need to observe the "closed" state.

Added `ServerPoolService.dispose()`: calls the existing private
`stopBackgroundCheck()` directly. This matters because the interval today
only auto-stops via `SocketService`'s last-subscriber callback — a dashboard
client left connected during a HomeBase-driven shutdown would otherwise keep
polling forever. `dispose()` bypasses that subscriber-driven path
unconditionally; idempotent, matching the existing guarded
`stopBackgroundCheck()`/`clearInterval` behavior.

**Standalone SIGINT/SIGTERM handlers: added**, per the plan's own
recommendation. `app.ts`'s `start()` now installs both after `httpServer.listen()`,
behind a `shuttingDown` boolean guard (a second signal during shutdown is a
no-op rather than re-entering). Shutdown order: clear the `RequestRegistryService`
prune interval (previously fire-and-forget, `setInterval`'s return value was
discarded — now captured so it can be cleared) → `SocketService.dispose()` →
`ServerPoolService.dispose()` → `DbService.dispose()` → `httpServer.close()`
→ `process.exit(0)` in the close callback. This is standalone-only wiring in
`app.ts`, not a new export — phase 7's `src/host/adapter.ts` will call the
same three services' `dispose()` methods directly from its own `dispose()`
contract method instead of relying on OS signals (HomeBase drives shutdown
itself, per §3).

**Verification:** `tsc --noEmit` clean. `npm test` — 228/228 pass (224
existing + 4 new: `DbService.dispose()` idempotency/reopen and
`ServerPoolService.dispose()` idempotency plus a fake-timers check that it
stops the polling interval even with a subscriber still "connected").
`npm run dev` booted cleanly and `GET /health` returned 200, both before and
after these changes, confirming no regression to normal startup.

**Could not verify live in this session, and why:** the plan's stop point
calls for confirming `Ctrl+C` against `npm run dev` exits cleanly. This
session's shell runs commands non-interactively with no attached console —
confirmed directly by testing `process.kill(process.pid, 'SIGINT')` and
`'SIGTERM'` from small throwaway scripts in this same shell: on Windows,
Node only routes `SIGINT`/`SIGBREAK` through its JS `process.on()` handlers
when the OS console delivers a real Ctrl+C keystroke to an attached console;
a self-sent or externally-`taskkill`'d signal (without `/F`) unconditionally
terminates the process via `TerminateProcess` instead, bypassing the handler
entirely (confirmed via `taskkill //PID <pid>` without `/F` on the actual
running dev server, which Windows itself refused with "can only be
terminated forcefully" — proving no console/signal path exists to that
backgrounded process). This is a sandbox/tooling limitation, not a code
defect: the dispose methods it would call are unit-tested individually
(this phase) and via `SocketService`'s existing suite (phase 5), and the
handler-wiring code itself is straightforward. A real interactive terminal
Ctrl+C check is deferred to phase 9's live acceptance pass, or the user can
spot-check it directly (`npm run dev`, then Ctrl+C, confirm "Server closed"
logs and the process exits without hanging).

**Not committed** — per the user's standing preference, left for the user's
own review/commit. Modified: `src/app.ts`, `src/services/DbService.ts`,
`src/services/ServerPoolService.ts`, this plan doc. Modified tests:
`tests/services/DbService.test.ts`, `tests/services/ServerPoolService.test.ts`.

**Next:** Phase 7 — hosted adapter entry point (`src/host/contracts.ts`,
`src/host/config.ts`, `src/host/adapter.ts`, `src/host/index.ts`,
`tsconfig.host.json`, `npm run build:host`). The real factory's
`dispose()` should call the same three services' `dispose()` methods added
here directly (not via signals); `getStatus()` can use `DbService`/
`SocketService`'s now-observable initialized-or-not state as a cheap health
signal.

### 2026-08-21 — Phase 5: Realtime namespacing and safe disposal (COMPLETE)

**The close-safety check this phase requires was not assumed — verified
directly against installed source**, not trusted from documentation:
`node_modules/socket.io/dist/index.js` `Server#close()` (line ~489) always
ends with `if (this.httpServer) { this.httpServer.close(...) }` —
unconditionally, with no distinction between a server Socket.IO created
itself and one it was merely attached to. Calling `io.close()` here would
have taken down HomeBase's shared `http.Server` and every sibling
application with it. `Server#disconnectSockets(close)` (confirmed at the
same file, ~line 799) only tears down individual client connections and
never touches `httpServer` — that's the one used.

Added a `basePath` parameter to `SocketService.initialize()` (default `'/'`,
standalone unchanged), passed as Socket.IO's own `path` option
(`${basePath}socket.io/`) so hosted mode's realtime traffic is namespaced
under `/lmapi/socket.io/` and can't collide with a sibling app on the same
`http.Server`. `app.ts`'s `start()` now defines one local `basePath` const
and threads it through both `buildApp(basePath)` (phase 4) and
`SocketService.initialize(httpServer, basePath)` so they always agree.

Added `SocketService.dispose()`: calls `io.disconnectSockets(true)` then
drops the reference, per the close-safety finding above — idempotent (safe
before `initialize()` and safe to call twice). This is the disposal
*mechanism*; wiring it into an actual `HostedApplication.attachRealtime()`
`Disposer` return value is phase 7's job once `src/host/adapter.ts` exists —
phase 5 only had a `SocketService` to change, not yet a hosted adapter
object.

Updated the three dashboard pages' Socket.IO client bootstrap to match:
`<script src="/socket.io/socket.io.js">` → page-relative
`src="socket.io/socket.io.js"` (resolves against the phase 4 `<base href>`
tag, same mechanism as every other asset); `DashboardSocket`'s constructor
now accepts an `options` param forwarded to the client's `io(...)` call;
both `log-dashboard.html` and `history-browser.html` (which use
`DashboardSocket`) and `modelEvaluator.js` (which calls `window.io()`
directly) now compute `path: new URL('socket.io/', document.baseURI)
.pathname` at their call sites — this reads the same `<base href>` value the
server injected, so the client always asks for the correct namespaced path
without needing any separate base-path variable threaded into the browser.

**Verification:** `tsc --noEmit` clean. `npm test` — 224/224 pass (220
existing + 4 new). Added `tests/services/SocketService.test.ts` — opts out
of `tests/setup.ts`'s global `SocketService` mock (`vi.unmock`, since this
file tests the real implementation) and, against a real `http.Server`,
covers: `path` defaults to `/socket.io` standalone and namespaces to
`/lmapi/socket.io` when given a basePath (`Server#path()` strips the
trailing slash it's configured with — confirmed by reading the source
rather than guessing); `dispose()` calls `disconnectSockets(true)` and never
`close()` (spied directly on the real `io` instance); `dispose()` leaves
`httpServer.listening === true`; `dispose()` idempotency including
before `initialize()`. Manual `npm run dev`: dashboard still connects at the
default `/socket.io/` path (confirmed via a raw EIO polling handshake
request, `200` with a valid session payload) and the page's injected
`<base href="/">` plus relative script tag resolved correctly. Did **not**
rely on a manual hosted-mode (`/lmapi/`) end-to-end script through the
compiled `dist/app.js` — merely requiring it still runs `start()` at module
scope as an unconditional side effect (pre-existing, phase 7's job to
split), which silently no-ops a second `SocketService.initialize()` call in
the same process via its already-initialized guard and produced misleading
404s unrelated to this phase's code; the automated test above exercises the
same code paths cleanly instead.

**Not committed** — per the user's standing preference, left for the user's
own review/commit. Modified: `src/app.ts`, `src/services/SocketService.ts`,
the three `src/public/*.html` files, `src/public/scripts/dashboardSocket.js`,
`src/public/scripts/modelEvaluator.js`, this plan doc. New:
`tests/services/SocketService.test.ts`.

**Next:** Phase 6 — shutdown/dispose correctness for `DbService` (idempotent
`close()`) and `ServerPoolService` (unconditionally stop the polling
interval, not just on zero subscribers), plus deciding whether standalone
should install `SIGINT`/`SIGTERM` handlers.

### 2026-08-21 — Phase 4: Base-path awareness (COMPLETE)

**Deviation from this plan's wording, verified before implementing:** §5
Phase 4 says to "prefix the eight `/api/*` route mounts with an injected
base path." Re-read HomeBase's `src/services/ApplicationHost.ts` directly
first (line 384/412: `app.use(basePath, router)`) — HomeBase itself mounts
the returned router under `basePath`; Express strips that prefix before
dispatch, so anything this app's own router does internally must NOT also
add the prefix, or hosted routing would double up (`/lmapi/lmapi/api/...`).
DevPlanner's already-migrated `src/app.ts` confirms this same conclusion in
its own comment: "`basePath`... [n]ot used to prefix router paths (HomeBase
does that) — reserved for callers... that need to know their own mount
point." So none of the internal Express mounts changed — `/api/*`, `/`,
`/dashboard`, `/history`, `/evaluator`, `/api-docs` are identical in both
modes; `buildApp(basePath)`'s only use of `basePath` is generating a
`<base href>` tag for the three server-rendered dashboard pages (see below).
This matches the plan's actual goal (correct behavior under both modes)
via a different, HomeBase-contract-verified mechanism than its literal
phrasing described.

**§7.2 resolved:** root-level OpenAI-compatible double-mount stays exactly
as-is, unconditionally, in both modes — no code branch needed. Since
HomeBase mounts this app's whole router under `basePath`, the endpoint is
reachable at `{origin}/lmapi/v1/chat/completions` when hosted (not true bare
root, which HomeBase reserves for itself) — this is a documented behavior
difference, not a technical conflict: standalone users point an OpenAI SDK
`baseURL` at `{origin}/`, hosted users at `{origin}/lmapi/`.

**§7.3 resolved:** dashboard pages move under `/lmapi/` as-is (the plan's
own stated default) — confirmed working via the `<base href>` mechanism
below, no SPA rewrite.

Added `basePath` parameter to `buildApp()` (default `'/'`, standalone
behavior unchanged) and a `sendHtmlWithBasePath()` helper that reads a
dashboard HTML file and injects `<base href="{basePath}">` right after
`<head>`. This lets the browser resolve every page-relative asset URL,
`fetch()` call, and nav link correctly under either `/` or `/lmapi/` with
**no client-side base-path plumbing** — only the URL literals themselves
needed to become page-relative (dropped their leading `/`). Audited and
fixed every hardcoded root-relative reference in `src/public/`: stylesheet
`href`, script `src` (dashboard socket bootstrap module, `modelEvaluator.js`
mount), nav `<a href>` links between the three dashboard pages, and all 11
`fetch()`/`fetchJson()`/`fetchPost()` call sites across `log-dashboard.html`,
`history-browser.html`, and `model-evaluator.html` (`modelEvaluator.js` had
3 more). **Deliberately left absolute** and unchanged: the `/socket.io/
socket.io.js` client-bootstrap `<script src>` in all three pages — Socket.IO
isn't namespaced under `basePath` yet (that's phase 5), so its client script
still only exists at the true root regardless of mount; phase 5 must update
this alongside the actual namespacing change, not before.

`setupSwagger()` also now takes `basePath` (default `'/'`) and swaps the
OpenAPI spec's `servers[0].url` to the raw `basePath` when hosted (was a
hardcoded `http://localhost:{port}`, which is only correct standalone) —
minor accuracy fix for the "Try it out" UI, not a routing change; `/api-docs`
and `/api-docs.json` mounts themselves stayed untouched per the point above.

**Verification:** `tsc --noEmit` clean. `npm test` — 220/220 pass. Standalone
manual check via `npm run dev`: `GET /`, `/history`, `/evaluator` all still
200 with `<base href="/">` injected; `/styles/log-dashboard.css`,
`/scripts/modelEvaluator.js`, `/api/servers`, `/api-docs` (301→`/api-docs/`),
`/api-docs.json` all unchanged; root-level `POST /v1/chat/completions`
still reachable (400 on empty body, not 404). Separately built `dist/` and
called `buildApp('/lmapi/')` directly (via a throwaway `http.Server` bound to
an ephemeral port, not through HomeBase) to confirm hosted-mode behavior in
isolation: `GET /` returned `<base href="/lmapi/">`, and
`GET /api-docs.json`'s `servers[0].url` was `/lmapi/`.

**Not committed** — per the user's standing preference, left for the user's
own review/commit. Modified: `src/app.ts`, `src/swagger.ts`, the three
`src/public/*.html` files, `src/public/scripts/modelEvaluator.js`, this plan
doc.

**Next:** Phase 5 — realtime namespacing and safe disposal (Socket.IO `path`
option scoped under `basePath`, update the three dashboard pages'
`/socket.io/socket.io.js` script tag and `DashboardSocket`'s connection
options to match, `attachRealtime()` contract, and the Socket.IO-close-safety
check against the shared `http.Server`).

### 2026-08-21 — Phase 3: Logging facade (COMPLETE)

Added `src/logging/ApplicationLogger.ts` — a standalone `ApplicationLogger`
interface (`child(bindings)`, `log(level, event, message, context?)`,
optional `flush()`) transcribed from HomeBase's
`src/contracts/hostedApplication.ts`. Not wired into `LogService` yet — it's
a type-only addition ahead of phase 7, when the hosted adapter will pass
`options.logger` straight through (per this plan's §3 note) rather than
adapting `LogService`'s existing `trace/debug/info/warn/error` shape, which
stays unchanged and is still called from 129 sites across 14 files — out of
scope to touch here.

Refactored `services/LogService.ts`: the `pino.transport(...)` construction
(the actual file-open/worker-thread-spawn) moved from module top level into
a `buildTransport()` function, called only from the existing lazy
`getLogger()` (itself unchanged — still built on first real log call via the
`Proxy`). Added `LogService.initializeFileLogging()` as the explicit,
idempotent standalone-entry hook; `app.ts`'s `start()` now calls it as its
first line, ahead of `ConfigService.loadConfig()` (which logs immediately on
failure) so transport construction happens at a deterministic point rather
than whichever call happens to log first. The `pino-roll` file path now
resolves via `AppPaths.getLogsBasePath()` (added in Phase 2, previously
unused) instead of a `process.cwd()`-relative literal.

**Verification:** `tsc --noEmit` clean. `npm test` — 220/220 pass. Built
`dist/` and ran `node -e` requiring the compiled `LogService.js` alone from
a different cwd — confirmed no `logs/` directory is created merely by
importing it. `npm run dev`: `GET /health` → 200, console output unchanged
(colorized `pino-pretty`), and the daily rotated log file
(`logs/log.2026-08-21.1.log`) received new entries with an updated mtime —
byte-for-byte the same logging behavior as before this phase.

**Not committed** — per the user's standing preference, left for the user's
own review/commit. Modified: `src/app.ts`, `src/services/LogService.ts`,
this plan doc. New: `src/logging/ApplicationLogger.ts`.

**Next:** Phase 4 — base-path awareness. Also resolve/record §7.2 (root-level
OpenAI-compat endpoint) and §7.3 (dashboard scope) decisions during that
phase per the plan's existing default assumptions unless the user says
otherwise.

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

### 2026-08-21 — Phase 2: Path/config injection (COMPLETE)

**§7.1 resolved with the user:** `servers.json` copies into HomeBase's
injected writable data directory on first run in hosted mode and is
read/written there from then on; standalone mode keeps editing
`src/config/servers.json` in place, unchanged.

Added `src/config/AppPaths.ts` — a lazy static resolver (`repositoryRoot`/
`dataDir`, both default to `process.cwd()`, plus a `configure()` hook for
Phase 7) that every affected service now calls at use-time instead of
computing its own `process.cwd()`-based path as an eager static field.
Updated: `app.ts` (`buildApp()`'s public/scripts static dirs),
`ConfigService.ts`, `ServerConfigService.ts` (this also removed a
pre-existing duplication — both services independently computed the same
`servers.json` path), `ProviderService.ts`, `PromptService.ts`,
`PromptTemplateService.ts`, `DbService.ts`, `EvaluationReportService.ts`,
`ReportService.ts`.

**Deliberately not touched, with reasons** (both explained in the
in-session plan, not oversights):
- `LogService.ts:19` — `pino.transport(...)` still builds at module top
  level; injecting a path here without also moving construction into a
  function (Phase 3's job) would still violate "importing must not open
  files." Left as `process.cwd()`-relative; Phase 3 does both together.
- `swagger.ts:50` — `apis: ['./src/routes/*.ts']` globs TypeScript source,
  which won't exist in a compiled `dist/` deployment regardless of what
  root is injected. Recommendation (not yet acted on): defer to Phase 7,
  when the actual `dist/host` build shape exists to decide a
  source-glob-vs-compiled-glob split.

**Verification:** `tsc --noEmit` clean. `npm test` — 220/220 pass. Live
`npm run dev`: confirmed `providers.json` still loads
("Loaded cloud provider: openrouter"), static/dashboard routes respond,
and — the one read+write path — `PATCH /api/servers/Beast2022/disabled`
still reads and writes `src/config/servers.json` in place with zero
residual diff after toggling back (`git diff` empty).

**Not committed** — per the user's standing preference, changes were left
staged/unstaged for their own review and commit message. A fresh session
resuming this work should run `git status`/`git diff` first: `src/app.ts`,
the nine service files above, and this plan doc are modified, and
`src/config/AppPaths.ts` is a new untracked file, all from this Phase 2
work and ready to commit as-is (verification already passed) unless
further changes are made first.

**Next:** Phase 3 — logging facade (add an `ApplicationLogger`-shaped
interface, move `LogService`'s `pino.transport(...)` construction out of
module-load time into a function only the standalone entry point calls,
and route its path through `AppPaths.getLogsBasePath()` — already added
in Phase 2 but currently unused — while doing so).

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
says to continue — append a Changelog entry (top of this file) summarizing
what was done, any deviation from this plan and why, and what verification
was run, so a fresh session can resume cold.

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

**Stop — verify:**
- `npm run typecheck` (if present) / `tsc --noEmit` clean.
- `npm test` (`vitest run`) — all existing tests pass unchanged (they don't
  import `app.ts` today, so this should be a non-event, but confirm).
- `npm run dev` boots and `GET /health` (or equivalent) responds as before.
- Append a Changelog entry.

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

**Stop — verify:**
- `npm test` — all tests pass; add/adjust tests if any service's path
  resolution was directly asserted.
- Manual: `npm run dev` from the repo root still finds `data/`, `logs/`,
  `reports/`, and the three JSON config files in their existing locations —
  no behavior change for standalone mode.
- Append a Changelog entry.

### Phase 3 — Logging facade

Add a small `Logger` interface matching HomeBase's `ApplicationLogger`
shape (`child(bindings)`, `log(level, event, message, context?)`, optional
`flush()`). Move `LogService`'s `pino.transport(...)` construction out of
module-load time into a function only called by the standalone entry point
(so importing the module performs no file I/O). Hosted mode will later pass
`options.logger` straight through with no adaptation (phase 7).

**Stop — verify:**
- `npm test` clean; `npm run dev` still logs to console and the daily
  rotated file exactly as before.
- Confirm via a quick `node -e` or test that merely `require()`ing the
  refactored logging module (without calling the standalone-only init step)
  does not create `logs/log*` files.
- Append a Changelog entry.

### Phase 4 — Base-path awareness

Prefix the eight `/api/*` route mounts with an injected base path (`/` in
standalone, `/lmapi/` hosted). Resolve the root-level dashboard
(`/`, `/dashboard`, `/history`, `/evaluator`), swagger
(`/api-docs`, `/api-docs.json`), and OpenAI-compat root mount per the §7
decisions — implement whatever was decided there, don't leave it
half-resolved. Audit `src/public/scripts/*.js` for hardcoded root-relative
fetch URLs (not just the Socket.IO client bootstrap) and make them
base-path-relative.

**Stop — verify:**
- `npm test` clean.
- Manual: standalone mode (`basePath: '/'`) round-trips identically to
  before — dashboard loads, `/history`, `/evaluator`, swagger UI, and (if
  kept standalone-only per §7) the root-level OpenAI-compat endpoint all
  still work unprefixed.
- Append a Changelog entry.

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

**Stop — verify:**
- `npm test` clean; add a test (or manual check) confirming
  `attachRealtime()`'s returned `Disposer` detaches the path listener and
  terminates only LMApi's own Socket.IO clients without closing the
  underlying `http.Server`.
- Manual: standalone mode's dashboard still connects and receives live
  events with the new namespaced path.
- Append a Changelog entry.

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

**Stop — verify:**
- `npm test` clean; new test(s) for dispose idempotency and interval/DB
  cleanup.
- Manual: `Ctrl+C` against `npm run dev` exits cleanly if signal handlers
  were added; confirm no leaked handles (`--detectOpenHandles`-equivalent
  check if vitest supports it, or manual process inspection).
- Append a Changelog entry.

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

**Stop — verify:**
- `npm run typecheck` (root + `tsconfig.host.json`) clean.
- `npm test` clean.
- `npm run build:host` produces `dist/host/index.js` with a working default
  export — verify directly with the same `pathToFileURL` + `import()` +
  `.default` typeof/factory-call check DevPlanner's migration used (run via
  plain `node -e`, not through HomeBase itself).
- Append a Changelog entry.

### Phase 8 — Host adapter tests + route-level base-path tests

Add `src/host/__tests__/adapter.test.ts` covering: factory call has zero
side effects; `getStatus`/`getActiveWork`/`dispose` are safe before
`initialize()`; `initialize()` rejects clearly on invalid `adapterConfig`;
`dispose()` idempotency; `getStatus`/`getActiveWork` resolve well under the
2000 ms budget; `attachRealtime()`'s listener attach/detach lifecycle
(including the Socket.IO-close-safety check from phase 5). Add route-level
tests confirming base-path-prefixed mounting behaves correctly for at least
one representative route per §2's root-level-route list.

**Stop — verify:**
- `npm test` — full suite green, new coverage included.
- Append a Changelog entry.

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

**Stop — verify:**
- Document the live-verification results (what was checked, what passed)
  in this file's Changelog, same level of detail as DevPlanner's handoff
  doc used.
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

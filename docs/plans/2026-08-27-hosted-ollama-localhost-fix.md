# Fix: "Localhost" Ollama server not coming Online under HomeBase/Docker

**Status:** Investigation complete 2026-08-27; fix not yet applied.
**Scope:** Cross-repository — root cause lives in how HomeBase hosts LMApi's
config, not in Ollama or Docker networking. One optional LMApi code change
(§4) to make this discoverable next time; the actual fix is a one-line edit
to a file outside this repo (§3) plus a restart.
**Repositories touched:** LMApi (this repo, read-only investigation +
optional §4 change), `HomeBase` (the file that actually needs editing lives
in its mounted data directory, not its source tree).

## Summary

`src/config/servers.json` (this repo) is **not** the file LMApi reads when
running hosted inside HomeBase's Docker container. Hosted mode reads a
**one-time copy** seeded into HomeBase's data volume on first run, and that
copy is never refreshed from the repo afterward. The copy still has the old
`http://localhost:11434` for the `Localhost` entry — which is why editing
`src/config/servers.json` in this repo "did not seem to make a difference."
Ollama itself is already correctly configured (bound to `0.0.0.0:11434`, not
just loopback), and `host.docker.internal` is already proven reachable from
this exact container for other services — so no Ollama or Docker networking
change is needed at all.

## Evidence (verified directly, not assumed)

1. **Hosted mode uses a separate, one-time-seeded config file.**
   `AppPaths.getServersConfigPath()` ([src/config/AppPaths.ts:66-81](../../src/config/AppPaths.ts#L66-L81)):
   when a hosted entry point configures a `serversConfigOverridePath`, the
   *first* access copies `src/config/servers.json` (the template) to that
   override path **only if it doesn't already exist** — every access after
   that reads the override path directly, with no re-sync back to the
   template, ever.

2. **HomeBase sets that override path to a location outside this repo.**
   `src/host/adapter.ts`'s `initialize()` calls `AppPaths.configure({
   ..., serversConfigPath: join(dataPath, 'servers.json') })` (documented in
   `docs/plans/2026-08-16-homebase-integration.md`'s Phase 7 changelog
   entry). HomeBase's `ApplicationHost.ts:305-315` passes
   `dataPath: application.dataPath`, and `ConfigService.ts:486` in HomeBase
   sets `dataPath: path.join(dataRoot, "apps", application.id)` — for LMApi,
   `apps/lmapi`. HomeBase's `docker-compose.yml:21` mounts
   `${HOMEBASE_HOST_DATA_PATH}:/data:rw`, and `.env.docker` sets
   `HOMEBASE_HOST_DATA_PATH=C:/LocalDev/Projects/HomeBase/data`.

   So the live file is:
   ```
   C:\LocalDev\Projects\HomeBase\data\apps\lmapi\servers.json
   ```

3. **Confirmed by reading that file directly** — it still has:
   ```json
   { "name": "Localhost", "baseUrl": "http://localhost:11434" }
   ```
   while this repo's `src/config/servers.json` (edited by the user) now has
   `"baseUrl": "http://host.docker.internal:11434"`. Two different files;
   only the second one was edited.

4. **`ConfigService.loadConfig()` ([src/services/ConfigService.ts:31-58](../../src/services/ConfigService.ts#L31-L58))
   reads servers.json once, at startup, into an in-memory static field.**
   Neither `POST /api/servers/refresh` nor `POST /api/servers/:name/refresh`
   re-reads the file from disk — they only re-run the Ollama health check
   against whatever config is already in memory
   ([src/services/ServerPoolService.ts:104-153](../../src/services/ServerPoolService.ts#L104-L153)).
   So even after fixing the file, a live-reload via those endpoints won't
   pick it up — LMApi's hosted adapter needs to be re-initialized (HomeBase
   restart, or LMApi's own hot-reload if HomeBase supports reloading a
   single adapter).

5. **Ollama's bind address is not the problem.** `netstat -ano` on the
   Windows host shows:
   ```
   TCP    0.0.0.0:11434    0.0.0.0:0    LISTENING
   TCP    [::]:11434       [::]:0       LISTENING
   ```
   Ollama is already listening on all interfaces, not just `127.0.0.1` — the
   classic "Ollama only binds loopback, container can't reach it even via
   `host.docker.internal`" failure mode does not apply here.

6. **`host.docker.internal` is already proven reachable from this exact
   HomeBase container**, for a different service: HomeBase's own
   `.env.docker` uses it today for MemoryApi's Qdrant/Neo4j
   (`QDRANT_URL=http://host.docker.internal:6333`, etc.), with a comment
   confirming it "works on Windows/Mac without `extra_hosts`." No reason to
   expect it to behave differently for port 11434.

**Conclusion:** this is purely a stale-cached-config problem, not a
networking or Ollama configuration problem.

## Why the two files are *supposed* to diverge (don't just auto-sync them)

`src/config/servers.json` also serves standalone mode (`npm run dev` run
directly on Windows, no Docker) — the "Localhost" entry there correctly
needs `http://localhost:11434` in that mode, since `localhost` really does
mean the same machine. It's only once LMApi runs *inside* the HomeBase
container that `localhost` means "the container itself" and
`host.docker.internal` becomes the correct address for the same physical
Ollama instance. **A single shared `servers.json` cannot correctly express
both** — the hosted copy diverging from the template on this one field is
the *correct* end state, not a bug to eliminate by force-resyncing. The bug
is that this divergence is silent and undiscoverable, not that it exists.

## §3. Immediate fix (do this to unblock today)

1. Edit `C:\LocalDev\Projects\HomeBase\data\apps\lmapi\servers.json` directly
   (outside this repo) — change the `Localhost` entry's `baseUrl` from
   `http://localhost:11434` to `http://host.docker.internal:11434`.
2. Restart LMApi's hosted adapter so `ConfigService.loadConfig()` re-reads
   the file — since `/api/servers/refresh` won't do it (see evidence #4),
   this means restarting HomeBase's container (`docker compose restart
   homebase` or equivalent), or whatever mechanism HomeBase uses to
   individually reload one adapter, if any.
3. Verify: `GET /lmapi/api/servers` (through HomeBase) shows `Localhost`
   with `isOnline: true` and a populated `models` array within one
   `SERVER_CHECK_INTERVAL_MS` cycle (or immediately after the restart, since
   `refreshPool()` runs once at `ServerPoolService.initialize()`).

This step is **not applied by this plan** — it edits a file outside this
repository and restarts a shared HomeBase container that other sibling apps
(DevPlanner, MemoryApi) also depend on. Confirm before doing it, since a
HomeBase restart briefly takes down every hosted app, not just LMApi.

## §4. Optional LMApi code change — make this discoverable next time

Nothing here is required to fix today's issue, but without it the same
"edited servers.json, nothing changed" confusion will recur for any future
server addition/edit made once HomeBase has already seeded the hosted copy.
Two small, independent changes:

1. **Log the resolved path at startup.** In
   `ConfigService.loadConfig()` ([src/services/ConfigService.ts:36](../../src/services/ConfigService.ts#L36)),
   the `LogService.info(\`Loaded ${this.servers.length} servers from
   config\`)` line already exists — extend it to include `configPath`, e.g.
   `LogService.info(\`Loaded ${this.servers.length} servers from
   ${configPath}\`)`. Trivial, but turns "why didn't my edit take effect"
   into something answerable from the logs in ten seconds, standalone or
   hosted.

2. **Document the split in CLAUDE.md.** Add a short note under
   "Ollama Server Configuration" or "Configuration" explaining that hosted
   (HomeBase) mode reads a copy of `servers.json` seeded once into
   HomeBase's data volume (`{HOMEBASE_HOST_DATA_PATH}/apps/lmapi/servers.json`),
   not the repo file, and that edits meant for hosted mode must be made
   there (or via a future runtime API — see below) followed by an adapter
   restart, while edits to the repo file only affect standalone `npm run
   dev`.

**Not recommended for now:** extending `ServerConfigService`/`serverRoutes`
with a "add server" / "update baseUrl" runtime API (parallel to the existing
`PATCH /:name/disabled` and `PUT /order` endpoints) so hosted-mode server
list changes never require touching the container's mounted data directory
by hand. This would be a reasonable follow-up if this kind of edit becomes
frequent, but it's new scope beyond fixing today's bug — worth a separate
decision, not bundled into this fix.

## Verification checklist

- [ ] `C:\LocalDev\Projects\HomeBase\data\apps\lmapi\servers.json`'s
      `Localhost` entry uses `http://host.docker.internal:11434`.
- [ ] HomeBase restarted (or LMApi's adapter individually reloaded).
- [ ] `GET /lmapi/api/servers` (or the dashboard's server panel) shows
      `Localhost` as `isOnline: true` with a non-empty `models` array.
- [ ] If §4's logging change is made: `npm run build` clean, and a fresh
      `npm run dev` / hosted restart shows the resolved config path in the
      startup log line.

# Open WebUI Integration Plan (Docker + Hermes + Tailscale)

**Status:** Approved 2026-08-27.
**Scope:** Cross-repository deployment work — not an LMApi code change. LMApi's
own code addition (`GET /v1/models`, `POST /v1/embeddings`) is tracked
separately in `docs/features/2026-08-27-openai-compat-endpoints.md`; this
plan assumes that work is done and LMApi is reachable as an OpenAI-compatible
provider.
**Repositories/systems touched:**
- **New** `\Projects\OpenWebUI` — Docker Compose stack, created from
  scratch by this plan, on the **same Docker host** that already runs LMApi
  (via HomeBase)
- `HomeBase` (`\Projects\HomeBase`) — no code changes needed; LMApi
  is already live through it at `https://home.<tailnet>.ts.net/lmapi/`
- Hermes' Mac VM (192.168.64.4) — config-only changes, no repo in this
  workspace
- Tailscale ACL policy (admin console) and Tailscale Serve (host CLI)

## Context

The attached research doc (`2026-08-27_open_webui_lmapi_hermes.md`)
recommends connecting Open WebUI to LMApi as an **OpenAI-compatible
provider** (not an Ollama server), so LMApi keeps owning routing/load
balancing while Open WebUI just calls `/v1/chat/completions`. This plan
stands up Open WebUI in Docker, connects it to LMApi and to Hermes (running
on a separate Mac VM) as two OpenAI-compatible connections, and exposes Open
WebUI on the tailnet at `https://agents.<tailnet>.ts.net` using the same
Tailscale Serve pattern HomeBase already uses — but with the service named
`svc:agents` (not `svc:webui`) so the hostname comes out as
`agents.<tailnet>.ts.net`, while still being tagged `tag:webui` for ACL
auto-approval.

Confirmed by codebase/repo research:
- HomeBase's Tailscale pattern
  (`docs/features/2026-08-16-container-and-tailnet-deployment.md` in
  HomeBase) is: no Tailscale sidecar container, app container publishes to
  `127.0.0.1:<port>` only, and `tailscale serve --service=svc:<name> --bg
  --https=443 http://127.0.0.1:<port>` is run manually on the host. No ACL
  policy file is checked into that repo — approving a new named service is a
  one-time step in the Tailscale admin console.
- LMApi is already live, mounted inside the HomeBase container via the
  hosted adapter, reachable at `https://home.<tailnet>.ts.net/lmapi/`. The
  checked-in `config/homebase.docker.json:42` still shows the `lmapi` entry
  as `"enabled": false`, but that file is just a template — HomeBase's
  `docker-compose.yml:22` mounts the real, live config from
  `${HOMEBASE_HOST_CONFIG_PATH}` on the host, which is outside this repo and
  clearly has it enabled. HomeBase's actual configured port is
  `HOMEBASE_PORT=17110` (from its `.env.docker`, not the `17106` default in
  `docker-compose.yml`).
- No Express-level CORS middleware exists in LMApi (`src/app.ts`) — this is
  fine, since Open WebUI's backend calls LMApi server-to-server, not from the
  browser, so no CORS change is needed anywhere in this plan.

---

## §0. How Open WebUI reaches LMApi

Open WebUI's `OpenWebUI` container will run on the **same Docker host** that
already runs HomeBase (and, through it, LMApi). Two ways to reach it:

- **Intra-host (recommended):** `http://host.docker.internal:17110/lmapi/v1`
  — hits HomeBase's published port directly on the same machine, without a
  round trip through Tailscale's network for what is otherwise local
  container-to-container traffic, and without depending on Tailscale Serve
  being up for Open WebUI's core chat connection to work.
- **Via the tailnet hostname:** `https://home.<tailnet>.ts.net/lmapi/v1` —
  already confirmed working today; simpler to reason about (one URL, same
  one you'd use from a browser), but adds an unnecessary external hop and a
  soft dependency on Tailscale Serve for local traffic.

This plan uses the intra-host URL (`<LMAPI_BASE_URL>` =
`http://host.docker.internal:17110/lmapi/v1`) in §2. Swap in the tailnet
hostname instead if you'd rather keep one canonical URL for both local and
remote access.

---

## Checklist overview

- [ ] Phase 1 — Create the Open WebUI Docker Compose stack (new `OpenWebUI` project)
- [ ] Phase 2 — Connect Open WebUI to LMApi as an OpenAI-compatible provider
- [ ] Phase 3 — Expose Hermes (Mac VM) for Open WebUI's agent connection
- [ ] Phase 4 — Connect Open WebUI to Hermes as a second OpenAI-compatible connection
- [ ] Phase 5 — Tailscale: ACL tag + Serve, reachable at `https://agents.<tailnet>.ts.net`
- [ ] Phase 6 — End-to-end verification

---

## Phase 1 — Open WebUI Docker Compose stack (new directory)

Create `\Projects\OpenWebUI` (sibling to `LMApi`/`HomeBase`) as a
fresh project, empty except for what this plan generates:

```
OpenWebUI/
  docker-compose.yml
  .env.example
  .env               (gitignored, copied from .env.example)
  .gitignore
```

**`.gitignore`:**
```
.env
```

**`.env.example`:**
```
# Host port Open WebUI's Docker container listens on (mapped to loopback only)
OPEN_WEBUI_PORT=3100

# Random secret Open WebUI uses to sign sessions — generate with:
#   openssl rand -hex 32
WEBUI_SECRET_KEY=

# Set to false once the environment is stable and you don't want new local
# signups; the first account created becomes the admin.
ENABLE_SIGNUP=true
```

**`docker-compose.yml`** (no Dockerfile needed — official image is
sufficient; mirrors HomeBase's loopback-only publish pattern):

```yaml
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    restart: unless-stopped
    env_file:
      - .env
    environment:
      WEBUI_SECRET_KEY: ${WEBUI_SECRET_KEY}
      ENABLE_SIGNUP: ${ENABLE_SIGNUP:-true}
    ports:
      - "127.0.0.1:${OPEN_WEBUI_PORT:-3100}:8080"
    volumes:
      - open-webui-data:/app/backend/data
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  open-webui-data:
```

`extra_hosts` is a no-op on Docker Desktop (Windows/Mac already provide
`host.docker.internal` automatically) but keeps the compose file portable if
this ever runs on Linux.

**Commands to run:**
```bash
cd \Projects\OpenWebUI
cp .env.example .env
# edit .env: paste `openssl rand -hex 32` output into WEBUI_SECRET_KEY
docker compose up -d
```

Open WebUI becomes reachable at `http://localhost:3100` on the host for
initial setup (create the admin account) before Tailscale exposure in
Phase 5.

---

## Phase 2 — Connect Open WebUI → LMApi

In Open WebUI's UI: **Admin Settings → Connections → OpenAI → Add
Connection**

- URL: `<LMAPI_BASE_URL>` (from §0: `http://host.docker.internal:17110/lmapi/v1`,
  or `https://home.<tailnet>.ts.net/lmapi/v1` if you prefer the tailnet
  hostname)
- API Key: any non-empty placeholder string (LMApi doesn't currently check an
  API key on `/v1/*` routes — no auth middleware in `src/app.ts` — but Open
  WebUI's connection UI requires a non-empty key field regardless)

Once LMApi's `GET /v1/models` lands (see
`docs/features/2026-08-27-openai-compat-endpoints.md`), LMApi's aggregated
model list (Ollama fleet + enabled OpenRouter models) should populate Open
WebUI's model selector automatically.

---

## Phase 3 — Expose Hermes (Mac VM, 192.168.64.4) for Open WebUI

Hermes's API gateway defaults to binding `127.0.0.1:8642`, which blocks
anything outside its own VM — including Open WebUI's Docker host. On the Mac
VM, in Hermes's own config (its `.env` or equivalent — not part of this
repo):

```
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=<generate with: openssl rand -hex 32>
```

Restart the Hermes process so it picks up the rebind.

**macOS firewall — restrict 8642 to only the Docker host's IP**, not the
whole LAN. Two options depending on what's available on that Mac:
- **pf (packet filter, built into macOS):** add an anchor rule allowing
  TCP/8642 only from the Docker host's IP, deny otherwise. Needs a persisted
  `pf.conf` anchor plus a LaunchDaemon to load it at boot — more setup but
  survives reboots cleanly.
- **Simpler stopgap:** since `192.168.64.x` is a VM-internal/NAT subnet
  (UTM/Parallels-style), confirm whether that subnet is *already* only
  reachable from the host machine (i.e., not bridged to the wider LAN) — if
  so, the VM boundary itself may already provide the isolation a firewall
  rule would add, making the `pf` rule a defense-in-depth nicety rather than
  a hard requirement. Verify by trying to reach `192.168.64.4:8642` from a
  *third* machine on the LAN (not the Docker host) — if that already fails,
  treat the extra firewall rule as optional.

**Action needed:** confirm which case applies (bridged vs. host-only VM
networking) before deciding whether the `pf` rule is required — this can't be
determined from this repo.

---

## Phase 4 — Connect Open WebUI → Hermes

Same **Admin Settings → Connections → OpenAI → Add Connection** flow as
Phase 2:

- URL: `http://192.168.64.4:8642/v1`
- API Key: the `API_SERVER_KEY` generated in Phase 3

Hermes then appears as its own selectable agent in Open WebUI's model list,
separate from the LMApi-routed local models.

---

## Phase 5 — Tailscale: tag + Serve for `agents.<tailnet>.ts.net`

Following HomeBase's pattern (no sidecar container, no config file —
host-run CLI):

1. **ACL policy (Tailscale admin console → Access Controls):** add a
   `tag:webui` definition with a `tagOwners` entry (your own identity or the
   group that owns tags today), plus an `autoApprovers` entry so the tagged
   service doesn't need manual re-approval each time it's re-created:
   ```json
   {
     "tagOwners": {
       "tag:webui": ["autogroup:admin"]
     },
     "autoApprovers": {
       "services": {
         "svc:agents": ["tag:webui"]
       }
     }
   }
   ```
   Adjust `tagOwners` to match however your existing policy names its
   admin group/user (check the current policy for the pattern already used
   by other tags, if any exist).
2. **Run Serve on the Docker host**, targeting Open WebUI's published
   loopback port, using the **`agents`** service name (not `webui`) so the
   hostname comes out as `agents.<tailnet>.ts.net` while still being the
   tag-approved service:
   ```bash
   tailscale serve --service=svc:agents --bg --https=443 http://127.0.0.1:3100
   tailscale serve status
   ```
3. **First-time check:** `svc:agents` may already exist for another
   purpose. Run `tailscale serve status` first to see if `svc:agents` is
   already bound to something else. If so, either reuse that existing
   binding (adding Open WebUI as an additional path isn't supported by
   `tailscale serve` the same way multiple `--set-path` entries under one
   service are — check current `tailscale serve status` output for existing
   path mappings on `svc:agents`), or confirm with the tailnet admin whether
   a fresh, differently-named service is actually needed instead. **Verify
   this before running the command** — it depends on tailnet state this plan
   has no visibility into.
4. Verify from a second tailnet device: `curl -I https://agents.<tailnet>.ts.net`.

---

## Phase 6 — End-to-end verification

- [ ] Open WebUI (`http://localhost:3100` or the tailnet URL) shows both
      LMApi's aggregated models and the Hermes agent in its model selector
- [ ] A chat sent to an LMApi-routed model in Open WebUI completes
      successfully (non-streaming and streaming)
- [ ] A chat sent to Hermes in Open WebUI completes successfully
- [ ] `https://agents.<tailnet>.ts.net` is reachable from a second tailnet
      device and NOT reachable from a non-tailnet device

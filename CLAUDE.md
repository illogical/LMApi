# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run dev          # Run in development mode (ts-node src/app.ts)
npm run build        # Compile TypeScript to ./dist/
npm start            # Run compiled output (node dist/app.js)
```

### Test Scripts (integration tests against running servers)

```bash
npm run test:routes           # Test route endpoints
npm run test:route:any        # Test /api/generate/any
npm run test:route:transcribe # Test transcription summarization agent
npm run test:chat             # Test chat completion endpoints
```

There is no unit test framework — `npm test` is a placeholder. The test scripts above require the server to be running and Ollama servers to be reachable.

## Architecture

LMApi is a TypeScript/Express intelligent request router and load balancer for multiple Ollama LLM servers, with cloud fallback via OpenRouter.

### Service Layer (`src/services/`)

Services are stateless singletons with static methods. Key services and their roles:

- **AppService** — Orchestrates startup: loads config, initializes DB, starts server pool health checks
- **ConfigService** — Loads `.env` + JSON config files (`servers.json`, `providers.json`)
- **ServerPoolService** — Tracks server status, model availability, and handles server reservation for requests (atomic to prevent race conditions)
- **QueueService** — FIFO priority queue; dispatches to servers or enqueues when all are busy
- **ChatCompletionService** — Forwards chat requests to Ollama or OpenRouter; handles SSE streaming
- **ProviderService** — Manages cloud providers (currently OpenRouter) as fallback
- **ModelCacheService** — Caches per-server model lists (30-min TTL)
- **DbService** — SQLite (better-sqlite3, WAL mode) for prompt history persistence
- **LogService** — Pino-based structured logging with daily file rotation
- **SocketService** — Socket.IO for real-time dashboard updates

### Route Layer (`src/routes/`)

| Route file | Endpoints | Purpose |
|---|---|---|
| chatCompletionRoutes | `/v1/chat/completions`, `/api/chat/completions/*` | OpenAI-compatible chat + LMAPI variants |
| promptRoutes | `/api/generate/*`, `/api/embed` | Prompt generation and embeddings |
| serverRoutes | `/api/servers*` | Server status and refresh |
| modelRoutes | `/api/models*` | Model discovery across servers |
| historyRoutes | `/api/prompt-history` | Paginated history queries |
| agentRoutes | `/api/agents/*` | Domain-specific prompts (summarization) |

### Routing Strategy (Priority-Fill, VRAM-Aware)

Implemented in `ServerPoolService.reserveServerForModel()`. Designed to minimize Ollama VRAM model swaps when multiple agents use different large models across a pool of machines.

1. **Sticky**: Reuse a server *actively processing* the requested model (if below parallel limit)
2. **Warm Idle**: Pick an idle server whose `lastModel` matches and is within `OLLAMA_KEEP_ALIVE_MS` (model likely still in VRAM)
3. **Cold Idle**: Pick any idle server (servers.json order = priority)
4. **Warm Overflow**: Assign to a busy server whose `lastModel` matches and is within `OLLAMA_KEEP_ALIVE_MS` (avoids a model swap)
5. **Cold Overflow**: Assign to any busy server still below `MAX_PARALLEL_PER_SERVER` (last resort; may force a VRAM swap)
6. **Queue**: Enqueue if all servers at capacity; dispatch when a slot opens

`lastModel` and `lastModelAt` are tracked per server and updated on request completion. The keep-alive window is configurable via `OLLAMA_KEEP_ALIVE_MS`.

### Request Validation

All request bodies are validated with Zod schemas defined alongside routes and types. Core schemas: `ChatCompletionSchema`, `PromptSchema`, `BatchPromptSchema`, `AllPromptSchema`.

## Configuration

### `.env` variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `LOG_LEVEL` | `trace` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `MAX_PARALLEL_PER_SERVER` | `4` | Max concurrent requests per Ollama server |
| `SERVER_CHECK_INTERVAL_MS` | `300000` | Background health check interval (ms) |
| `OLLAMA_KEEP_ALIVE_MS` | `300000` | How long Ollama keeps a model in VRAM after last use (ms). Should match `OLLAMA_KEEP_ALIVE` on your Ollama servers (default 5 min). Used by the warm-routing steps to avoid stale VRAM assumptions. If servers have different keep-alive settings, use the shortest. |
| `OPENROUTER_API_KEY` | — | API key for OpenRouter cloud fallback |
| `LMAPI_BASE_URL` | — | Public base URL of this LMApi instance |

### Ollama Server Configuration

To control how long Ollama keeps models in VRAM after last use, set `OLLAMA_KEEP_ALIVE` on each Ollama server before starting it:

```bash
OLLAMA_KEEP_ALIVE=30m ollama serve   # keep models warm for 30 minutes
OLLAMA_KEEP_ALIVE=-1 ollama serve    # keep indefinitely
OLLAMA_KEEP_ALIVE=0 ollama serve     # unload immediately after each request
```

To manually unload a model from VRAM:
```bash
ollama stop <model-name>             # CLI
# or via API:
curl -X POST http://<server>/api/chat -d '{"model":"<name>","keep_alive":0,"messages":[]}'
```

- **`src/config/servers.json`** — Ollama server pool (array ordered by priority)
- **`src/config/providers.json`** — Cloud provider config (OpenRouter models, routing, headers)

## Key Conventions

- **TypeScript strict mode** with CommonJS modules targeting ES2020
- Core type definitions live in `src/types.ts`; Socket.IO event constants in `src/constants.ts`
- Model names follow Ollama tag format (`modelname` or `modelname:tag`, implicit `:latest`)
- Database at `data/history.db`; logs at `logs/log-YYYY-MM-DD.log`
- Dashboard served from `src/public/` at `/log-dashboard` and `/history`
- SSE streaming uses `text/event-stream` with `data: [DONE]` sentinel

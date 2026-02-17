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

### Routing Strategy (Priority-Fill)

1. **Sticky**: Reuse a server already running the requested model (if below parallel limit)
2. **Idle**: Pick the first idle server that has the model (servers.json order = priority)
3. **Overflow**: Assign to a busy server still below `MAX_PARALLEL_PER_SERVER`
4. **Queue**: Enqueue if all servers at capacity; dispatch when a slot opens

### Request Validation

All request bodies are validated with Zod schemas defined alongside routes and types. Core schemas: `ChatCompletionSchema`, `PromptSchema`, `BatchPromptSchema`, `AllPromptSchema`.

## Configuration

- **`.env`** — `PORT`, `MAX_PARALLEL_PER_SERVER`, `SERVER_CHECK_INTERVAL_MS`, `LOG_LEVEL`, `OPENROUTER_API_KEY`, `LMAPI_BASE_URL`
- **`src/config/servers.json`** — Ollama server pool (array ordered by priority)
- **`src/config/providers.json`** — Cloud provider config (OpenRouter models, routing, headers)

## Key Conventions

- **TypeScript strict mode** with CommonJS modules targeting ES2020
- Core type definitions live in `src/types.ts`; Socket.IO event constants in `src/constants.ts`
- Model names follow Ollama tag format (`modelname` or `modelname:tag`, implicit `:latest`)
- Database at `data/history.db`; logs at `logs/log-YYYY-MM-DD.log`
- Dashboard served from `src/public/` at `/log-dashboard` and `/history`
- SSE streaming uses `text/event-stream` with `data: [DONE]` sentinel

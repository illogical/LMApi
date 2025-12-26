# LMApi

## Objectives
- Pool multiple Ollama servers and route requests by priority and availability.
- Queue prompt jobs with awareness of model availability per server.
- Prompt multiple models in parallel to compare speed and quality.
- Cache server model lists with short timeouts to detect availability quickly.
- Persist prompt metrics (duration, tokens, temps) in SQLite for later analysis.
- Provide logging per day with request/response tracing.
- Ship a lightweight log dashboard for server status and prompt history (see [reports/log-dashboard.html](reports/log-dashboard.html)).

### Server Pool Configuration (JSON)
- Sorted array in priority order (index 0 is highest priority).
- Schema example:
```json
[
	{ "name": "alpha", "baseUrl": "http://192.168.1.10:11434" },
	{ "name": "beta",  "baseUrl": "http://192.168.1.20:11434" }
]
```
- Priority: earlier entries are preferred; use next available server when higher priority is busy/unavailable.

### Queue Model
- Fields: `id`, `prompt`, `serverName` (or `"any"`), `model`, `createdAt` timestamp.
- Behavior: enqueue when no suitable server is free; dispatcher pops next item respecting priority and model availability.

### PromptResponse Schema
- `response`: generated text (or embedding vector for embedding calls).
- `durationMs`: time to complete `/api/generate` or `/api/embed`.
- `serverName`: responder.
- `model`: model used.

### Model Cache
- On `/api/tags` per server: apply short timeout; cache available models with timestamp.
- Refresh cache whenever `/api/tags` is called. Cache powers “next available server by model” lookups.

### Logging
- `LogService` with levels (trace/debug/info/warn/error).
- Trace method entry; log request/response payloads (scrub sensitive fields if any).
- Daily rotating file; first log of day creates file with date in filename.

### Persistence (SQLite)
- Table `PromptHistory` (initial): `id`, `serverName`, `model`, `prompt`, `responseDurationMs`, `estimatedTokens` (if derivable), `temperature`.
- Use DB for future dashboard metrics: per-server availability, counts, errors, averages.

### API Endpoints (planned)
- `GET /servers` – list all servers with `name`, `baseUrl`, `status` (available/processing/unavailable).
- `GET /servers/available` – list available servers with `name`, `baseUrl`, `models` (from cache).
- `GET /servers/:name/models` – available models for server (hits `/api/tags`, refresh cache).
- `GET /models/:model/servers` – servers that have a given model.
- `GET /servers/:name/status` – status for a server.
- POST /generate/any – body: `{ prompt, model, params? }`; chooses next available highest-priority server with model; queues if none; errors if model absent anywhere.
- POST /generate/server – body: `{ prompt, serverName, model, params? }`; bypasses the queue for immediate passthrough to the specific server (useful for parallel async calls).
- POST /generate/batch – body: `{ prompt, models: string[], params? }`; prompts all available servers that have each listed model; returns array of `PromptResponse` with server/model pairing; uses model cache.
- POST /embed – body: `{ prompt, model, params? }`; returns `EmbeddingResponse` (same metadata as `PromptResponse`, response contains vector).

### Request Routing Rules
- Dispatch prefers highest-priority available server with required model.
- If multiple servers have the model and are free, round-robin by priority order.
- If none free, enqueue; when server frees, check queue head respecting model availability.
- Server availability check uses short timeout when contacting `/api/generate`/`/api/embed`/`/api/tags`.

### Error Handling
- Clear message when requested model not present on targeted server.
- Clear message when model not present on any server in pool.
- Timeouts and unreachable servers degrade gracefully: mark unavailable, requeue job.

### Development Notes (TypeScript API)
- Recommended stack: Node.js + Express/Fastify, SQLite via better-sqlite3 or Prisma, pino/winston for logging.
- Services: `ServerPoolService`, `QueueService`, `ModelCacheService`, `PromptService`, `LogService`, `DbService`.
- Consider background job to refresh model caches periodically.

### Sample HTTP Calls (http file excerpt)
```http
### List servers
GET http://localhost:3000/api/servers

### Prompt any server with model
POST http://localhost:3000/api/generate/any
Content-Type: application/json
{
	"prompt": "Write a haiku about winter.",
	"model": "llama3",
	"params": { "temperature": 0.6 }
}

### Prompt multiple models across servers
POST http://localhost:3000/api/generate/batch
Content-Type: application/json
{
	"prompt": "Summarize the latest space news.",
	"models": ["llama3", "mistral", "phi3"],
	"params": { "temperature": 0.4 }
}

### Embedding request
POST http://localhost:3000/api/embed
Content-Type: application/json
{
	"prompt": "Vectorize this sentence.",
	"model": "nomic-embed-text"
}
```

### Getting Started (proposed)
1) Create `servers.json` with prioritized servers (see schema above).
2) Install dependencies (e.g., `npm install express` plus logging/db libs).
3) Implement services and endpoints per spec; wire SQLite migrations for `PromptHistory`.
4) Run `npm run dev` (or equivalent) and exercise endpoints via the provided HTTP samples.

### Future Enhancements
- Frontend dashboard: server status, prompt counts, error feed, latency averages per model/server.
- Token accounting if available from Ollama responses.
- Smarter scheduling (latency-aware weights, backoff for flaky nodes).



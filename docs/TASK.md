# Project: LMAPI — LLM Orchestration API

## Completed Phases

- [x] **Phase 1: Project Setup & Infrastructure**
  - [x] Initialize Node.js TypeScript project structure
  - [x] Install dependencies (Express, SQLite, Zod, Logging)
  - [x] Implement `LogService` (Daily rotation, trace/info levels)
  - [x] Implement `DbService` & Schema Migration (`PromptHistory` table)
  - [x] Implement `ConfigService` (Load `servers.json`)

- [x] **Phase 2: Core Services**
  - [x] Implement `ModelCacheService` (Cache `api/tags`, refresh logic)
  - [x] Implement `ServerPoolService` (Registry, availability checks, priority logic)
  - [x] Implement `QueueService` (Request queuing, dispatch logic)

- [x] **Phase 3: API Endpoints**
  - [x] Implement Server Management Endpoints (`/servers`, `/servers/available`, `/servers/:name/status`)
  - [x] Implement Model Discovery Endpoints (`/servers/:name/models`, `/models/:model/servers`)
  - [x] Implement Prompting Endpoints (`/generate/any`, `/generate/server`, `/generate/batch`, `/embed`)

- [x] **Phase 4: Prompt History Logging**
  - [x] Add a DbService helper to insert PromptHistory rows only after a successful response is received.
  - [x] Capture serverName, modelName, prompt, durationMs, estimatedTokens, temperature, and createdAt in each record.
  - [x] Expose a paged `GET /prompt-history` endpoint that supports filters (model, serverName) and sorting (duration, serverName, modelName, createdAt).
  - [x] Add indexes on createdAt, modelName, and serverName to keep the history queries fast.
  - [x] Wire QueueService/generation flows to call the helper and skip inserts on errors or timeouts.

---

## Completed Phases (Continued)

- [x] **Phase 5: Chat Completions — Ollama Proxy (Non-streaming)**
  - [x] Create `ChatCompletionService` to proxy OpenAI-compatible `/v1/chat/completions` requests to Ollama servers
  - [x] Add LMAPI routing endpoints: `/api/chat/completions/any`, `/server`, `/batch`, `/all`
  - [x] Add OpenAI-compatible endpoint: `/v1/chat/completions` (auto-routes like `/any`)
  - [x] Support tool/function calling pass-through (Ollama handles tool logic natively)
  - [x] Integrate with existing `ServerPoolService` for priority-fill server selection
  - [x] Integrate with existing `QueueService` for queuing when all servers at capacity
  - [x] Log chat completion requests to `PromptHistory` (two-phase insert/update pattern)
  - [x] Emit WebSocket events for real-time dashboard updates
  - [x] Return OpenAI-compatible error responses

- [x] **Phase 6: Chat Completions — SSE Streaming Support**
  - [x] Add SSE streaming support for `/v1/chat/completions` and `/api/chat/completions/*`
  - [x] Implement streaming proxy: read SSE chunks from Ollama, forward to client
  - [x] Handle streaming tool call accumulation and forwarding
  - [x] Update dashboard to display streaming request status

- [x] **Phase 7: OpenRouter Provider Integration**
  - [x] Create `providers.json` config for cloud providers (separate from `servers.json`)
  - [x] Implement `ProviderService` for OpenRouter API key auth and request forwarding
  - [x] Add OpenRouter as a chat completions backend (same `/v1/chat/completions` interface)
  - [x] Extend `ServerPoolService` routing: prefer local Ollama, fall back to OpenRouter
  - [x] Support OpenRouter-specific features (provider preferences, transforms)
  - [x] Log OpenRouter requests to `PromptHistory` with provider metadata

---

## Upcoming Phases

- [ ] **Phase 8: Advanced Features (Future)**
  - [ ] SSE streaming for OpenRouter provider
  - [ ] Extend `/api/generate/*` to optionally route through OpenRouter
  - [ ] OpenRouter generation tracking via `/api/generation/{id}` polling
  - [ ] Cost tracking for OpenRouter requests
  - [ ] Rate limiting per provider
  - [ ] Dashboard enhancements for multi-provider visibility

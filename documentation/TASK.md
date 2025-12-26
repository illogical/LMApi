# Project: Ollama Orchestration API

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

- [ ] **Phase 4: Verification**
  - [ ] Verify all endpoints with `http` client
  - [ ] Stress test queue system

- [x] **Phase 5: Prompt History Logging**
  - [x] Add a DbService helper to insert PromptHistory rows only after a successful response is received.
  - [x] Capture serverName, modelName, prompt, durationMs, estimatedTokens, temperature, and createdAt in each record.
  - [x] Expose a paged `GET /prompt-history` endpoint that supports filters (model, serverName) and sorting (duration, serverName, modelName, createdAt).
  - [x] Add indexes on createdAt, modelName, and serverName to keep the history queries fast.
  - [x] Wire QueueService/generation flows to call the helper and skip inserts on errors or timeouts.

# Project: Ollama Orchestration API

- [ ] **Phase 1: Project Setup & Infrastructure**
  - [ ] Initialize Node.js TypeScript project structure
  - [ ] Install dependencies (Express, SQLite, Zod, Logging)
  - [ ] Implement `LogService` (Daily rotation, trace/info levels)
  - [ ] Implement `DbService` & Schema Migration (`PromptHistory` table)
  - [ ] Implement `ConfigService` (Load `servers.json`)

- [ ] **Phase 2: Core Services**
  - [ ] Implement `ModelCacheService` (Cache `api/tags`, refresh logic)
  - [ ] Implement `ServerPoolService` (Registry, availability checks, priority logic)
  - [ ] Implement `QueueService` (Request queuing, dispatch logic)

- [ ] **Phase 3: API Endpoints**
  - [ ] Implement Server Management Endpoints (`/servers`, `/servers/available`, `/servers/:name/status`)
  - [ ] Implement Model Discovery Endpoints (`/servers/:name/models`, `/models/:model/servers`)
  - [ ] Implement Prompting Endpoints (`/generate/any`, `/generate/server`, `/generate/batch`, `/embed`)

- [ ] **Phase 4: Verification**
  - [ ] Verify all endpoints with `http` client
  - [ ] Stress test queue system

- [ ] **Phase 5: Prompt History Logging**
  - [ ] Add a DbService helper to insert PromptHistory rows only after a successful response is received.
  - [ ] Capture serverName, modelName, prompt, durationMs, estimatedTokens, temperature, and createdAt in each record.
  - [ ] Expose a paged `GET /prompt-history` endpoint that supports filters (model, serverName) and sorting (duration, serverName, modelName, createdAt).
  - [ ] Add indexes on createdAt, modelName, and serverName to keep the history queries fast.
  - [ ] Wire QueueService/generation flows to call the helper and skip inserts on errors or timeouts.

# LMApi Test Suite Overview

## Summary

LMApi now includes a comprehensive regression test suite built with **Vitest** and **Supertest**. The suite contains **220 tests** across **17 test files** covering the service layer, route layer, type contracts, and Zod schema validation. All tests run in under 2 seconds.

```
npm test              # Run all tests
npm run test:watch    # Run in watch mode
npm run test:coverage # Run with coverage report
```

---

## Architecture

```
tests/
├── setup.ts                          # Global mocks (SocketService, LogService)
├── helpers/
│   └── testApp.ts                    # Express app factory for route testing
├── services/                         # Service-layer unit tests
│   ├── constants.test.ts
│   ├── types.test.ts
│   ├── ConfigService (via ServerPoolService)
│   ├── RequestRegistryService.test.ts
│   ├── ServerPoolService.test.ts
│   ├── ModelCacheService.test.ts
│   ├── DbService.test.ts
│   ├── PromptTemplateService.test.ts
│   ├── EvaluationReportService.test.ts
│   └── PromptService.test.ts
└── routes/                           # Route-layer integration tests
    ├── healthRoutes.test.ts
    ├── serverRoutes.test.ts
    ├── modelRoutes.test.ts
    ├── requestRoutes.test.ts
    ├── historyRoutes.test.ts
    ├── promptRoutes.test.ts
    ├── chatCompletionRoutes.test.ts
    └── evaluateRoutes.test.ts
```

---

## Test Categories

### 1. Service Layer Tests (126 tests)

#### ServerPoolService (29 tests)
The most critical service in LMApi — the VRAM-aware routing algorithm. Tests cover:
- **Initialization**: Server status creation from config, online detection
- **Server lookup**: `getServer`, `getServers`, `getAvailableServersForModel`
- **5-tier priority routing**: Sticky → Warm Idle → Cold Idle → Warm Overflow → Cold Overflow
- **Reservation mechanics**: Atomic reserve + increment, parallel limit enforcement, `maxParallelOverride`
- **Active request tracking**: Increment/decrement, `activeModels` tracking, `lastModel`/`lastModelAt` VRAM hints
- **Config updates**: `applyConfigUpdate` preserves live state, handles new servers
- **Pool refresh**: Parallel refresh, disabled server skipping

#### RequestRegistryService (24 tests)
In-memory request lifecycle tracking. Tests cover:
- **Request creation**: All request types (`generate`, `chat`, `embed`, `agent`), group assignment
- **Phase transitions**: `queued → dispatching → evaluating → streaming → completed`; also `failed` and `cancelled`
- **Active/queue queries**: `getActive()`, `getQueueSnapshot()`, terminal phase filtering
- **Group aggregation**: `getGroupStatus()` counts by phase, model, server
- **Pruning**: `pruneCompleted()` with time-based cleanup, group index cleanup
- **Full lifecycle flows**: End-to-end happy path and streaming path

#### DbService (18 tests)
SQLite persistence layer. Tests cover:
- **Database initialization**: Table creation, WAL journal mode
- **Insert operations**: Basic records, all-field records, error records
- **Update operations**: Partial field updates, no-op on empty update
- **Query/pagination**: Limit/offset, sort/direction, all filter combinations
- **Filtering**: By model, server, requestType, isError, groupId, duration range, date range
- **Group assignment**: `assignGroupIdByPrompt()` auto-grouping of duplicate prompts

#### ModelCacheService (8 tests)
Model list caching with 30-minute TTL. Tests cover:
- **Cache population**: Fetch from `/api/tags`, alphabetical sorting
- **Cache hit**: Subsequent calls use cache without re-fetching
- **Error handling**: Connection failures return empty array, non-OK responses
- **Running models**: Fetch from `/api/ps` endpoint
- **Cache invalidation**: `clearCache()` forces re-fetch

#### EvaluationReportService (9 tests)
Markdown report generation for model comparison. Tests cover:
- **Report generation**: File naming (`eval-{timestamp}.md`), directory creation
- **Content sections**: Prompt, group ID, summary table headers
- **Result ordering**: Sorted by duration ascending
- **Error handling**: Error results with `**Error:** ` formatting
- **Optional sections**: Thinking blocks, tool calls, metrics line

#### PromptTemplateService (8 tests)
Prompt template loading and placeholder substitution. Tests cover:
- **Constructor**: Custom and default base path
- **Token estimation**: `estimateTokens()` at ~4 chars/token, empty/long strings
- **Template building**: `buildSummarizeTranscriptionPrompt()` and `buildTranscriptionTitleFromSummary()`
- **Placeholder replacement**: `{{transcript}}` and `{{summary}}` substitution

#### PromptService (5 tests)
Random prompt example loading. Tests cover:
- **Loading**: From file, file-not-found fallback, JSON parse error handling
- **Random selection**: Returns from loaded examples or fallback string

#### Constants & Types (20 tests)
- **SOCKET_EVENTS**: All event names present, unique string values, snake_case format
- **TypeScript interfaces**: Compile-time contracts for `PromptRequest`, `PromptResponse`, `ChatMessage`, `ChatCompletionRequest`, `ActiveRequestState`, `GroupStatus`, `EvaluationRequest`, `EvaluationResult`

---

### 2. Route Layer Tests (94 tests)

All route tests use **Supertest** with a minimal Express app factory. Each route file is tested in isolation with mocked service dependencies.

#### chatCompletionRoutes (18 tests)
- **`/api/chat/completions/any`**: Dispatch, 503 model unavailable, 400 validation errors
- **`/api/chat/completions/server`**: Targeted dispatch, 400/404 errors
- **`/api/chat/completions/batch`**: Multi-model dispatch, validation
- **Zod schema validation**: Missing model/messages, invalid roles, tool messages, null content, tools array, stop string/array

#### promptRoutes (18 tests)
- **`/api/prompts/random`**: Random prompt retrieval
- **`/api/generate/any`**: Dispatch, 503 unavailable, optional params
- **`/api/generate/server`**: Targeted dispatch, 400/404/503 errors
- **`/api/embed`**: Embedding dispatch, 503 unavailable
- **`/api/generate/batch`**: Multi-model dispatch, 503 partial unavailable
- **Zod validation**: Missing fields, invalid `maxParallelPerServer`

#### serverRoutes (17 tests)
- **`/api/config`**: Configuration values
- **`/api/servers`**: Full server list
- **`/api/servers/available`**: Online, non-disabled filtering
- **`/api/servers/:name/status`**: Individual status, 404
- **`/api/servers/:name/models`**: Server model list, 404
- **`/api/servers/:name/models/loaded`**: Running models
- **`POST /api/servers/refresh`**: Pool refresh, 500 on failure
- **`POST /api/servers/:name/refresh`**: Single server refresh, 404
- **`PATCH /api/servers/:name/disabled`**: Toggle disabled, 400/404
- **`PUT /api/servers/order`**: Reorder servers, 400 validation

#### evaluateRoutes (15 tests)
- **`POST /api/evaluate`**: Single/multi-model evaluation, report generation
- **File-based evaluation**: `filePath` support, extension validation, relative path rejection
- **Report control**: `generateReport: false` skips report
- **Socket events**: `emitEvalLaneStarted`, `emitEvalLaneCompleted`, `emitEvalAllCompleted`
- **Error handling**: Dispatch failures return error results gracefully
- **`GET /api/evaluate/file`**: File content retrieval, 400/404 errors

#### historyRoutes (14 tests)
- **`/api/prompt-history`**: Default pagination, custom limit/page
- **Filters**: model, serverName, provider (alias), groupId, requestType, isError, duration range
- **Sort/direction**: Custom sort fields, ASC/DESC
- **Validation**: Invalid limit (0, 500+), invalid sort field, invalid requestType

#### requestRoutes (8 tests)
- **`/api/requests/active`**: Active request list, empty list
- **`/api/requests/:requestId`**: Individual request, 404
- **`/api/groups/:groupId`**: Group status, 404
- **`/api/queue`**: Queue snapshot with length

#### modelRoutes (7 tests)
- **`/api/models`**: Deduplicated, sorted model list
- **`/api/models/loaded`**: Online server models only
- **`/api/models/by-server`**: Per-server grouping, disabled server exclusion, sorted models
- **`/api/models/:model/servers`**: Server list for model, empty for unavailable

#### healthRoutes (2 tests)
- **`/health`**: Full health check (ok, db, onlineServers, activeRequests, queueLength)
- **DB failure**: Reports `db: false` when SELECT 1 fails

---

## Test Design Principles

### Isolation
- Global `setup.ts` mocks `SocketService` and `LogService` to prevent side effects
- Service tests use `vi.mock()` for external dependencies
- Route tests use the `createTestApp()` helper with isolated Express instances
- DbService tests clear the database between each test

### Coverage Focus
- **Routing algorithm**: The 5-tier priority-fill algorithm is tested with multiple scenarios
- **Error paths**: 400, 403, 404, 500, 503 status codes are all tested
- **Zod validation**: Schema edge cases (missing fields, wrong types, boundary values)
- **State transitions**: Full request lifecycle from `queued` to `completed`/`failed`/`cancelled`

### Fast Execution
- All 220 tests complete in ~2 seconds
- No external service dependencies (Ollama, OpenRouter)
- No file I/O in route tests (mocked)
- DbService uses real SQLite but clears between tests

---

## Running Tests

```bash
# Run all tests
npm test

# Run in watch mode (re-run on file changes)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run specific test file
npx vitest run tests/services/ServerPoolService.test.ts

# Run tests matching a pattern
npx vitest run -t "routing"
```

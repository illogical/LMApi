# Ollama Orchestration API Specification

## 1. Introduction
This document outlines the software specification for a new TypeScript API designed to orchestrate LLM prompts across multiple Ollama servers on a local network. The system enables parallel prompting, prioritized server utilization, and centralized logging and metrics.

## 2. Core Features

### 2.1 Server Pool Management
- **Configuration**: Servers are defined in a JSON configuration file (`servers.json`).
- **Priority**: Servers are prioritized by order in the configuration (Index 0 = Highest Priority).
- **Discovery**: The system dynamically checks and caches available models for each server.

### 2.2 Intelligent Queue System
- **Mechanism**: A prioritized, managed round-robin queue.
- **Logic**:
  - Requests are queued if no suitable server is available.
  - Dispatcher selects the next available server that hosts the required model.
  - Highest priority servers are preferred when multiple are available.
- **Queue Item Schema**:
  - `id`: Unique identifier.
  - `prompt`: The text prompt.
  - `serverName`: Specific server to target, or "Any".
  - `modelName`: Model to use.
  - `timestamp`: Creation time.

### 2.3 Response Handling
- **PromptResponse Schema**:
  - `response`: The generated text or embedding.
  - `durationMs`: Execution time (server response latency).
  - `serverName`: The server that handled the request.
  - `modelName`: Validated model name used.

### 2.4 Availability & Caching
- **Model Cache**: Caches `api/tags` results for each server to minimize latency.
- **Health Checks**: Short timeouts used to determine server availability.
- **Refresh**: Cache is refreshed on `api/tags` calls or periodic intervals.

## 3. Data Persistence & Logging

### 3.1 SQLite Database
- **Purpose**: Track metrics, history, and performance.
- **Schema**: `PromptHistory`
  - `ID`: Primary Key.
  - `ServerName`: Text.
  - `ModelName`: Text.
  - `Prompt`: Text.
  - `ResponseDuration`: Integer (ms).
  - `EstimatedTokens`: Integer (optional).
  - `Temperature`: Float.
  - `CreatedAt`: Datetime.

### 3.2 Logging Service
- **Format**: File-based logging.
- **Rotation**: Daily log files (e.g., `logs/2025-12-25.log`).
- **Levels**: Standard levels (Trace, Debug, Info, Error).
- **Content**:
  - Trace all method calls.
  - Log request/response payloads.

## 4. API Endpoints

### 4.1 Server Management
- `GET /servers`: List all servers (Name, BaseURL, Status).
- `GET /servers/available`: List only available servers with their models.
- `GET /servers/:name/status`: Get status of a specific server.

### 4.2 Model Discovery
- `GET /servers/:name/models`: Return available models for a server (uses cache/refresh).
- `GET /models/:model/servers`: Return list of servers supporting a specific model.

### 4.3 Prompting
- `POST /generate/any`
  - **Body**: `{ prompt, model, ...params }`
  - **Behavior**: Queues to next available, highest-priority server with the model.
- `POST /generate/server`
  - **Body**: `{ prompt, serverName, model, ...params }`
  - **Behavior**: Targets specific server. Errors if model unavailable.
- `POST /generate/batch`
  - **Body**: `{ prompt, models: ["modelA", "modelB"], ...params }`
  - **Behavior**: Prompts all available servers capable of running the requested models in parallel. Returns list of `PromptResponse`.
- `POST /embed`
  - **Body**: `{ text, model, ...params }`
  - **Behavior**: Returns `EmbeddingResponse` (same metadata as PromptResponse).

### 4.4 Completions (OpenAI-Compatible Chat Completions)

The API supports OpenAI-compatible completions endpoints (`/v1/chat/completions` and `/api/chat/completions/*`), proxied through local Ollama servers or cloud providers (e.g., OpenRouter).

#### OpenAI-Compatible Endpoint
- `POST /v1/chat/completions`
  - **Body**: Standard OpenAI chat completion format (see below)
  - **Behavior**: Auto-routes to the best available local Ollama server. Falls back to cloud providers for non-streaming requests when no local servers are available (if configured).
  - **Response**: Standard OpenAI chat completion response (no LMAPI metadata).

#### LMAPI Routing Endpoints
These endpoints provide explicit routing control and include LMAPI metadata in responses:

- `POST /api/chat/completions/any`
  - **Body**: OpenAI format + LMAPI extensions (`serverName`, `models`, `groupId`, `maxParallelPerServer`, `provider`)
  - **Behavior**: Auto-selects best server via `ServerPoolService`. Falls back to cloud providers when configured. Use `provider` parameter to explicitly target a cloud provider.
  - **Response**: OpenAI format + `lmapi` metadata (`server_name`, `duration_ms`, `group_id`).

- `POST /api/chat/completions/server`
  - **Body**: OpenAI format + `serverName` (required)
  - **Behavior**: Routes to a specific named server.
  - **Response**: OpenAI format + `lmapi` metadata.

- `POST /api/chat/completions/batch`
  - **Body**: OpenAI format + `models` array (required)
  - **Behavior**: Sends same messages to multiple models in parallel.
  - **Response**: `{ results: [...], group_id: "uuid" }`

- `POST /api/chat/completions/all`
  - **Body**: OpenAI format + `model` (required)
  - **Behavior**: Broadcasts to all servers that have the model.
  - **Response**: `{ results: [...], group_id: "uuid" }`

#### Chat Completion Request Format
```json
{
  "model": "llama3.1",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "tools": [],
  "tool_choice": "auto",
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false,
  "provider": "openrouter"
}
```

#### Provider Parameter
All chat completion endpoints support an optional `provider` parameter for explicit cloud provider targeting:

```json
{
  "model": "openai/gpt-3.5-turbo",
  "provider": "openrouter",
  "stream": true,
  "messages": [...]
}
```

When `provider` is specified:
- Request routes directly to the named provider (e.g., "openrouter")
- Bypasses local server routing and fallback logic
- Enables testing of cloud-only models with full LMAPI observability
- Returns 400 error if provider not found or model not supported
- Works with both streaming and non-streaming requests

#### Streaming Support
Set `"stream": true` to receive Server-Sent Events (SSE) instead of a buffered response.

- Streaming is supported on:
  - `POST /v1/chat/completions`
  - `POST /api/chat/completions/any`
  - `POST /api/chat/completions/server`
- Streaming is supported for:
  - Local Ollama servers
  - OpenRouter cloud provider (Phase 8+)
- All streaming requests are logged to `PromptHistory` upon completion

#### Tool/Function Calling
Tool/function calling is fully pass-through. LMAPI forwards `tools` and `tool_choice` and returns model-generated `tool_calls` unchanged. LMAPI does not execute tools or manage tool call state.

#### Cloud Provider Integration
Cloud providers (e.g., OpenRouter) are configured in `providers.json`. When no local Ollama server is available for a requested model, LMAPI can fall back to cloud providers if:
- The provider is enabled and has an API key configured
- The provider's routing priority is set to "fallback"
- The model is listed in the provider's `models` array

Cloud provider requests are logged to `PromptHistory` with the provider name as `serverName`. This enables testing cloud-only models through the same completions interface.

## Model Evaluator

### Page

`GET /evaluator` — serves `src/public/model-evaluator.html`, a browser UI for side-by-side model comparison.

Features:
- Add multiple lanes, each bound to a loaded model
- Enter a prompt inline or load it from a file (`.txt`, `.md`, `.text`, `.prompt`)
- Click **Compare** to dispatch all models simultaneously and watch per-lane live timers
- Results stream in via WebSocket as each model completes
- Summary table sorted by duration (fastest first) appears when all models finish
- Optionally download a markdown report

### Endpoint

#### `POST /api/evaluate`

Dispatches a prompt to N models in parallel and returns aggregated results.

**Request body (JSON):**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | string | one of | — | Prompt text to send to all models |
| `filePath` | string | one of | — | Absolute path to a `.md`/`.txt`/`.text`/`.prompt` file |
| `models` | string[] | yes | — | Model names (min 1) |
| `temperature` | number | no | — | Sampling temperature |
| `max_tokens` | number | no | — | Max output tokens |
| `generateReport` | boolean | no | `true` | Whether to write a markdown report to `reports/` |

At least one of `prompt` or `filePath` must be provided.

**Response (JSON):**

```json
{
  "group_id": "uuid",
  "duration_ms": 4210,
  "report_path": "eval-20260416-143022.md",
  "results": [
    {
      "model": "llama3.2",
      "server_name": "beast",
      "duration_ms": 2140,
      "input_tokens": 12,
      "output_tokens": 45,
      "tokens_per_second": 21.0,
      "finish_reason": "stop",
      "response_text": "Hello! How can I help?"
    }
  ]
}
```

**WebSocket events** (all scoped to `group_id`):
- `eval_lane_started` — emitted immediately when each model dispatch begins
- `eval_lane_completed` — emitted when each model's response arrives (includes full `EvaluationResult`)
- `eval_all_completed` — emitted after all models finish (includes all results + optional `reportPath`)

#### `GET /api/evaluate/file?path=<absolute-path>`

Reads a file and returns its contents for use as a prompt. Only allows `.md`, `.txt`, `.text`, `.prompt` extensions.

**Response:** `{ "content": "..." }` or `{ "error": "..." }` with 400/404.

### Report Format

Reports are written to `reports/eval-YYYYMMDD-HHmmss.md` and include:
- Evaluation metadata (date, group ID, model count)
- Full prompt block
- Summary table sorted by duration ascending
- Per-model response sections with optional Thinking and Tool Calls subsections

---

## 4.6 Observability Endpoints

Real-time visibility into in-flight and queued requests via the `RequestRegistryService`.

### `GET /api/requests/active`

Returns all non-terminal requests currently tracked in the registry.

**Response:** `{ "requests": ActiveRequestState[] }`

### `GET /api/requests/:requestId`

Returns a single request by ID. Returns 404 if not found.

### `GET /api/groups/:groupId`

Returns aggregated status for all requests sharing a `groupId`.

**Response:**
```json
{
  "groupId": "uuid",
  "total": 3,
  "queued": 0,
  "running": 2,
  "completed": 1,
  "failed": 0,
  "byModel": { "llama3.2": 2, "qwen2.5": 1 },
  "byServer": { "beast": 3 },
  "startedAt": "2026-04-16T14:30:00Z",
  "updatedAt": "2026-04-16T14:30:04Z"
}
```

### `GET /api/queue`

Returns all currently queued (waiting) requests.

**Response:** `{ "queue": ActiveRequestState[], "length": number }`

### WebSocket Events

| Event | Payload | When |
|---|---|---|
| `request_started` | `ActiveRequestState` | New request registered |
| `request_completed` | `ActiveRequestState` | Request finished successfully |
| `request_failed` | `ActiveRequestState` | Request errored |
| `queue_updated` | `{ queue, length }` | Any queue state change |

### `ActiveRequestState` Schema

| Field | Type | Description |
|---|---|---|
| `requestId` | string | UUID |
| `groupId` | string\|null | Shared group identifier (set by caller) |
| `requestType` | string | `generate`, `chat`, `embed`, `agent` |
| `serverName` | string\|null | Assigned Ollama server |
| `modelName` | string | Model being evaluated |
| `phase` | string | `queued`→`dispatching`→`evaluating`→`streaming`→`completed`\|`failed`\|`cancelled` |
| `startedAt` | string | ISO timestamp |
| `elapsedMs` | number | Computed on read |
| `promptPreview` | string | First 120 chars of prompt |

---

## 4.7 Health Endpoint

### `GET /health`

Returns server health summary.

**Response:**
```json
{
  "ok": true,
  "db": true,
  "onlineServers": 2,
  "activeRequests": 3,
  "queueLength": 1
}
```

---

## 4.8 Extended History Filters

`GET /api/prompt-history` now accepts additional query parameters:

| Param | Type | Description |
|---|---|---|
| `groupId` | string | Filter by group ID |
| `requestType` | string | `generate`, `chat`, `embed`, `agent` |
| `isError` | boolean | Filter to error or non-error records |
| `createdAfter` | ISO datetime | Records created after this timestamp |
| `createdBefore` | ISO datetime | Records created before this timestamp |
| `durationGt` | number | Filter `responseDurationMs > N` |
| `durationLt` | number | Filter `responseDurationMs < N` |

---

## 5. Technology Stack
- **Language**: TypeScript
- **Runtime**: Node.js
- **Database**: SQLite (via `better-sqlite3`)
- **Validation**: Zod
- **Real-time**: Socket.io (WebSocket events)

## 6. Future Roadmap
- Frontend Dashboard for server status and metrics.
- Comparative performance analysis (Average speed per model/server).
- Cost tracking for cloud provider requests.
- Rate limiting per provider.

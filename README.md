# LMApi

## Overview
LMApi is a fully-implemented intelligent request router and load balancer for Ollama servers. The system provides:
- **Smart routing** across multiple Ollama servers with priority-based selection and availability awareness.
- **Intelligent queueing** that respects model availability per server and dispatches requests when resources become available.
- **Parallel model execution** to compare speed and quality across different models and servers simultaneously.
- **Dynamic model caching** with short timeouts for fast detection of model availability changes.
- **Complete metrics persistence** in SQLite, recording duration, token counts, temperature, and model details for every request.
- **Structured logging** with daily rotation, request/response tracing, and multiple severity levels.
- **Live dashboard interface** with real-time server status monitoring, interactive prompt history, filtering, sorting, and detailed record inspection via WebSocket integration.

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
Responses from generation and embedding endpoints contain the following fields:
- `response`: Generated text output for prompts, or embedding vector for embedding requests.
- `responseDurationMs`: Time in milliseconds to complete the request.
- `serverName`: Name of the server that processed the request.
- `model`: Model name used for generation.
- `estimatedTokens`: Estimated count of input (prompt) tokens processed.
- `estimatedOutputTokens`: Estimated count of generated (response) tokens (for generation endpoints).
- `temperature`: Temperature parameter used for sampling (if applicable).
- `createdAt`: ISO 8601 timestamp of when the request was created.

### Model Cache
- On `/api/tags` per server: apply short timeout; cache available models with timestamp.
- Refresh cache whenever `/api/tags` is called. Cache powers “next available server by model” lookups.

### Prompt History Dashboard
A lightweight, real-time web dashboard is included for monitoring and analysis. Access it at `/log-dashboard` (served from [src/public/log-dashboard.html](src/public/log-dashboard.html)).

#### Dashboard Features
- **Live Server Status Grid**: Displays all configured servers with current connectivity, model availability, and active request count. Click individual servers to view detailed model list or manually refresh a single server.
- **Interactive Prompt History Table**: Browse the most recent 50 prompt records with sortable/filterable columns including model, server, response duration, and creation date.
- **Flexible Filtering & Sorting**: 
  - Filter by model name or server name
  - Sort by duration (fastest/slowest), creation date (newest/oldest), server name, or model name
  - Pagination with configurable page size (up to 200 records per page)
- **Detailed Record Inspection**: Click any prompt record to open a slide panel showing:
  - Full prompt text
  - Complete response/generated text
  - Model name and target server
  - Response duration in milliseconds
  - Token estimates (input and output)
  - Temperature parameter used
  - Exact timestamp (UTC)
- **Real-Time Updates**: All data updates in real-time via WebSocket connection—server status changes, new prompts, and request counts update immediately without page refresh.
- **Refresh Controls**: One-click refresh of all servers or individual servers to revalidate status and model availability.

### Logging & Persistence
- **LogService**: Structured logging with levels (trace/debug/info/warn/error), request/response tracing, and daily rotating log files.
- **SQLite Persistence**: Every successful prompt request is recorded in the `PromptHistory` table for analytics and historical review.

### Database Schema
The `PromptHistory` table stores metrics for every successful prompt request.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | INTEGER | Primary key, autoincrement. |
| `serverName` | TEXT | Name of the server that handled the request. |
| `modelName` | TEXT | Name of the model used. |
| `prompt` | TEXT | The input prompt text. |
| `responseText` | TEXT | The generated response text. |
| `responseDurationMs` | INTEGER | Time taken to generate the response in milliseconds. |
| `estimatedTokens` | INTEGER | Estimated number of input (prompt) tokens. |
| `estimatedOutputTokens` | INTEGER | Estimated number of output (response) tokens. |
| `temperature` | REAL | The temperature parameter used for the request. |
| `createdAt` | DATETIME | Timestamp of when the record was created (UTC). |

### API Endpoints

#### Server Management
- **`GET /servers`** – Retrieve full list of configured servers with current status, online state, and model availability.
- **`GET /servers/available`** – List only online servers currently available to handle requests.
- **`GET /servers/:name/status`** – Get detailed status for a specific server including models, active request count, and connectivity state.
- **`GET /servers/:name/models`** – Fetch available models for a specific server (refreshes cache from Ollama `/api/tags` endpoint).
- **`POST /servers/refresh`** – Trigger refresh of all servers in the pool; revalidates availability and model lists across all servers.
- **`POST /servers/:name/refresh`** – Refresh status and model list for a single specific server.

#### Model Queries
- **`GET /models/:model/servers`** – Get list of servers that currently have a specific model available.

#### Prompt Generation
- **`POST /generate/any`** – Queue or dispatch a prompt request. Automatically selects the highest-priority available server that hosts the requested model. Queues request if no server is currently free; errors if model is unavailable everywhere. Body: `{ prompt, model, params? }`
- **`POST /generate/server`** – Dispatch a prompt directly to a specific server, bypassing the queue system. Useful for parallel async requests when server is known. Returns error if server doesn't have the model. Body: `{ prompt, serverName, model, params? }`
- **`POST /generate/batch`** – Submit the same prompt to multiple models in parallel. Dispatches to all available servers that host each listed model. Returns array of results with server/model pairing for comparison. Body: `{ prompt, models: string[], params? }`
- **`POST /embed`** – Generate embeddings for input text using a specified model. Returns vector response with same metadata tracking. Body: `{ prompt, model, params? }`

#### Prompt History & Analytics
- **`GET /prompt-history`** – Retrieve paginated prompt history with flexible filtering and sorting. Query parameters:
  - `limit` (1-200, default 50): number of records per page
  - `page` (default 1): page number for pagination
  - `sort` (createdAt|responseDurationMs|serverName|modelName, default createdAt): field to sort by
  - `dir` (asc|desc, default desc): sort direction
  - `model` (optional): filter by model name
  - `serverName` (optional): filter by server name
  
  Returns: `{ total, page, pageSize, records }`

### Request Routing Rules
- Dispatch prefers highest-priority available server with required model.
- If multiple servers have the model and are free, round-robin by priority order.
- If none free, enqueue; when server frees, check queue head respecting model availability.
- Server availability check uses short timeout when contacting `/api/generate`/`/api/embed`/`/api/tags`.

### WebSocket Integration
Real-time updates are broadcast to connected dashboard clients via Socket.IO. The system emits the following events:

#### Server Events
- **`SERVER_STATUS_CHANGED`** – Emitted when a server's availability status changes (online/offline). Includes server name and new status.
- **`SERVERS_UPDATED`** – Emitted after bulk server refresh operations. Provides updated list of all servers with current status and model availability.
- **`ACTIVE_REQUESTS_CHANGED`** – Emitted when the count of active requests on a server changes. Includes server name and current active request count.

#### History Events
- **`PROMPT_HISTORY_ADDED`** – Emitted immediately after a new prompt request completes and is recorded. Contains full record including response, duration, tokens, and timestamp.

The dashboard client automatically subscribes to these events and updates the UI in real-time without requiring manual refresh.

### Error Handling
- Clear message when requested model not present on targeted server.
- Clear message when model not present on any server in pool.
- Timeouts and unreachable servers degrade gracefully: mark unavailable, requeue job.

### Development Notes (TypeScript API)
- Recommended stack: Node.js + Express/Fastify, SQLite via better-sqlite3 or Prisma, pino/winston for logging.
- Services: `ServerPoolService`, `QueueService`, `ModelCacheService`, `PromptService`, `LogService`, `DbService`.
- Consider background job to refresh model caches periodically.

### Future Enhancements
- Pooling improvements to allow each server to handle up to 4 requests each before sending requests to the next server in the pool
- Display the queue count on the log dashboard interface.
- Use the streaming endpoint to report how long it takes to load the model vs. process the response
- Frontend dashboard: server status, prompt counts, error feed, latency averages per model/server.
- Smarter scheduling (latency-aware weights, backoff for flaky nodes).



# LMApi API Reference — For External Consumers

This document describes the LMApi endpoints that the Prompt & Model Evaluation System needs to consume. LMApi is a separate, already-running service that routes LLM requests across Ollama servers and OpenRouter.

**Base URL**: `http://localhost:3111` (configurable via LMApi's `.env` `PORT`)

---

## 1. Server & Model Discovery

### `GET /api/servers`

Returns all configured servers with status, model lists, and active request counts.

**Response:**
```json
[
  {
    "config": {
      "name": "alpha",
      "baseUrl": "http://192.168.1.10:11434"
    },
    "isOnline": true,
    "models": ["llama3.1:latest", "qwen2.5:7b", "deepseek-coder:6.7b"],
    "runningModels": ["llama3.1:latest"],
    "activeModels": ["llama3.1:latest"],
    "activeRequests": 1,
    "lastChecked": 1708300000000
  },
  {
    "config": {
      "name": "beta",
      "baseUrl": "http://192.168.1.20:11434"
    },
    "isOnline": true,
    "models": ["llama3.1:latest", "mistral:latest"],
    "runningModels": [],
    "activeModels": [],
    "activeRequests": 0,
    "lastChecked": 1708300000000
  }
]
```

### `GET /api/servers/available`

Returns only online servers.

**Response:**
```json
{
  "servers": [ /* same shape as GET /api/servers, filtered to isOnline: true */ ]
}
```

### `GET /api/servers/:name/status`

Returns a single server's status.

**Response:** Same shape as one element of `GET /api/servers`.

### `GET /api/models`

Returns a deduplicated, sorted list of all model names across all configured servers.

**Response:**
```json
{
  "models": ["deepseek-coder:6.7b", "llama3.1:latest", "mistral:latest", "qwen2.5:7b"]
}
```

### `GET /api/models/:model/servers`

Returns which servers have a specific model available.

**Response:**
```json
{
  "servers": ["alpha", "beta"]
}
```

---

## 2. Chat Completions (OpenAI-Compatible)

These are the primary endpoints the eval system uses to dispatch completions to models.

### `POST /v1/chat/completions`

OpenAI-compatible endpoint. Auto-routes to best available Ollama server, falls back to OpenRouter if configured.

**Request Body:**
```json
{
  "model": "llama3.1:latest",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Explain quantum computing." }
  ],
  "tools": [],
  "tool_choice": "auto",
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

**Response (non-streaming):**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1708300000,
  "model": "llama3.1:latest",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quantum computing is..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

**Notes:**
- This endpoint does NOT include `lmapi` metadata in the response.
- Returns standard OpenAI error format on failure.

### `POST /api/chat/completions/any`

Same as `/v1/chat/completions` but includes LMAPI metadata in the response.

**Additional request fields (LMAPI extensions):**
```json
{
  "serverName": "any",
  "groupId": "eval-abc123",
  "maxParallelPerServer": 2,
  "provider": "openrouter"
}
```

**Response includes `lmapi` field:**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1708300000,
  "model": "llama3.1:latest",
  "choices": [ /* same as above */ ],
  "usage": { /* same as above */ },
  "lmapi": {
    "server_name": "alpha",
    "duration_ms": 3450,
    "group_id": "eval-abc123"
  }
}
```

### `POST /api/chat/completions/batch`

Sends the same messages to multiple models in parallel.

**Request Body:**
```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "models": ["llama3.1:latest", "mistral:latest"],
  "temperature": 0.7,
  "groupId": "eval-batch-123"
}
```

**Response:**
```json
{
  "results": [
    { /* ChatCompletionResponse for llama3.1 with lmapi metadata */ },
    { /* ChatCompletionResponse for mistral with lmapi metadata */ }
  ],
  "group_id": "eval-batch-123"
}
```

### Explicit Provider Targeting

Any chat completion endpoint supports the `provider` parameter to route directly to a cloud provider (e.g., OpenRouter), bypassing local server selection:

```json
{
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "provider": "openrouter",
  "messages": [ /* ... */ ],
  "stream": false
}
```

**Behavior:**
- Bypasses local Ollama server routing entirely.
- Returns `400` if the provider is not found or the model is not in the provider's model list.
- Works with both streaming and non-streaming requests.

---

## 3. Streaming (SSE)

Set `"stream": true` in the request body. The response is `text/event-stream`:

```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}

data: [DONE]
```

**Supported on:**
- `POST /v1/chat/completions`
- `POST /api/chat/completions/any`
- `POST /api/chat/completions/server`

**NOT supported on:**
- `POST /api/chat/completions/batch`
- `POST /api/chat/completions/all`

**Important for eval system:** The eval system should use **non-streaming** mode (`stream: false`) for all evaluation completions. This simplifies response handling since the full response is needed before running deterministic checks. Streaming is only useful for the real-time preview of individual cell responses in the UI.

---

## 4. Tool/Function Calling

LMApi passes through `tools` and `tool_choice` fields unchanged. It does NOT execute tools — the model generates tool call instructions and returns them in the response.

**Request with tools:**
```json
{
  "model": "llama3.1:latest",
  "messages": [
    { "role": "user", "content": "What's the weather in Paris?" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string", "description": "City name" },
            "units": { "type": "string", "enum": ["celsius", "fahrenheit"] }
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

**Response with tool calls:**
```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\": \"Paris\", \"units\": \"celsius\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

**Note:** `function.arguments` is a JSON string, not a parsed object.

---

## 5. Socket.IO Real-Time Events

LMApi runs a Socket.IO server on the same port as the HTTP server. Connect to receive real-time updates.

**Connection:**
```javascript
import { io } from 'socket.io-client';
const socket = io('http://localhost:3111');
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `prompt_history_added` | `PromptHistoryRecord` | New completion logged |
| `prompt_history_updated` | `PromptHistoryRecord` | Completion record updated (e.g., response received) |
| `server_status_changed` | `{ serverName, isOnline, ... }` | Server went online/offline |
| `servers_updated` | `ServerStatus[]` | Bulk server refresh completed |
| `active_requests_changed` | `{ serverName, activeRequests }` | Server's active request count changed |

### `PromptHistoryRecord` Shape

```typescript
{
  id: number;
  serverName: string;
  modelName: string;
  prompt: string;
  responseText: string;
  responseDurationMs: number;
  inputTokens: number;
  outputTokens: number;
  loadDuration: number;      // ms to load model into memory
  evalDuration: number;      // ms for prompt eval + generation
  totalDuration: number;     // total Ollama-side duration
  thinking: string;          // model reasoning output (if supported)
  temperature: number;
  createdAt: string;         // ISO datetime
  responseAt: string;        // ISO datetime
  isError: boolean;
  groupId: string;           // groups related requests
  requestType: string;       // 'generate', 'chat', 'embed'
}
```

**Usage for eval system:** The eval system can optionally listen for `prompt_history_added` events to get detailed per-request metrics (load duration, eval duration, etc.) that aren't available in the chat completion response itself. This is useful for the Metrics tab. Match records by `groupId` if you set one in the request.

---

## 6. Prompt History Query

### `GET /api/prompt-history`

Paginated query of all logged completions.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number (1-200) | 50 | Records per page |
| `page` | number | 1 | Page number |
| `sort` | string | `createdAt` | Sort field: `createdAt`, `responseDurationMs`, `serverName`, `modelName`, `totalDuration`, `evalDuration` |
| `dir` | string | `desc` | Sort direction: `asc` or `desc` |
| `model` | string | — | Filter by model name |
| `serverName` | string | — | Filter by server name |
| `provider` | string | — | Filter by provider (alias for serverName) |

**Response:**
```json
{
  "total": 1500,
  "page": 1,
  "pageSize": 50,
  "records": [ /* PromptHistoryRecord[] */ ]
}
```

---

## 7. Error Response Format

All endpoints return errors in a consistent format:

**LMAPI-style (routes under `/api/`):**
```json
{ "error": "No available servers or cloud providers host model \"xyz\"" }
```

**OpenAI-style (`/v1/chat/completions`):**
```json
{
  "error": {
    "message": "No available servers or cloud providers host model \"xyz\"",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

---

## 8. Routing Behavior Summary

When the eval system sends a chat completion request with `serverName: "any"` (or uses `/v1/chat/completions`), LMApi selects a server using this priority:

1. **Sticky** — reuse a server already running the model (if below parallel limit)
2. **Idle** — pick the first idle server with the model (servers.json order = priority)
3. **Overflow** — assign to a busy server below parallel limit
4. **Queue** — enqueue if all servers are full; dispatch when a slot opens
5. **Cloud fallback** — if no local server has the model and a cloud provider does, route to the provider

The eval system does **not** need to implement any routing logic — LMApi handles all of it. Just send requests to `/api/chat/completions/any` or `/v1/chat/completions` and LMApi will find the best server.

---

## 9. Recommended Patterns for Eval System

### Dispatching eval completions

```typescript
// Use /api/chat/completions/any for LMAPI metadata (server_name, duration_ms)
const response = await fetch(`${LMAPI_BASE_URL}/api/chat/completions/any`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama3.1:latest',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: testCase.userMessage }
    ],
    tools: toolDefinitions,
    temperature: 0.7,
    stream: false,
    groupId: evalId    // groups all eval requests for history filtering
  })
});

const data = await response.json();
// data.lmapi.server_name → which server handled it
// data.lmapi.duration_ms → end-to-end request time
// data.usage.prompt_tokens, data.usage.completion_tokens → token counts
```

### Fetching available models for the model selector

```typescript
// Get all servers with their models for a grouped selector
const servers = await fetch(`${LMAPI_BASE_URL}/api/servers`).then(r => r.json());

// Build grouped model list:
// {
//   "alpha": ["llama3.1:latest", "qwen2.5:7b"],
//   "beta": ["llama3.1:latest", "mistral:latest"],
//   "openrouter": ["meta-llama/llama-3.3-70b-instruct:free", ...]
// }
const modelsByServer: Record<string, string[]> = {};
for (const server of servers) {
  if (server.isOnline) {
    modelsByServer[server.config.name] = server.models;
  }
}
```

### Parallel model comparison

For comparing the same prompt across multiple models, use the batch endpoint:

```typescript
const response = await fetch(`${LMAPI_BASE_URL}/api/chat/completions/batch`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: testCase.userMessage }
    ],
    models: ['llama3.1:latest', 'mistral:latest', 'qwen2.5:7b'],
    temperature: 0.7,
    groupId: evalId
  })
});

const data = await response.json();
// data.results → array of ChatCompletionResponse, one per model
// data.group_id → shared group ID
```

---

## 10. Configuration Reference

The eval system needs to know the LMApi base URL. Recommended: use an environment variable.

```env
# In the eval project's .env
LMAPI_BASE_URL=http://localhost:3111
```

LMApi itself is configured via its own `.env` and JSON files — the eval system does not need to modify those. Key LMApi settings that affect eval behavior:

| Setting | Default | Effect on Eval |
|---------|---------|----------------|
| `MAX_PARALLEL_PER_SERVER` | 4 | How many eval cells can run simultaneously per Ollama server |
| `PORT` | 3111 | URL the eval system connects to |
| Cloud providers | `providers.json` | Which cloud models are available for eval |

---

## 11. TypeScript Types (For Client Use)

```typescript
// Minimal types for consuming the LMApi API from the eval project

interface LmapiChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }>;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // LMAPI extensions
  serverName?: string;
  groupId?: string;
  maxParallelPerServer?: number;
  provider?: string;
}

interface LmapiChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  lmapi?: {
    server_name: string;
    duration_ms: number;
    group_id?: string;
  };
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;  // JSON Schema
  };
}

interface LmapiServerStatus {
  config: { name: string; baseUrl: string };
  isOnline: boolean;
  models: string[];
  runningModels: string[];
  activeModels: string[];
  activeRequests: number;
  lastChecked: number;
}

interface LmapiBatchResponse {
  results: LmapiChatCompletionResponse[];
  group_id: string;
}
```

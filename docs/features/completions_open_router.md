# LMAPI Chat Completions & OpenRouter Implementation Plan

## Overview

This document outlines the plan for extending LMAPI to support the OpenAI-compatible `/v1/chat/completions` endpoint, initially proxied through Ollama servers, with OpenRouter added as a cloud fallback provider. Tool/function calling is supported via pass-through — LMAPI does not execute tools; it proxies tool call requests/responses between client and backend.

## Current Architecture

LMAPI is a TypeScript/Express API that orchestrates LLM prompts across a pool of local Ollama servers:

- **6 Ollama servers** configured in `src/config/servers.json` (M2 Max MacBook Pro, NVIDIA GPU PCs, AMD Strix Halo 96GB VRAM)
- **Existing endpoints**: `/api/generate/any`, `/server`, `/batch`, `/all`, `/embed` — all use Ollama's `/api/generate` endpoint
- **Server selection**: Priority-fill algorithm in `ServerPoolService.reserveServerForModel()` with sticky → idle → overflow tiers
- **Queuing**: `QueueService` queues requests when all servers are at capacity, drains queue on request completion
- **Observability**: Two-phase DB writes (`insertPromptHistory` → `updatePromptHistory`), real-time WebSocket events via `SocketService`, live dashboard
- **No streaming**: All requests use `stream: false`; responses are buffered

## Goals

1. Proxy OpenAI-compatible `/v1/chat/completions` to Ollama servers (Ollama natively supports this endpoint)
2. Provide LMAPI routing variants (`/any`, `/server`, `/batch`, `/all`) for chat completions
3. Pass through tool/function calling (LMAPI does not execute tools)
4. Add OpenRouter as a cloud provider for models not available locally
5. Maintain all existing observability, pooling, load balancing, and dashboard features
6. Keep existing `/api/generate/*` endpoints unchanged

---

## Phase 5: Chat Completions — Ollama Proxy (Non-streaming)

### Endpoint Design

Two access patterns serve different use cases:

#### OpenAI-Compatible Endpoint

`POST /v1/chat/completions` — Standard OpenAI-format endpoint. Auto-routes to the best available Ollama server (same logic as `/api/generate/any`). This endpoint allows any OpenAI-compatible client or SDK to work with LMAPI without modification.

#### LMAPI Routing Endpoints

These mirror the existing `/api/generate/*` pattern for explicit routing control:

| Endpoint | Behavior |
|----------|----------|
| `POST /api/chat/completions/any` | Auto-select best server via `ServerPoolService.reserveServerForModel()` |
| `POST /api/chat/completions/server` | Route to a specific named server (requires `serverName` in body) |
| `POST /api/chat/completions/batch` | Send same messages to multiple models in parallel (requires `models[]` in body) |
| `POST /api/chat/completions/all` | Broadcast to all servers that have the model |

### Request Format

The request body follows the OpenAI chat completions standard. For LMAPI routing endpoints, additional fields are accepted alongside the standard fields:

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

  "serverName": "Beast2024",
  "models": ["llama3.1", "qwen2.5"],
  "groupId": "optional-group-uuid",
  "maxParallelPerServer": 2
}
```

- `serverName` — Used by `/server` endpoint only
- `models` — Used by `/batch` endpoint only (overrides `model`)
- `groupId` — Optional grouping for related requests (used by dashboard)
- `maxParallelPerServer` — Override the default concurrency limit per server

The `/v1/chat/completions` endpoint ignores LMAPI-specific fields and uses only the OpenAI-standard fields.

### Response Format

Standard OpenAI chat completion response — passed through from Ollama with no transformation:

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "llama3.1",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you?",
        "tool_calls": []
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

LMAPI routing endpoints (`/api/chat/completions/*`) wrap the response with server metadata:

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "llama3.1",
  "choices": [...],
  "usage": {...},
  "lmapi": {
    "server_name": "Beast2024",
    "duration_ms": 2345,
    "group_id": "uuid"
  }
}
```

For `/batch` and `/all` endpoints, results are wrapped in an array:

```json
{
  "results": [
    { "id": "chatcmpl-1", "choices": [...], "lmapi": { "server_name": "Beast2024" } },
    { "id": "chatcmpl-2", "choices": [...], "lmapi": { "server_name": "M2 Max" } }
  ],
  "group_id": "uuid"
}
```

### Implementation Details

#### New Files

- `src/routes/chatCompletionRoutes.ts` — Route handlers for `/v1/chat/completions` and `/api/chat/completions/*`
- `src/services/ChatCompletionService.ts` — Service to proxy requests to Ollama's `/v1/chat/completions`

#### ChatCompletionService

Static class following the existing singleton pattern. Core responsibility: forward OpenAI-format requests to Ollama's native `/v1/chat/completions` endpoint.

```typescript
class ChatCompletionService {
  // Build the fetch call to Ollama's /v1/chat/completions
  static async sendToServer(
    server: ServerStatus,
    body: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>

  // Extract token counts from response for DB logging
  static extractUsage(response: ChatCompletionResponse): {
    inputTokens?: number;
    outputTokens?: number;
  }
}
```

Key behavior:
- Forwards the request body to `${server.config.baseUrl}/v1/chat/completions` (Ollama's OpenAI-compatible endpoint)
- Sets `stream: false` for Phase 5 (streaming added in Phase 6)
- Strips LMAPI-specific fields (`serverName`, `models`, `groupId`, `maxParallelPerServer`) before forwarding
- Uses `AbortController` with 600s timeout (matching existing pattern)

#### Integration with Existing Services

The chat completion routes integrate with existing services the same way `/api/generate/*` does:

1. **ServerPoolService** — `reserveServerForModel(model)` for `/any` and `/v1/chat/completions`; `getServer(name)` for `/server`
2. **QueueService** — New `dispatchOrQueueChat()` and `runChatRequest()` methods that follow the same pattern as `dispatchOrQueue()` and `runRequest()`, but call `ChatCompletionService.sendToServer()` instead of Ollama's `/api/generate`
3. **DbService** — Two-phase insert/update to `PromptHistory`. For chat completions, `prompt` field stores the last user message content (for search/grouping). Response text stores `choices[0].message.content`.
4. **SocketService** — Same events: `prompt_history_added`, `prompt_history_updated`, `active_requests_changed`

#### Zod Validation Schemas

```typescript
const ChatCompletionSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.null()]).optional(),
    name: z.string().optional(),
    tool_calls: z.array(z.any()).optional(),
    tool_call_id: z.string().optional()
  })).min(1),
  tools: z.array(z.any()).optional(),
  tool_choice: z.any().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  top_p: z.number().optional(),
  frequency_penalty: z.number().optional(),
  presence_penalty: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  stream: z.boolean().optional().default(false),
  n: z.number().optional()
});

// LMAPI extensions for routing endpoints
const LMAPIChatCompletionSchema = ChatCompletionSchema.extend({
  serverName: z.string().optional(),
  models: z.array(z.string()).optional(),
  groupId: z.string().optional(),
  maxParallelPerServer: z.number().int().positive().optional()
});
```

#### Tool Calling

Tool calling is fully pass-through:
- Client includes `tools` and `tool_choice` in the request
- LMAPI forwards these to Ollama (which supports tools natively on compatible models)
- Ollama returns `tool_calls` in the response when the model decides to call tools
- LMAPI passes the response back to the client unchanged
- Client handles tool execution and sends follow-up messages with `role: "tool"`

LMAPI does **not** validate tool schemas, execute tools, or manage tool call state. It logs whether a request included tools and whether the response contained tool calls (for observability).

#### Error Responses

Errors follow OpenAI format:

```json
{
  "error": {
    "message": "Model 'unknown-model' not available on any server",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

#### PromptHistory Schema Updates

Add a column to distinguish request types:

```sql
ALTER TABLE PromptHistory ADD COLUMN requestType TEXT DEFAULT 'generate';
-- Values: 'generate', 'chat', 'embed'
```

For chat completions, the `prompt` field stores the last user message (for search/grouping/display). The full messages array is not stored in the DB (it can be very large with multi-turn conversations).

---

## Phase 6: SSE Streaming Support

Add `stream: true` support to all chat completion endpoints.

### Implementation

- When `stream: true`, proxy the SSE stream from Ollama directly to the client
- Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Read chunks from Ollama's response body, forward each `data:` line to the client
- On stream completion (`data: [DONE]`), update `PromptHistory` with accumulated token counts
- Tool calls arrive incrementally in streaming; LMAPI forwards chunks as-is (no accumulation needed since client handles reassembly)

### Observability for Streaming

- Insert `PromptHistory` record at stream start (pending state)
- Update record when stream completes with total duration and token counts from the final usage chunk
- Dashboard shows streaming requests as "in progress" until the stream closes

---

## Phase 7: OpenRouter Provider Integration

### Configuration

OpenRouter is configured separately from Ollama servers, in a new `src/config/providers.json`:

```json
{
  "openrouter": {
    "enabled": true,
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeyEnvVar": "OPENROUTER_API_KEY",
    "headers": {
      "HTTP-Referer": "https://lmapi.local",
      "X-Title": "LMAPI"
    },
    "models": [
      "anthropic/claude-sonnet-4",
      "openai/gpt-4o",
      "google/gemini-2.5-flash"
    ],
    "routing": {
      "priority": "fallback",
      "allowedEndpoints": ["chat/completions"]
    }
  }
}
```

- API key stored in `.env` as `OPENROUTER_API_KEY` (referenced by `apiKeyEnvVar`)
- `models` list defines which models are available through OpenRouter (used for routing decisions)
- `routing.priority: "fallback"` means local Ollama servers are always preferred; OpenRouter used only when the model isn't available locally or all local servers are at capacity

### New Service: ProviderService

```typescript
class ProviderService {
  // Load providers.json and validate
  static initialize(): void

  // Check if a model is available on any cloud provider
  static getProviderForModel(model: string): ProviderConfig | undefined

  // Send chat completion to OpenRouter
  static async sendChatCompletion(
    provider: ProviderConfig,
    body: ChatCompletionRequest
  ): Promise<ChatCompletionResponse>
}
```

### Routing Integration

Extend `ChatCompletionService` to check cloud providers when no local Ollama server is available:

1. Try `ServerPoolService.reserveServerForModel(model)` — local Ollama first
2. If no local server available, check `ProviderService.getProviderForModel(model)`
3. If cloud provider found, route through `ProviderService.sendChatCompletion()`
4. If neither available, queue the request (waiting for a local server to free up) or return 503

### OpenRouter-Specific Headers

```typescript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${apiKey}`,
  'HTTP-Referer': provider.headers['HTTP-Referer'],
  'X-Title': provider.headers['X-Title']
};
```

### Observability

- `PromptHistory` records include `provider` info (logged as serverName = "openrouter" or similar)
- Dashboard displays OpenRouter requests distinctly from local Ollama requests
- Log whether a request was routed locally or to a cloud provider

---

## Phase 8: Future Enhancements

- **SSE streaming for OpenRouter** — Same SSE proxy pattern as Ollama streaming
- **Extend `/api/generate/*` to route through OpenRouter** — Translate generate format to chat completions internally
- **OpenRouter generation tracking** — Poll `/api/generation/{id}` for async generation status
- **Cost tracking** — Track per-request cost based on OpenRouter's pricing data
- **Rate limiting** — Per-provider rate limiting to stay within OpenRouter API limits
- **Dashboard multi-provider view** — Visual distinction between local and cloud requests, cost display

---

## Testing Strategy

### Integration Tests (per phase)

**Phase 5:**
- Send chat completion to `/v1/chat/completions` → verify OpenAI-format response
- Send to `/api/chat/completions/any` → verify server selection and `lmapi` metadata
- Send to `/api/chat/completions/server` with specific server → verify routing
- Send to `/api/chat/completions/batch` with multiple models → verify parallel execution
- Send request with tools → verify tool calls passed through in response
- Verify `PromptHistory` records created and WebSocket events emitted
- Verify queuing when all servers at capacity

**Phase 6:**
- Send streaming request → verify SSE chunks forwarded correctly
- Verify streaming tool calls forwarded as-is
- Verify `PromptHistory` updated on stream completion

**Phase 7:**
- Request model only available on OpenRouter → verify cloud routing
- Request model available locally → verify local preference
- Verify OpenRouter auth headers sent correctly
- Verify `PromptHistory` records provider info

---

## References

- [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Ollama OpenAI Compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
- [OpenRouter API Docs](https://openrouter.ai/docs)
- [OpenRouter Generation Tracking](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

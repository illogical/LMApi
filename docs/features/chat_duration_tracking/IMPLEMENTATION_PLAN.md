# Client-Side Duration Tracking for Chat Completions

## Context

Ollama's `/v1/chat/completions` (OpenAI-compatible) endpoint does not return `load_duration`, `eval_duration`, or `total_duration` — those are Ollama-native fields only available on `/api/generate` and `/api/chat`. Since all chat requests in this project route through the OpenAI-compatible endpoint, these fields are always null for chat completion history records.

**Principle:** Client-side measurements are a fallback **only** when Ollama does not provide native duration data. The `/api/generate` path (`QueueService.runRequest()`) already receives `load_duration`, `eval_duration`, `total_duration` from Ollama and must not be changed. Only the `/v1/chat/completions` and cloud provider paths — which return no duration fields at all — use the client-side measurements.

The fix: measure equivalent durations client-side inside LMApi and store them in the same existing DB fields. The most meaningful breakdown for streaming requests is:
- **TTFT (Time to First Token)** → stored as `loadDuration` — captures model load + queue time before generation begins
- **Generation Time** → stored as `evalDuration` — time from first token to stream complete
- **Total Time** → stored as `totalDuration` — end-to-end wall clock

For non-streaming requests, only Total Time can be measured (no TTFT signal). Cloud provider requests follow the same pattern.

The UI already displays these three stat boxes and the stacked bar, so the existing visual infrastructure works — we just need to populate the fields and update the stat labels to reflect that for chat requests, these are client measurements rather than Ollama-reported values.

---

## Changes

### 1. `src/types.ts`

Extend the `lmapi` field on `ChatCompletionResponse` to carry TTFT back from `ChatCompletionService` to `QueueService`:

```typescript
lmapi?: {
    server_name: string;
    duration_ms: number;
    ttft_ms?: number;   // Time to first token (streaming only)
    group_id?: string;
};
```

---

### 2. `src/services/ChatCompletionService.ts`

In `handleStreamingResponse()`, add TTFT tracking:

- Record `streamStartMs = Date.now()` at the top of the method (before the read loop)
- Declare `let firstTokenMs: number | undefined`
- Inside the loop, after parsing a chunk that contains non-empty `delta.content` **or** a non-empty `delta.tool_calls`, set `firstTokenMs = Date.now() - streamStartMs` (only once — guard with `if (firstTokenMs === undefined)`)
- Before returning `accumulatedResponse`, attach the measurement:
  ```typescript
  if (firstTokenMs !== undefined && accumulatedResponse) {
      accumulatedResponse.lmapi = { server_name: server.config.name, duration_ms: 0, ttft_ms: firstTokenMs };
  }
  ```
  (`duration_ms: 0` is a placeholder — QueueService overwrites the entire `lmapi` object after reading `ttft_ms`.)

---

### 3. `src/services/QueueService.ts`

**`runChatRequest()` (non-streaming, Ollama):**
After `sendToServer()` returns, add `totalDuration` to the DB update:
```typescript
totalDuration: Math.round(durationMs * 1e6),   // convert ms → ns to match Ollama field format
```

**`runChatRequestStreaming()` (streaming, Ollama):**
After `sendToServer()` returns, read TTFT before overwriting `lmapi`:
```typescript
const ttftMs = response.lmapi?.ttft_ms;
const loadDuration  = ttftMs != null ? Math.round(ttftMs * 1e6) : undefined;
const evalDuration  = ttftMs != null ? Math.round((durationMs - ttftMs) * 1e6) : undefined;
const totalDuration = Math.round(durationMs * 1e6);
```
Then pass all three to `updatePromptHistory`, and set `response.lmapi` as normal.

**`runCloudProviderRequest()` (non-streaming, cloud):**
Same as non-streaming Ollama — just `totalDuration: Math.round(durationMs * 1e6)`.

**`runCloudProviderRequestStreaming()` (streaming, cloud):**
`ProviderService.sendChatCompletion()` handles streaming internally — no TTFT signal available. Set only `totalDuration: Math.round(durationMs * 1e6)`.

---

### 4. `src/public/log-dashboard.html` — Label differentiation

In `showDetailPanel()`, update the three stat box labels based on `row.requestType`:

```javascript
const isChat = row.requestType === 'chat';
const label1 = isChat ? 'TTFT'     : 'Load Duration';
const label2 = isChat ? 'Gen Time' : 'Eval Duration';
const label3 = isChat ? 'Total'    : 'Total Duration';
```

Same update for the stacked bar tooltip labels (`title` attributes): swap "Load" → "TTFT" and "Eval" → "Gen" when `isChat`.

No new DB fields needed — `loadDuration`, `evalDuration`, `totalDuration` already exist and are displayed correctly.

---

## File Summary

| File | Change |
|------|--------|
| `src/types.ts` | Add `ttft_ms?: number` to `lmapi` on `ChatCompletionResponse` |
| `src/services/ChatCompletionService.ts` | Track TTFT in streaming loop; attach to `accumulatedResponse.lmapi` before return |
| `src/services/QueueService.ts` | Read `ttft_ms`; compute and save `loadDuration`, `evalDuration`, `totalDuration` for chat/cloud paths only |
| `src/public/log-dashboard.html` | Show `TTFT` / `Gen Time` / `Total` labels for chat requests; unchanged for generate |

---

## Verification

1. Start server: `npm run dev`
2. Send a **streaming** chat request (`"stream": true`) via `/v1/chat/completions`
   - Open the Prompt History sidebar — expect `TTFT`, `Gen Time`, `Total` labels populated; stacked bar visible
3. Send a **non-streaming** chat request (`"stream": false`)
   - Expect: only `Total` populated; `TTFT` and `Gen Time` show `—`
4. Send an `/api/generate` request
   - Expect: original `Load Duration`, `Eval Duration`, `Total Duration` labels; values from Ollama unchanged
5. Send a **tool-use** request (`llama3-groq-tool-use`, streaming)
   - TTFT should trigger on the first `delta.tool_calls` chunk since there's no `delta.content`

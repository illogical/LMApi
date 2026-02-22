# Prompt History — Rich Request Context, Fix Token Metadata, Collapsible Tool/Thinking Sections

## Context

The Prompt History sidebar currently only shows the last user message in the "Prompt" field and is missing token counts and duration metadata for requests routed through the `/v1/chat/completions` endpoint. The root causes are:

1. **Tokens null for chat completions (streaming):** Ollama's `/v1/chat/completions` does not include `usage` in streaming SSE chunks by default. Requesting with `"stream_options": {"include_usage": true}` is required to receive usage data in the final chunk.
2. **Tool calls lost in streaming:** The streaming accumulator only concatenates `delta.content`, ignoring `delta.tool_calls`. When a model returns tool calls (like `llama3-groq-tool-use`), the accumulated response ends up with empty content and no tool_calls — so both `responseText` and token counts end up blank.
3. **Duration fields (load/eval/total) not available for chat completions:** These are Ollama-native fields returned only by `/api/generate` and `/api/chat`, not by the OpenAI-compatible `/v1/chat/completions`. This is an API limitation, not a bug — they will remain `—` for chat requests.
4. **Missing request context:** Only the last user message is saved to the DB. System prompts and prior conversation turns are discarded.
5. **No separate storage for tool_calls:** Raw tool_call JSON is converted to a display string and stored in `responseText`, making it unstructured.

---

## Changes

### 1. `src/services/DbService.ts`

**DB Migration** — Add two new columns via `ALTER TABLE ... ADD COLUMN` (same try/catch pattern as existing migrations):
- `messages TEXT` — Full messages array as JSON string for chat requests
- `toolCalls TEXT` — Raw tool_calls JSON array from the response

**`PromptHistoryRecord` interface** — Add:
```typescript
messages?: string;    // JSON string of full messages array
toolCalls?: string;   // JSON string of tool_calls array
```

**`insertPromptHistory()` and `updatePromptHistory()`** — Accept and persist the two new fields in SQL.

---

### 2. `src/services/ChatCompletionService.ts`

**Fix streaming in `sendToServer()` (lines 22–26):**
Add `"stream_options": {"include_usage": true}` to the payload when `body.stream === true`. This tells Ollama to include a `usage` object in the final SSE chunk.

**Fix `handleStreamingResponse()` tool_calls accumulation (lines 133–148):**
Currently only `delta.content` is appended during streaming. Add handling for `delta.tool_calls` to accumulate tool call arrays across chunks using index-based merging (OpenAI streaming tool_calls delta format).

**Add `extractToolCalls()` static method:**
```typescript
static extractToolCalls(response: ChatCompletionResponse): any[] | undefined {
    const toolCalls = response.choices?.[0]?.message?.tool_calls;
    return Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : undefined;
}
```

**Update `extractResponseContent()` (lines 220–235):**
When `tool_calls` are present and `content` is null/empty, return an empty string. Tool calls are now stored in the dedicated `toolCalls` column rather than being serialized into `responseText`.

---

### 3. `src/services/QueueService.ts`

**`runChatRequest()` (lines 386–471) and `runChatRequestStreaming()` (lines 477–563):**
- On `insertPromptHistory`: pass `messages: JSON.stringify(request.messages)` to store full conversation context.
- On `updatePromptHistory`: extract and pass `toolCalls: JSON.stringify(toolCallsArray)` using the new `extractToolCalls()` method.

**`runCloudProviderRequest()` and its streaming variant:** Same pattern — pass `messages` on insert and `toolCalls` on update.

---

### 4. `src/public/log-dashboard.html`

**Prompt display fix:**
When `row.prompt` is a JSON string that parses to an array of content parts (`[{"type":"text","text":"..."}]`), extract and display the text value rather than raw JSON.

**Messages / Context section:**
Add a new `.text-section` above the Prompt section. When `row.messages` is present, parse the JSON and render each message as a labeled block (`[SYSTEM]`, `[USER]`, `[ASSISTANT]`). This gives visibility into the system prompt and full conversation history.

**Collapsible sections (after Response section):**

```
[▶] Thinking   ← collapsed by default; toggle disabled (grayed) if row.thinking is null/empty
[▶] Tool Calls ← collapsed by default; toggle disabled (grayed) if row.toolCalls is null/empty
```

Each uses a disclosure pattern:
- A header `<button>` with a chevron icon (`▶` / `▼`) and label
- A content div hidden by default, shown when toggled
- Disabled state: button has `disabled` attribute + muted styling when no data
- Thinking content: plain text in a `.text-section-content` block
- Tool Calls content: formatted JSON (`JSON.stringify(parsed, null, 2)`) in a `.text-section-content` block

---

### 5. `src/public/styles/log-dashboard.css`

Add CSS for collapsible sections:
- `.collapsible-header` — flex row, clickable, with chevron and label
- `.collapsible-header:disabled` — muted/grayed, cursor default
- `.collapsible-body` — hidden by default
- `.collapsible-section.open .collapsible-body` — `display: block`

---

## File Summary

| File | Change |
|------|--------|
| `src/services/DbService.ts` | Add `messages`/`toolCalls` columns, interface fields, SQL |
| `src/services/ChatCompletionService.ts` | Fix streaming usage + tool_calls accumulation; add `extractToolCalls()`; add `stream_options` |
| `src/services/QueueService.ts` | Pass `messages` on insert, `toolCalls` on update for all chat paths |
| `src/public/log-dashboard.html` | Fix prompt display; add Messages section; add Thinking/Tool Calls collapsibles |
| `src/public/styles/log-dashboard.css` | Add collapsible section CSS |

---

## Verification

1. Start server: `npm run dev`
2. Send a **non-streaming** chat request with a system prompt via `/v1/chat/completions` — `inputTokens` and `outputTokens` should populate; full `messages` with system prompt visible in sidebar
3. Send a **streaming** chat request — token counts should also populate (via `stream_options`)
4. Send a **tool-use** request with `llama3-groq-tool-use` — Tool Calls section should appear enabled and show parsed JSON
5. Send a **thinking** model request — Thinking section should appear enabled
6. Send an `/api/generate` request — verify `loadDuration`, `evalDuration`, `totalDuration` still populate correctly
7. Verify Thinking and Tool Calls toggles are **disabled** for records with no data
8. Verify collapsibles start **collapsed** and expand on click

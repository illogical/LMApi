# LMApi Sampling Parameter Support

**Status:** `seed` implemented 2026-09-04 (see §2). `top_k`/`num_ctx` resolved as already
working via `/api/generate` — no code change needed there (see §3); native-endpoint routing
for chat-completions remains deferred, no consumer needs it yet.
**Target repository:** LMApi (this repository)
**Requested by:** LMEval, as a dependency of its Track A1 ("Inference parameters and
provenance") — see `C:\LocalDev\Projects\LMEval\docs\plans\2026-09-03-professional-memory-evaluations.md`
and the A1 implementation plan that motivated this doc.

## Why

LMEval is adding explicit `temperature`/`maxTokens`/`seed` control to every evaluation cell so
that a measured result is reproducible and attributable to a specific configuration rather than
"whatever the provider defaulted to." `temperature` and `maxTokens` already work end-to-end
through LMApi with zero changes needed here — see §1. `seed` does not, and that gap is entirely
on LMApi's side — see §2.

This is unrelated to the three existing plans in this folder (HomeBase integration, hosted-Ollama
localhost fix, Open WebUI integration) — it's a new, narrower ask.

## 1. Current state (verified, not assumed)

`ChatCompletionSchema` (`src/routes/chatCompletionRoutes.ts:21-35`) already accepts and forwards:
`temperature`, `max_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`. It has **no
`.passthrough()`**, so any field not named in the Zod schema is silently dropped by `.parse()`
before the request ever reaches `ChatCompletionService`.

`ChatCompletionService.sendToServer` (`src/services/ChatCompletionService.ts:12-37`) strips only
the LMAPI-specific routing fields (`serverName`, `models`, `groupId`, `maxParallelPerServer`) and
forwards everything else verbatim to **Ollama's OpenAI-compatibility endpoint**,
`{baseUrl}/v1/chat/completions` — not Ollama's native `/api/chat`.

There is currently no trace anywhere in this repo (routes, services, types) of `seed`, `top_k`,
`num_ctx`, or a native Ollama `options: {...}` object — confirmed by search, not merely absent
from the schema.

## 2. `seed` — IMPLEMENTED (2026-09-04)

Ollama's `/v1/chat/completions` compatibility endpoint accepts `seed` as a top-level field —
confirmed against current Ollama docs, not just assumed. Shipped as a schema-only change:

- `seed: z.number().int().optional()` added to `ChatCompletionSchema`
  (`src/routes/chatCompletionRoutes.ts`), which propagates automatically to
  `LMAPIChatCompletionSchema` and `BatchChatCompletionSchema` since both derive from it.
- `seed?: number` added to `ChatCompletionRequest` (`src/types.ts`).
- OpenAPI docs updated in `src/routes/schemas.ts` (`ChatCompletionRequest` and
  `BatchChatCompletionRequest`).
- No change needed in `ChatCompletionService` or `ProviderService` — the existing "forward
  everything not explicitly stripped" behavior already carries it through once the schema
  stops dropping it.

This unblocks LMEval's A1 provenance field (`transportProvenance.seedHonored`) from `false`
to `true` with no LMEval-side change required.

## 3. `top_k` / `num_ctx` — resolved: already works via `/api/generate`, chat-completions path deferred

Neither field exists on Ollama's OpenAI-compat endpoint at all (confirmed against current
Ollama docs — must be set via Modelfile there). Ollama only exposes them through its
**native** `/api/chat` / `/api/generate` endpoints' `options: {...}` object (e.g.
`options: { top_k: 40, num_ctx: 4096 }`).

**Turns out this repo already supports that — just not on the chat-completions path.**
`PromptSchema.params` (`src/routes/promptRoutes.ts`) is `z.record(z.any())`, and
`QueueService.runRequest` spreads `...request.params` directly into the payload sent to
Ollama's native `/api/generate` (`src/services/QueueService.ts`). A caller can already send:

```json
{ "model": "...", "prompt": "...", "params": { "options": { "top_k": 40, "num_ctx": 8192, "seed": 42 } } }
```

to `/api/generate/*` today, with zero LMApi changes. MemoryApi already relies on exactly this
pattern (`options: { temperature, num_predict }` via its `LMApiClient`).

What's still genuinely unsupported: **`/v1/chat/completions` and `/api/chat/completions/*`
have no way to pass native options**, since they forward straight to Ollama's OpenAI-compat
endpoint, which doesn't accept `top_k`/`num_ctx` at all. Closing that gap would require one
of the two options originally sketched here:

- **(a) Native-endpoint routing.** When a request includes `top_k` or `num_ctx`, route to
  Ollama's native `/api/chat` instead of the compat endpoint, translating the whole OpenAI-shaped
  body (`messages`, `temperature`, `max_tokens` → `num_predict`, etc.) into Ollama's native request
  shape. Broader blast radius: two request-building code paths to maintain, and any future
  OpenAI-compat field addition needs mirroring on both.
- **(b) Raw `options` passthrough on chat-completions.** Add an
  `options?: Record<string, unknown>` field to `LMAPIChatCompletionSchema`, forwarded only
  when targeting a confirmed-Ollama server. Narrower blast radius, but an escape hatch that
  breaks the "OpenAI-compatible" abstraction LMApi otherwise presents on that path.

**Still not needed by any current consumer** — LMEval's A1 work only needs `seed`, which is
now on the chat-completions path; MemoryApi only uses `/api/generate`, which already has full
native-options support. Remains deferred until an actual consumer asks for `top_k`/`num_ctx`
specifically on a chat-completions-shaped call. See
`C:\LocalDev\Projects\LMEval\docs\plans\2026-09-04-lmapi-native-options-available.md` for the
notice sent to LMEval about this.

## 4. Future parity backlog (not scoped, not implemented)

Surfaced while researching Ollama's current API surface for this doc. None have a current
consumer — recorded for whoever picks up LMApi/Ollama parity work next:

- **Structured outputs / JSON schema** (`response_format` on the compat endpoint, `format`
  on native endpoints) — supported by Ollama since December 2024 on both native and
  OpenAI-compat endpoints. Could help MemoryApi's classification/tagging/entity-extraction
  tasks, but MemoryApi hasn't requested it.
- **`think` parameter** for reasoning-model token control (boolean or `low`/`medium`/`high`/
  `max`) — no current consumer.
- **`/api/embed` vs `/api/embeddings`** — `QueueService` currently uses the deprecated
  `/api/embeddings`; low priority, works today, but Ollama documents `/api/embed` as the
  primary endpoint going forward.
- **`tool_choice`** — already accepted by LMApi's schema and forwarded, but Ollama's
  compat endpoint doesn't honor it (silently ignored). Not a bug, just worth knowing it's
  currently a no-op.

## Verification

- Add `seed` to a request against `/api/chat/completions/any` in a live smoke test; confirm the
  seed value round-trips into Ollama's response metadata (or produces deterministic output across
  repeated identical calls) rather than being silently dropped.
- No regression: existing `temperature`/`max_tokens`/etc. requests behave unchanged.

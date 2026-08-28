# Add `GET /v1/models` and `POST /v1/embeddings`

**Status:** Approved 2026-08-27.
**Target repository:** LMApi (this repository)
**Requested outcome:** Round out LMApi's OpenAI-compatible surface so external
OpenAI-compatible clients (Open WebUI, and anything else that talks to
`/v1/chat/completions`) can also discover models and request embeddings
without going through LMApi's `/api/*` routes. See
`docs/plans/2026-08-27-open-webui-integration.md` for the deployment work
this unblocks.

## Context

`POST /v1/chat/completions` already exists and is OpenAI-compatible
(`src/routes/chatCompletionRoutes.ts:193`). Two endpoints most
OpenAI-compatible clients also expect are missing:

- `GET /v1/models` — Open WebUI (and the OpenAI SDK's model-listing calls in
  general) uses this to populate a model selector. LMApi only exposes
  `/api/models`, `/api/models/loaded`, and `/api/models/by-server`
  (`src/routes/modelRoutes.ts`), which return `{ models: string[] }`, not the
  OpenAI list shape.
- `POST /v1/embeddings` — LMApi only exposes `/api/embed`
  (`src/routes/promptRoutes.ts:372`), which returns LMApi's own response
  envelope, not OpenAI's `{ object: 'list', data: [...] }` shape.

Both are thin projections over data LMApi already computes — no new routing
logic, no new services.

## Implementation

**File:** `src/routes/chatCompletionRoutes.ts` — both new routes belong here
(not in `modelRoutes.ts` / `promptRoutes.ts`), since it's the file already
holding the "OpenAI-compatible, not under `/api`" routes, and it's mounted at
the router root via `router.use('/', chatCompletionRoutes)` in
`src/app.ts:97` — no `app.ts` change needed.

### `GET /v1/models`

Reuse the same dedup/sort aggregation `src/routes/modelRoutes.ts:27-33`
(`/api/models`) already does via `ServerPoolService.getServers()`, reshaped
into OpenAI's list format:

```ts
router.get('/v1/models', (req, res) => {
    const servers = ServerPoolService.getServers();
    const allModels = new Set<string>();
    servers.forEach(s => s.models.forEach(m => allModels.add(m)));
    const sorted = Array.from(allModels).sort((a, b) => a.localeCompare(b));
    res.json({
        object: 'list',
        data: sorted.map(id => ({ id, object: 'model', owned_by: 'lmapi' })),
    });
});
```

Also include cloud-provider models from `ProviderService` so
OpenRouter-fallback models show up too, not just local Ollama models — check
`ProviderService`'s public methods for a "list enabled provider models"
accessor; if none exists, iterate the enabled providers in
`src/config/providers.json` and flatten their `models` arrays into the same
`data` list (`owned_by` can be the provider key, e.g. `'openrouter'`).

### `POST /v1/embeddings`

Wrapper around the existing routed embedding path
(`src/routes/promptRoutes.ts:372`, which calls `QueueService.dispatchOrQueue`
with `params.embedding = true`; the vector comes back as `result.response`,
per `src/services/QueueService.ts:211`). Add a small Zod schema alongside the
existing ones at the top of `chatCompletionRoutes.ts`:

```ts
const EmbeddingSchema = z.object({
    model: z.string(),
    input: z.union([z.string(), z.array(z.string())]),
});
```

Reuse `ensureModelAvailable` (already defined at
`chatCompletionRoutes.ts:54`) for the availability check, then loop over
`input` (wrap a single string in a one-element array), dispatching one
request per input string:

```ts
router.post('/v1/embeddings', async (req, res) => {
    try {
        const body = EmbeddingSchema.parse(req.body);
        const availability = ensureModelAvailable(body.model);
        if (!availability.ok) {
            return res.status(503).json(createErrorResponse(
                availability.message || 'Model not available',
                'invalid_request_error', 'model', 'model_not_found'
            ));
        }
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        const results = await Promise.all(inputs.map((text, index) =>
            QueueService.dispatchOrQueue({
                prompt: text,
                model: body.model,
                serverName: 'any',
                params: { embedding: true },
            }).then(r => ({ object: 'embedding', embedding: r.response, index }))
        ));
        res.json({
            object: 'list',
            data: results,
            model: body.model,
            usage: { prompt_tokens: 0, total_tokens: 0 },
        });
    } catch (error: any) {
        LogService.error('[/v1/embeddings] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json(createErrorResponse('Invalid request body: ' + error.message, 'invalid_request_error'));
        }
        if (!res.headersSent) {
            res.status(500).json(createErrorResponse(error.message, 'server_error'));
        }
    }
});
```

`usage` token counts are left at `0` — LMApi doesn't currently track token
counts for embedding calls anywhere in the codebase; don't invent a token
counter for this.

## Verification

No unit test framework covers routes directly — per CLAUDE.md, route
correctness is verified with the integration test scripts against a live
server (`npm run test:routes`-style), not `npm test`. For this change:

1. `npm run build` — confirms the TypeScript compiles.
2. `npm run dev`, then:
   ```bash
   curl http://localhost:17100/v1/models
   curl -X POST http://localhost:17100/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"model":"nomic-embed-text","input":"test"}'
   ```
   against a running Ollama server that has an embedding model loaded.
3. Confirm `/v1/models`'s `data` array includes both local Ollama models and
   any enabled OpenRouter models from `providers.json`.

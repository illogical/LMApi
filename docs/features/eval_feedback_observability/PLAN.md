# Eval Feedback & Observability (LA-14)

## Context

AI agents running model and prompt evaluations against LMApi have no way to observe
in-flight work. During an eval run, agents can't distinguish queue delay from model
slowness, can't tell if a request stalled, and can't track progress across a grouped
run. This plan implements two connected features:

1. **RequestRegistryService + Observability Endpoints (LA-13 foundation)** — in-memory
   per-request lifecycle tracking with REST query endpoints and WebSocket events, giving
   any caller real-time visibility into active requests, queue state, and grouped run
   progress.

2. **Model Evaluator (`POST /api/evaluate` + `/evaluator` page)** — a dedicated
   evaluation endpoint that dispatches a prompt to N models in parallel, emits per-lane
   WebSocket events as each model finishes, generates a markdown report, and serves a
   web UI for interactive comparison runs.

These are implemented together because the eval endpoint is the primary eval trigger
and the observability layer is what makes it agent-usable.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/services/RequestRegistryService.ts` | In-memory active request registry with lifecycle tracking |
| `src/services/EvaluationReportService.ts` | Markdown report writer for eval results (`reports/eval-*.md`) |
| `src/routes/requestRoutes.ts` | `GET /api/requests/active`, `/:requestId`, `/api/groups/:groupId`, `/api/queue` |
| `src/routes/healthRoutes.ts` | `GET /health` |
| `src/routes/evaluateRoutes.ts` | `POST /api/evaluate`, `GET /api/evaluate/file` |
| `src/public/model-evaluator.html` | Model Evaluator web UI page |
| `src/public/scripts/modelEvaluator.js` | Frontend ES module for the evaluator page |

## Files to Modify

| File | Change |
|---|---|
| `src/types.ts` | Add `ActiveRequestState`, `GroupStatus`, `EvaluationRequest`, `EvaluationResult` |
| `src/constants.ts` | Add `REQUEST_STARTED/COMPLETED/FAILED`, `QUEUE_UPDATED`, `EVAL_LANE_STARTED/COMPLETED`, `EVAL_ALL_COMPLETED` to `SOCKET_EVENTS` |
| `src/services/QueueService.ts` | Call `RequestRegistryService` at lifecycle points (8 insertion sites) |
| `src/services/SocketService.ts` | Add `emitRequestStarted/Completed/Failed`, `emitQueueUpdated`, `emitEvalLane*` methods |
| `src/services/DbService.ts` | Add `groupId`, `requestType`, `isError`, date-range, duration-range filters to history query |
| `src/routes/historyRoutes.ts` | Wire new filter query params to `DbService` |
| `src/app.ts` | Register 3 new route files; add `GET /evaluator` static route |
| `src/public/log-dashboard.html` | Add "Evaluator" nav link |
| `src/public/history-browser.html` | Add "Evaluator" nav link |
| `src/public/styles/log-dashboard.css` | Append lane animation + evaluator UI styles |
| `docs/SPECIFICATION.md` | Document new endpoints and evaluator page |
| `README.md` | Add evaluator to feature list, add Observability + Health sections |
| `docs/openapi.yaml` | Add OpenAPI entries for all new endpoints |

---

## Phase 1 — Types & Constants

### `src/types.ts` — append:

```ts
export type RequestPhase =
  'queued' | 'dispatching' | 'evaluating' | 'streaming' |
  'completed' | 'failed' | 'cancelled';

export interface ActiveRequestState {
  requestId: string;
  groupId?: string | null;
  requestType: 'generate' | 'chat' | 'embed' | 'agent';
  serverName?: string | null;
  modelName: string;
  phase: RequestPhase;
  startedAt: string;          // ISO
  queuedAt?: string;
  dispatchedAt?: string;
  lastActivityAt: string;
  elapsedMs: number;          // computed on read
  promptPreview?: string;
  retryCount: number;
  error?: string | null;
}

export interface GroupStatus {
  groupId: string;
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  byModel: Record<string, number>;
  byServer: Record<string, number>;
  startedAt: string;
  updatedAt: string;
}

export interface EvaluationRequest {
  prompt?: string;
  filePath?: string;
  models: string[];
  temperature?: number;
  max_tokens?: number;
  generateReport?: boolean;   // default true
}

export interface EvaluationResult {
  model: string;
  server_name: string;
  duration_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  tokens_per_second?: number;
  load_duration_ms?: number;
  eval_duration_ms?: number;
  finish_reason: string;
  response_text: string;
  thinking?: string;
  error?: string;
}
```

### `src/constants.ts` — add to `SOCKET_EVENTS`:

```ts
REQUEST_STARTED:      'request_started',
REQUEST_COMPLETED:    'request_completed',
REQUEST_FAILED:       'request_failed',
QUEUE_UPDATED:        'queue_updated',
EVAL_LANE_STARTED:    'eval_lane_started',
EVAL_LANE_COMPLETED:  'eval_lane_completed',
EVAL_ALL_COMPLETED:   'eval_all_completed',
```

---

## Phase 2 — RequestRegistryService

New file: `src/services/RequestRegistryService.ts`

Two module-level Maps:
- `registry: Map<string, ActiveRequestState>` — keyed by requestId
- `groupIndex: Map<string, Set<string>>` — groupId → Set of requestIds

### Public API:

```ts
static create(params: {
  requestId: string;
  groupId?: string;
  requestType: ActiveRequestState['requestType'];
  modelName: string;
  promptPreview?: string;
}): ActiveRequestState

static markDispatching(requestId: string, serverName: string): void
static markEvaluating(requestId: string): void
static markStreaming(requestId: string): void
static markCompleted(requestId: string): void
static markFailed(requestId: string, error: string): void
static markCancelled(requestId: string): void

static getActive(): ActiveRequestState[]        // phase not in terminal set
static getOne(requestId: string): ActiveRequestState | undefined
static getGroupStatus(groupId: string): GroupStatus | null
static getQueueSnapshot(): ActiveRequestState[] // phase === 'queued'

static pruneCompleted(maxAgeMs?: number): void  // removes terminal entries older than maxAgeMs (default 5min)
```

- `elapsedMs` is computed as `Date.now() - new Date(startedAt).getTime()` in every getter
- `pruneCompleted()` is called on a 60s interval from `AppService.start()`
- Every state mutation emits `SocketService.emitQueueUpdated(getQueueSnapshot())`

---

## Phase 3 — Instrument QueueService

Eight targeted insertions in `src/services/QueueService.ts` (no structural changes):

| Approx line | Lifecycle point | Call |
|---|---|---|
| After line ~35 (dispatchOrQueue) | Prompt registered | `RequestRegistryService.create(...)` |
| After line ~53 (enqueue) | Prompt queued | `RequestRegistryService.create(..., phase queued)` |
| Before line ~144 (runRequest insert) | Server assigned | `markDispatching(requestId, serverName)` → `markEvaluating(requestId)` |
| In finally ~line 260 (runRequest) | Prompt complete | `markCompleted()` or `markFailed(error)` |
| After line ~283 (dispatchOrQueueChat) | Chat registered | `RequestRegistryService.create(...)` |
| After line ~308 (enqueueChatRequest) | Chat queued | same |
| Before line ~401 (runChatRequest insert) | Server assigned | `markDispatching` + `markEvaluating` |
| In finally ~line 473 (runChatRequest) | Chat complete | `markCompleted()` / `markFailed()` |
| Before line ~502 (runChatRequestStreaming) | Stream starts | `markStreaming(requestId)` |
| In finally ~line 577 (streaming) | Stream done | `markCompleted()` / `markFailed()` |

Also emit `SocketService.emitRequestStarted(state)` in `create()` and
`SocketService.emitRequestCompleted/Failed(state)` in cleanup.

---

## Phase 4 — SocketService Extensions

Add to `src/services/SocketService.ts` following existing `emit*(data)` pattern:

```ts
emitRequestStarted(state: ActiveRequestState): void
emitRequestCompleted(state: ActiveRequestState): void
emitRequestFailed(state: ActiveRequestState): void
emitQueueUpdated(queue: ActiveRequestState[]): void
emitEvalLaneStarted(groupId: string, model: string, laneIndex: number): void
emitEvalLaneCompleted(groupId: string, model: string, result: EvaluationResult): void
emitEvalAllCompleted(groupId: string, results: EvaluationResult[], reportPath?: string): void
```

---

## Phase 5 — Observability Routes

**`src/routes/requestRoutes.ts`**

```
GET /api/requests/active          → { requests: RequestRegistryService.getActive() }
GET /api/requests/:requestId      → RequestRegistryService.getOne(id), 404 if not found
GET /api/groups/:groupId          → RequestRegistryService.getGroupStatus(id), 404 if null
GET /api/queue                    → { queue: [...], length: N }
```

**`src/routes/healthRoutes.ts`**

```
GET /health → {
  ok: true,
  db: DbService.isHealthy(),          // SELECT 1 check
  onlineServers: ServerPoolService.getServers().filter(s => s.isOnline).length,
  activeRequests: RequestRegistryService.getActive().length,
  queueLength: RequestRegistryService.getQueueSnapshot().length
}
```

Register in `src/app.ts`:
```ts
app.use('/api', requestRoutes);
app.use('/', healthRoutes);
```

---

## Phase 6 — History Filter Enhancements

**`src/routes/historyRoutes.ts`** — add Zod query params:

```ts
groupId?: string
requestType?: string        // 'generate' | 'chat' | 'embed' | 'agent'
isError?: boolean
createdAfter?: string       // ISO datetime
createdBefore?: string
durationGt?: number         // ms
durationLt?: number
```

**`src/services/DbService.ts`** — extend history query with parameterized `WHERE`
clauses for each new param. All columns already exist — no migration needed.

---

## Phase 7 — EvaluationReportService

New file: `src/services/EvaluationReportService.ts`

```ts
static async generate(
  prompt: string,
  results: EvaluationResult[],
  groupId: string
): Promise<{ filePath: string; fileName: string }>
```

- Writes to `reports/eval-YYYYMMDD-HHmmss.md` (creates `reports/` dir if missing)
- Sections: header (date, groupId, model count), full prompt block, summary table
  (model | server | duration | tok/s | output tokens | finish reason sorted by duration asc),
  per-model response sections with optional Thinking + Tool Calls sub-sections
- Follows same `fs.mkdir` + `fs.writeFile` pattern as existing `ReportService`

---

## Phase 8 — Evaluate Routes

New file: `src/routes/evaluateRoutes.ts`

**`POST /api/evaluate`**

Zod schema:
```ts
{
  prompt?: string,
  filePath?: string,
  models: z.string().array().min(1),
  temperature?: z.number().optional(),
  max_tokens?: z.number().int().optional(),
  generateReport?: z.boolean().default(true),
}
```

Implementation flow:
1. Validate at least one of `prompt` / `filePath` (400 if neither)
2. If `filePath`: validate extension (`.md .txt .text .prompt`), no path traversal, read with `fs.readFile`
3. Generate `groupId = randomUUID()`
4. For each model: build `ChatCompletionRequest` (single user message), call
   `QueueService.dispatchOrQueueChat()` with individual `.then()` handler
5. Emit `EVAL_LANE_STARTED` for each model immediately upon dispatch
6. Use `Promise.allSettled()` — one failure never blocks others
7. Map settled results to `EvaluationResult[]`
8. If `generateReport`: call `EvaluationReportService.generate()`
9. Emit `EVAL_ALL_COMPLETED`
10. Return `{ group_id, results, duration_ms, report_path? }`

**`GET /api/evaluate/file?path=<encoded>`**

- Allowlist extensions: `.md .txt .text .prompt`
- Require absolute path (reject relative)
- Return `{ content: string }` or 400/404

Register in `src/app.ts`:
```ts
app.use('/api', evaluateRoutes);
app.get('/evaluator', (req, res) =>
  res.sendFile('model-evaluator.html', { root: path.join(__dirname, '../public') }));
```

---

## Phase 9 — Frontend (Model Evaluator)

### `src/public/model-evaluator.html`

- Same page structure as `log-dashboard.html` (`.page`, `.panel`, `.header-actions` nav)
- Nav links: Dashboard → `/`, History → `/history`
- **Prompt panel**: textarea (max-height 300px, scrollable) + file Browse button (hidden
  `<input type="file">`) + visible path input + clear (✕) + View Full (⛶) modal
- **Controls bar**: Reset button + Compare button (disabled during active run)
- **Lanes container**: `display: flex; overflow-x: auto; gap: 16px`; each lane 320px fixed
  width `.panel` card; "+" add lane card (dashed, centered)
- **Summary panel**: hidden until `EVAL_ALL_COMPLETED`; table of results sorted by duration

### `src/public/scripts/modelEvaluator.js` — ES module

Lane state machine: `chooser → idle → loading → complete | error`

- Import `DashboardSocket` from `/scripts/dashboardSocket.js`
- Listen for `eval_lane_started`, `eval_lane_completed`, `eval_all_completed` filtered by `groupId`
- Live elapsed timer via `setInterval(16ms)` showing `MM:SS.mmm`
- Green border flash CSS animation on `complete` state entry
- Per-lane metrics display: duration, tok/s, tokens (in/out), load time, gen time, finish reason
- Scrollable response text block; collapsible Thinking section if present
- Model chooser: fetch `GET /api/models/loaded` + `GET /api/servers` → server pills per model

### `src/public/styles/log-dashboard.css` — append:

```css
.lane-complete-flash { animation: lane-flash 1s ease-out; }
@keyframes lane-flash {
  0%, 100% { border-color: var(--border); }
  30% { border-color: var(--success-color, #22c55e); }
}
.chooser-model-list { overflow-y: auto; max-height: 360px; }
.model-pill { font-size: .75rem; padding: 2px 6px; border-radius: 4px; background: var(--accent-muted); }
.metric-row { display: flex; justify-content: space-between; font-size: .85rem; }
.finish-badge { font-size: .75rem; padding: 2px 6px; border-radius: 4px; }
.finish-badge.stop { background: var(--success-muted, #166534); color: #86efac; }
.finish-badge.length { background: var(--warning-muted, #713f12); color: #fde68a; }
.lane-response-text { background: var(--code-bg); font-family: monospace; overflow-y: auto; max-height: 400px; padding: .75rem; border-radius: 6px; }
.eval-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; z-index: 100; }
.eval-modal { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; max-width: 800px; width: 90vw; max-height: 80vh; display: flex; flex-direction: column; }
```

---

## Phase 10 — Nav Links

- `src/public/log-dashboard.html`: add `<a href="/evaluator" class="btn btn-sm">Evaluator</a>` to `.header-actions`
- `src/public/history-browser.html`: same

---

## Phase 11 — Documentation

Update **after** all phases are verified:

- **`docs/SPECIFICATION.md`**: Add §4.5 Model Evaluator (page, endpoint, report format),
  §4.6 Observability Endpoints, §4.7 Health Endpoint; update §4.3 history filters
- **`README.md`**: Add Model Evaluator to feature list, Observability section under API Endpoints,
  `/health` entry, update existing endpoints table
- **`docs/openapi.yaml`**: Add full paths + schemas for:
  - `POST /api/evaluate`
  - `GET /api/evaluate/file`
  - `GET /api/requests/active`
  - `GET /api/requests/{requestId}`
  - `GET /api/groups/{groupId}`
  - `GET /api/queue`
  - `GET /health`
  - Updated `GET /api/prompt-history` with new filter params

---

## Verification Sequence

1. **Build**: `npm run build` — TypeScript must compile clean
2. **Start**: `npm run dev`
3. **Health**: `curl http://localhost:3111/health` → `{ ok: true, ... }`
4. **Active requests**: Send a slow generate request; poll `GET /api/requests/active` — entry visible with `phase: 'evaluating'`
5. **Queue state**: Send 10 concurrent requests (above `MAX_PARALLEL_PER_SERVER`); poll `GET /api/queue` — queued items appear
6. **Eval endpoint**: `POST /api/evaluate { prompt: "Say hello", models: ["llama3.2"] }` → results + `group_id`
7. **Group status**: Poll `GET /api/groups/:groupId` during eval → progress counters update
8. **Report file**: Verify `reports/eval-*.md` exists and contains valid markdown
9. **WebSocket**: Open DevTools WS inspector during eval — `eval_lane_started`, `eval_lane_completed`, `eval_all_completed` arrive
10. **Evaluator UI**: `http://localhost:3111/evaluator` — add lanes, click Compare, watch timers, see summary
11. **History filters**: `GET /api/prompt-history?groupId=<id>&requestType=chat&isError=false` → filtered
12. **File endpoint**: `GET /api/evaluate/file?path=/tmp/test.md` → `{ content: "..." }`

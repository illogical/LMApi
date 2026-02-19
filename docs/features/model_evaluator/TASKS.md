# Model Evaluator — Prioritized Task List

Track implementation progress here. Mark tasks `[x]` as they are completed.

---

## Phase 9: Backend Infrastructure

### 9.1 Types & Constants
- [x] Add `EvaluationResult` interface to `src/types.ts`
- [x] Add `EvaluationRequest` interface to `src/types.ts`
- [x] Add `EVAL_LANE_STARTED`, `EVAL_LANE_COMPLETED`, `EVAL_ALL_COMPLETED` to `SOCKET_EVENTS` in `src/constants.ts`

### 9.2 SocketService
- [x] Add `emitEvalLaneStarted(groupId, model, laneIndex)` to `SocketService`
- [x] Add `emitEvalLaneCompleted(groupId, model, result)` to `SocketService`
- [x] Add `emitEvalAllCompleted(groupId, results, reportPath?)` to `SocketService`

### 9.3 EvaluationReportService
- [x] Create `src/services/EvaluationReportService.ts`
- [x] Implement `generate(prompt, results, groupId)` — writes markdown to `reports/eval-YYYYMMDD-HHmmss.md`
- [x] Include summary table (model, server, duration, tokens/sec, output tokens, finish reason)
- [x] Include per-model response sections with heading format: `### model (server · duration · tok/s)`
- [x] Conditionally include thinking section if `result.thinking` is present
- [x] Conditionally include tool calls section if `result.tool_calls` is present
- [x] Return `{ filePath, fileName }` from `generate()`

### 9.4 Evaluate Route
- [x] Create `src/routes/evaluateRoutes.ts`
- [x] Implement `POST /api/evaluate` with Zod schema validation:
  - `prompt?: string`
  - `filePath?: string`
  - `models: string[]` (min 1)
  - `temperature?: number`
  - `max_tokens?: number`
  - `generateReport?: boolean` (default `true`)
- [x] Validate at least one of `prompt` or `filePath` is present (return 400 if neither)
- [x] If `filePath` is provided: validate extension (`.md`, `.txt`, `.text`, `.prompt`), read file contents with `fs.readFile`
- [x] Build `ChatCompletionRequest` per model with `messages: [{ role: 'user', content: prompt }]`
- [x] Assign a shared `groupId` (UUID) to all requests
- [x] Dispatch each model via `QueueService.dispatchOrQueueChat()` with individual `.then()` handlers
- [x] Emit `EVAL_LANE_STARTED` for each model immediately upon dispatch
- [x] Emit `EVAL_LANE_COMPLETED` for each model as each resolves
- [x] Use `Promise.allSettled()` so one failure does not block others
- [x] Map settled results to `EvaluationResult[]` (handle rejections as error entries)
- [x] Call `EvaluationReportService.generate()` if `generateReport` is true
- [x] Emit `EVAL_ALL_COMPLETED` with results and optional report path
- [x] Return `{ group_id, results, duration_ms, report_path? }` in HTTP response

### 9.5 File Validation Endpoint
- [x] Add `GET /api/evaluate/file` to `evaluateRoutes.ts`
- [x] Accept `path` query param (URL-decoded)
- [x] Validate file extension is in allowed list
- [x] Read and return `{ content: string }` or `{ error: string }` with 400/404

### 9.6 Route Registration
- [x] Import and register `evaluateRoutes` in `src/app.ts` under `/api`
- [x] Add `GET /evaluator` route in `src/app.ts` pointing to `src/public/model-evaluator.html`

---

## Phase 10: Frontend

### 10.1 Page Shell
- [x] Create `src/public/model-evaluator.html`
- [x] Link shared stylesheet: `<link rel="stylesheet" href="/styles/log-dashboard.css" />`
- [x] Add page header matching existing pattern (`.page`, `.title`, `.subtitle`, `.header-actions`)
- [x] Add nav links: "Dashboard" → `/`, "History" → `/history`
- [x] Add toast element `<div id="toast" class="toast"></div>`
- [x] Add prompt viewer modal (hidden by default): dark overlay + scrollable `<pre>` + close button
- [x] Create `src/public/scripts/modelEvaluator.js` as ES module

### 10.2 Prompt Input Panel
- [x] Build prompt panel with `.panel` + `.panel-head` structure
- [x] Add file path row: hidden `<input type="file" accept=".txt,.md,.text,.prompt">` + styled "Browse" button + visible path text input + clear (✕) icon button
- [x] On file selected via picker: populate path input with file name/path; read file client-side via File API; load content into textarea
- [x] On path text input blur: if value is non-empty, call `GET /api/evaluate/file?path=...`; on success, populate textarea; on error, show inline styled error message below input
- [x] Add prompt textarea: wide, `max-height: 300px`, scrollable, placeholder text
- [x] Add "View Full" (⛶) icon button inside/above textarea
- [x] Implement prompt viewer modal: click ⛶ opens modal with prompt content; ✕ button and Escape key close it
- [x] Clear (✕) icon on file path input resets path input; does NOT clear textarea

### 10.3 Comparison Controls Bar
- [x] Add comparison controls bar between Prompt panel and Lanes area
- [x] "Reset" button: clears all lanes (not prompt/filepath); re-enables Compare; re-enables lane swaps
- [x] "Compare" button (`.broadcast-btn` style): disabled when no prompt; disabled during active evaluation
- [x] On "Compare" click: collect `model` from each non-chooser lane, build request, `POST /api/evaluate`, then await WebSocket events for live updates

### 10.4 Lanes Area
- [x] Add lanes container: `display: flex; overflow-x: auto; gap: 16px; align-items: flex-start`
- [x] Each lane: fixed width (320px), `.panel` card style, `flex-shrink: 0`
- [x] Add "+" lane button at the end of the lanes: large dashed card style, centered plus icon, `min-width: 160px`
- [x] Clicking "+" appends a new lane in **chooser** state
- [x] Lane header row: model name (or placeholder) on left, ⇄ and ✕ icon buttons on right
  - ✕ removes lane from DOM
  - ⇄ returns lane to **chooser** state so a different model can be selected; disabled during an active evaluation run

### 10.5 Model Chooser (Lane Chooser State)
- [x] On lane creation (chooser state): fetch `GET /api/models/loaded` and `GET /api/servers`
- [x] Build model list grouped alphabetically from loaded models
- [x] For each model, display server pills (one per server that has the model)
- [x] Add multi-server badge: if model available on 2+ servers, show `×N` badge or distinct pill color using `--accent-gold`
- [x] Add filter text input at top of chooser: filters model list client-side by substring
- [x] Clicking a model in the chooser transitions lane to **idle** state with that model selected

### 10.6 Lane States

#### Idle State
- [x] Show selected model name at top
- [x] Show server name as "—" (not yet assigned)
- [x] Show muted "Ready" status text

#### Loading State
- [x] On `EVAL_LANE_STARTED` (matching `group_id`): set lane to loading state
- [x] Show animated spinner (reuse `.dot-pending` or custom CSS)
- [x] Start live elapsed timer: `setInterval` every 16ms displaying `MM:SS.mmm`
- [x] Show server name once `EVAL_LANE_STARTED` payload includes it (if available)

#### Complete State
- [x] On `EVAL_LANE_COMPLETED` (matching `group_id` + `model`): set lane to complete
- [x] Stop elapsed timer
- [x] Add `.lane-complete-flash` animation (green border pulse, ~1s, then revert)
- [x] Display metrics block:
  - Duration (ms), formatted with commas
  - Tokens/sec (output_tokens / eval_duration_s, rounded)
  - Output tokens / Input tokens
  - Load duration (ms) — labelled as "Load time"
  - Eval duration (ms) — labelled as "Gen time"
  - Finish reason badge
- [x] Display response text in a scrollable block (`max-height: 400px`, `--code-bg` background, monospace font)
- [x] If `thinking` present: show collapsible "Thinking" section (collapsed by default)
- [x] If `tool_calls` present: show "Tool Calls" section with JSON formatted display

#### Error State
- [x] If `EVAL_LANE_COMPLETED` result has `error`: apply rose border (`--danger-color`), show error message
- [x] Stop elapsed timer

### 10.7 Summary Report Panel
- [x] Add summary panel below lanes area; hidden initially (`display: none`)
- [x] On `EVAL_ALL_COMPLETED`: show panel
- [x] Show report path if available: `📋 Saved: reports/eval-*.md` (as muted text)
- [x] Build summary table: columns — Model, Server, Duration, Tok/s, Output Tokens, Finish Reason
- [x] Sort table rows by duration ascending (fastest first) for quick ranking

### 10.8 WebSocket Integration
- [x] Import `DashboardSocket` from `/scripts/dashboardSocket.js` (existing module)
- [x] Subscribe to `EVAL_LANE_STARTED`, `EVAL_LANE_COMPLETED`, `EVAL_ALL_COMPLETED` events
- [x] Use `group_id` to scope updates to the current evaluation session only

### 10.9 CSS Additions (append to `log-dashboard.css`)
- [x] `.lane-complete-flash` keyframe animation (green border glow pulse)
- [x] `.lane` base styles (width, flex-direction, etc.) if not already covered by `.panel`
- [x] `.chooser-model-list` styles (scrollable list, hover highlight)
- [x] `.model-pill` server badge styles for chooser (reuse existing `.model-overview-item` server pill patterns)
- [x] `.metric-row` two-column layout for lane metrics (label | value)
- [x] `.finish-badge` small pill for finish reason (green for "stop", amber for "length", blue for "tool_calls")
- [x] `.lane-response-text` code-block style for response text (reuse `--code-bg`, monospace)
- [x] Prompt viewer modal styles (`.eval-modal-overlay`, `.eval-modal`)

---

## Phase 11: Navigation & Documentation

### 11.1 Existing Page Links
- [x] Add "Model Evaluator" nav link to `src/public/log-dashboard.html` header actions
- [x] Add "Model Evaluator" nav link to `src/public/history-browser.html` header actions

### 11.2 Documentation Updates (after feature is fully implemented and verified)
- [x] Update `docs/SPECIFICATION.md`: add section 4.5 "Model Evaluator" with page description, endpoint docs, and report format
- [x] Update `README.md`: add "Model Evaluator" to the feature list and dashboard section
- [x] Update `docs/features/model_evaluator/TASKS.md`: mark all tasks complete

---

## Future Phases (Not in Scope for Initial Implementation)

### Phase 12: Judge Model (Future)
- [ ] Add optional "Judge Model" selector on the evaluator page
- [ ] Design evaluation prompt template that instructs the judge model on rating criteria
- [ ] After all lanes complete, automatically submit all responses + judge prompt to the selected model
- [ ] Display judge scores/feedback in the summary report and per-lane
- [ ] Support OpenRouter models as judge (via `provider: "openrouter"`)

### Phase 13: OpenRouter Model Selection (Future)
- [ ] Curate OpenRouter model list via `providers.json` config extension
- [ ] Add "OpenRouter" section in the model chooser (below Ollama models, separated by a divider)
- [ ] Show pricing/context info from OpenRouter config per model
- [ ] Allow mixing local Ollama and OpenRouter models in the same comparison

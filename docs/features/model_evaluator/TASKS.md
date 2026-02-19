# Model Evaluator — Prioritized Task List

Track implementation progress here. Mark tasks `[x]` as they are completed.

---

## Phase 9: Backend Infrastructure

### 9.1 Types & Constants
- [ ] Add `EvaluationResult` interface to `src/types.ts`
- [ ] Add `EvaluationRequest` interface to `src/types.ts`
- [ ] Add `EVAL_LANE_STARTED`, `EVAL_LANE_COMPLETED`, `EVAL_ALL_COMPLETED` to `SOCKET_EVENTS` in `src/constants.ts`

### 9.2 SocketService
- [ ] Add `emitEvalLaneStarted(groupId, model, laneIndex)` to `SocketService`
- [ ] Add `emitEvalLaneCompleted(groupId, model, result)` to `SocketService`
- [ ] Add `emitEvalAllCompleted(groupId, results, reportPath?)` to `SocketService`

### 9.3 EvaluationReportService
- [ ] Create `src/services/EvaluationReportService.ts`
- [ ] Implement `generate(prompt, results, groupId)` — writes markdown to `reports/eval-YYYYMMDD-HHmmss.md`
- [ ] Include summary table (model, server, duration, tokens/sec, output tokens, finish reason)
- [ ] Include per-model response sections with heading format: `### model (server · duration · tok/s)`
- [ ] Conditionally include thinking section if `result.thinking` is present
- [ ] Conditionally include tool calls section if `result.tool_calls` is present
- [ ] Return `{ filePath, fileName }` from `generate()`

### 9.4 Evaluate Route
- [ ] Create `src/routes/evaluateRoutes.ts`
- [ ] Implement `POST /api/evaluate` with Zod schema validation:
  - `prompt?: string`
  - `filePath?: string`
  - `models: string[]` (min 1)
  - `temperature?: number`
  - `max_tokens?: number`
  - `generateReport?: boolean` (default `true`)
- [ ] Validate at least one of `prompt` or `filePath` is present (return 400 if neither)
- [ ] If `filePath` is provided: validate extension (`.md`, `.txt`, `.text`, `.prompt`), read file contents with `fs.readFile`
- [ ] Build `ChatCompletionRequest` per model with `messages: [{ role: 'user', content: prompt }]`
- [ ] Assign a shared `groupId` (UUID) to all requests
- [ ] Dispatch each model via `QueueService.dispatchOrQueueChat()` with individual `.then()` handlers
- [ ] Emit `EVAL_LANE_STARTED` for each model immediately upon dispatch
- [ ] Emit `EVAL_LANE_COMPLETED` for each model as each resolves
- [ ] Use `Promise.allSettled()` so one failure does not block others
- [ ] Map settled results to `EvaluationResult[]` (handle rejections as error entries)
- [ ] Call `EvaluationReportService.generate()` if `generateReport` is true
- [ ] Emit `EVAL_ALL_COMPLETED` with results and optional report path
- [ ] Return `{ group_id, results, duration_ms, report_path? }` in HTTP response

### 9.5 File Validation Endpoint
- [ ] Add `GET /api/evaluate/file` to `evaluateRoutes.ts`
- [ ] Accept `path` query param (URL-decoded)
- [ ] Validate file extension is in allowed list
- [ ] Read and return `{ content: string }` or `{ error: string }` with 400/404

### 9.6 Route Registration
- [ ] Import and register `evaluateRoutes` in `src/app.ts` under `/api`
- [ ] Add `GET /evaluator` route in `src/app.ts` pointing to `src/public/model-evaluator.html`

---

## Phase 10: Frontend

### 10.1 Page Shell
- [ ] Create `src/public/model-evaluator.html`
- [ ] Link shared stylesheet: `<link rel="stylesheet" href="/styles/log-dashboard.css" />`
- [ ] Add page header matching existing pattern (`.page`, `.title`, `.subtitle`, `.header-actions`)
- [ ] Add nav links: "Dashboard" → `/`, "History" → `/history`
- [ ] Add toast element `<div id="toast" class="toast"></div>`
- [ ] Add prompt viewer modal (hidden by default): dark overlay + scrollable `<pre>` + close button
- [ ] Create `src/public/scripts/modelEvaluator.js` as ES module

### 10.2 Prompt Input Panel
- [ ] Build prompt panel with `.panel` + `.panel-head` structure
- [ ] Add file path row: hidden `<input type="file" accept=".txt,.md,.text,.prompt">` + styled "Browse" button + visible path text input + clear (✕) icon button
- [ ] On file selected via picker: populate path input with file name/path; read file client-side via File API; load content into textarea
- [ ] On path text input blur: if value is non-empty, call `GET /api/evaluate/file?path=...`; on success, populate textarea; on error, show inline styled error message below input
- [ ] Add prompt textarea: wide, `max-height: 300px`, scrollable, placeholder text
- [ ] Add "View Full" (⛶) icon button inside/above textarea
- [ ] Implement prompt viewer modal: click ⛶ opens modal with prompt content; ✕ button and Escape key close it
- [ ] Clear (✕) icon on file path input resets path input; does NOT clear textarea

### 10.3 Comparison Controls Bar
- [ ] Add comparison controls bar between Prompt panel and Lanes area
- [ ] "Reset" button: clears all lanes (not prompt/filepath); re-enables Compare; re-enables lane swaps
- [ ] "Compare" button (`.broadcast-btn` style): disabled when no prompt; disabled during active evaluation
- [ ] On "Compare" click: collect `model` from each non-chooser lane, build request, `POST /api/evaluate`, then await WebSocket events for live updates

### 10.4 Lanes Area
- [ ] Add lanes container: `display: flex; overflow-x: auto; gap: 16px; align-items: flex-start`
- [ ] Each lane: fixed width (320px), `.panel` card style, `flex-shrink: 0`
- [ ] Add "+" lane button at the end of the lanes: large dashed card style, centered plus icon, `min-width: 160px`
- [ ] Clicking "+" appends a new lane in **chooser** state
- [ ] Lane header row: model name (or placeholder) on left, ⇄ and ✕ icon buttons on right
  - ✕ removes lane from DOM
  - ⇄ returns lane to **chooser** state so a different model can be selected; disabled during an active evaluation run

### 10.5 Model Chooser (Lane Chooser State)
- [ ] On lane creation (chooser state): fetch `GET /api/models/loaded` and `GET /api/servers`
- [ ] Build model list grouped alphabetically from loaded models
- [ ] For each model, display server pills (one per server that has the model)
- [ ] Add multi-server badge: if model available on 2+ servers, show `×N` badge or distinct pill color using `--accent-gold`
- [ ] Add filter text input at top of chooser: filters model list client-side by substring
- [ ] Clicking a model in the chooser transitions lane to **idle** state with that model selected

### 10.6 Lane States

#### Idle State
- [ ] Show selected model name at top
- [ ] Show server name as "—" (not yet assigned)
- [ ] Show muted "Ready" status text

#### Loading State
- [ ] On `EVAL_LANE_STARTED` (matching `group_id`): set lane to loading state
- [ ] Show animated spinner (reuse `.dot-pending` or custom CSS)
- [ ] Start live elapsed timer: `setInterval` every 16ms displaying `MM:SS.mmm`
- [ ] Show server name once `EVAL_LANE_STARTED` payload includes it (if available)

#### Complete State
- [ ] On `EVAL_LANE_COMPLETED` (matching `group_id` + `model`): set lane to complete
- [ ] Stop elapsed timer
- [ ] Add `.lane-complete-flash` animation (green border pulse, ~1s, then revert)
- [ ] Display metrics block:
  - Duration (ms), formatted with commas
  - Tokens/sec (output_tokens / eval_duration_s, rounded)
  - Output tokens / Input tokens
  - Load duration (ms) — labelled as "Load time"
  - Eval duration (ms) — labelled as "Gen time"
  - Finish reason badge
- [ ] Display response text in a scrollable block (`max-height: 400px`, `--code-bg` background, monospace font)
- [ ] If `thinking` present: show collapsible "Thinking" section (collapsed by default)
- [ ] If `tool_calls` present: show "Tool Calls" section with JSON formatted display

#### Error State
- [ ] If `EVAL_LANE_COMPLETED` result has `error`: apply rose border (`--danger-color`), show error message
- [ ] Stop elapsed timer

### 10.7 Summary Report Panel
- [ ] Add summary panel below lanes area; hidden initially (`display: none`)
- [ ] On `EVAL_ALL_COMPLETED`: show panel
- [ ] Show report path if available: `📋 Saved: reports/eval-*.md` (as muted text)
- [ ] Build summary table: columns — Model, Server, Duration, Tok/s, Output Tokens, Finish Reason
- [ ] Sort table rows by duration ascending (fastest first) for quick ranking

### 10.8 WebSocket Integration
- [ ] Import `DashboardSocket` from `/scripts/dashboardSocket.js` (existing module)
- [ ] Subscribe to `EVAL_LANE_STARTED`, `EVAL_LANE_COMPLETED`, `EVAL_ALL_COMPLETED` events
- [ ] Use `group_id` to scope updates to the current evaluation session only

### 10.9 CSS Additions (append to `log-dashboard.css`)
- [ ] `.lane-complete-flash` keyframe animation (green border glow pulse)
- [ ] `.lane` base styles (width, flex-direction, etc.) if not already covered by `.panel`
- [ ] `.chooser-model-list` styles (scrollable list, hover highlight)
- [ ] `.model-pill` server badge styles for chooser (reuse existing `.model-overview-item` server pill patterns)
- [ ] `.metric-row` two-column layout for lane metrics (label | value)
- [ ] `.finish-badge` small pill for finish reason (green for "stop", amber for "length", blue for "tool_calls")
- [ ] `.lane-response-text` code-block style for response text (reuse `--code-bg`, monospace)
- [ ] Prompt viewer modal styles (`.eval-modal-overlay`, `.eval-modal`)

---

## Phase 11: Navigation & Documentation

### 11.1 Existing Page Links
- [ ] Add "Model Evaluator" nav link to `src/public/log-dashboard.html` header actions
- [ ] Add "Model Evaluator" nav link to `src/public/history-browser.html` header actions

### 11.2 Documentation Updates (after feature is fully implemented and verified)
- [ ] Update `docs/SPECIFICATION.md`: add section 4.5 "Model Evaluator" with page description, endpoint docs, and report format
- [ ] Update `README.md`: add "Model Evaluator" to the feature list and dashboard section
- [ ] Update `docs/TASK.md`: add Phase 9 and Phase 10 blocks; mark all tasks complete

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

# Project: LMAPI — LLM Orchestration API

## Completed Phases

- [x] **Phase 1: Project Setup & Infrastructure**
  - [x] Initialize Node.js TypeScript project structure
  - [x] Install dependencies (Express, SQLite, Zod, Logging)
  - [x] Implement `LogService` (Daily rotation, trace/info levels)
  - [x] Implement `DbService` & Schema Migration (`PromptHistory` table)
  - [x] Implement `ConfigService` (Load `servers.json`)

- [x] **Phase 2: Core Services**
  - [x] Implement `ModelCacheService` (Cache `api/tags`, refresh logic)
  - [x] Implement `ServerPoolService` (Registry, availability checks, priority logic)
  - [x] Implement `QueueService` (Request queuing, dispatch logic)

- [x] **Phase 3: API Endpoints**
  - [x] Implement Server Management Endpoints (`/servers`, `/servers/available`, `/servers/:name/status`)
  - [x] Implement Model Discovery Endpoints (`/servers/:name/models`, `/models/:model/servers`)
  - [x] Implement Prompting Endpoints (`/generate/any`, `/generate/server`, `/generate/batch`, `/embed`)

- [x] **Phase 4: Prompt History Logging**
  - [x] Add a DbService helper to insert PromptHistory rows only after a successful response is received.
  - [x] Capture serverName, modelName, prompt, durationMs, estimatedTokens, temperature, and createdAt in each record.
  - [x] Expose a paged `GET /prompt-history` endpoint that supports filters (model, serverName) and sorting (duration, serverName, modelName, createdAt).
  - [x] Add indexes on createdAt, modelName, and serverName to keep the history queries fast.
  - [x] Wire QueueService/generation flows to call the helper and skip inserts on errors or timeouts.

---

## Completed Phases (Continued)

- [x] **Phase 5: Chat Completions — Ollama Proxy (Non-streaming)**
  - [x] Create `ChatCompletionService` to proxy OpenAI-compatible `/v1/chat/completions` requests to Ollama servers
  - [x] Add LMAPI routing endpoints: `/api/chat/completions/any`, `/server`, `/batch`, `/all`
  - [x] Add OpenAI-compatible endpoint: `/v1/chat/completions` (auto-routes like `/any`)
  - [x] Support tool/function calling pass-through (Ollama handles tool logic natively)
  - [x] Integrate with existing `ServerPoolService` for priority-fill server selection
  - [x] Integrate with existing `QueueService` for queuing when all servers at capacity
  - [x] Log chat completion requests to `PromptHistory` (two-phase insert/update pattern)
  - [x] Emit WebSocket events for real-time dashboard updates
  - [x] Return OpenAI-compatible error responses

- [x] **Phase 6: Chat Completions — SSE Streaming Support**
  - [x] Add SSE streaming support for `/v1/chat/completions`, `/api/chat/completions/any`, and `/api/chat/completions/server`
  - [x] Implement streaming proxy: read SSE chunks from Ollama, forward to client
  - [x] Handle streaming tool call accumulation and forwarding
  - [x] Update dashboard to display streaming request status

- [x] **Phase 7: OpenRouter Provider Integration**
  - [x] Create `providers.json` config for cloud providers (separate from `servers.json`)
  - [x] Implement `ProviderService` for OpenRouter API key auth and request forwarding
  - [x] Add OpenRouter as a chat completions backend (same `/v1/chat/completions` interface)
  - [x] Extend `ServerPoolService` routing: prefer local Ollama, fall back to OpenRouter
  - [x] Support OpenRouter-specific features (provider preferences, transforms)
  - [x] Log OpenRouter requests to `PromptHistory` with provider metadata
  - [x] Validate cloud-model fallback through `scripts/testChatCompletions.ts`

---

## Upcoming Phases

- [x] **Phase 8: OpenRouter Enhancements & Provider Flag**
  - [x] Add SSE streaming support for OpenRouter provider (currently non-streaming only)
  - [x] Implement provider-request flag/parameter to explicitly target cloud providers
    - [x] Add `provider` field to chat completions request schema (e.g., `"provider": "openrouter"`)
    - [x] Allow direct provider targeting instead of relying on fallback logic
    - [x] Enable testing of cloud-only models through LMAPI's observability layer
  - [x] Add provider filtering to `/prompt-history` endpoint
  - [x] Validate provider-explicit routing through test scripts
  - [x] Update documentation with provider-request examples

- [ ] **Phase 9: Advanced Provider Features (Future)**
  - [ ] OpenRouter generation tracking via `/api/generation/{id}` polling
  - [ ] Cost tracking for OpenRouter requests (parse usage metadata)
  - [ ] Rate limiting per provider
  - [ ] Multi-provider load balancing strategies
  - [ ] Dashboard enhancements for multi-provider visibility and cost analysis

---

## Phase 10: Prompt & Model Evaluation System

> Full design spec: [`docs/features/prompt_eval_system/prompt-eval-system-plan.md`](features/prompt_eval_system/prompt-eval-system-plan.md)
> LMApi-adapted implementation plan: [`docs/features/prompt_eval_system/IMPLEMENTATION_PLAN.md`](features/prompt_eval_system/IMPLEMENTATION_PLAN.md)

### Phase 10.1 — Foundation: Dependencies, Types, File I/O, CRUD APIs

- [ ] Install `ajv` and `diff` npm packages (+ `@types/diff` dev dependency)
- [ ] Create `src/types/eval.ts` with all TypeScript interfaces (`EvalTemplate`, `JudgePerspective`, `PromptManifest`, `PromptVersionMeta`, `ToolDefinition`, `TestSuite`, `TestCase`, `ExpectedToolCall`, `EvaluationConfig`, `EvaluationResults`, `EvalMatrixCell`, `ToolCallResult`, `JudgeResult`, `PairwiseRanking`, `EvaluationSummary`, `EvalStreamEvent`)
- [ ] Create `src/services/eval/EvalFileService.ts` (JSON I/O, Markdown I/O, slug generation, directory helpers)
- [ ] Create `data/evals/` directory structure (`templates/`, `templates/custom/`, `prompts/`, `test-suites/`, `evaluations/`, `baselines/`)
- [ ] Create built-in template JSON files for: `general-quality`, `tool-calling`, `code-generation`, `instruction-following` (see Section 8 of original plan for full content)
- [ ] Create `src/services/eval/EvalTemplateService.ts` with list/get/create/update/delete/seedBuiltIns
- [ ] Create `src/services/eval/EvalPromptService.ts` with list/get/getVersionContent/create/addVersion/diff/updateTools/estimateTokens
- [ ] Create `src/services/eval/EvalTestSuiteService.ts` with list/get/create/update/delete/addTestCase/removeTestCase
- [ ] Create `src/routes/evalRoutes.ts` — implement Templates, Prompts, Test Suites, and Models proxy endpoints with Zod validation
- [ ] Register `evalRoutes` in `src/app.ts` at `/api/eval` and seed built-in templates on startup
- [ ] Create `scripts/testEvalApi.ts` integration test covering all CRUD operations (round-trip read/write, diff, model proxy)
- [ ] Add `"test:eval": "ts-node scripts/testEvalApi.ts"` to `package.json`
- [ ] **Verification**: Run `npm run test:eval` — all CRUD operations pass, built-in templates are present, diff endpoint returns structured output

### Phase 10.2 — Evaluation Engine: Execution Pipeline (No Judge)

- [ ] Add `EVAL_SOCKET_EVENTS` constants to `src/constants.ts`
- [ ] Add `emitEvalEvent(evalId, event, data)` method to `SocketService`
- [ ] Create `src/services/eval/EvalMetricsService.ts` — JSON Schema validation (ajv), tool call validation, keyword checks, token count estimation
- [ ] Create `src/services/eval/EvalSummaryService.ts` — aggregation of deterministic metrics, per-model/per-prompt ranking, consistency score
- [ ] Create `src/services/eval/EvalExecutionService.ts` — Phase 1 (matrix build), Phase 2 (completion dispatch via `QueueService.dispatchOrQueueChat()`), Phase 4 (summary write); include `AbortController` map for cancel support; use `Promise.allSettled()` for parallel dispatch; implement `Semaphore` for batching large matrices
- [ ] Add Evaluations CRUD endpoints to `evalRoutes.ts` (create → start async, list, get config, get results, get summary, cancel)
- [ ] Create `scripts/testEvalExecution.ts` end-to-end test (with Socket.IO client listener for `eval:completed`)
- [ ] **Verification**: Create eval via API → verify `config.json` (status: running → completed), `results.json` (all cells present with deterministic metrics), `summary.json` (model rankings populated); Socket.IO events arrive in correct sequence; cancel mid-run stops cleanly

### Phase 10.3 — LLM Judge System

- [ ] Create `src/services/eval/EvalJudgeService.ts` — `buildRubricPrompt()`, `buildPairwisePrompt()`, `parseRubricResponse()` (4-step fallback chain), `parsePairwiseResponse()`, `buildTemplateGeneratorPrompt()`, `parseTemplateGeneratorResponse()`
- [ ] Update `EvalExecutionService` Phase 3: dispatch judge calls in parallel via `QueueService.dispatchOrQueueChat()` for each perspective × cell; dispatch pairwise comparisons if enabled; accumulate `JudgeResult[]` and `PairwiseRanking[]`
- [ ] Update `EvalSummaryService` to include composite score calculation (weighted perspective averages) and judge result aggregation in model/prompt rankings
- [ ] Implement `POST /api/eval/templates/generate` route — build generator prompt, dispatch to model, parse and return proposed template
- [ ] Update `scripts/testEvalExecution.ts` to cover judge-enabled evaluation
- [ ] **Verification**: Run eval with judge → `JudgeResult` records present in `results.json`; scores in range 1–5; pairwise rankings consistent; auto-generate template returns 4–6 perspectives; malformed judge responses handled gracefully (no crash, error logged)

### Phase 10.4 — Export System, Baselines & History

- [ ] Create `data/evals/templates/report-template.html` — self-contained HTML template (dark theme, `{{DATA}}` + `{{EVAL_NAME}}` placeholders, vanilla JS renderer for tables/heatmap/tabs, no external dependencies, printable)
- [ ] Create `src/services/eval/EvalReportService.ts` — `generateMarkdown()`, `generateHtml()` (reads template, injects data), `writeReports()`
- [ ] Implement export endpoints: `GET /api/eval/evaluations/:id/export?format=html|md`
- [ ] Implement baseline endpoints: `POST /api/eval/evaluations/:id/baseline` (copy summary to `data/evals/baselines/`)
- [ ] Implement `EvalSummaryService.computeRegression()` — delta calculation vs baseline; populate `summary.regression` field
- [ ] Implement history endpoint: `GET /api/eval/prompts/:id/history` — scan evaluations dir, return timeline data
- [ ] Implement leaderboard endpoint: `GET /api/eval/models/leaderboard` — aggregate composite scores across all completed evaluations
- [ ] Update `scripts/testEvalApi.ts` to cover export, baseline, and regression tests
- [ ] **Verification**: HTML export opens in browser with no internet access, all sections render; Markdown export has correct structure; baseline + regression delta populated after second run; history timeline returns sorted evaluation list

### Phase 10.5 — Frontend: Eval Dashboard

- [ ] Create `src/public/styles/eval.css` — CSS custom properties (zinc/amber/teal/rose palette), three-panel grid layout, drag-resize handles, tab navigation, heatmap table, score cell coloring, animations (slide-in feed cards, progress bar transitions)
- [ ] Create `src/public/scripts/evalSocket.js` — Socket.IO client; listen for all `EVAL_SOCKET_EVENTS`; filter by `evalId`; update DOM for progress bar, live feed, matrix cells
- [ ] Create `src/public/eval.html` — three-panel layout wired to REST API and Socket.IO:
  - [ ] Top bar: inline-editable eval name, status indicator (pulsing amber/teal/rose dot), matrix badge, Run/Export/Baseline action buttons
  - [ ] Left panel: prompt tab bar with add/remove; Editor/File/Saved mode toggle per tab; token count estimate; "Save Version" button; collapsible tool definitions JSON editor; diff view toggle
  - [ ] Center panel (config mode): model selector (grouped, searchable multi-select from `/api/eval/models`); test case section (Quick + Suite modes); template selector + "Auto-Generate" button; judge config controls; execution preview (matrix dimensions + cost estimate)
  - [ ] Center panel (execution mode): overall progress bar; per-model progress rows; live completion feed with slide-in cards; judge progress section
  - [ ] Right panel — five tabs:
    - [ ] **Scoreboard**: CSS Grid heatmap matrix, model leaderboard cards, prompt leaderboard cards, regression banner (if baseline)
    - [ ] **Compare**: two cell selectors, side-by-side response viewer, tool call cards, diff toggle
    - [ ] **Details**: raw response, tool calls with pass/fail, deterministic metrics table, per-perspective judge scores + justifications, "Why Did This Fail?" button
    - [ ] **Metrics**: Canvas bar charts (latency, tokens/sec), deterministic compliance table, consistency chart (if multiple runs)
    - [ ] **Timeline**: Canvas line chart (score over time per model)
  - [ ] Bottom bar: token cost ticker, phase/progress summary, quick stats (best model, best prompt, score range)
  - [ ] Keyboard shortcuts: `Ctrl+Enter` (run), `Ctrl+E` (export), `Ctrl+1/2/3` (panel focus), `Ctrl+D` (diff), `Esc` (close modal), `Ctrl+S` (save prompt)
- [ ] Add `/eval` route to `src/app.ts` serving `eval.html`
- [ ] **Verification**: Full browser walkthrough — load prompt → configure → run → watch live progress → view all 5 result tabs → export HTML → panel resize works; keyboard shortcuts functional

### Phase 10.6 — Polish, Edge Cases & Documentation

- [ ] Implement "Why Did This Fail?" diagnostic: construct diagnostic judge prompt from low-scoring cell + rubric, dispatch via `QueueService`, return improvement suggestions in Details tab
- [ ] Add per-cell retry logic in `EvalExecutionService` (default: 1 retry on transient error; configurable via eval config)
- [ ] Handle partial evaluation failures: cells that fail (after retry) are marked `status: 'failed'` in results; evaluation completes with partial data (not aborted)
- [ ] Add `requestType: 'eval'` tagging to eval-originated chat completions in `PromptHistory` (enables filtering eval traffic in history dashboard)
- [ ] Accessibility pass on `eval.html`: `aria-label` on all interactive controls, keyboard navigation through model list and test case table, focus management on tab switches
- [ ] Update `README.md` — add **Prompt & Model Evaluation System** section covering: eval page URL, all new `/api/eval/*` endpoints (table), data storage layout, evaluation workflow steps, built-in template descriptions, export formats
- [ ] **Verification**: Force cell failure (nonexistent model) → eval completes with partial results correctly flagged; "Why Did This Fail?" returns suggestions; screen reader can navigate eval page; README section is accurate and complete

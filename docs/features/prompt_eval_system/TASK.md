# Prompt & Model Evaluation System — Task List

> Implementation plan: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)
> Original design spec: [`prompt-eval-system-plan.md`](prompt-eval-system-plan.md)
> LMApi API reference: [`LMAPI_API_REFERENCE.md`](LMAPI_API_REFERENCE.md)

This project is a standalone Bun + Vite + React + TypeScript application that consumes the LMApi service for all LLM model interactions.

---

## Phase 1 — Project Setup & Foundation

- [ ] Scaffold project with `bun create vite prompt-eval --template react-ts`
- [ ] Install dependencies: `tailwindcss`, `@tailwindcss/vite`, `socket.io-client`, `diff`, `@types/diff`, `hono`, `ajv`, `@types/bun`
- [ ] Configure Tailwind CSS with eval color palette as CSS custom properties (zinc/amber/teal/rose — see Section 7.3 of IMPLEMENTATION_PLAN.md)
- [ ] Configure `vite.config.ts` with dev proxy to eval backend (`/api/eval` → `:3200`) and WebSocket proxy (`/ws/eval`)
- [ ] Create `.env` with `PORT=3200` and `LMAPI_BASE_URL=http://localhost:3111`
- [ ] Create `server/index.ts` — Bun HTTP server with Hono app on port 3200
- [ ] Create shared TypeScript types:
  - [ ] `src/types/eval.ts` — all eval system interfaces from Section 2.2 of `prompt-eval-system-plan.md` (`EvalTemplate`, `JudgePerspective`, `PromptManifest`, `PromptVersionMeta`, `ToolDefinition`, `TestSuite`, `TestCase`, `ExpectedToolCall`, `EvaluationConfig`, `EvaluationResults`, `EvalMatrixCell`, `ToolCallResult`, `JudgeResult`, `PairwiseRanking`, `EvaluationSummary`, `EvalStreamEvent`)
  - [ ] `src/types/lmapi.ts` — LMApi response types from Section 11 of `LMAPI_API_REFERENCE.md` (`LmapiChatCompletionRequest`, `LmapiChatCompletionResponse`, `LmapiServerStatus`, `LmapiBatchResponse`, `ToolCall`, `ToolDefinition`)
  - [ ] `server/types/eval.ts` — re-export or symlink shared types for backend use
- [ ] Create `server/services/FileService.ts` — JSON/Markdown I/O, slug generation, directory helpers, `ensureDir`, `generateId` (see Section 4.2)
- [ ] Create `data/evals/` directory structure: `templates/`, `templates/custom/`, `prompts/`, `test-suites/`, `evaluations/`, `baselines/`
- [ ] Create built-in template JSON files in `data/evals/templates/`:
  - [ ] `general-quality.json` (Accuracy 0.3, Completeness 0.25, Instruction Following 0.25, Conciseness 0.2)
  - [ ] `tool-calling.json` (Tool Selection 0.35, Argument Quality 0.3, Reasoning 0.2, Error Handling 0.15)
  - [ ] `code-generation.json` (Correctness 0.35, Code Quality 0.25, Completeness 0.2, Efficiency 0.2)
  - [ ] `instruction-following.json` (Explicit Instructions 0.4, Format Compliance 0.3, Constraint Adherence 0.2, No Hallucination 0.1)
- [ ] Create `scripts/seed-templates.ts` — idempotent seeder for built-in templates
- [ ] Create `server/services/LmapiClient.ts` — HTTP client wrapper for LMApi: `getServers()`, `getModels()`, `chatCompletion()`, `batchCompletion()` with timeout handling and error wrapping (see Section 4.1)
- [ ] Create `server/services/TemplateService.ts` — list/get/create/update/delete/isBuiltIn/seedBuiltIns (see Section 4.3)
- [ ] Create `server/services/PromptService.ts` — list/get/getVersionContent/create/addVersion/diff/updateTools/estimateTokens (see Section 4.4)
- [ ] Create `server/services/TestSuiteService.ts` — list/get/create/update/delete (see Section 4.5)
- [ ] Create `server/routes/templates.ts` — GET list, GET by id, POST create, PUT update, DELETE (Hono routes with request validation)
- [ ] Create `server/routes/prompts.ts` — GET list, GET by id, GET version content, POST create, POST add version, GET diff, PUT update tools
- [ ] Create `server/routes/testSuites.ts` — GET list, GET by id, POST create, PUT update, DELETE
- [ ] Create `server/routes/models.ts` — GET proxy to LMApi servers endpoint, returns grouped model list
- [ ] Wire all routes into `server/index.ts`; seed built-in templates on startup
- [ ] Create `scripts/test-api.ts` — integration test covering: template CRUD (create custom, list includes built-ins, delete custom, reject delete built-in); prompt CRUD (create, add version, get content, diff); test suite CRUD; model list proxy returns data from LMApi
- [ ] Add `"scripts": { "dev:server": "bun run server/index.ts", "dev:client": "bunx vite", "test:api": "bun run scripts/test-api.ts" }` to `package.json`
- [ ] **Verification**: Run `bun run test:api` against running eval backend + LMApi — all CRUD operations pass; built-in templates present; diff returns structured output; model proxy returns server-grouped model list

---

## Phase 2 — Evaluation Engine: Execution Pipeline (No Judge)

- [ ] Create `server/services/MetricsService.ts` — `validateJsonSchema()` using ajv (singleton, `allErrors: true`); `validateToolCalls()` against definitions + expected calls; `checkKeywords()` for required/forbidden; `estimateTokenCount()` (see Section 4.6)
- [ ] Create `server/services/SummaryService.ts` — `computeSummary()` with per-model and per-prompt aggregate rankings using deterministic metrics only; `computeConsistency()` for multi-run variance (see Section 4.9)
- [ ] Create `server/services/ExecutionService.ts` — 3 of 4 phases:
  - [ ] Phase 1: `buildMatrix()` — expand all prompt × model × testCase × run combinations into `EvalMatrixCell[]`; `estimateCost()` for token/time estimates
  - [ ] Phase 2: `runCompletions()` — dispatch each cell via `LmapiClient.chatCompletion()` with `stream: false` and `groupId: evalId`; run deterministic checks via `MetricsService` on each completed cell; use `Promise.allSettled()` for parallel dispatch; implement `Semaphore` class for batching (default limit: 8 concurrent)
  - [ ] Phase 4: `aggregate()` — call `SummaryService.computeSummary()`, write `results.json` + `summary.json`
  - [ ] `AbortController` map for cancel support; `cancel(evalId)` method
  - [ ] Write `config.json` with `status: 'pending' → 'running' → 'completed'/'failed'`
- [ ] Create `server/ws.ts` — Bun native WebSocket server at `/ws/eval`; broadcast `EvalStreamEvent` messages to all connected clients; track connected clients
- [ ] Emit WebSocket events during execution: `cell:started`, `cell:completed`, `cell:failed`, `eval:progress`, `eval:completed`, `eval:failed`
- [ ] Create `server/routes/evaluations.ts`:
  - [ ] `GET /api/eval/evaluations` — list evaluations with optional status/promptId/modelId filters
  - [ ] `GET /api/eval/evaluations/:id` — read and return `config.json`
  - [ ] `GET /api/eval/evaluations/:id/results` — read and return `results.json`
  - [ ] `GET /api/eval/evaluations/:id/summary` — read and return `summary.json`
  - [ ] `POST /api/eval/evaluations` — validate config, write `config.json`, call `ExecutionService.run(id)` async (do not await), return 202 with config
  - [ ] `DELETE /api/eval/evaluations/:id` — call `ExecutionService.cancel(id)`, return success/failure
- [ ] Create `scripts/test-execution.ts` — end-to-end test: connect WebSocket, create minimal eval (1 prompt × 1 model × 1 test case, no judge), listen for `eval:completed`, verify `results.json` structure (cells have response content + deterministic metrics), verify `summary.json` (model rankings populated)
- [ ] Add `"test:execution": "bun run scripts/test-execution.ts"` to `package.json`
- [ ] **Verification**: `bun run test:execution` — eval completes; `config.json` status transitions to `completed`; all matrix cells present in `results.json` with populated metrics (inputTokens, outputTokens, durationMs, tokensPerSecond, serverName); `summary.json` has model rankings; WebSocket events arrive in correct sequence (cell:started → cell:completed → eval:progress → eval:completed); cancel mid-run stops execution cleanly

---

## Phase 3 — LLM Judge System

- [ ] Create `server/services/JudgeService.ts`:
  - [ ] `buildRubricPrompt()` — construct judge prompt per perspective with system prompt, user input, response, reference criteria, and scoring instructions in JSON output format (see Section 4.7 for exact prompt template)
  - [ ] `buildPairwisePrompt()` — construct comparison prompt showing both responses (randomize order to reduce position bias), requesting JSON with winner + justification
  - [ ] `parseRubricResponse()` — 4-step fallback chain: direct JSON.parse → strip markdown fences → regex extract first `{...}` block → return null with logged raw text
  - [ ] `parsePairwiseResponse()` — similar parsing, returns `PairwiseRanking` or null
  - [ ] `buildTemplateGeneratorPrompt()` — construct prompt that analyzes a system prompt and proposes 4-6 scoring dimensions, deterministic checks, and 3-5 test cases (see Section 5 of original plan)
  - [ ] `parseTemplateGeneratorResponse()` — parse generated template JSON, return `Partial<EvalTemplate>` or null
- [ ] Update `ExecutionService` with Phase 3 (`runJudging()`):
  - [ ] For each perspective × completed cell: build rubric prompt via `JudgeService.buildRubricPrompt()`, dispatch via `LmapiClient.chatCompletion()` with the judge model
  - [ ] If pairwise enabled: generate all unique cell pairs per test case, build pairwise prompts, dispatch in parallel
  - [ ] Parse all judge responses, accumulate `JudgeResult[]` and `PairwiseRanking[]`
  - [ ] Use `Promise.allSettled()` for parallel judge dispatch; failed parses logged but don't abort
  - [ ] Emit `judge:started` and `judge:completed` WebSocket events
- [ ] Update `SummaryService.computeSummary()` to include:
  - [ ] Composite score calculation (weighted average of perspective scores per cell)
  - [ ] Per-model aggregate: average composite across all prompts × testCases × runs
  - [ ] Per-prompt aggregate: average composite across all models × testCases × runs
  - [ ] Judge result breakdown in `perspectiveScores` field
- [ ] Implement `POST /api/eval/templates/generate` route:
  - [ ] Accept `{ promptContent: string, tools?: ToolDefinition[] }`
  - [ ] Build generator prompt via `JudgeService.buildTemplateGeneratorPrompt()`
  - [ ] Dispatch to LMApi using the most capable available model (or a specified model)
  - [ ] Parse response, return proposed `EvalTemplate`
- [ ] Update `scripts/test-execution.ts` to include judge-enabled eval test case
- [ ] **Verification**: Run eval with judge enabled → `JudgeResult` records in `results.json` with scores in 1-5 range; `summary.json` has perspectiveScores populated; pairwise rankings present and consistent (winner exists in cell pair); auto-generate template returns 4-6 perspectives with weights summing to 1.0; malformed judge responses (wrap in markdown, prepend text) handled gracefully without crash

---

## Phase 4 — Export System, Baselines & History

- [ ] Create `data/evals/templates/report-template.html`:
  - [ ] Dark theme CSS matching eval palette (inline `<style>` tag)
  - [ ] `{{EVAL_NAME}}` and `{{DATA}}` template placeholders
  - [ ] Vanilla JS that renders: interactive sortable tables, heatmap matrix (CSS grid + background gradient), expandable detail sections, basic tab navigation (Scoreboard / Details / Metrics)
  - [ ] No external dependencies (no CDN links); works offline
  - [ ] Printable via `@media print` CSS
  - [ ] Target: under 500KB for a typical evaluation
- [ ] Create `server/services/ReportService.ts`:
  - [ ] `generateMarkdown(evalId)` — read `summary.json` + `results.json`, render Markdown report using template from Section 7.1 of original plan (model rankings table, prompt rankings table, regression analysis, detailed per-cell results)
  - [ ] `generateHtml(evalId)` — read report template, replace `{{DATA}}` with `JSON.stringify(summary + results)` and `{{EVAL_NAME}}` with eval name, return self-contained HTML string
  - [ ] `writeReports(evalId)` — write both `report.md` and `report.html` to the evaluation directory
- [ ] Add export endpoints to `server/routes/evaluations.ts`:
  - [ ] `GET /api/eval/evaluations/:id/export?format=html` — call `ReportService.generateHtml()`, return as `text/html` with `Content-Disposition: attachment` header
  - [ ] `GET /api/eval/evaluations/:id/export?format=md` — call `ReportService.generateMarkdown()`, return as `text/markdown` with attachment header
- [ ] Add baseline endpoint to `server/routes/evaluations.ts`:
  - [ ] `POST /api/eval/evaluations/:id/baseline` — accept `{ slug: string }`, copy `summary.json` to `data/evals/baselines/{slug}.json` with evalId reference
- [ ] Update `SummaryService` with `computeRegression()`:
  - [ ] Accept current `EvaluationSummary` + baseline `EvaluationSummary`
  - [ ] Compute delta for every metric (compositeScore, perspectiveScores, deterministicPassRate, avgLatencyMs, avgTokensPerSecond)
  - [ ] Classify each metric as `improved`, `regressed`, or `unchanged` (threshold: ±2% for scores, ±5% for latency)
  - [ ] Populate `summary.regression` field
- [ ] When `baselineId` is set on `EvaluationConfig`, load baseline in `ExecutionService.aggregate()` and call `computeRegression()`
- [ ] Add history endpoint to `server/routes/prompts.ts`:
  - [ ] `GET /api/eval/prompts/:id/history` — scan `data/evals/evaluations/` directories, read each `config.json`, filter to evals that included this promptId, read corresponding `summary.json` for scores, return sorted timeline array `[{ evalId, date, modelScores, promptScore }]`
- [ ] Add leaderboard endpoint to `server/routes/models.ts`:
  - [ ] `GET /api/eval/models/leaderboard` — scan all completed evaluations, aggregate composite scores per model across all evals, return ranked list
- [ ] Update `scripts/test-api.ts` to cover: HTML export opens standalone (contains `<script>` data block); Markdown export has expected sections; save baseline then run second eval with `baselineId` set → regression data populated in `summary.json`; history endpoint returns timeline
- [ ] **Verification**: HTML export opens in browser with no internet, all sections render with correct data; Markdown export has model rankings table, prompt rankings table, detailed results; baseline save creates file in `data/evals/baselines/`; regression delta correctly identifies improved/regressed metrics; history returns chronologically sorted evaluations for the prompt; leaderboard aggregates across evaluations

---

## Phase 5 — Frontend: Configuration & Execution

- [ ] Set up `src/index.css` with Tailwind directives and CSS custom properties for eval palette
- [ ] Set up `tailwind.config.ts` extending theme with eval colors (see Section 7.3)
- [ ] Create `src/api/eval.ts` — fetch wrapper with typed API client for all `/api/eval/*` endpoints (see Section 7.6)
- [ ] Create `src/api/lmapi.ts` — fetch wrapper for direct LMApi calls (`/api/servers`, `/api/models`)
- [ ] Create React Context for eval state (`EvalContext.tsx` + `useReducer`) — see Section 7.1 for `EvalState` shape
- [ ] Create `src/hooks/useEvalSocket.ts` — native WebSocket hook connecting to `/ws/eval`; filters by `evalId`; returns `{ progress, liveFeed, isCompleted, error }`
- [ ] Create `src/hooks/useLmapiSocket.ts` — Socket.IO client hook connecting to LMApi; returns `{ serverStatuses }` (optional, for bonus metrics)
- [ ] Create `src/hooks/useResizable.ts` — panel resize hook with mouse event handlers; returns `{ sizes, onDragStart }`
- [ ] Create `src/components/layout/ResizablePanel.tsx` — generic three-panel CSS Grid container with drag handles
- [ ] Create `src/components/layout/TopBar.tsx`:
  - [ ] Inline-editable eval name (text input that toggles on click)
  - [ ] Status indicator: animated dot (gray idle, pulsing amber running, teal completed, rose failed)
  - [ ] Matrix badge: "2P × 3M × 4T × 1R = 24 completions" — updates live from config state
  - [ ] Action buttons: "Run Evaluation" (amber primary), "Export" dropdown (HTML / Markdown), "Save as Baseline", "Load Previous"
- [ ] Create `src/components/layout/BottomBar.tsx` — cost ticker (running token total), progress summary ("Phase 2/4 — 18/24 done"), quick stats post-completion (best model, best prompt)
- [ ] Create Left Panel components:
  - [ ] `PromptTabs.tsx` — horizontal tab bar with add/remove buttons; color dot per tab
  - [ ] `PromptEditor.tsx` — monospace `<textarea>` with input mode toggle (Editor / File / Saved); saved mode fetches from `/api/eval/prompts` with version dropdown; metadata bar below (version notes input, token count estimate, "Save Version" button)
  - [ ] `ToolDefinitionEditor.tsx` — collapsible section with JSON `<textarea>`; "Validate" button runs `JSON.parse` and shows errors inline
  - [ ] `PromptDiff.tsx` — unified diff view; calls `GET /api/eval/prompts/:id/diff`; renders additions (teal bg) and deletions (rose bg)
- [ ] Create Center Panel components (config mode):
  - [ ] `ModelSelector.tsx` — fetch from `GET /api/eval/models`; grouped by server/provider with section headers; searchable text input filters; multi-select checkboxes; selected models as removable chips; "Select All Local" / "Clear" buttons
  - [ ] `TestCaseEditor.tsx` — toggle between "Quick" mode (single textarea for one user message) and "Suite" mode (table of test cases: name, message, expected tool calls, reference answer; add/remove rows; load saved suite from dropdown)
  - [ ] `TemplateSelector.tsx` — dropdown of templates from `GET /api/eval/templates`; "Auto-Generate from Prompt" button (calls `POST /api/eval/templates/generate`, shows editable preview); "Customize" button opens inline perspective editor (weights, enable/disable)
  - [ ] `JudgeConfig.tsx` — judge model selector (single select); pairwise comparison toggle; runs-per-combination number input (1-10, default 1); perspective weight sliders (sum to 1.0 with auto-rebalance)
  - [ ] `ExecutionPreview.tsx` — small grid showing prompt × model × testCase dimensions; estimated total completions, tokens, time; warning if matrix > 50 cells
- [ ] Create Center Panel components (execution mode):
  - [ ] `ProgressDashboard.tsx` — overall progress bar with percentage + ETA calculation; phase indicator (1-4)
  - [ ] `ModelProgressRow.tsx` — per-model row: model name, progress bar (done/total), average latency, tokens/sec
  - [ ] `LiveFeed.tsx` — scrolling list of completed cells as compact cards (model name, test case name, pass/fail indicator); CSS slide-in animation; click card to preview response in modal
- [ ] Transition logic: when eval starts, center panel smoothly swaps config for execution view; when complete, right panel expands
- [ ] Implement keyboard shortcuts (see Section 7.7): `Ctrl+Enter` (run), `Ctrl+E` (export), `Ctrl+1/2/3` (panel focus), `Ctrl+D` (diff), `Esc` (close modal), `Ctrl+S` (save prompt)
- [ ] **Verification**: Full browser walkthrough — load `/` → three-panel layout renders → add two prompts → select models (grouped correctly) → add test cases → select template → configure judge → execution preview shows correct matrix dimensions → click "Run" → live progress updates via WebSocket → completion feed shows slide-in cards → keyboard shortcuts work → panel resize works via drag handles

---

## Phase 6 — Frontend: Results & Analysis

- [ ] Create `src/lib/scoring.ts` — utility functions: `scoreToColor(score, min, max)` returns CSS color from heatmap gradient (teal → amber → rose); `formatScore(score)` rounds to 1 decimal; `formatLatency(ms)` to human-readable
- [ ] Create `src/components/results/Scoreboard.tsx`:
  - [ ] Default results tab view
  - [ ] `HeatmapMatrix.tsx` sub-component: CSS Grid table; rows = prompts × test cases, columns = models; each cell shows composite score (1.0-5.0) with background color from `scoreToColor()`; hover tooltip shows per-perspective breakdown; click opens DetailView for that cell
  - [ ] Model leaderboard: ranked cards with composite score, deterministic pass rate, avg latency, tokens/sec; top model gets teal border accent
  - [ ] Prompt leaderboard: same format ranking prompts by composite score
  - [ ] Regression banner (if baseline set): prominent alert showing improvements (teal up-arrows) and regressions (rose down-arrows) with delta values
- [ ] Create `src/components/results/CompareView.tsx`:
  - [ ] Two dropdown selectors to pick any two prompt × model × testCase cells
  - [ ] Left and right columns showing full response text
  - [ ] Tool calls rendered as structured cards (function name, arguments, valid/invalid badge)
  - [ ] Pairwise verdict section below: winner indicator + judge justification
  - [ ] Diff toggle button: highlights text differences between the two responses (teal additions, rose deletions)
- [ ] Create `src/components/results/DetailView.tsx`:
  - [ ] Full drill-down for a single matrix cell (selected from heatmap click or dropdown)
  - [ ] Sections: raw response (monospace, scrollable), tool calls (collapsible cards with pass/fail per call and error details), deterministic metrics table (format compliant, JSON valid, keywords, token count), per-perspective judge scores with justifications (expandable), latency/token breakdown
  - [ ] "Why Did This Fail?" button (visible if composite score < 2.5): calls `POST /api/eval/evaluations/:id/diagnose` with cell data, shows improvement suggestions in a modal
- [ ] Create `src/components/results/MetricsView.tsx`:
  - [ ] Bar charts via HTML5 Canvas: latency by model, tokens/second by model, token usage (input vs output) by model
  - [ ] Deterministic compliance table: per-cell pass/fail for each enabled check (format, JSON schema, tool calls, keywords) with color coding
  - [ ] Consistency chart (visible if runs > 1): box plot or variance chart showing score distribution per model
- [ ] Create `src/components/results/TimelineView.tsx`:
  - [ ] Line chart via HTML5 Canvas: x-axis = evaluation date, y-axis = composite score
  - [ ] One line per model (color-coded)
  - [ ] Hover to see evaluation details (tooltip with eval name, scores)
  - [ ] Markers for prompt version changes along x-axis
  - [ ] Fetches data from `GET /api/eval/prompts/:id/history`
- [ ] Create results tab navigation: five tab buttons at top of right panel; content switches with crossfade transition; no layout shift
- [ ] Wire export buttons in TopBar: "Export HTML" calls `GET /api/eval/evaluations/:id/export?format=html` and triggers download; "Export Markdown" similar
- [ ] Wire "Save as Baseline" button: prompts for slug name, calls `POST /api/eval/evaluations/:id/baseline`
- [ ] Wire "Load Previous" button: opens modal with list from `GET /api/eval/evaluations`, click loads results into right panel
- [ ] **Verification**: Complete an evaluation → Scoreboard shows heatmap with correct colors and tooltips → model/prompt leaderboards ranked correctly → Compare view shows two responses side-by-side with working diff toggle → Details view shows all metrics sections → Metrics tab renders Canvas charts with correct data → Timeline tab shows history (run 2+ evals for same prompt) → Export downloads valid HTML/Markdown files → Baseline save + regression badges work

---

## Phase 7 — Polish, Edge Cases & Documentation

- [ ] Implement "Why Did This Fail?" diagnostic endpoint:
  - [ ] `POST /api/eval/evaluations/:id/diagnose` — accepts `{ cellId: string }`
  - [ ] Constructs a diagnostic prompt: includes the original system prompt, user message, model response, judge rubric + score, and asks for specific improvement suggestions
  - [ ] Dispatches to LMApi via `LmapiClient.chatCompletion()`
  - [ ] Returns improvement suggestions as structured text
- [ ] Add per-cell retry logic in `ExecutionService`:
  - [ ] On transient error (network timeout, 503 from LMApi): retry once after 2s delay
  - [ ] Make retry count configurable via eval config (default: 1, max: 3)
- [ ] Handle partial evaluation failures:
  - [ ] Cells that fail after retry: mark `status: 'failed'` in `EvalMatrixCell`, include error message
  - [ ] Evaluation continues with remaining cells — never abort entire eval on individual cell failure
  - [ ] `summary.json` notes failed cells count and which models/test cases were affected
  - [ ] Frontend shows failed cells in heatmap with rose border + error icon
- [ ] Add `groupId` tagging: set `groupId: evalId` on all LMApi requests so eval traffic can be filtered in LMApi's prompt history dashboard
- [ ] Accessibility pass:
  - [ ] `aria-label` on all interactive controls (buttons, selects, tabs)
  - [ ] Keyboard navigation through model selector list and test case table
  - [ ] Focus management on tab switches (focus first element in new tab content)
  - [ ] High contrast mode: ensure all text meets WCAG AA contrast ratio against dark backgrounds
  - [ ] Screen reader: heatmap cells announce score and model/test case context
- [ ] Responsive layout:
  - [ ] Below 1024px width: panels stack vertically (prompt → config → results)
  - [ ] Panel collapse buttons work at all breakpoints
  - [ ] Mobile: single-panel view with tab navigation between panels
- [ ] Error boundary: React error boundary wrapping each panel so one panel crash doesn't take down the whole page
- [ ] Loading states: skeleton loaders for model list, template list, results panels
- [ ] Create project `README.md`:
  - [ ] Overview and purpose
  - [ ] Prerequisites: Node.js/Bun, running LMApi instance
  - [ ] Setup instructions: clone, install, configure `.env`, seed templates
  - [ ] Running: `bun run dev:server` + `bun run dev:client`
  - [ ] Usage walkthrough: create prompt → configure eval → run → analyze results → export
  - [ ] Architecture overview (standalone project consuming LMApi)
  - [ ] All API endpoints table (`/api/eval/*`)
  - [ ] Built-in template descriptions
  - [ ] Data storage layout (`data/evals/` directory tree)
  - [ ] Export formats (HTML standalone, Markdown)
  - [ ] Keyboard shortcuts table
  - [ ] Configuration reference (`.env` variables)
- [ ] **Verification**: Force cell failure (use nonexistent model) → eval completes with partial results, failed cells shown in UI with error indicator; "Why Did This Fail?" returns suggestions for low-scoring cell; retry logic triggers on simulated timeout; screen reader navigates eval page successfully; responsive layout works at mobile widths; README is complete and accurate

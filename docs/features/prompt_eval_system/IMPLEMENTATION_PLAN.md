# Prompt & Model Evaluation System — Implementation Plan (LMApi-Adapted)

## 0. Adaptation Notes

The original design in `prompt-eval-system-plan.md` was written for a Bun + Vite SPA stack. This plan adapts it to the actual LMApi stack:

| Concern | Original Plan | LMApi Reality |
|---|---|---|
| Runtime | Bun | Node.js + Express |
| Frontend | Vite + TypeScript SPA | Static HTML/CSS/JS in `src/public/` |
| WebSocket | Raw WS endpoint | Socket.IO (already in use) |
| Model calls | Direct LMAPI proxy | Route through `QueueService.dispatchOrQueueChat()` |
| Real-time events | `ws://…/api/eval/:id/stream` | Socket.IO room events from `SocketService` |
| Test framework | Vitest (assumed) | `ts-node` integration scripts (same pattern as existing) |

All other design decisions (file-based JSON storage, REST API shape, data model, execution pipeline, LLM-as-judge, export formats) carry over unchanged.

---

## 1. New Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "ajv": "^8.17.1",
    "diff": "^7.0.0"
  },
  "devDependencies": {
    "@types/diff": "^5.2.3"
  }
}
```

- **`ajv`** — JSON Schema validation (draft-07+) for tool call argument validation and structured output checks.
- **`diff`** — Text diff computation for prompt version comparison views.

---

## 2. Directory & File Structure

All new source files live under `src/` following existing conventions. New data lives under `data/evals/`.

### 2.1 Source Directory Layout

```
src/
├── routes/
│   └── evalRoutes.ts                    # NEW — all /api/eval/* REST endpoints
├── services/
│   ├── eval/
│   │   ├── EvalFileService.ts           # NEW — file I/O: read/write JSON, Markdown, slugs
│   │   ├── EvalTemplateService.ts       # NEW — CRUD for eval templates
│   │   ├── EvalPromptService.ts         # NEW — CRUD for versioned prompts + diff
│   │   ├── EvalTestSuiteService.ts      # NEW — CRUD for test suites
│   │   ├── EvalExecutionService.ts      # NEW — orchestrates the full 4-phase pipeline
│   │   ├── EvalMetricsService.ts        # NEW — deterministic checks (JSON schema, keywords, tool calls)
│   │   ├── EvalJudgeService.ts          # NEW — LLM-as-judge prompt construction + response parsing
│   │   ├── EvalSummaryService.ts        # NEW — aggregation, ranking, regression deltas
│   │   └── EvalReportService.ts         # NEW — Markdown + HTML report generation
│   └── [existing services unchanged]
├── types/
│   └── eval.ts                          # NEW — all TypeScript interfaces for the eval system
├── public/
│   ├── eval.html                        # NEW — eval dashboard static page
│   ├── scripts/
│   │   └── evalSocket.js                # NEW — client-side Socket.IO event handler for eval
│   └── styles/
│       └── eval.css                     # NEW — eval page styles
└── constants.ts                         # MODIFY — add EVAL_SOCKET_EVENTS constants
```

### 2.2 Data Directory Layout

```
data/
└── evals/
    ├── templates/
    │   ├── general-quality.json
    │   ├── tool-calling.json
    │   ├── code-generation.json
    │   ├── instruction-following.json
    │   └── custom/
    ├── prompts/
    │   └── {prompt-slug}/
    │       ├── manifest.json
    │       ├── v1.md
    │       └── tools.json               # optional
    ├── test-suites/
    │   └── {suite-slug}.json
    ├── evaluations/
    │   └── {eval-id}/
    │       ├── config.json
    │       ├── results.json
    │       ├── summary.json
    │       ├── report.md
    │       └── report.html
    └── baselines/
        └── {baseline-slug}.json
```

---

## 3. TypeScript Types (`src/types/eval.ts`)

Define all interfaces from Section 2.2 of the original plan verbatim. Group them into logical blocks with JSDoc comments:

```typescript
// ── Templates ──────────────────────────────────────────────────────────────
export interface EvalTemplate { ... }
export interface JudgePerspective { ... }

// ── Prompts ────────────────────────────────────────────────────────────────
export interface PromptManifest { ... }
export interface PromptVersionMeta { ... }
export interface ToolDefinition { ... }

// ── Test Suites ────────────────────────────────────────────────────────────
export interface TestSuite { ... }
export interface TestCase { ... }
export interface ExpectedToolCall { ... }

// ── Evaluation ─────────────────────────────────────────────────────────────
export interface EvaluationConfig { ... }
export interface EvaluationResults { ... }
export interface EvalMatrixCell { ... }
export interface ToolCallResult { ... }
export interface JudgeResult { ... }
export interface PairwiseRanking { ... }
export interface EvaluationSummary { ... }

// ── WebSocket Events ────────────────────────────────────────────────────────
export type EvalStreamEvent = ... // see Section 10.6 of original plan
```

All type definitions are a direct copy of Section 2.2 of the original plan with no modifications.

---

## 4. Service Layer

### 4.1 `EvalFileService`

Core file I/O utility. All other eval services depend on it.

**Methods:**
```typescript
class EvalFileService {
  // Paths
  static evalsDir(): string          // → data/evals/
  static templatesDir(): string
  static customTemplatesDir(): string
  static promptsDir(): string
  static testSuitesDir(): string
  static evaluationsDir(): string
  static baselinesDir(): string

  // JSON I/O
  static readJson<T>(filePath: string): T | null
  static writeJson(filePath: string, data: unknown): void
  static ensureDir(dirPath: string): void

  // Markdown I/O
  static readMarkdown(filePath: string): string | null
  static writeMarkdown(filePath: string, content: string): void

  // Utilities
  static generateSlug(name: string): string      // kebab-case from display name
  static generateId(): string                     // randomUUID()
  static listJsonFiles(dir: string): string[]    // returns full paths
  static fileExists(filePath: string): boolean
  static deleteFile(filePath: string): void
  static deleteDir(dirPath: string): void
}
```

**Implementation notes:**
- Use `fs` (sync) for all operations — same pattern as `DbService` and `ProviderService`.
- `generateSlug`: lowercase, replace spaces/special chars with hyphens, trim.
- `ensureDir` wraps `fs.mkdirSync({ recursive: true })`.

### 4.2 `EvalTemplateService`

CRUD for eval templates stored as JSON files.

**Methods:**
```typescript
class EvalTemplateService {
  static list(): EvalTemplate[]
  static get(id: string): EvalTemplate | null
  static create(data: Omit<EvalTemplate, 'id' | 'createdAt' | 'updatedAt'>): EvalTemplate
  static update(id: string, data: Partial<EvalTemplate>): EvalTemplate
  static delete(id: string): void    // only custom templates; reject built-ins
  static isBuiltIn(id: string): boolean
  static seedBuiltIns(): void        // call on startup if built-ins are missing
}
```

**Storage:** Built-in templates live in `data/evals/templates/{name}.json`. Custom templates live in `data/evals/templates/custom/{id}.json`.

**Startup integration:** Call `EvalTemplateService.seedBuiltIns()` from `app.ts` startup sequence (alongside `DbService.initialize()`).

### 4.3 `EvalPromptService`

Versioned prompt storage and diff.

**Methods:**
```typescript
class EvalPromptService {
  static list(): PromptManifest[]
  static get(id: string): PromptManifest | null
  static getVersionContent(id: string, version: number): string | null
  static create(name: string, content: string, description?: string): PromptManifest
  static addVersion(id: string, content: string, notes?: string): PromptManifest
  static diff(id: string, v1: number, v2: number): DiffResult   // uses `diff` npm package
  static updateTools(id: string, tools: ToolDefinition[]): void
  static estimateTokens(content: string): number  // rough word-based estimate × 1.3
}
```

**Storage:** Each prompt lives in `data/evals/prompts/{slug}/`. The manifest.json contains all metadata; each version's content is in `v{n}.md`.

### 4.4 `EvalTestSuiteService`

CRUD for test suites.

**Methods:**
```typescript
class EvalTestSuiteService {
  static list(): TestSuite[]
  static get(id: string): TestSuite | null
  static create(data: Omit<TestSuite, 'id' | 'createdAt' | 'updatedAt'>): TestSuite
  static update(id: string, data: Partial<TestSuite>): TestSuite
  static delete(id: string): void
  static addTestCase(suiteId: string, testCase: Omit<TestCase, 'id'>): TestSuite
  static removeTestCase(suiteId: string, testCaseId: string): TestSuite
}
```

**Storage:** `data/evals/test-suites/{slug}.json`

### 4.5 `EvalMetricsService`

Deterministic metric collection. Pure functions — no I/O.

**Methods:**
```typescript
class EvalMetricsService {
  // JSON Schema validation using ajv
  static validateJsonSchema(content: string, schema: object): { valid: boolean; errors: string[] }

  // Tool call validation
  static validateToolCalls(
    toolCalls: ToolCall[],
    definitions: ToolDefinition[],
    expected?: ExpectedToolCall[]
  ): { valid: boolean; errors: string[] }

  // Keyword checks
  static checkKeywords(
    content: string,
    required?: string[],
    forbidden?: string[]
  ): { present: Record<string, boolean>; absent: Record<string, boolean> }

  // Token count (rough estimate from response text)
  static estimateTokenCount(text: string): number
}
```

**Implementation notes:**
- Instantiate `ajv` once as a module-level singleton. Enable `allErrors: true` to collect all validation errors.
- Tool call validation: for each `ExpectedToolCall`, verify the function name exists in the response's `tool_calls`, required args are present, and arg JSON is valid against `argSchema` (if provided).

### 4.6 `EvalJudgeService`

LLM-as-judge prompt construction and response parsing.

**Methods:**
```typescript
class EvalJudgeService {
  // Build rubric-scoring prompt for a single perspective
  static buildRubricPrompt(
    cell: EvalMatrixCell,
    systemPromptContent: string,
    testCaseMessage: string,
    perspective: JudgePerspective,
    referenceAnswer?: string
  ): ChatCompletionRequest

  // Build pairwise comparison prompt
  static buildPairwisePrompt(
    cellA: EvalMatrixCell,
    cellB: EvalMatrixCell,
    systemPromptContent: string,
    testCaseMessage: string,
    judgeModel: string
  ): ChatCompletionRequest

  // Parse judge response — robust extraction with fallback chain
  static parseRubricResponse(raw: string): { score: number; justification: string } | null
  static parsePairwiseResponse(raw: string, cellAId: string, cellBId: string): PairwiseRanking | null

  // Template auto-generation
  static buildTemplateGeneratorPrompt(
    systemPromptContent: string,
    tools?: ToolDefinition[]
  ): ChatCompletionRequest
  static parseTemplateGeneratorResponse(raw: string): Partial<EvalTemplate> | null
}
```

**`parseRubricResponse` fallback chain (from Section 10.3 of original plan):**
1. `JSON.parse(raw)` directly.
2. Strip markdown fences (` ```json...``` `) and retry.
3. Extract first `{...}` block via regex and retry.
4. Return `null` (failed parse) — log raw text.

**Judge prompt format** (from Section 4.3 of original plan):
```
System: <perspective.systemPrompt>
User:
## Original Prompt
<system prompt being evaluated>

## User Input
<test case user message>

## Response to Evaluate
<model response content>

## Reference Criteria (if provided)
<reference answer / criteria>

## Scoring Instructions
Score this response on a scale of <min> to <max> for <perspective.name>.
<scale label descriptions>

Respond with JSON: { "score": <number>, "justification": "<string>" }
```

### 4.7 `EvalExecutionService`

Orchestrates the 4-phase evaluation pipeline. This is the most complex service.

**Methods:**
```typescript
class EvalExecutionService {
  // Main entry point — called by POST /api/eval/evaluations
  static async run(evalId: string): Promise<void>

  // Phase 1: Matrix construction
  private static buildMatrix(config: EvaluationConfig, testCases: TestCase[]): EvalMatrixCell[]
  static estimateCost(config: EvaluationConfig, testCases: TestCase[]): CostEstimate

  // Phase 2: Completion dispatch
  private static async runCompletions(
    evalId: string,
    matrix: EvalMatrixCell[],
    config: EvaluationConfig,
    promptContents: Map<string, string>
  ): Promise<void>

  // Phase 3: Judge evaluation
  private static async runJudging(
    evalId: string,
    matrix: EvalMatrixCell[],
    config: EvaluationConfig,
    promptContents: Map<string, string>,
    testCases: TestCase[]
  ): Promise<JudgeResult[]>

  // Phase 4: Aggregation
  private static aggregate(
    evalId: string,
    matrix: EvalMatrixCell[],
    judgeResults: JudgeResult[],
    pairwise: PairwiseRanking[],
    config: EvaluationConfig
  ): EvaluationSummary

  // Cancel support
  private static runningEvals = new Map<string, AbortController>()
  static cancel(evalId: string): boolean
}
```

**Key implementation decisions:**
- All completions are dispatched via `QueueService.dispatchOrQueueChat()` — the eval system is just another API client using the existing load balancer.
- Use `Promise.allSettled()` for all parallel dispatches (phases 2 and 3) so individual failures don't abort the evaluation.
- Emit Socket.IO events via `SocketService.emit(EVAL_SOCKET_EVENTS.*, data)` throughout execution.
- Write partial results to disk after each phase completes; the evaluation is restartable.
- The `AbortController` map enables cancel support via `DELETE /api/eval/evaluations/:id`.

**Phase 2 cell construction:**
```typescript
const request: ChatCompletionRequest = {
  model: cell.modelId,
  messages: [
    { role: 'system', content: promptContent },
    { role: 'user', content: testCase.userMessage }
  ],
  tools: promptManifest.toolDefinitions,
  serverName: 'any'  // let LMAPI route
};
const response = await QueueService.dispatchOrQueueChat(request);
```

### 4.8 `EvalSummaryService`

Pure computation — takes raw results, returns summary.

**Methods:**
```typescript
class EvalSummaryService {
  static computeSummary(
    evalId: string,
    matrix: EvalMatrixCell[],
    judgeResults: JudgeResult[],
    pairwise: PairwiseRanking[],
    config: EvaluationConfig,
    baselineId?: string
  ): EvaluationSummary

  static computeRegression(
    current: EvaluationSummary,
    baseline: EvaluationSummary
  ): EvaluationSummary['regression']

  static computeConsistency(cells: EvalMatrixCell[]): number  // variance metric
}
```

### 4.9 `EvalReportService`

Report generation. Reads summary and results, writes files.

**Methods:**
```typescript
class EvalReportService {
  static generateMarkdown(evalId: string): string
  static generateHtml(evalId: string): string
  static writeReports(evalId: string): void   // writes both report.md and report.html

  private static loadTemplate(): string  // reads data/evals/templates/report-template.html
}
```

**HTML template location:** `data/evals/templates/report-template.html`

The HTML template uses `{{DATA}}` and `{{EVAL_NAME}}` placeholders. The generated file is fully self-contained (inline CSS, embedded JSON, vanilla JS rendering). No external CDN dependencies. Target: under 500KB.

---

## 5. API Routes (`src/routes/evalRoutes.ts`)

One route file covers all `/api/eval/*` endpoints. Register in `app.ts` as `app.use('/api/eval', evalRoutes)`.

### 5.1 Templates

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/templates` | `EvalTemplateService.list()` |
| `GET` | `/templates/:id` | `EvalTemplateService.get(id)` |
| `POST` | `/templates` | `EvalTemplateService.create(body)` |
| `PUT` | `/templates/:id` | `EvalTemplateService.update(id, body)` |
| `DELETE` | `/templates/:id` | `EvalTemplateService.delete(id)` |
| `POST` | `/templates/generate` | `EvalJudgeService.buildTemplateGeneratorPrompt()` → `QueueService.dispatchOrQueueChat()` → parse response |

### 5.2 Prompts

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/prompts` | `EvalPromptService.list()` |
| `GET` | `/prompts/:id` | `EvalPromptService.get(id)` |
| `GET` | `/prompts/:id/versions/:version` | `EvalPromptService.getVersionContent(id, version)` |
| `POST` | `/prompts` | `EvalPromptService.create(body)` |
| `POST` | `/prompts/:id/versions` | `EvalPromptService.addVersion(id, body)` |
| `GET` | `/prompts/:id/diff` | `EvalPromptService.diff(id, v1, v2)` (query params) |
| `PUT` | `/prompts/:id/tools` | `EvalPromptService.updateTools(id, body.tools)` |

### 5.3 Test Suites

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/test-suites` | `EvalTestSuiteService.list()` |
| `GET` | `/test-suites/:id` | `EvalTestSuiteService.get(id)` |
| `POST` | `/test-suites` | `EvalTestSuiteService.create(body)` |
| `PUT` | `/test-suites/:id` | `EvalTestSuiteService.update(id, body)` |
| `DELETE` | `/test-suites/:id` | `EvalTestSuiteService.delete(id)` |

### 5.4 Evaluations

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/evaluations` | List all; query: `status`, `promptId`, `modelId` |
| `GET` | `/evaluations/:id` | Read `config.json` |
| `GET` | `/evaluations/:id/results` | Read `results.json` |
| `GET` | `/evaluations/:id/summary` | Read `summary.json` |
| `POST` | `/evaluations` | Create config, start `EvalExecutionService.run(id)` async |
| `DELETE` | `/evaluations/:id` | `EvalExecutionService.cancel(id)` |
| `GET` | `/evaluations/:id/export` | Query: `format=html\|md`; call `EvalReportService` |
| `POST` | `/evaluations/:id/baseline` | Copy `summary.json` to `data/evals/baselines/{slug}.json` |

**Note on async execution:** `POST /evaluations` validates the config, writes `config.json` with `status: "pending"`, then calls `EvalExecutionService.run(id)` without `await` — the function runs in the background. The HTTP response returns the created `EvaluationConfig` immediately (202 Accepted). Progress is tracked via Socket.IO events.

### 5.5 Models Proxy

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/models` | Calls `ServerPoolService.getAllServersWithModels()` and `ProviderService.getProviders()` — returns grouped model list |

The model list response groups models by server/provider with metadata (server name, model name, context window if available).

### 5.6 History & Analytics

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/prompts/:id/history` | Scan `data/evals/evaluations/` for evals that included this promptId; return timeline data |
| `GET` | `/models/leaderboard` | Aggregate model rankings across all completed evaluations |

---

## 6. Socket.IO Integration

### 6.1 New Event Constants (`src/constants.ts`)

Add to the existing `SOCKET_EVENTS` export:

```typescript
export const EVAL_SOCKET_EVENTS = {
  EVAL_CELL_STARTED:      'eval:cell:started',
  EVAL_CELL_STREAMING:    'eval:cell:streaming',
  EVAL_CELL_COMPLETED:    'eval:cell:completed',
  EVAL_CELL_FAILED:       'eval:cell:failed',
  EVAL_JUDGE_STARTED:     'eval:judge:started',
  EVAL_JUDGE_COMPLETED:   'eval:judge:completed',
  EVAL_PROGRESS:          'eval:progress',
  EVAL_COMPLETED:         'eval:completed',
  EVAL_FAILED:            'eval:failed',
} as const;
```

### 6.2 New `SocketService` Methods

Add to `SocketService.ts`:

```typescript
// Eval-specific emitters (namespaced to avoid collision with existing events)
static emitEvalEvent(evalId: string, event: string, data: any) {
  this.emit(event, { evalId, ...data });
}
```

All eval stream events include `evalId` so the frontend can ignore events for other evaluations.

### 6.3 Event Payload Types

```typescript
// Emitted during Phase 2:
{ type: 'eval:cell:started', evalId, cellId, modelId, testCaseId }
{ type: 'eval:cell:completed', evalId, cellId, metrics: EvalMatrixCell['metrics'] }
{ type: 'eval:cell:failed', evalId, cellId, error: string }

// Emitted during Phase 3:
{ type: 'eval:judge:started', evalId, cellId, perspectiveId }
{ type: 'eval:judge:completed', evalId, cellId, perspectiveId, score: number }

// Emitted during all phases:
{ type: 'eval:progress', evalId, phase: number, totalPhases: 4,
  completedCells: number, totalCells: number, elapsedMs: number }

// Final events:
{ type: 'eval:completed', evalId, summaryPath: string }
{ type: 'eval:failed', evalId, error: string }
```

---

## 7. App Startup Integration (`src/app.ts`)

Add to the startup sequence in `start()`:

```typescript
import { EvalTemplateService } from './services/eval/EvalTemplateService';
import { evalRoutes } from './routes/evalRoutes';

// In start():
EvalTemplateService.seedBuiltIns();  // idempotent — skips existing files

// Route registration (add before error handler):
app.use('/api/eval', evalRoutes);

// Static page:
app.get('/eval', (_req, res) => {
  res.sendFile(path.join(publicDir, 'eval.html'));
});
```

---

## 8. Frontend (`src/public/eval.html`)

The frontend follows the same pattern as the existing `log-dashboard.html` and `history-browser.html` — plain HTML with inline or linked CSS/JS, no build step required.

### 8.1 Architecture

- **Single HTML file** at `src/public/eval.html` with `<link>` to `styles/eval.css` and `<script src="scripts/evalSocket.js">`.
- `evalSocket.js` connects to Socket.IO and handles all real-time updates.
- State is managed in plain JavaScript module-pattern objects.
- API calls use `fetch()` against `/api/eval/*`.

### 8.2 Layout Structure

Three-panel layout using CSS Grid (same visual approach as `log-dashboard.html`):

```
┌──────────────────────────────────────────────────────────┐
│  Top Bar: Eval Name | Status | Matrix Badge | Actions    │
├────────────┬──────────────────┬───────────────────────────┤
│ LEFT       │ CENTER           │ RIGHT                      │
│ Prompt     │ Config &         │ Results &                  │
│ Input      │ Execution        │ Analysis                   │
├────────────┴──────────────────┴───────────────────────────┤
│  Bottom Bar: Cost Estimate | Progress | Quick Stats       │
└──────────────────────────────────────────────────────────┘
```

All panels are independently scrollable with drag-resize handles using mouse events.

### 8.3 Color Palette

Defined as CSS custom properties at `:root`, matching the spec from Section 6.1 of the original plan:

```css
:root {
  --bg-base:    #09090b;  /* zinc-950 */
  --bg-surface: #18181b;  /* zinc-900 */
  --bg-elevated:#27272a;  /* zinc-800 */
  --border:     #3f3f46;  /* zinc-700 */
  --text-primary:  #f4f4f5;  /* zinc-100 */
  --text-secondary:#a1a1aa;  /* zinc-400 */
  --accent:     #f59e0b;  /* amber-500 */
  --accent-hover:#fbbf24; /* amber-400 */
  --success:    #14b8a6;  /* teal-500 */
  --warning:    #f59e0b;  /* amber-500 */
  --error:      #f43f5e;  /* rose-500 */
  --info:       #0ea5e9;  /* sky-500 */
}
```

Typography: `JetBrains Mono` (loaded via Google Fonts or local) for prompt/code content; system sans-serif fallback for UI.

### 8.4 Left Panel — Prompt Input

- **Tab bar**: one tab per loaded prompt with add/remove. Color dot per tab matches results matrix.
- **Input mode**: toggle between Editor (textarea with monospace), File (file input or path text), Saved (dropdown of `GET /api/eval/prompts`).
- **Metadata bar**: version notes input, token count (updated via JS regex approximation), "Save Version" button.
- **Tool definitions**: collapsible `<textarea>` for JSON. "Validate" button runs `JSON.parse` and shows errors.
- **Diff view**: when ≥2 prompts loaded, "Diff" button shows unified diff rendered using the `diff` package (API call to `GET /api/eval/prompts/:id/diff`).

### 8.5 Center Panel — Configuration

**Configuration mode:**
- Model selector: fetch from `GET /api/eval/models`; grouped by server, multi-select checkboxes. Search input filters in-place.
- Test cases: "Quick" mode (single textarea) and "Suite" mode (table of cases with add/remove).
- Template selector: dropdown from `GET /api/eval/templates` with "Auto-Generate" button.
- Judge config: judge model select, pairwise toggle, runs-per-cell number input.
- Execution preview: computed matrix dimensions + estimated totals.

**Execution mode** (transitions in when eval starts):
- Overall progress bar.
- Per-model progress rows (updated via `eval:cell:completed` events).
- Live feed of completed cells (slide-in cards via CSS animation).
- Judge progress section appears after Phase 2.

### 8.6 Right Panel — Results

Five tabs (rendered as buttons with `active` class toggling visibility):

1. **Scoreboard** — CSS Grid heatmap table + model/prompt leaderboard cards.
2. **Compare** — Two column selectors + side-by-side response viewer with diff toggle.
3. **Details** — Full drill-down for one cell: raw response, tool call cards, per-perspective judge scores.
4. **Metrics** — Bar charts via vanilla Canvas API (no charting library needed for simple bars); deterministic compliance table.
5. **Timeline** — Line chart via Canvas for score history over time.

### 8.7 `evalSocket.js`

Connects to the existing Socket.IO server (same URL as page). Listens for all `EVAL_SOCKET_EVENTS` and updates the DOM:

```javascript
const socket = io();

socket.on('eval:cell:completed', ({ evalId, cellId, metrics }) => {
  if (evalId !== currentEvalId) return;
  updateCellInMatrix(cellId, metrics);
  appendToLiveFeed(cellId, metrics);
});

socket.on('eval:progress', ({ evalId, phase, completedCells, totalCells, elapsedMs }) => {
  if (evalId !== currentEvalId) return;
  updateProgressBar(completedCells, totalCells, phase, elapsedMs);
});

socket.on('eval:completed', ({ evalId }) => {
  if (evalId !== currentEvalId) return;
  fetchAndRenderResults(evalId);
});
```

---

## 9. Built-in Template Seeding

`EvalTemplateService.seedBuiltIns()` writes the four built-in templates from Section 8 of the original plan to `data/evals/templates/` on first startup. The method is idempotent — it skips files that already exist. Templates include fully-specified `systemPrompt` strings for each `JudgePerspective`.

**Built-in template IDs** (stable, never deleted):
- `general-quality`
- `tool-calling`
- `code-generation`
- `instruction-following`

---

## 10. Report Template

Create `data/evals/templates/report-template.html` as a self-contained HTML template with:
- Dark theme CSS matching the eval page palette.
- `{{EVAL_NAME}}` and `{{DATA}}` placeholders.
- Vanilla JS that renders tables, heatmap, and tab navigation from the embedded `DATA` JSON blob.
- No external dependencies. Printable via `@media print` CSS.

---

## 11. Zod Validation Schemas

Define Zod schemas alongside route handlers in `evalRoutes.ts` following the pattern from `chatCompletionRoutes.ts`. Key schemas:

```typescript
const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  deterministicChecks: z.object({ ... }),
  judgeConfig: z.object({ ... })
});

const CreatePromptSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
  description: z.string().optional()
});

const CreateEvaluationSchema = z.object({
  name: z.string().min(1),
  templateId: z.string(),
  promptVersions: z.array(z.object({
    promptId: z.string(),
    version: z.number().int().positive()
  })).min(1),
  models: z.array(z.string()).min(1),
  testSuiteId: z.string().optional(),
  inlineTestCases: z.array(z.object({ ... })).optional(),
  judgeConfig: z.object({ ... }),
  baselineId: z.string().optional()
}).refine(
  data => data.testSuiteId || (data.inlineTestCases && data.inlineTestCases.length > 0),
  { message: 'Either testSuiteId or inlineTestCases must be provided' }
);
```

---

## 12. Integration Test Scripts

Following the existing pattern in `scripts/`, create integration test scripts that run against a live server:

### `scripts/testEvalApi.ts`

Tests all CRUD endpoints in sequence:
1. Create a template → verify response.
2. Create a prompt → add version → get diff.
3. Create a test suite → add test cases.
4. Create and start an evaluation → poll status → verify results on completion.
5. Export as Markdown → verify file content.
6. Save as baseline → run second evaluation → verify regression data.
7. Cleanup (delete custom templates, test suites).

Add to `package.json`:
```json
"test:eval": "ts-node scripts/testEvalApi.ts"
```

### `scripts/testEvalExecution.ts`

End-to-end execution test with Socket.IO client:
1. Connect Socket.IO client.
2. Create a minimal evaluation (1 prompt × 1 model × 1 test case, no judge).
3. Listen for `eval:completed` event.
4. Verify `results.json` and `summary.json` structure.
5. Assert deterministic metric fields are populated.

---

## 13. Error Handling Conventions

Follow existing patterns:
- Route handlers return `{ error: string }` JSON on failure (matching existing routes).
- Services throw `Error` with descriptive messages; routes catch and return 400/404/500.
- Eval execution failures per cell: mark cell as `status: 'failed'`, emit `eval:cell:failed`, continue with remaining cells.
- Eval-level failures (e.g., no test cases): mark config as `status: 'failed'`, emit `eval:failed`, write error to `config.json`.

---

## 14. Implementation Order

Execute phases in this order. Each phase is independently deliverable and testable.

### Phase 1 — Foundation (Data & CRUD APIs)

**Deliverables:**
- `src/types/eval.ts` — all TypeScript interfaces
- `src/services/eval/EvalFileService.ts`
- `src/services/eval/EvalTemplateService.ts` + seeding on startup
- `src/services/eval/EvalPromptService.ts`
- `src/services/eval/EvalTestSuiteService.ts`
- `src/routes/evalRoutes.ts` — Templates, Prompts, Test Suites, and Models proxy endpoints only
- `data/evals/` directory structure and built-in template JSON files
- `scripts/testEvalApi.ts` — CRUD tests (templates, prompts, test suites)

**Verification:**
```bash
npm run dev
# In another terminal:
npm run test:eval
```
All CRUD operations round-trip correctly. Diff endpoint returns structured diff.

---

### Phase 2 — Evaluation Engine (Execution Pipeline)

**Deliverables:**
- `src/services/eval/EvalMetricsService.ts`
- `src/services/eval/EvalJudgeService.ts` — prompt construction only (no judge calls yet)
- `src/services/eval/EvalSummaryService.ts`
- `src/services/eval/EvalExecutionService.ts` — Phases 1-2 and 4 only (no judge)
- `src/constants.ts` — add `EVAL_SOCKET_EVENTS`
- `SocketService.ts` — add `emitEvalEvent()`
- `src/routes/evalRoutes.ts` — Evaluations endpoints (create, list, get, cancel)
- `app.ts` — register eval routes
- `scripts/testEvalExecution.ts` — end-to-end execution test (no judge)

**Verification:**
- Create evaluation via API → poll until `status: 'completed'`.
- Verify `results.json` contains all matrix cells with deterministic metrics populated.
- Socket.IO events arrive in correct order with correct payloads.
- Cancel a running evaluation → verify it stops cleanly.

---

### Phase 3 — LLM Judge System

**Deliverables:**
- `EvalJudgeService.ts` — complete (rubric scoring, pairwise, template generator, response parsing)
- `EvalExecutionService.ts` — Phase 3 complete (parallel judge dispatch via `QueueService`)
- `EvalSummaryService.ts` — composite score calculation including judge results
- Route: `POST /api/eval/templates/generate`
- Update `scripts/testEvalExecution.ts` to cover judge evaluation

**Verification:**
- Run evaluation with judge enabled → verify `JudgeResult` records in `results.json`.
- Verify scores are in expected range (1–5).
- Pairwise rankings are internally consistent.
- Auto-generate template → verify returned template has 4-6 perspectives.
- Fallback parsing handles malformed judge responses gracefully.

---

### Phase 4 — Export & Baselines

**Deliverables:**
- `src/services/eval/EvalReportService.ts`
- `data/evals/templates/report-template.html` — self-contained report template
- Routes: `GET /api/eval/evaluations/:id/export`, `POST /api/eval/evaluations/:id/baseline`
- Routes: `GET /api/eval/prompts/:id/history`, `GET /api/eval/models/leaderboard`
- Update `scripts/testEvalApi.ts` to cover export and baseline tests

**Verification:**
- Export as HTML → open in browser → all sections render correctly without internet access.
- Export as Markdown → verify structure matches template.
- Save baseline → run second eval → regression data populated in `summary.json`.
- History endpoint returns timeline data sorted by date.

---

### Phase 5 — Frontend

**Deliverables:**
- `src/public/eval.html`
- `src/public/styles/eval.css`
- `src/public/scripts/evalSocket.js`
- `app.ts` — add `/eval` static route

**Verification:**
- Load `/eval` in browser.
- Full workflow: create prompt → select model → configure eval → run → watch live progress → view results.
- All five result tabs render correctly.
- Export from UI downloads file.
- Panel resize works via drag handles.
- Keyboard shortcuts functional.

---

### Phase 6 — Polish & Edge Cases

**Deliverables:**
- "Why Did This Fail?" diagnostic button → calls judge with diagnostic prompt
- Error handling for partial eval failures (cells that fail don't abort the eval)
- Retry logic for transient failures (configurable, default: 1 retry per cell)
- Eval history and leaderboard pages (inline in `eval.html` via tab or separate route)
- Accessibility pass: `aria-label`, keyboard navigation, focus management
- README.md update — add Prompt & Model Evaluation System section

**Verification:**
- Force a cell failure (use a nonexistent model) → eval completes with partial results.
- All keyboard shortcuts work.
- Screen reader can navigate the eval page.
- README update covers all new endpoints and the eval page URL.

---

## 15. README Update Requirements

When implementation is complete, add a **Prompt & Model Evaluation System** section to `README.md` covering:

1. **Accessing the eval page** — `http://localhost:{PORT}/eval`
2. **New API endpoints** — table of all `/api/eval/*` endpoints with brief descriptions
3. **Data storage** — explain `data/evals/` directory structure
4. **Evaluation workflow** — step-by-step: load prompt → configure → run → view results → export
5. **Built-in templates** — list the four templates with brief descriptions
6. **Configuration** — note that eval model calls route through the existing LMAPI pool
7. **Export formats** — HTML (standalone) and Markdown

---

## 16. Key Technical Decisions (LMApi-specific)

### 16.1 Using Existing QueueService for Eval Completions

All model calls during evaluation dispatch through `QueueService.dispatchOrQueueChat()`. This means:
- Eval completions compete with regular API traffic for server resources.
- The LMAPI load balancer automatically distributes eval cells across available servers.
- All eval requests are logged to `PromptHistory` with `requestType: 'eval'` — filtering the history endpoint by `requestType=eval` shows evaluation traffic.

To tag eval requests, add `requestType: 'eval'` in the `ChatCompletionRequest` LMAPI extension fields (add to `types.ts` and pass through `QueueService`), or alternatively set a `groupId` matching the `evalId`.

### 16.2 Socket.IO Room Scoping (Future Enhancement)

Currently, eval events are broadcast to all Socket.IO clients. If multiple evals run simultaneously, each client receives events for all evals and filters by `evalId`. For Phase 6 or beyond, consider Socket.IO rooms per eval (`socket.join(evalId)` pattern) to scope traffic.

### 16.3 File System vs SQLite for Eval Data

Eval configs, results, and summaries are stored as JSON files (not SQLite). The SQLite `PromptHistory` table is **not** used for eval results — only for logging the raw chat completions that the eval engine generates (via `QueueService`). SQLite may be added later for indexing/search over many evaluations.

### 16.4 `ajv` Initialization

Instantiate `ajv` once as a module-level singleton in `EvalMetricsService`:

```typescript
import Ajv from 'ajv';
const ajv = new Ajv({ allErrors: true });
```

Compile schemas at evaluation start (not per-cell) and cache compiled validators.

### 16.5 Parallel Execution Limits

Phase 2 dispatches all matrix cells in parallel via `Promise.allSettled()`. For large matrices (>50 cells), this could overwhelm the LMAPI server pool queue. Consider chunking: dispatch in batches of `N` (e.g., `MAX_PARALLEL_PER_SERVER × server_count`) with a semaphore pattern. Implement a simple `Semaphore` class in `EvalExecutionService` for this purpose.

```typescript
class Semaphore {
  constructor(private limit: number) {}
  private queue: (() => void)[] = [];
  private running = 0;
  async acquire(): Promise<void> { ... }
  release(): void { ... }
}
```

### 16.6 Handling Streaming in Eval Completions

The eval engine uses **non-streaming** `QueueService.dispatchOrQueueChat()` calls. Streaming is not needed during evaluation since we wait for the complete response before running deterministic checks. This simplifies response handling significantly.

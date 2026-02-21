# Prompt & Model Evaluation System — Implementation Plan

## 0. Project Overview

A standalone web application for systematic comparison of LLM prompts and models. It consumes the **LMApi** service (a separate, already-running API) for all model interactions — model discovery, chat completions, and real-time metrics.

### Stack

| Concern | Technology |
|---|---|
| Runtime | Bun |
| Frontend | Vite + React + TypeScript |
| Styling | Tailwind CSS |
| Backend API | Bun HTTP server (Hono or Elysia) |
| Model calls | HTTP requests to LMApi (`/api/chat/completions/any`, `/api/chat/completions/batch`) |
| Real-time | Socket.IO client connected to LMApi + WebSocket server in eval backend |
| Storage | File-based JSON + Markdown on disk |
| JSON Schema validation | `ajv` |
| Text diffing | `diff` npm package |

### Relationship to LMApi

```
┌─────────────────────────────────┐     HTTP/WS      ┌─────────────────────────┐
│   Eval System                   │ ◄──────────────── │   LMApi                 │
│   (this project)                │ ──────────────►   │   (external service)    │
│                                 │                   │                         │
│   Vite React Frontend           │                   │   Ollama Server Pool    │
│   Bun API Backend               │                   │   OpenRouter Fallback   │
│   File-based JSON storage       │                   │   Socket.IO Events      │
└─────────────────────────────────┘                   └─────────────────────────┘
```

- The eval system does NOT modify LMApi in any way.
- All model calls route through LMApi's existing chat completions endpoints.
- LMApi handles server selection, load balancing, queueing, and provider fallback.
- The eval system connects to LMApi's Socket.IO for optional real-time metrics (token counts, latency, server assignment).

**Reference:** See [`LMAPI_API_REFERENCE.md`](LMAPI_API_REFERENCE.md) for full LMApi endpoint documentation.

---

## 1. Project Initialization

Start from the Vite React TypeScript template:

```bash
bun create vite prompt-eval --template react-ts
cd prompt-eval
bun install
```

### Additional Dependencies

```bash
# Frontend
bun add tailwindcss @tailwindcss/vite socket.io-client diff
bun add -d @types/diff

# Backend
bun add hono ajv
bun add -d @types/bun
```

### Project Structure

```
prompt-eval/
├── src/                            # Frontend (Vite + React)
│   ├── api/                        # API client functions
│   │   ├── lmapi.ts                # LMApi HTTP client (models, completions)
│   │   └── eval.ts                 # Eval backend API client (templates, prompts, evals)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TopBar.tsx
│   │   │   ├── BottomBar.tsx
│   │   │   └── ResizablePanel.tsx
│   │   ├── prompt/
│   │   │   ├── PromptEditor.tsx
│   │   │   ├── PromptTabs.tsx
│   │   │   ├── PromptDiff.tsx
│   │   │   └── ToolDefinitionEditor.tsx
│   │   ├── config/
│   │   │   ├── ModelSelector.tsx
│   │   │   ├── TestCaseEditor.tsx
│   │   │   ├── TemplateSelector.tsx
│   │   │   ├── JudgeConfig.tsx
│   │   │   └── ExecutionPreview.tsx
│   │   ├── execution/
│   │   │   ├── ProgressDashboard.tsx
│   │   │   ├── LiveFeed.tsx
│   │   │   └── ModelProgressRow.tsx
│   │   └── results/
│   │       ├── Scoreboard.tsx
│   │       ├── HeatmapMatrix.tsx
│   │       ├── CompareView.tsx
│   │       ├── DetailView.tsx
│   │       ├── MetricsView.tsx
│   │       └── TimelineView.tsx
│   ├── hooks/
│   │   ├── useEvalSocket.ts        # WebSocket hook for eval events
│   │   ├── useLmapiSocket.ts       # Socket.IO hook for LMApi events
│   │   └── useResizable.ts         # Panel resize hook
│   ├── types/
│   │   ├── eval.ts                 # Eval system types
│   │   └── lmapi.ts                # LMApi response types
│   ├── lib/
│   │   └── scoring.ts              # Client-side score formatting/coloring
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                   # Tailwind directives + custom properties
├── server/                         # Backend (Bun + Hono)
│   ├── index.ts                    # Bun server entry point
│   ├── routes/
│   │   ├── templates.ts
│   │   ├── prompts.ts
│   │   ├── testSuites.ts
│   │   ├── evaluations.ts
│   │   └── models.ts               # Proxy to LMApi
│   ├── services/
│   │   ├── FileService.ts          # JSON/Markdown I/O, slug generation
│   │   ├── TemplateService.ts      # CRUD for eval templates
│   │   ├── PromptService.ts        # Versioned prompt storage + diff
│   │   ├── TestSuiteService.ts     # CRUD for test suites
│   │   ├── ExecutionService.ts     # 4-phase eval pipeline orchestrator
│   │   ├── MetricsService.ts       # Deterministic checks (ajv, keywords, tool calls)
│   │   ├── JudgeService.ts         # LLM-as-judge prompt construction + parsing
│   │   ├── SummaryService.ts       # Aggregation, ranking, regression
│   │   ├── ReportService.ts        # Markdown + HTML report generation
│   │   └── LmapiClient.ts         # HTTP client wrapper for LMApi
│   ├── types/
│   │   └── eval.ts                 # Shared eval types (re-exported)
│   └── ws.ts                       # WebSocket server for eval progress events
├── data/
│   └── evals/
│       ├── templates/
│       │   ├── general-quality.json
│       │   ├── tool-calling.json
│       │   ├── code-generation.json
│       │   ├── instruction-following.json
│       │   └── custom/
│       ├── prompts/
│       │   └── {prompt-slug}/
│       │       ├── manifest.json
│       │       ├── v1.md
│       │       └── tools.json
│       ├── test-suites/
│       │   └── {suite-slug}.json
│       ├── evaluations/
│       │   └── {eval-id}/
│       │       ├── config.json
│       │       ├── results.json
│       │       ├── summary.json
│       │       ├── report.md
│       │       └── report.html
│       └── baselines/
│           └── {baseline-slug}.json
├── scripts/
│   ├── seed-templates.ts           # Seed built-in templates
│   └── test-api.ts                 # Integration test script
├── .env                            # LMAPI_BASE_URL, PORT
├── bunfig.toml
├── tailwind.config.ts
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 2. Configuration

### `.env`

```env
# Eval system backend port
PORT=3200

# LMApi connection
LMAPI_BASE_URL=http://localhost:3111
```

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api/eval': 'http://localhost:3200',    // Eval backend
      '/ws/eval': {                             // Eval WebSocket
        target: 'ws://localhost:3200',
        ws: true
      }
    }
  }
});
```

---

## 3. TypeScript Types (`src/types/eval.ts` + `server/types/eval.ts`)

Shared between frontend and backend. Define all interfaces from Section 2.2 of the original design spec (`prompt-eval-system-plan.md`) verbatim:

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
export type EvalStreamEvent = ... // Section 10.6 of original plan
```

All type definitions are a direct copy of Section 2.2 of `prompt-eval-system-plan.md` with no modifications.

LMApi response types live in `src/types/lmapi.ts` — copied from Section 11 of `LMAPI_API_REFERENCE.md`.

---

## 4. Backend Service Layer (`server/services/`)

### 4.1 `LmapiClient.ts`

HTTP client wrapper for all LMApi interactions. The eval backend never talks to Ollama or OpenRouter directly — only through LMApi.

```typescript
class LmapiClient {
  private baseUrl: string;  // from LMAPI_BASE_URL env var

  // Model discovery
  async getServers(): Promise<LmapiServerStatus[]>
  async getModels(): Promise<string[]>

  // Chat completions (non-streaming, for eval pipeline)
  async chatCompletion(request: LmapiChatCompletionRequest): Promise<LmapiChatCompletionResponse>

  // Batch completions (for parallel model comparison)
  async batchCompletion(messages: ChatMessage[], models: string[], options?: {
    tools?: ToolDefinition[];
    temperature?: number;
    groupId?: string;
  }): Promise<LmapiBatchResponse>
}
```

**Implementation notes:**
- Uses `fetch()` (Bun native).
- All methods include timeout handling (10 min default for completions).
- Errors are thrown with descriptive messages including LMApi error details.
- The `groupId` is always set to the `evalId` so LMApi's prompt history can be filtered.

### 4.2 `FileService.ts`

Core file I/O utility. All other services depend on it.

```typescript
class FileService {
  static evalsDir(): string          // → data/evals/
  static readJson<T>(filePath: string): T | null
  static writeJson(filePath: string, data: unknown): void
  static readMarkdown(filePath: string): string | null
  static writeMarkdown(filePath: string, content: string): void
  static generateSlug(name: string): string
  static generateId(): string
  static listJsonFiles(dir: string): string[]
  static ensureDir(dirPath: string): void
  static fileExists(filePath: string): boolean
  static deleteFile(filePath: string): void
  static deleteDir(dirPath: string): void
}
```

**Implementation notes:**
- Use Bun's native `Bun.file()` and `Bun.write()` for I/O.
- `generateSlug`: lowercase, replace spaces/special chars with hyphens, trim.
- `generateId`: `crypto.randomUUID()`.

### 4.3 `TemplateService.ts`

CRUD for eval templates.

```typescript
class TemplateService {
  static list(): EvalTemplate[]
  static get(id: string): EvalTemplate | null
  static create(data: Omit<EvalTemplate, 'id' | 'createdAt' | 'updatedAt'>): EvalTemplate
  static update(id: string, data: Partial<EvalTemplate>): EvalTemplate
  static delete(id: string): void
  static isBuiltIn(id: string): boolean
  static seedBuiltIns(): void
}
```

Built-in templates live in `data/evals/templates/{name}.json`. Custom templates in `data/evals/templates/custom/{id}.json`.

### 4.4 `PromptService.ts`

Versioned prompt storage and diff.

```typescript
class PromptService {
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

Each prompt lives in `data/evals/prompts/{slug}/`. Manifest.json holds metadata; each version's content is in `v{n}.md`.

### 4.5 `TestSuiteService.ts`

CRUD for test suites.

```typescript
class TestSuiteService {
  static list(): TestSuite[]
  static get(id: string): TestSuite | null
  static create(data: Omit<TestSuite, 'id' | 'createdAt' | 'updatedAt'>): TestSuite
  static update(id: string, data: Partial<TestSuite>): TestSuite
  static delete(id: string): void
}
```

### 4.6 `MetricsService.ts`

Deterministic metric collection. Pure functions — no I/O.

```typescript
class MetricsService {
  static validateJsonSchema(content: string, schema: object): { valid: boolean; errors: string[] }
  static validateToolCalls(
    toolCalls: ToolCall[],
    definitions: ToolDefinition[],
    expected?: ExpectedToolCall[]
  ): { valid: boolean; errors: string[] }
  static checkKeywords(
    content: string,
    required?: string[],
    forbidden?: string[]
  ): { present: Record<string, boolean>; absent: Record<string, boolean> }
  static estimateTokenCount(text: string): number
}
```

- `ajv` instantiated once at module level: `new Ajv({ allErrors: true })`.
- Compile schemas per-evaluation (not per-cell) and cache validators.

### 4.7 `JudgeService.ts`

LLM-as-judge prompt construction and response parsing.

```typescript
class JudgeService {
  // Rubric scoring
  static buildRubricPrompt(
    cell: EvalMatrixCell,
    systemPromptContent: string,
    testCaseMessage: string,
    perspective: JudgePerspective,
    referenceAnswer?: string
  ): LmapiChatCompletionRequest

  // Pairwise comparison
  static buildPairwisePrompt(
    cellA: EvalMatrixCell, cellB: EvalMatrixCell,
    systemPromptContent: string,
    testCaseMessage: string,
    judgeModel: string
  ): LmapiChatCompletionRequest

  // Response parsing with 4-step fallback chain
  static parseRubricResponse(raw: string): { score: number; justification: string } | null
  static parsePairwiseResponse(raw: string, cellAId: string, cellBId: string): PairwiseRanking | null

  // Template auto-generation
  static buildTemplateGeneratorPrompt(
    systemPromptContent: string,
    tools?: ToolDefinition[]
  ): LmapiChatCompletionRequest
  static parseTemplateGeneratorResponse(raw: string): Partial<EvalTemplate> | null
}
```

**`parseRubricResponse` fallback chain:**
1. `JSON.parse(raw)` directly.
2. Strip markdown fences (` ```json...``` `) and retry.
3. Extract first `{...}` block via regex and retry.
4. Return `null` — log raw text.

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

### 4.8 `ExecutionService.ts`

Orchestrates the 4-phase evaluation pipeline. This is the most complex service.

```typescript
class ExecutionService {
  private static lmapi = new LmapiClient();
  private static runningEvals = new Map<string, AbortController>();

  // Main entry — runs in background, emits WebSocket events
  static async run(evalId: string): Promise<void>

  // Phase 1: Matrix construction
  private static buildMatrix(config: EvaluationConfig, testCases: TestCase[]): EvalMatrixCell[]
  static estimateCost(config: EvaluationConfig, testCases: TestCase[]): CostEstimate

  // Phase 2: Completion dispatch (via LmapiClient)
  private static async runCompletions(
    evalId: string, matrix: EvalMatrixCell[],
    config: EvaluationConfig, promptContents: Map<string, string>
  ): Promise<void>

  // Phase 3: Judge evaluation (via LmapiClient)
  private static async runJudging(
    evalId: string, matrix: EvalMatrixCell[],
    config: EvaluationConfig, promptContents: Map<string, string>,
    testCases: TestCase[]
  ): Promise<JudgeResult[]>

  // Phase 4: Aggregation
  private static aggregate(...): EvaluationSummary

  // Cancel support
  static cancel(evalId: string): boolean
}
```

**Key implementation patterns:**

- All completions dispatch via `LmapiClient.chatCompletion()` → LMApi handles load balancing.
- Use `Promise.allSettled()` for parallel dispatch — individual cell failures don't abort the evaluation.
- Emit WebSocket events via the eval backend's WS server throughout execution.
- Write partial results to disk after each phase (the eval is resumable).
- Semaphore pattern for large matrices (batch N concurrent requests at a time).

**Phase 2 cell dispatch:**
```typescript
const response = await this.lmapi.chatCompletion({
  model: cell.modelId,
  messages: [
    { role: 'system', content: promptContent },
    { role: 'user', content: testCase.userMessage }
  ],
  tools: promptManifest.toolDefinitions,
  temperature: 0.7,
  stream: false,     // Always non-streaming for eval
  groupId: evalId    // Tag for LMApi prompt history
});
```

### 4.9 `SummaryService.ts`

Pure computation — takes raw results, returns summary.

```typescript
class SummaryService {
  static computeSummary(
    evalId: string, matrix: EvalMatrixCell[],
    judgeResults: JudgeResult[], pairwise: PairwiseRanking[],
    config: EvaluationConfig, baselineId?: string
  ): EvaluationSummary

  static computeRegression(
    current: EvaluationSummary, baseline: EvaluationSummary
  ): EvaluationSummary['regression']

  static computeConsistency(cells: EvalMatrixCell[]): number
}
```

### 4.10 `ReportService.ts`

```typescript
class ReportService {
  static generateMarkdown(evalId: string): string
  static generateHtml(evalId: string): string
  static writeReports(evalId: string): void
}
```

HTML report template at `data/evals/templates/report-template.html` — fully self-contained (inline CSS, embedded JSON data, vanilla JS renderer). No external dependencies. Under 500KB.

---

## 5. Backend API Routes (`server/routes/`)

All routes are under `/api/eval/` and served by the Bun backend.

### 5.1 Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/templates` | List all eval templates (built-in + custom) |
| `GET` | `/api/eval/templates/:id` | Get a single template |
| `POST` | `/api/eval/templates` | Create a custom template |
| `PUT` | `/api/eval/templates/:id` | Update a custom template |
| `DELETE` | `/api/eval/templates/:id` | Delete a custom template |
| `POST` | `/api/eval/templates/generate` | AI-generate a template from a prompt |

### 5.2 Prompts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/prompts` | List all saved prompts |
| `GET` | `/api/eval/prompts/:id` | Get prompt manifest |
| `GET` | `/api/eval/prompts/:id/versions/:version` | Get version content |
| `POST` | `/api/eval/prompts` | Create a new prompt |
| `POST` | `/api/eval/prompts/:id/versions` | Add a new version |
| `GET` | `/api/eval/prompts/:id/diff?v1=1&v2=2` | Diff two versions |
| `PUT` | `/api/eval/prompts/:id/tools` | Update tool definitions |

### 5.3 Test Suites

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/test-suites` | List all test suites |
| `GET` | `/api/eval/test-suites/:id` | Get a test suite |
| `POST` | `/api/eval/test-suites` | Create a test suite |
| `PUT` | `/api/eval/test-suites/:id` | Update a test suite |
| `DELETE` | `/api/eval/test-suites/:id` | Delete a test suite |

### 5.4 Evaluations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/evaluations` | List evaluations (filter: `status`, `promptId`, `modelId`) |
| `GET` | `/api/eval/evaluations/:id` | Get evaluation config |
| `GET` | `/api/eval/evaluations/:id/results` | Get full results |
| `GET` | `/api/eval/evaluations/:id/summary` | Get aggregated summary |
| `POST` | `/api/eval/evaluations` | Create and start evaluation (returns 202, runs async) |
| `DELETE` | `/api/eval/evaluations/:id` | Cancel a running evaluation |
| `GET` | `/api/eval/evaluations/:id/export?format=html\|md` | Export report |
| `POST` | `/api/eval/evaluations/:id/baseline` | Save evaluation as baseline |

### 5.5 Models (Proxy to LMApi)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/models` | Fetch and return grouped model list from LMApi |

### 5.6 History & Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/prompts/:id/history` | Evaluation history timeline for a prompt |
| `GET` | `/api/eval/models/leaderboard` | Aggregate model rankings across evaluations |

---

## 6. WebSocket Server (`server/ws.ts`)

The eval backend runs its own WebSocket server for eval progress events. This is separate from LMApi's Socket.IO server.

Use Bun's native WebSocket support:

```typescript
const server = Bun.serve({
  port: 3200,
  fetch(req, server) {
    if (new URL(req.url).pathname === '/ws/eval') {
      server.upgrade(req);
      return;
    }
    // ... handle HTTP routes via Hono
  },
  websocket: {
    open(ws) { /* track connected client */ },
    close(ws) { /* cleanup */ },
    message(ws, msg) { /* handle subscriptions */ }
  }
});
```

### Event Types

```typescript
type EvalStreamEvent =
  | { type: 'cell:started'; evalId: string; cellId: string; modelId: string; testCaseId: string }
  | { type: 'cell:streaming'; evalId: string; cellId: string; partialContent: string; tokensGenerated: number }
  | { type: 'cell:completed'; evalId: string; cellId: string; metrics: EvalMatrixCell['metrics'] }
  | { type: 'cell:failed'; evalId: string; cellId: string; error: string }
  | { type: 'judge:started'; evalId: string; cellId: string; perspectiveId: string }
  | { type: 'judge:completed'; evalId: string; cellId: string; perspectiveId: string; score: number }
  | { type: 'eval:progress'; evalId: string; phase: number; totalPhases: number; completedCells: number; totalCells: number; elapsedMs: number }
  | { type: 'eval:completed'; evalId: string; summaryPath: string }
  | { type: 'eval:failed'; evalId: string; error: string };
```

All events include `evalId` so the frontend can filter for the active evaluation.

---

## 7. Frontend Architecture

### 7.1 State Management

Use React Context + `useReducer` for eval state. No external state library needed.

```typescript
// EvalContext.tsx
interface EvalState {
  // Config phase
  prompts: PromptTab[];
  selectedModels: string[];
  testCases: TestCase[];
  template: EvalTemplate | null;
  judgeConfig: JudgeConfig;

  // Execution phase
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress: EvalProgress;
  liveFeed: CompletedCell[];

  // Results phase
  results: EvaluationResults | null;
  summary: EvaluationSummary | null;
}
```

### 7.2 Layout (`App.tsx`)

Three-panel layout using CSS Grid + `ResizablePanel` component:

```
┌──────────────────────────────────────────────────────────┐
│  TopBar: Eval Name | Status | Matrix Badge | Actions     │
├────────────┬──────────────────┬───────────────────────────┤
│ LEFT       │ CENTER           │ RIGHT                     │
│ PromptPanel│ ConfigPanel /    │ ResultsPanel              │
│ (~35%)     │ ExecutionPanel   │ (~35%, expands on         │
│            │ (~30%)           │  completion)              │
├────────────┴──────────────────┴───────────────────────────┤
│  BottomBar: Cost | Progress | Quick Stats                 │
└──────────────────────────────────────────────────────────┘
```

### 7.3 Color Palette (Tailwind + CSS Custom Properties)

Defined in `src/index.css` and extended in `tailwind.config.ts`:

```css
:root {
  --bg-base:     #09090b;  /* zinc-950 */
  --bg-surface:  #18181b;  /* zinc-900 */
  --bg-elevated: #27272a;  /* zinc-800 */
  --border:      #3f3f46;  /* zinc-700 */
  --text-primary:   #f4f4f5;  /* zinc-100 */
  --text-secondary: #a1a1aa;  /* zinc-400 */
  --accent:      #f59e0b;  /* amber-500 */
  --accent-hover:#fbbf24;  /* amber-400 */
  --success:     #14b8a6;  /* teal-500 */
  --warning:     #f59e0b;  /* amber-500 */
  --error:       #f43f5e;  /* rose-500 */
  --info:        #0ea5e9;  /* sky-500 */
}
```

**Heatmap gradient**: `teal-600` → `amber-500` → `rose-500`

Typography: `JetBrains Mono` for prompt/code, `Inter` for UI.

### 7.4 Key Components

#### Left Panel — Prompt Input

| Component | Description |
|-----------|-------------|
| `PromptTabs` | Tab bar with add/remove. Color dot per tab. |
| `PromptEditor` | Monospace textarea. Input mode toggle: Editor / File / Saved. |
| `ToolDefinitionEditor` | Collapsible JSON editor with validate button. |
| `PromptDiff` | Unified diff view between two prompts/versions (calls `/api/eval/prompts/:id/diff`). |

#### Center Panel — Configuration

| Component | Description |
|-----------|-------------|
| `ModelSelector` | Grouped multi-select (by server/provider). Fetches from `/api/eval/models`. Search filter, "Select All Local" / "Clear". |
| `TestCaseEditor` | Quick mode (single textarea) + Suite mode (table with add/remove). |
| `TemplateSelector` | Dropdown + "Auto-Generate" button + inline editor for customization. |
| `JudgeConfig` | Judge model select, pairwise toggle, runs-per-cell input, perspective weight sliders. |
| `ExecutionPreview` | Matrix grid visualization + estimated tokens/time/cost. |

#### Center Panel — Execution Mode

| Component | Description |
|-----------|-------------|
| `ProgressDashboard` | Overall progress bar with ETA. |
| `ModelProgressRow` | Per-model: progress bar, avg latency, tokens/sec. |
| `LiveFeed` | Completed cells as cards with slide-in animation. Click to preview response. |

#### Right Panel — Results (5 tabs)

| Tab | Component | Description |
|-----|-----------|-------------|
| Scoreboard | `Scoreboard` + `HeatmapMatrix` | CSS Grid heatmap, model/prompt leaderboard cards, regression badges. |
| Compare | `CompareView` | Two dropdowns, side-by-side responses, pairwise verdict, diff toggle. |
| Details | `DetailView` | Full cell drill-down: response, tool calls, metrics, judge scores, "Why Did This Fail?" button. |
| Metrics | `MetricsView` | Canvas bar charts (latency, tokens/sec), compliance table, consistency chart. |
| Timeline | `TimelineView` | Canvas line chart: composite score over time per model. |

### 7.5 Hooks

```typescript
// useEvalSocket.ts — connects to eval backend WebSocket
function useEvalSocket(evalId: string | null) {
  // Returns: { progress, liveFeed, isCompleted, error }
  // Subscribes to ws://localhost:3200/ws/eval
  // Filters events by evalId
}

// useLmapiSocket.ts — connects to LMApi Socket.IO (optional, for metrics)
function useLmapiSocket() {
  // Returns: { serverStatuses, recentHistory }
  // Subscribes to LMApi's Socket.IO for server status updates
}

// useResizable.ts — panel resize logic
function useResizable(initialSizes: number[]) {
  // Returns: { sizes, onDragStart, panelRefs }
}
```

### 7.6 API Client (`src/api/`)

```typescript
// src/api/eval.ts — calls the eval backend
const evalApi = {
  templates: {
    list: () => get('/api/eval/templates'),
    get: (id: string) => get(`/api/eval/templates/${id}`),
    create: (data) => post('/api/eval/templates', data),
    update: (id, data) => put(`/api/eval/templates/${id}`, data),
    delete: (id) => del(`/api/eval/templates/${id}`),
    generate: (data) => post('/api/eval/templates/generate', data),
  },
  prompts: { /* similar */ },
  testSuites: { /* similar */ },
  evaluations: {
    list: (filters?) => get('/api/eval/evaluations', filters),
    get: (id) => get(`/api/eval/evaluations/${id}`),
    results: (id) => get(`/api/eval/evaluations/${id}/results`),
    summary: (id) => get(`/api/eval/evaluations/${id}/summary`),
    create: (config) => post('/api/eval/evaluations', config),
    cancel: (id) => del(`/api/eval/evaluations/${id}`),
    export: (id, format) => get(`/api/eval/evaluations/${id}/export?format=${format}`),
    saveBaseline: (id) => post(`/api/eval/evaluations/${id}/baseline`),
  },
  models: {
    list: () => get('/api/eval/models'),
  },
};

// src/api/lmapi.ts — direct calls to LMApi (for model discovery from frontend)
const lmapiApi = {
  servers: () => get(`${LMAPI_BASE_URL}/api/servers`),
  models: () => get(`${LMAPI_BASE_URL}/api/models`),
};
```

### 7.7 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Run Evaluation |
| `Ctrl+E` | Toggle Export menu |
| `Ctrl+1/2/3` | Focus panel 1/2/3 |
| `Ctrl+D` | Toggle diff view |
| `Esc` | Close modal/overlay |
| `Ctrl+S` | Save current prompt version |

---

## 8. Built-in Template Seeding

`scripts/seed-templates.ts` writes the four built-in templates to `data/evals/templates/` if they don't already exist. Run during first setup or call from server startup.

Templates (full content in Section 8 of `prompt-eval-system-plan.md`):
- `general-quality.json` — Accuracy, Completeness, Instruction Following, Conciseness
- `tool-calling.json` — Tool Selection, Argument Quality, Reasoning, Error Handling
- `code-generation.json` — Correctness, Code Quality, Completeness, Efficiency
- `instruction-following.json` — Explicit Instructions, Format Compliance, Constraint Adherence, No Hallucination

---

## 9. Report Template

`data/evals/templates/report-template.html` — self-contained HTML template with:
- Dark theme CSS matching the app palette (inline `<style>` tag).
- `{{EVAL_NAME}}` and `{{DATA}}` placeholders.
- Vanilla JS rendering: interactive sortable tables, heatmap matrix (CSS grid + background colors), expandable detail sections, basic tab navigation.
- No external dependencies. Works offline. Printable via `@media print`.
- Target: under 500KB for a typical evaluation.

---

## 10. Integration Tests (`scripts/`)

### `scripts/test-api.ts`

Run with `bun run scripts/test-api.ts`. Tests all CRUD operations:
1. Seed and list templates.
2. Create prompt → add version → diff.
3. Create test suite → add test cases.
4. Create evaluation → poll status → verify results.
5. Export as Markdown → verify content.
6. Save baseline → run second eval → verify regression.
7. Cleanup.

### `scripts/test-execution.ts`

End-to-end execution test with WebSocket client:
1. Connect WebSocket to `ws://localhost:3200/ws/eval`.
2. Create a minimal evaluation (1 prompt × 1 model × 1 test case).
3. Listen for `eval:completed` event.
4. Verify `results.json` and `summary.json`.

---

## 11. Key Technical Decisions

### 11.1 LMApi as External Service

The eval system communicates with LMApi exclusively via HTTP and Socket.IO. This means:
- The eval system can run on a different machine than LMApi.
- Multiple eval instances could share the same LMApi service.
- LMApi version upgrades don't require eval system changes (as long as the API contract holds).
- Eval completions compete with other LMApi traffic for server resources — this is intentional.

### 11.2 Non-Streaming for Eval Completions

All eval pipeline calls use `stream: false`. The full response is needed before running deterministic checks. This simplifies response handling. Streaming could be added later for real-time response preview in the UI.

### 11.3 Parallel Execution Limits

For large matrices (>50 cells), use a semaphore to batch concurrent requests:

```typescript
class Semaphore {
  constructor(private limit: number) {}
  private queue: (() => void)[] = [];
  private running = 0;
  async acquire(): Promise<void> { ... }
  release(): void { ... }
}

// Usage in ExecutionService:
const semaphore = new Semaphore(maxConcurrent);
await Promise.allSettled(matrix.map(async cell => {
  await semaphore.acquire();
  try { /* dispatch cell */ }
  finally { semaphore.release(); }
}));
```

The `maxConcurrent` default should be conservative (e.g., 8) to avoid overwhelming LMApi's queue.

### 11.4 File-Based Storage

All eval data is JSON/Markdown on disk. No database. The directory structure serves as the organizational layer. This keeps the project simple and makes evaluations portable (copy a directory to share).

### 11.5 Dual WebSocket Connections

The frontend maintains two optional real-time connections:
1. **Eval backend WS** (`ws://localhost:3200/ws/eval`) — eval progress events.
2. **LMApi Socket.IO** (`ws://localhost:3111`) — server status, per-request metrics.

The LMApi connection is optional — it provides bonus data (server load, model load times) but the eval system works without it.

---

## 12. Implementation Phases

### Phase 1 — Project Setup & Foundation

**Deliverables:**
- Scaffolded Bun + Vite + React + TypeScript project
- Tailwind CSS configured with eval color palette
- `server/index.ts` with Hono app running on port 3200
- Shared TypeScript types (`eval.ts`, `lmapi.ts`)
- `server/services/FileService.ts` + `LmapiClient.ts`
- `server/services/TemplateService.ts` + `PromptService.ts` + `TestSuiteService.ts`
- CRUD routes for templates, prompts, test suites
- Models proxy route (fetches from LMApi)
- Built-in template JSON files seeded
- `scripts/test-api.ts` passing

### Phase 2 — Evaluation Engine

**Deliverables:**
- `server/services/MetricsService.ts`
- `server/services/SummaryService.ts`
- `server/services/ExecutionService.ts` (Phases 1, 2, 4 — no judge)
- `server/ws.ts` — WebSocket server for eval events
- Evaluation CRUD + execution routes
- `scripts/test-execution.ts` passing

### Phase 3 — LLM Judge System

**Deliverables:**
- `server/services/JudgeService.ts` (rubric, pairwise, template generator, response parsing)
- `ExecutionService` Phase 3 complete
- `SummaryService` with judge score aggregation
- `POST /api/eval/templates/generate` route

### Phase 4 — Export & Baselines

**Deliverables:**
- `server/services/ReportService.ts`
- `data/evals/templates/report-template.html`
- Export, baseline, history, and leaderboard routes

### Phase 5 — Frontend: Config & Execution

**Deliverables:**
- Three-panel layout with resize
- Left panel: prompt editor, tabs, diff, tool definitions
- Center panel: model selector, test cases, template selector, judge config, execution preview
- Center panel execution mode: progress dashboard, live feed
- Top bar and bottom bar
- WebSocket hooks (`useEvalSocket`, `useLmapiSocket`)
- Keyboard shortcuts

### Phase 6 — Frontend: Results & Analysis

**Deliverables:**
- Scoreboard tab with heatmap matrix
- Compare tab with side-by-side viewer
- Details tab with full drill-down
- Metrics tab with Canvas charts
- Timeline tab with history chart
- "Why Did This Fail?" diagnostic button

### Phase 7 — Polish & Documentation

**Deliverables:**
- Error handling for partial eval failures
- Per-cell retry logic
- Accessibility pass (ARIA labels, keyboard navigation)
- Responsive layout (panel stacking on small screens)
- `README.md` with setup instructions, screenshots, API reference

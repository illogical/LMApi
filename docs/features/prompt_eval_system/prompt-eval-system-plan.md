# Prompt & Model Evaluation System — Implementation Plan

## 1. Overview

### 1.1 Purpose

A web-based evaluation system integrated into the existing LMAPI project (TypeScript, Bun, Vite, SQLite) that enables systematic comparison of LLM prompts and models. The system answers two core questions:

1. **Is prompt A better than prompt B?** — Compare prompt revisions against the same model(s) and test cases.
2. **Is model X better than model Y for this task?** — Compare model performance against the same prompt(s) and test cases.

### 1.2 Key Capabilities

- Run 1+ prompts across 1+ models with 1+ test cases (user messages), producing a full evaluation matrix.
- **Deterministic metrics**: format compliance, JSON schema validation, tool call correctness, response length, latency, token usage, and consistency across repeated runs.
- **LLM-as-Judge evaluation**: rubric-based scoring, pairwise comparison, and multi-perspective judging via parallel judge prompts.
- **Evaluation templates**: pre-built and custom rubrics, plus an AI-powered template generator that analyzes a prompt and proposes scoring dimensions.
- **Prompt versioning and diffing**, regression testing against saved baselines, and an evaluation history timeline.
- **Real-time execution monitoring** via LMAPI websocket integration.
- **Export** to self-contained HTML reports and Markdown.
- **Persistence** via JSON files (evaluation data) and Markdown files (reports and prompt history), stored on disk with SQLite used only for indexing/search if needed.

### 1.3 Architecture Context

- **Frontend**: Vite + TypeScript SPA, integrated into the existing LMAPI project.
- **Backend API**: Bun server, new `/api/eval/*` route namespace alongside existing LMAPI routes.
- **Model Access**: All model calls go through LMAPI's existing proxy (local Ollama + OpenRouter), using the OpenAI Completions API format.
- **Observability**: LMAPI's existing websocket implementation provides real-time token counts, latency, and server metadata — consumed by the eval dashboard during execution.
- **Storage**: File-based JSON + Markdown. No additional database tables required unless indexing needs arise later.

---

## 2. Data Model & Persistence

All evaluation data is stored as JSON files on disk. The directory structure acts as the organizational layer.

### 2.1 Directory Structure

```
lmapi/
└── data/
    └── evals/
        ├── templates/                    # Eval template definitions
        │   ├── general-quality.json
        │   ├── tool-calling.json
        │   ├── code-generation.json
        │   ├── instruction-following.json
        │   └── custom/                   # User-created templates
        │       └── my-agent-eval.json
        ├── prompts/                      # Versioned prompt storage
        │   └── {prompt-slug}/
        │       ├── manifest.json         # Prompt metadata, version history
        │       ├── v1.md                 # Prompt content (system prompt as Markdown)
        │       ├── v2.md
        │       └── tools.json            # Tool/function definitions (optional)
        ├── test-suites/                  # Reusable test case collections
        │   └── {suite-slug}.json
        ├── evaluations/                  # Completed evaluation runs
        │   └── {eval-id}/
        │       ├── config.json           # Evaluation configuration (what was run)
        │       ├── results.json          # Raw results (all responses, scores, metrics)
        │       ├── summary.json          # Aggregated scores, rankings, regression data
        │       ├── report.md             # Generated Markdown report
        │       └── report.html           # Generated self-contained HTML report
        └── baselines/                    # Saved baseline snapshots for regression
            └── {baseline-slug}.json
```

### 2.2 Core Data Types

#### EvalTemplate

```typescript
interface EvalTemplate {
  id: string;
  name: string;
  description: string;
  // Deterministic checks to run
  deterministicChecks: {
    formatCompliance: boolean;       // Did response match expected format?
    jsonSchemaValidation: boolean;   // Validate against a JSON schema
    jsonSchema?: object;             // The JSON schema to validate against (when enabled)
    toolCallValidation: boolean;     // Validate tool calls against tool definitions
    keywordPresence?: string[];      // Required keywords/phrases
    keywordAbsence?: string[];       // Forbidden keywords/phrases
    maxTokens?: number;              // Response length ceiling
    minTokens?: number;              // Response length floor
  };
  // LLM judge configuration
  judgeConfig: {
    enabled: boolean;
    model: string;                   // Model ID for the judge (e.g., "llama3.3:70b" or "openrouter/anthropic/claude-sonnet")
    perspectives: JudgePerspective[];
    pairwiseComparison: boolean;     // Enable pairwise ranking between responses
    runsPerCombination: number;      // Default: 1, set 3-5 for consistency measurement
  };
  // Optional reference/ground truth
  referenceAnswer?: string;
  referenceCriteria?: string[];      // Key points the response should cover
  createdAt: string;
  updatedAt: string;
}

interface JudgePerspective {
  id: string;
  name: string;                      // e.g., "Accuracy", "Instruction Following", "Conciseness"
  description: string;               // What this perspective evaluates
  weight: number;                    // Weight in composite score (0-1, all weights should sum to 1)
  systemPrompt: string;              // The judge's system prompt for this perspective
  scoringScale: {
    min: number;                     // Typically 1
    max: number;                     // Typically 5
    labels: Record<number, string>;  // e.g., { 1: "Poor", 3: "Adequate", 5: "Excellent" }
  };
}
```

#### PromptVersion

```typescript
interface PromptManifest {
  id: string;
  slug: string;
  name: string;
  description?: string;
  currentVersion: number;
  versions: PromptVersionMeta[];
  toolDefinitions?: ToolDefinition[];  // OpenAI-format tool/function schemas
  createdAt: string;
  updatedAt: string;
}

interface PromptVersionMeta {
  version: number;
  notes?: string;                     // What changed in this version
  filePath: string;                   // Relative path to the .md file
  createdAt: string;
  tokenEstimate?: number;             // Approximate token count
}

// Tool definitions follow OpenAI function calling format
interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object;               // JSON Schema for parameters
  };
}
```

#### TestSuite

```typescript
interface TestSuite {
  id: string;
  slug: string;
  name: string;
  description?: string;
  testCases: TestCase[];
  createdAt: string;
  updatedAt: string;
}

interface TestCase {
  id: string;
  name: string;                       // Short label for display
  userMessage: string;                // The user message to send
  expectedToolCalls?: ExpectedToolCall[];  // Optional: expected tool usage
  referenceAnswer?: string;           // Optional: ground truth for this specific case
  tags?: string[];                    // For filtering/grouping
}

interface ExpectedToolCall {
  functionName: string;
  requiredArgs?: string[];            // Argument names that must be present
  argSchema?: object;                 // JSON Schema for argument validation
  order?: number;                     // Expected position in the call sequence
}
```

#### Evaluation

```typescript
interface EvaluationConfig {
  id: string;
  name: string;
  templateId: string;
  promptVersions: {                   // 1 or more prompts being evaluated
    promptId: string;
    version: number;
  }[];
  models: string[];                   // Model IDs from LMAPI
  testSuiteId?: string;              // Reference to a saved test suite
  inlineTestCases?: TestCase[];       // Or ad-hoc test cases
  judgeConfig: EvalTemplate["judgeConfig"];
  toolDefinitions?: ToolDefinition[];
  createdAt: string;
  status: "pending" | "running" | "completed" | "failed";
  baselineId?: string;               // Compare against a saved baseline
}

interface EvaluationResults {
  evalId: string;
  matrix: EvalMatrixCell[];           // One entry per prompt × model × testCase × run
  judgeResults: JudgeResult[];        // One per judgment made
  pairwiseRankings?: PairwiseRanking[];
  completedAt: string;
}

interface EvalMatrixCell {
  id: string;
  promptId: string;
  promptVersion: number;
  modelId: string;
  testCaseId: string;
  runNumber: number;
  // Response data
  response: {
    content: string;
    toolCalls?: ToolCallResult[];
    finishReason: string;
  };
  // Deterministic metrics
  metrics: {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    tokensPerSecond: number;
    timeToFirstTokenMs?: number;
    serverName: string;               // From LMAPI
    formatCompliant: boolean | null;
    jsonSchemaValid: boolean | null;
    jsonSchemaErrors?: string[];
    toolCallsValid: boolean | null;
    toolCallErrors?: string[];
    keywordsPresent?: Record<string, boolean>;
    keywordsAbsent?: Record<string, boolean>;
    tokenCount: number;
  };
}

interface ToolCallResult {
  functionName: string;
  arguments: object;
  valid: boolean;
  errors?: string[];
}

interface JudgeResult {
  cellId: string;                     // Which matrix cell was judged
  perspectiveId: string;
  judgeModel: string;
  score: number;
  justification: string;
  durationMs: number;
}

interface PairwiseRanking {
  cellIdA: string;
  cellIdB: string;
  winnerId: string;                   // Which cell was judged better
  justification: string;
  judgeModel: string;
}

interface EvaluationSummary {
  evalId: string;
  // Per-model aggregate scores
  modelRankings: {
    modelId: string;
    compositeScore: number;           // Weighted average across all perspectives
    perspectiveScores: Record<string, number>;
    deterministicPassRate: number;     // % of deterministic checks passed
    avgLatencyMs: number;
    avgTokensPerSecond: number;
    consistencyScore?: number;        // Variance across runs (lower = more consistent)
  }[];
  // Per-prompt aggregate scores
  promptRankings: {
    promptId: string;
    version: number;
    compositeScore: number;
    perspectiveScores: Record<string, number>;
  }[];
  // Regression data (if baseline provided)
  regression?: {
    baselineId: string;
    improved: string[];               // Metric names that improved
    regressed: string[];              // Metric names that regressed
    unchanged: string[];
    details: Record<string, { before: number; after: number; delta: number }>;
  };
  generatedAt: string;
}
```

---

## 3. API Endpoints

All new endpoints live under `/api/eval/`. They follow REST conventions and return JSON.

### 3.1 Templates

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/templates` | List all eval templates (built-in + custom) |
| `GET` | `/api/eval/templates/:id` | Get a single template |
| `POST` | `/api/eval/templates` | Create a custom template |
| `PUT` | `/api/eval/templates/:id` | Update a custom template |
| `DELETE` | `/api/eval/templates/:id` | Delete a custom template |
| `POST` | `/api/eval/templates/generate` | AI-generate a template from a prompt (sends prompt to an LLM that returns a proposed template) |

### 3.2 Prompts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/prompts` | List all saved prompts |
| `GET` | `/api/eval/prompts/:id` | Get prompt manifest with version history |
| `GET` | `/api/eval/prompts/:id/versions/:version` | Get a specific prompt version content |
| `POST` | `/api/eval/prompts` | Create a new prompt (first version) |
| `POST` | `/api/eval/prompts/:id/versions` | Add a new version to an existing prompt |
| `GET` | `/api/eval/prompts/:id/diff?v1=1&v2=2` | Get a diff between two versions |
| `PUT` | `/api/eval/prompts/:id/tools` | Update tool/function definitions for a prompt |

### 3.3 Test Suites

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/test-suites` | List all test suites |
| `GET` | `/api/eval/test-suites/:id` | Get a test suite with all cases |
| `POST` | `/api/eval/test-suites` | Create a new test suite |
| `PUT` | `/api/eval/test-suites/:id` | Update a test suite |
| `DELETE` | `/api/eval/test-suites/:id` | Delete a test suite |

### 3.4 Evaluations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/evaluations` | List all evaluations (with filters: status, prompt, model) |
| `GET` | `/api/eval/evaluations/:id` | Get evaluation config |
| `GET` | `/api/eval/evaluations/:id/results` | Get full results |
| `GET` | `/api/eval/evaluations/:id/summary` | Get aggregated summary |
| `POST` | `/api/eval/evaluations` | Create and start a new evaluation run |
| `POST` | `/api/eval/evaluations/:id/cancel` | Cancel a running evaluation |
| `GET` | `/api/eval/evaluations/:id/export?format=html` | Export report (html or md) |
| `POST` | `/api/eval/evaluations/:id/baseline` | Save this evaluation as a baseline |

### 3.5 Execution (WebSocket)

| Path | Description |
|------|-------------|
| `ws://.../api/eval/evaluations/:id/stream` | Real-time execution updates. Emits events: `cell:started`, `cell:streaming`, `cell:completed`, `judge:started`, `judge:completed`, `eval:progress` (overall %), `eval:completed` |

### 3.6 Models (delegates to existing LMAPI)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/models` | Proxy to LMAPI's model list endpoint. Returns all available models grouped by server/provider, with metadata (parameter count, quantization, context window). |

### 3.7 History & Analytics

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/eval/prompts/:id/history` | Get evaluation history timeline for a prompt (all evaluations that included this prompt, with scores over time) |
| `GET` | `/api/eval/models/leaderboard` | Aggregate model rankings across all evaluations |

---

## 4. Evaluation Execution Pipeline

When the user clicks "Run Evaluation", the backend executes this pipeline:

### 4.1 Phase 1 — Matrix Construction

1. Parse the evaluation config: expand all prompt × model × testCase × run combinations.
2. Estimate cost: calculate approximate input tokens (system prompt + user message + tool defs) per cell, multiply by model count and run count. Report estimated total tokens and wall-clock time.
3. Create the evaluation record on disk (`config.json`), set status to `running`.

### 4.2 Phase 2 — Completion Execution

1. For each cell in the matrix, construct the OpenAI-format request:
   - `messages`: `[{ role: "system", content: <prompt> }, { role: "user", content: <testCase.userMessage> }]`
   - `tools`: tool definitions from the prompt (if any)
   - `model`: the target model ID
2. Dispatch all cells to LMAPI in parallel (LMAPI handles load balancing across Ollama servers).
3. As each response arrives, populate the `EvalMatrixCell` with the response content and tool calls.
4. Run deterministic metrics on each completed cell:
   - JSON Schema validation (if enabled in template): validate `response.content` or `toolCalls` arguments against the configured schema using a JSON Schema validation library (e.g., `ajv`).
   - Tool call validation: check function names against defined tools, validate argument schemas, check call sequence against expected order.
   - Keyword checks, token counts, format compliance.
5. Emit `cell:completed` websocket events with metrics attached.

### 4.3 Phase 3 — LLM Judge Evaluation

1. For each judge perspective in the template:
   - For each completed matrix cell, construct a judge prompt:
     ```
     System: <perspective.systemPrompt>
     User: 
     ## Original Prompt
     <the system prompt being evaluated>
     
     ## User Input
     <the test case user message>
     
     ## Response to Evaluate
     <the model's response>
     
     ## Reference Criteria (if provided)
     <reference answer or criteria>
     
     ## Scoring Instructions
     Score this response on a scale of <min> to <max> for <perspective.name>.
     <scale labels>
     
     Respond with JSON:
     { "score": <number>, "justification": "<string>" }
     ```
   - Dispatch all judge calls in parallel via LMAPI.
   - Parse responses, populate `JudgeResult` records.
2. If pairwise comparison is enabled:
   - Generate all unique pairs of cells for the same testCase.
   - For each pair, construct a pairwise judge prompt showing both responses (randomize order to reduce position bias).
   - Dispatch and collect `PairwiseRanking` results.
3. Emit `judge:completed` events.

### 4.4 Phase 4 — Aggregation & Summary

1. Compute per-cell composite scores (weighted average of perspective scores).
2. Aggregate per-model: average composite across all prompts × testCases × runs.
3. Aggregate per-prompt: average composite across all models × testCases × runs.
4. If a baseline is linked, compute regression deltas for every metric.
5. If consistency runs > 1, compute variance metrics.
6. Write `results.json` and `summary.json`.
7. Emit `eval:completed`.

### 4.5 Phase 5 — Report Generation

1. Generate `report.md` using a Markdown template populated from `summary.json`.
2. Generate `report.html` as a self-contained file:
   - Inline CSS (dark theme matching the app aesthetic).
   - Embed `summary.json` as a `<script>` data blob.
   - Inline JS that renders the data into tables, charts, and comparison views.
   - No external dependencies — the HTML file is fully portable.

---

## 5. Eval Template Auto-Generation

When the user clicks "Generate Eval Criteria" with a loaded prompt:

### 5.1 Generator Agent Prompt

```
You are an evaluation design specialist. Analyze the provided system prompt and generate a structured evaluation template.

## System Prompt to Analyze
<the user's prompt>

## Tool Definitions (if any)
<tool schemas>

## Your Task
1. Identify the key behaviors this prompt is trying to elicit.
2. Propose 4-6 scoring dimensions (judge perspectives) with:
   - Name, description, weight (must sum to 1.0)
   - A specific rubric description for each score level (1-5)
3. Identify which deterministic checks are applicable:
   - Does this prompt expect structured output (JSON, XML, specific format)?
   - Does it use tool calling? If so, what are the expected tool usage patterns?
   - Are there keywords that should or shouldn't appear?
4. Suggest 3-5 test cases (user messages) that would effectively exercise this prompt.

Respond with JSON matching this schema:
<EvalTemplate JSON Schema>
```

### 5.2 User Workflow

1. User loads a prompt.
2. Clicks "Auto-Generate Evaluation Template."
3. System sends the prompt to the configured generator model.
4. Proposed template is displayed in an editable preview.
5. User refines weights, adds/removes perspectives, adjusts rubrics.
6. User saves as a custom template.

---

## 6. Frontend — Page Layout & UX

### 6.1 Color Palette

| Role | Token | Hex | Usage |
|------|-------|-----|-------|
| Background (base) | `zinc-950` | `#09090b` | Page background |
| Surface | `zinc-900` | `#18181b` | Cards, panels |
| Surface elevated | `zinc-800` | `#27272a` | Hover states, nested panels |
| Border | `zinc-700` | `#3f3f46` | Dividers, input borders |
| Text primary | `zinc-100` | `#f4f4f5` | Headings, primary content |
| Text secondary | `zinc-400` | `#a1a1aa` | Labels, descriptions |
| Accent primary | `amber-500` | `#f59e0b` | Primary actions, highlights, active tabs |
| Accent primary hover | `amber-400` | `#fbbf24` | Button hover states |
| Success / high score | `teal-500` | `#14b8a6` | Pass indicators, high scores |
| Warning / mid score | `amber-500` | `#f59e0b` | Medium scores, caution states |
| Error / low score | `rose-500` | `#f43f5e` | Fail indicators, low scores, errors |
| Info / neutral accent | `sky-500` | `#0ea5e9` | Links, informational badges |

**Heatmap gradient** (for the results matrix): `teal-600` → `amber-500` → `rose-500`

**Typography**: monospace for prompt content and code (`JetBrains Mono` or `Fira Code`), sans-serif for UI (`Inter`).

### 6.2 Layout Structure

The page uses a **three-panel layout** that transitions through workflow phases:

```
┌─────────────────────────────────────────────────────────────────┐
│  Top Bar: Eval Name │ Status │ Matrix Badge │ Actions           │
├────────────────┬──────────────────┬─────────────────────────────┤
│                │                  │                             │
│  LEFT PANEL    │  CENTER PANEL    │  RIGHT PANEL                │
│  Prompt Input  │  Config &        │  Results &                  │
│  (~35%)        │  Execution       │  Analysis                   │
│                │  (~30%)          │  (~35%, expands on          │
│                │                  │   completion)               │
│                │                  │                             │
├────────────────┴──────────────────┴─────────────────────────────┤
│  Bottom Bar: Cost Estimate │ Progress │ Quick Stats             │
└─────────────────────────────────────────────────────────────────┘
```

All three panels are resizable via drag handles and independently scrollable. Each panel is collapsible — when results are ready, the user can collapse the left and center panels to give the results panel full width.

### 6.3 Panel Details

#### Top Bar

- **Eval Name**: inline-editable text field, auto-generated from the prompt name + timestamp if not set.
- **Status Indicator**: animated dot — gray (idle), pulsing amber (running), teal (completed), rose (failed).
- **Matrix Badge**: e.g., "2P × 3M × 4T × 1R = 24 completions" — updates live as config changes.
- **Actions**: "Run Evaluation" (amber primary button), "Export" (dropdown: HTML / Markdown), "Save as Baseline", "Load Previous Eval" (opens a selection modal).

#### Left Panel — Prompt Input

- **Tab Bar**: horizontal tabs for each loaded prompt: "Prompt A", "Prompt B", "+ Add" button. Each tab shows a colored dot for identification in the results matrix.
- **Input Mode Toggle**: three options per prompt tab:
  - **Editor**: inline textarea with monospace font, basic Markdown syntax highlighting. This is the default.
  - **File**: file picker or a text input for a filesystem path. On load, content populates the editor.
  - **Saved**: dropdown of saved prompts from `data/evals/prompts/`, with version selector.
- **Prompt Content Area**: the editor itself. Large, resizable. Supports copy/paste of large prompts.
- **Prompt Metadata Bar** (below editor): version notes input, token count estimate (updated on edit), "Save Version" button.
- **Tool Definitions Section** (collapsible): JSON editor for tool/function schemas. "Load from file" option. Validate button that checks JSON Schema validity.
- **Diff View Toggle**: when 2+ prompts are loaded, a toggle button switches to a side-by-side or unified diff view between any two prompts/versions. Use a lightweight diff library (e.g., `diff` npm package) to compute and render changes.

#### Center Panel — Configuration & Execution

**Configuration Mode** (before running):

- **Model Selector**: 
  - Fetch from `/api/eval/models`. 
  - Display as a searchable, filterable multi-select list.
  - Group by provider/server (e.g., "Ollama — workstation-1", "Ollama — workstation-2", "OpenRouter").
  - Show model metadata: parameter size, quantization level, context window.
  - "Select All Local" / "Clear" convenience buttons.
  - Selected models appear as removable chips above the list.

- **Test Cases Section**:
  - "Quick Test" mode: single user message textarea for simple evaluations.
  - "Test Suite" mode: load a saved test suite or create inline test cases.
  - Each test case: name, user message, optional expected tool calls, optional reference answer.
  - "Add Test Case" button, drag-to-reorder, bulk import from JSON.

- **Eval Template Selector**:
  - Dropdown showing built-in templates + custom templates.
  - "Auto-Generate from Prompt" button (amber outlined) — runs the template generator agent.
  - "Customize" button — opens template editor inline (edit perspectives, weights, deterministic checks).
  - Preview of active template: list of enabled deterministic checks and judge perspectives with weights.

- **Judge Configuration**:
  - Judge model selector (single select from available models — suggest the most capable available).
  - Toggle for pairwise comparison (on/off).
  - Runs per combination (number input, default 1, max 10).
  - Toggle each judge perspective on/off, adjust weights with sliders.

- **Execution Preview**:
  - Matrix visualization: a small grid showing prompt × model × testCase dimensions.
  - Estimated metrics: total completions, estimated tokens (input + output), estimated time, estimated cost (if using OpenRouter models).
  - Warning indicators if the matrix is very large (e.g., >50 completions).

**Execution Mode** (while running):

The configuration section collapses into a compact summary, and a **Live Progress Dashboard** takes over:

- Overall progress bar with percentage and ETA.
- Per-model row showing: model name, progress bar (completions done / total), average latency so far, tokens/second.
- Live-updating completion feed: each completed cell appears as a compact card showing model, test case, and a pass/fail indicator for deterministic checks. Click to preview the response.
- Judge progress section (appears after Phase 2 completes): similar per-perspective progress bars.

#### Right Panel — Results & Analysis

**Empty state** (before first run): displays a helpful illustration/message: "Configure your evaluation and click Run to see results here." Could also show recent evaluation history as clickable cards.

**After completion**, the panel populates with tabbed sub-views:

- **Tab: Scoreboard** (default view)
  - **Heatmap Matrix Table**: rows = prompts × test cases, columns = models. Each cell shows the composite score (1.0–5.0) with background color from the heatmap gradient. Hover shows a tooltip with per-perspective breakdown. Click opens the detail view for that cell.
  - **Model Leaderboard**: ranked cards for each model showing composite score, deterministic pass rate, average latency, tokens/second. The top model gets a subtle teal border accent.
  - **Prompt Leaderboard**: same format but ranking prompts.
  - **Regression Badge** (if baseline set): a prominent banner showing improvements/regressions with delta indicators (teal up-arrows, rose down-arrows).

- **Tab: Compare**
  - Side-by-side response viewer. Two dropdowns to select any two prompt × model × testCase cells.
  - Left and right columns show the full response, with tool calls rendered as structured cards.
  - Below the responses: the judge's pairwise comparison verdict and justification.
  - Inline diff mode: toggle to highlight differences between the two responses.

- **Tab: Details**
  - Full drill-down for a single matrix cell.
  - Sections: raw response, tool calls (with pass/fail per call), deterministic metrics table, per-perspective judge scores with justifications, latency/token breakdown.
  - "Why Did This Fail?" button (if score is low): sends the prompt + response + rubric to a judge with a diagnostic prompt, returns specific improvement suggestions.

- **Tab: Metrics**
  - Deterministic metrics dashboard.
  - Bar charts: latency by model, tokens/second by model, token usage by model.
  - Format compliance table: per-cell pass/fail for each deterministic check.
  - If consistency runs > 1: variance chart showing score distribution per model.

- **Tab: Timeline** (visible when viewing a prompt with evaluation history)
  - Line chart showing composite scores over time (x-axis: evaluation date, y-axis: score).
  - One line per model. Hover to see evaluation details.
  - Markers for prompt version changes along the x-axis.

#### Bottom Bar

- **Cost Ticker**: running total of tokens consumed (input/output), estimated cost.
- **Progress Summary**: "Phase 2/4 — 18/24 completions done" or "Complete — 24/24."
- **Quick Stats** (after completion): best model, best prompt, highest/lowest score.

### 6.4 UX Interactions & Animations

- **Panel resizing**: smooth drag handles between panels. Double-click a handle to collapse/expand.
- **Phase transitions**: when execution starts, the center panel smoothly transitions from config to progress mode. When complete, the right panel smoothly expands.
- **Score cells in heatmap**: subtle scale-up on hover (1.02×), smooth color transitions.
- **Live progress**: cell completion cards slide in from the top of the feed with a brief fade-in.
- **Diff view**: additions highlighted with teal background, deletions with rose background, using standard diff conventions.
- **Tab transitions**: content crossfades, no layout shift.
- **Tooltips**: appear on hover after a short delay (200ms), positioned intelligently to avoid overflow.

### 6.5 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Run Evaluation |
| `Ctrl+E` | Toggle Export menu |
| `Ctrl+1/2/3` | Switch to panel 1/2/3 |
| `Ctrl+D` | Toggle diff view (when 2+ prompts loaded) |
| `Esc` | Close any open modal/overlay |
| `Ctrl+S` | Save current prompt version |

---

## 7. Export System

### 7.1 Markdown Report

Generated from a template using the summary data. Structure:

```markdown
# Evaluation Report: {eval name}
**Date**: {date} | **Prompts**: {count} | **Models**: {count} | **Test Cases**: {count}

## Summary
{narrative summary of findings — which model/prompt won and by how much}

## Model Rankings
| Rank | Model | Composite | Accuracy | Instruction Following | ... | Latency |
...

## Prompt Rankings
| Rank | Prompt | Version | Composite | ... |
...

## Regression Analysis (if applicable)
{delta table vs baseline}

## Detailed Results
### {Model Name} × {Prompt Name}
**Test Case: {name}**
- Score: {composite} | Deterministic: {pass/fail}
- Response summary: {truncated response}
- Judge notes: {key justification excerpts}
...
```

### 7.2 HTML Report

A self-contained `.html` file:

- All CSS inline in a `<style>` tag (dark theme matching app palette).
- Evaluation data embedded as `<script>const DATA = { ... };</script>`.
- Vanilla JS that renders: interactive sortable tables, the heatmap matrix (using CSS grid + background colors), expandable detail sections, basic tab navigation.
- No external dependencies. Works offline. Printable.
- Target: under 500KB for a typical evaluation.

### 7.3 HTML Report Template Location

Store the HTML report template at `data/evals/templates/report-template.html`. This template uses placeholder tokens (e.g., `{{DATA}}`, `{{EVAL_NAME}}`) that the backend replaces during generation. This makes it easy to iterate on the report design independently.

---

## 8. Built-in Eval Templates

### 8.1 General Quality

```json
{
  "name": "General Quality",
  "deterministicChecks": { "formatCompliance": false, "jsonSchemaValidation": false, "toolCallValidation": false },
  "judgeConfig": {
    "perspectives": [
      { "name": "Accuracy", "weight": 0.3, "description": "Factual correctness and reliability of information" },
      { "name": "Completeness", "weight": 0.25, "description": "Whether all aspects of the query were addressed" },
      { "name": "Instruction Following", "weight": 0.25, "description": "Adherence to explicit instructions in the prompt" },
      { "name": "Conciseness", "weight": 0.2, "description": "Appropriate brevity without sacrificing clarity" }
    ]
  }
}
```

### 8.2 Tool Calling

```json
{
  "name": "Tool Calling Accuracy",
  "deterministicChecks": { "formatCompliance": true, "jsonSchemaValidation": true, "toolCallValidation": true },
  "judgeConfig": {
    "perspectives": [
      { "name": "Tool Selection", "weight": 0.35, "description": "Did the model choose the correct tool(s) for the task?" },
      { "name": "Argument Quality", "weight": 0.3, "description": "Were tool arguments well-formed, complete, and appropriate?" },
      { "name": "Reasoning", "weight": 0.2, "description": "Did the model explain its tool usage decisions clearly?" },
      { "name": "Error Handling", "weight": 0.15, "description": "Does the model handle edge cases and potential tool failures?" }
    ]
  }
}
```

### 8.3 Code Generation

```json
{
  "name": "Code Generation Quality",
  "deterministicChecks": { "formatCompliance": true, "jsonSchemaValidation": false, "toolCallValidation": false },
  "judgeConfig": {
    "perspectives": [
      { "name": "Correctness", "weight": 0.35, "description": "Would this code work as intended?" },
      { "name": "Code Quality", "weight": 0.25, "description": "Readability, naming, structure, and best practices" },
      { "name": "Completeness", "weight": 0.2, "description": "Does the code handle all specified requirements?" },
      { "name": "Efficiency", "weight": 0.2, "description": "Algorithmic efficiency and resource usage" }
    ]
  }
}
```

### 8.4 Instruction Following (Strict)

```json
{
  "name": "Instruction Following (Strict)",
  "deterministicChecks": { "formatCompliance": true, "jsonSchemaValidation": false, "toolCallValidation": false },
  "judgeConfig": {
    "perspectives": [
      { "name": "Explicit Instructions", "weight": 0.4, "description": "Were all explicit instructions in the prompt followed?" },
      { "name": "Format Compliance", "weight": 0.3, "description": "Does the output match the requested format exactly?" },
      { "name": "Constraint Adherence", "weight": 0.2, "description": "Were length limits, tone requirements, and other constraints respected?" },
      { "name": "No Hallucination", "weight": 0.1, "description": "Did the model avoid adding unrequested information?" }
    ]
  }
}
```

---

## 9. Implementation Phases

### Phase 1 — Foundation (Core Data & API)

**Goal**: File-based persistence, CRUD endpoints, and the data model working end-to-end.

- [ ] Create the `data/evals/` directory structure and seed with built-in templates.
- [ ] Implement TypeScript interfaces for all data types (Section 2.2).
- [ ] Build file I/O utility layer: read/write JSON, read/write Markdown, directory listing, slug generation.
- [ ] Implement API endpoints for Templates CRUD (Section 3.1).
- [ ] Implement API endpoints for Prompts CRUD with versioning (Section 3.2).
- [ ] Implement API endpoints for Test Suites CRUD (Section 3.3).
- [ ] Implement prompt diff endpoint using a diff library.
- [ ] Implement the `/api/eval/models` proxy endpoint.
- [ ] Write validation logic: JSON Schema validation (via `ajv`), tool call validation functions.
- [ ] **Verification**: API integration tests for all CRUD operations, round-trip JSON read/write tests.

### Phase 2 — Evaluation Engine (Execution Pipeline)

**Goal**: The core evaluation pipeline runs end-to-end — prompts dispatched to models, deterministic metrics collected, results stored.

- [ ] Implement evaluation matrix construction (Phase 4.1).
- [ ] Implement the completion dispatch system: construct OpenAI-format requests, send to LMAPI in parallel, collect responses.
- [ ] Implement deterministic metrics collection (Phase 4.2, step 4): JSON schema validation, tool call validation, keyword checks, token/latency metrics.
- [ ] Implement the WebSocket stream endpoint for real-time progress (Section 3.5). Integrate with LMAPI's existing websocket data for per-completion metrics.
- [ ] Implement results aggregation and summary generation (Phase 4.4).
- [ ] Store `config.json`, `results.json`, and `summary.json` on completion.
- [ ] Implement evaluation listing and status endpoints.
- [ ] **Verification**: End-to-end test — create an evaluation via API, run it, verify results JSON matches expected structure. Test with tool-calling prompts.

### Phase 3 — LLM Judge System

**Goal**: LLM-based evaluation working with rubric scoring and pairwise comparison.

- [ ] Implement judge prompt construction for rubric-based scoring (Phase 4.3, step 1).
- [ ] Implement judge prompt construction for pairwise comparison (Phase 4.3, step 2).
- [ ] Implement judge response parsing (extract scores and justifications from JSON responses, with fallback parsing for non-JSON responses).
- [ ] Implement composite score calculation (weighted perspective averages).
- [ ] Integrate judge results into the aggregation pipeline.
- [ ] Implement the eval template auto-generation agent (Section 5).
- [ ] Update summary generation to include judge scores.
- [ ] **Verification**: Run a judge evaluation, verify scores are within expected ranges, verify pairwise rankings are consistent.

### Phase 4 — Frontend: Prompt Input & Configuration

**Goal**: The left and center panels fully functional — user can load prompts, select models, configure an evaluation, and see the execution preview.

- [ ] Set up the eval page route in the Vite app, implement the three-panel resizable layout.
- [ ] Apply the color palette and typography (Section 6.1). Set up CSS custom properties for theming.
- [ ] Build the Left Panel:
  - [ ] Prompt tab bar with add/remove.
  - [ ] Prompt editor (monospace textarea with basic formatting).
  - [ ] File load / paste path / saved prompt selector input modes.
  - [ ] Prompt metadata bar (version notes, token estimate, save button).
  - [ ] Tool definitions JSON editor (collapsible section).
  - [ ] Diff view toggle between two prompts.
- [ ] Build the Center Panel:
  - [ ] Model selector (fetch from API, searchable multi-select, grouped by provider).
  - [ ] Test case section (quick single message + full test suite mode).
  - [ ] Eval template selector with preview.
  - [ ] Judge configuration controls.
  - [ ] Execution preview matrix + cost estimate.
- [ ] Build the Top Bar: eval name, status indicator, matrix badge, action buttons.
- [ ] Build the Bottom Bar: cost ticker, progress summary, quick stats.
- [ ] Implement keyboard shortcuts (Section 6.5).
- [ ] **Verification**: Load the page, create a multi-prompt × multi-model evaluation config, verify the execution preview is correct. Build an HTML test harness that exercises all input modes.

### Phase 5 — Frontend: Execution & Results

**Goal**: Real-time execution monitoring and the full results panel.

- [ ] Implement the WebSocket client for execution streaming.
- [ ] Build the Live Progress Dashboard (center panel execution mode):
  - [ ] Overall progress bar.
  - [ ] Per-model progress rows.
  - [ ] Live completion feed with slide-in animations.
  - [ ] Judge progress section.
- [ ] Build the Right Panel results tabs:
  - [ ] **Scoreboard**: heatmap matrix table, model leaderboard, prompt leaderboard, regression badges.
  - [ ] **Compare**: side-by-side response viewer with dropdown selectors, tool call cards, diff toggle.
  - [ ] **Details**: full cell drill-down with all metrics, judge scores, justifications, "Why Did This Fail?" button.
  - [ ] **Metrics**: deterministic dashboard with bar charts (latency, tokens/sec), compliance table, consistency charts.
  - [ ] **Timeline**: evaluation history line chart for a prompt over time.
- [ ] Implement tab transitions and UX animations (Section 6.4).
- [ ] **Verification**: Run a full evaluation from the UI, verify all panels update correctly, verify results match API data. Test with both single-prompt and multi-prompt evaluations.

### Phase 6 — Export, Baselines & Regression

**Goal**: Export system, baseline management, and regression testing.

- [ ] Implement Markdown report generation from summary data (Section 7.1).
- [ ] Build the HTML report template (Section 7.2–7.3). Inline CSS + vanilla JS rendering.
- [ ] Implement export API endpoints.
- [ ] Implement baseline save/load (Section 3.4 baseline endpoint).
- [ ] Implement regression comparison logic: delta calculation, improved/regressed/unchanged classification.
- [ ] Integrate regression data into the Scoreboard tab (regression badges, delta indicators).
- [ ] Implement the evaluation history timeline data endpoint (Section 3.7).
- [ ] Wire the Timeline tab to the history endpoint.
- [ ] **Verification**: Export an evaluation as both HTML and Markdown, verify the HTML report opens standalone in a browser with correct rendering. Save a baseline, run a modified eval, verify regression report accuracy.

### Phase 7 — Polish & Advanced Features

**Goal**: UX refinement and nice-to-haves.

- [ ] "Why Did This Fail?" diagnostic agent: implement the diagnostic prompt, wire the button in the Details tab.
- [ ] Model ELO leaderboard: implement running ELO calculation across evaluations.
- [ ] Bulk operations: re-run an evaluation with different models, clone an evaluation with a modified prompt.
- [ ] Prompt library: a modal/page for browsing saved prompts with search and tags.
- [ ] Test suite library: similar browsing UI for test suites.
- [ ] Accessibility pass: keyboard navigation, ARIA labels, screen reader support.
- [ ] Responsive layout: ensure the three-panel layout degrades gracefully on smaller screens (stack panels vertically).
- [ ] Error handling: graceful failure for individual cell completions (don't abort the whole evaluation), retry logic, timeout handling.
- [ ] **Verification**: Full end-to-end walkthrough of the happy path. Edge case testing: no models selected, empty prompt, all cells fail, single model/single prompt evaluation, very large matrix.

---

## 10. Key Technical Decisions & Notes

### 10.1 JSON Schema Validation

Use the `ajv` library (Already JSON Validator) for runtime JSON Schema validation. It supports draft-07 and later, covers all the validation needs for tool call arguments and structured output validation. Install as a project dependency.

### 10.2 Diff Computation

Use the `diff` npm package for computing text diffs between prompt versions. Render as a unified or side-by-side diff with teal (additions) and rose (deletions) highlighting.

### 10.3 Judge Prompt Robustness

Judge prompts must request JSON output and the parser must handle cases where the judge model wraps its response in markdown code fences or adds preamble text. Implement a `parseJudgeResponse` utility that:
1. Tries `JSON.parse` directly.
2. Strips markdown code fences and retries.
3. Extracts the first `{...}` block via regex and retries.
4. Falls back to a "parse failed" result with the raw text preserved.

### 10.4 Parallel Execution Strategy

Use `Promise.allSettled` for dispatching completion and judge requests. Individual failures should not abort the evaluation — mark the failed cell with an error state and continue. The summary should note which cells failed and why.

### 10.5 Cost Estimation

For local models, cost is $0 — display only token counts and estimated time (based on historical tokens/second from LMAPI metrics). For OpenRouter models, use their published pricing per token to estimate cost. The `/api/eval/models` endpoint should include pricing metadata for OpenRouter models if available.

### 10.6 WebSocket Message Format

```typescript
type EvalStreamEvent =
  | { type: "cell:started"; cellId: string; modelId: string; testCaseId: string }
  | { type: "cell:streaming"; cellId: string; partialContent: string; tokensGenerated: number }
  | { type: "cell:completed"; cellId: string; metrics: EvalMatrixCell["metrics"] }
  | { type: "cell:failed"; cellId: string; error: string }
  | { type: "judge:started"; cellId: string; perspectiveId: string }
  | { type: "judge:completed"; cellId: string; perspectiveId: string; score: number }
  | { type: "eval:progress"; phase: number; totalPhases: number; completedCells: number; totalCells: number; elapsedMs: number }
  | { type: "eval:completed"; summaryPath: string }
  | { type: "eval:failed"; error: string };
```

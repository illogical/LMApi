# Model Evaluator — Implementation Plan

## Context

LMAPI already dispatches prompts to multiple Ollama servers in parallel (`/api/chat/completions/batch`), logs all requests to SQLite, and broadcasts live metrics via Socket.IO to the dashboard. What it lacks is a user-facing interface for **deliberately comparing models side-by-side** — selecting which models to probe, loading a prompt from a file, watching each model's lane update in real time, and reviewing a persistent report afterward.

The Model Evaluator page adds that interface and the supporting backend endpoint, reusing as much existing infrastructure as possible.

---

## Architecture Overview

### New Files

| Path | Purpose |
|---|---|
| `src/public/model-evaluator.html` | New page HTML (uses shared CSS) |
| `src/public/scripts/modelEvaluator.js` | Frontend ES module (state machine, Socket.IO, fetch) |
| `src/routes/evaluateRoutes.ts` | `POST /api/evaluate` endpoint |
| `src/services/EvaluationReportService.ts` | Markdown report generator (writes to `reports/`) |

### Modified Files

| Path | Change |
|---|---|
| `src/app.ts` | Register `/api/evaluate` route; serve evaluator page at `GET /evaluator` |
| `src/constants.ts` | Add three new Socket.IO event constants |
| `src/types.ts` | Add `EvaluationRequest`, `EvaluationResult` types |
| `src/public/log-dashboard.html` | Add "Model Evaluator" nav link in `.header-actions` |
| `src/public/history-browser.html` | Add "Model Evaluator" nav link in `.header-actions` |
| `docs/SPECIFICATION.md` | Document new page and endpoint after implementation |
| `README.md` | Mention Model Evaluator availability and purpose after implementation |
| `docs/TASK.md` | Add Phase 9 / Phase 10 task blocks |

---

## Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Model Evaluator                              [Dashboard] [History] [↻] │
│  Compare prompt responses across multiple models side by side.           │
├─────────────────────────────────────────────────────────────────────────┤
│  PROMPT  ─────────────────────────────────────────────────────────────  │
│  [Browse]  [/path/to/prompt.md___________________________] [✕]          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Prompt textarea (wide, max-height ~300px, scrollable)        ⛶ │    │
│  └─────────────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────────┤
│  MODEL COMPARISON ──────────────────────── [Reset]  [▶ Compare]         │
│                                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ llama3.1   │  │ qwen2.5    │  │ gemma3     │  │                  │  │
│  │ :70b  [⇄][✕]│  │ :14b [⇄][✕]│  │ :27b [⇄][✕]│  │    [  +  ]       │  │
│  │ ─────────  │  │ ─────────  │  │ ─────────  │  │ Add a model lane │  │
│  │ ◌ Waiting  │  │ ◌ Waiting  │  │ ✓ Done     │  │                  │  │
│  │ 0:03.142   │  │ 0:04.508   │  │ 1,892 ms   │  │                  │  │
│  │            │  │            │  │ 89 t/s     │  │                  │  │
│  │            │  │            │  │ ─────────  │  │                  │  │
│  │            │  │            │  │ [response  │  │                  │  │
│  │            │  │            │  │  text...]  │  │                  │  │
│  └────────────┘  └────────────┘  └────────────┘  └──────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│  SUMMARY REPORT (appears after all lanes complete) ───────────────────  │
│  📋 Saved: reports/eval-20260218-143022.md                              │
│  Model         │ Server     │ Duration │ Tok/s │ Out Tokens │ Finish    │
│  llama3.1:70b  │ Legion2025 │ 3,412 ms │ 47    │ 162        │ stop      │
│  qwen2.5:14b   │ Beast2024  │ 1,892 ms │ 89    │ 168        │ stop      │
└─────────────────────────────────────────────────────────────────────────┘
```

### New Lane (Model Chooser State)

When the `+` button is clicked, a new lane appears in **chooser mode**:

```
┌────────────────────┐
│              [✕]   │
│ [🔍 filter...   ]  │
│ ─────────────────  │
│ gemma3:27b         │
│   [M2 Max] [Beast] │  ← two pills; implies multi-server availability
│ llama3.1:8b  ×3    │  ← "×3" badge when on 3+ servers
│   [Legion2025]     │
│ qwen2.5:14b        │
│   [Beast2024]      │
│ ...                │
└────────────────────┘
```

Clicking a model in the list transitions the lane to **selected/idle** state, where the model name is shown at the top and the lane waits for the Compare action.

---

## Lane State Machine

Each lane cycles through these states:

1. **chooser** — model list displayed; user picks a model
2. **idle** — model selected; waiting for Compare click
3. **loading** — request dispatched; live elapsed timer ticking
4. **complete** — response received; metrics and response text shown; green border flash
5. **error** — request failed; error message shown; red border

The "swap model" icon (⇄) returns any lane from `idle`, `complete`, or `error` back to **chooser** state so the user can select a different model for that lane. The Compare button must not be active when a lane is mid-run — swapping is only available before or after a comparison run.

---

## Useful Lane Metrics

| Metric | Source | Why It Matters |
|---|---|---|
| **Total duration** | Client-measured ms | True end-to-end latency |
| **Tokens/second** | `output_tokens / (eval_duration_ms / 1000)` | Primary speed ranking metric |
| **Output tokens** | `usage.completion_tokens` | Output size context |
| **Input tokens** | `usage.prompt_tokens` | Prompt cost awareness |
| **Load duration** | `lmapi.load_duration` (from Ollama) | Cold-start penalty |
| **Eval duration** | `lmapi.eval_duration` (pure generation) | Speed without loading |
| **Finish reason** | `choices[0].finish_reason` | Truncation indicator |
| **Server name** | `lmapi.server_name` (via WebSocket, then confirmed in response) | Which machine handled it |
| **Thinking/reasoning** | `choices[0].message.thinking` (if present) | Transparency for reasoning models |
| **Tool calls** | `choices[0].message.tool_calls` (if present) | Function-calling models |

---

## Backend: New API Endpoint

### `POST /api/evaluate`

Accepts a prompt (inline or from file path) and an array of model names. Dispatches all models in parallel, emits per-model WebSocket events as each completes, and generates a markdown report when all are done.

#### Request Schema

```ts
{
  prompt?: string;           // Prompt text (required if filePath not provided)
  filePath?: string;         // Absolute path to a .txt or .md file (required if prompt not provided)
  models: string[];          // At least 1 model name (Ollama format: "name" or "name:tag")
  temperature?: number;      // Default: 0.7
  max_tokens?: number;       // Optional
  generateReport?: boolean;  // Default: true — write markdown file to reports/
}
```

Validation: Zod schema. If `filePath` is provided, the server reads the file with `fs.readFile`. If neither is provided, return 400.

#### Response

```ts
{
  group_id: string;
  results: EvaluationResult[];
  duration_ms: number;          // Total elapsed for all models
  report_path?: string;         // e.g., "reports/eval-20260218-143022.md"
}
```

#### `EvaluationResult` type

```ts
interface EvaluationResult {
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
  tool_calls?: ToolCall[];
  error?: string;
}
```

#### Implementation Strategy

The endpoint will build a `ChatCompletionRequest` for each model (converting the prompt into a single user message) and call `QueueService.dispatchOrQueueChat()` per model, mirroring the existing `/batch` pattern. Each `Promise` has its own `.then()` handler that:

1. Emits `EVAL_LANE_COMPLETED` via `SocketService`
2. Accumulates the result in an array

`Promise.allSettled()` is used so that one failed model does not block results from others.

When all settle, the handler emits `EVAL_ALL_COMPLETED` and calls `EvaluationReportService.generate()`.

---

## New Socket.IO Events

Add to `src/constants.ts`:

```ts
EVAL_LANE_STARTED:   'eval_lane_started'    // fired when dispatch begins for a model
EVAL_LANE_COMPLETED: 'eval_lane_completed'  // fired when a model's response arrives
EVAL_ALL_COMPLETED:  'eval_all_completed'   // fired when every model has resolved/rejected
```

Payloads:
- `EVAL_LANE_STARTED`: `{ group_id, model, lane_index }`
- `EVAL_LANE_COMPLETED`: `{ group_id, model, result: EvaluationResult }`
- `EVAL_ALL_COMPLETED`: `{ group_id, results: EvaluationResult[], report_path?: string }`

The frontend subscribes to these events to drive lane state transitions without polling.

> Note: Events are broadcast to all connected Socket.IO clients. The frontend disambiguates by `group_id` — only the tab that initiated the evaluation will have a matching `group_id` in state.

---

## EvaluationReportService

New file: `src/services/EvaluationReportService.ts`

Writes markdown to `reports/eval-YYYYMMDD-HHmmss.md`.

### Report Format

```markdown
# Model Evaluation Report

**Date:** 2026-02-18 14:30:22
**Group ID:** `abc-123-uuid`
**Models Evaluated:** 3

## Prompt

```
[full prompt text]
```

## Results Summary

| Model | Server | Duration | Tokens/s | Output Tokens | Finish Reason |
|---|---|---|---|---|---|
| llama3.1:70b | Legion2025 | 3,412 ms | 47 | 162 | stop |
| qwen2.5:14b | Beast2024 | 1,892 ms | 89 | 168 | stop |

## Model Responses

### llama3.1:70b (Legion2025 · 3,412 ms · 47 tok/s)

[response text]

---

### qwen2.5:14b (Beast2024 · 1,892 ms · 89 tok/s)

[response text]

---
```

Thinking and tool calls sections are added conditionally if present.

---

## Frontend: Key Implementation Details

### File Input

- Native `<input type="file" accept=".txt,.md">` hidden button triggered by a styled "Browse" button
- Visible text input next to it for paste-in file paths
- On file chosen via picker: populate the text input with the file path, send path to `/api/evaluate`'s file reading — **or** read the file client-side via the File API and populate the textarea directly (simpler, no extra backend call)
- On blur of text input: `POST /api/validate-path` or inline JS `fetch` to validate — **preferred approach**: validate and read on the backend via `/api/evaluate` to avoid CORS and path exposure issues. Alternatively, add a lightweight `GET /api/evaluate/file?path=...` endpoint that returns file contents
- Clear icon (✕) resets the text input and clears the textarea

### Prompt Viewer Modal

Fullscreen-dark overlay with a centered scrollable `<pre>` or `<textarea readonly>` showing the full prompt. Opened by the ⛶ icon on the textarea. Closed by ✕ button or Escape key.

### Model Chooser Fetch

On page load and on each lane entering **chooser** state: fetch `GET /api/models/loaded` to get the list of models currently on available servers. Cross-reference with `GET /api/servers` to build the server-per-model mapping for pills and multi-server badges.

### Lane Elapsed Timer

While a lane is in **loading** state, a `setInterval(16ms)` ticks a `Date.now() - startTime` counter displayed as `MM:SS.mmm`. Cleared when the `EVAL_LANE_COMPLETED` event arrives for that lane's `group_id` + `model`.

### Complete Animation

On `EVAL_LANE_COMPLETED`: add `.lane-complete-flash` CSS class (green border pulse, e.g., 1 second keyframe animation using existing color tokens `--success-color`). Class is removed after the animation ends via `animationend` event.

### Summary Report Panel

Hidden initially (`display: none`). Shown when `EVAL_ALL_COMPLETED` fires. Populated with a table built from the `results` array. The `report_path` is shown as a file reference string (the reports are server-side files, not HTTP-served).

---

## Reused Existing Infrastructure

| Existing piece | How it's reused |
|---|---|
| `src/public/styles/log-dashboard.css` | Linked directly — no new stylesheet needed |
| `src/public/scripts/dashboardSocket.js` | `DashboardSocket` imported to listen for eval events |
| `QueueService.dispatchOrQueueChat()` | Each model dispatched through the existing queue |
| `DbService` | Requests logged to `PromptHistory` automatically via `QueueService` |
| `SocketService.emit*()` | New eval events added alongside existing history events |
| `ReportService` writing pattern | `EvaluationReportService` follows same `fs.mkdir` + `fs.writeFile` pattern |
| `/api/models/loaded` | Model chooser fetches this to populate the list |
| `/api/servers` | Cross-referenced for server → model mapping in chooser pills |
| `.panel`, `.table-wrap`, `.controls` CSS classes | All page structural elements reuse existing patterns |
| `.row-highlight-complete`, `.is-pending`, `.status-dot` | Lane state visual indicators |
| Toast pattern | Used for file load errors, path validation errors, copy notifications |

---

## File Path Validation Endpoint

A lightweight companion endpoint is needed to validate a pasted file path without running the full evaluation:

### `GET /api/evaluate/file?path=<encoded_path>`

- Returns `{ content: string }` if the file exists and is readable
- Returns `{ error: string }` with 400/404 if not
- Restricted to text files (check extension: `.md`, `.txt`, `.text`, `.prompt`)
- No path traversal — validate that the path is absolute and the file extension is in the allowed list

---

## Verification Plan

After implementation, verify end-to-end by:

1. **Start the server**: `npm run dev`
2. **Navigate to** `http://localhost:17100/evaluator`
3. **Load a file**: Paste or browse to a `.md` file path; verify textarea populates and "View Full" modal works
4. **Add 2–3 model lanes**: Click `+`, select models from the chooser; verify server pills appear
5. **Click Compare**: Verify lanes enter loading state with ticking timers; verify WebSocket `EVAL_LANE_STARTED` events arrive (check browser DevTools → WS frames)
6. **Watch lanes complete**: Verify green flash on each completion; verify metrics appear (duration, tokens/sec, server name)
7. **Check Summary Report panel**: Verify it appears after all lanes complete; verify `report_path` shown
8. **Inspect the report file**: Open `reports/eval-*.md` and verify markdown is valid and contains all response content
9. **Click Reset**: Verify lanes clear; verify prompt and file path remain intact
10. **Test error case**: Add a model that doesn't exist on any server; verify lane shows error state without crashing others
11. **Test `/api/evaluate` directly** via `api.http` or curl with `filePath` and `models[]`; verify JSON response
12. **Check PromptHistory**: Verify evaluation requests appear in `/history` with shared `group_id`

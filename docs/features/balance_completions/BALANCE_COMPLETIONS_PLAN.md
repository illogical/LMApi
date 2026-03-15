# Plan: Model-Aware Load Balancing for Chat Completions

## Problem

The `/v1/chat/completions` endpoint (OpenAI-compatible proxy) does load balance across the Ollama server pool, but its routing logic has a gap that causes unnecessary VRAM model swaps in multi-model, multi-machine environments.

### Current Routing Priority (`reserveServerForModel`)

1. **Sticky** — server actively processing the requested model AND under `MAX_PARALLEL_PER_SERVER` → reuse
2. **Idle** — first completely idle server → use it (may need to load model into VRAM)
3. **Overflow** — first server under the parallel limit (model-blind)

### The Gap: Model-Blind Overflow

Scenario: Server A is serving `model-x` (1/4 parallel slots), Server B is idle with `model-y` available.
A request arrives for `model-y`.

Current result:
- Sticky: skip (no server actively running `model-y`)
- Idle: skip (Server A has `activeRequests=1`)
- **Overflow: assigns `model-y` to Server A** ← forces VRAM swap, ignores idle Server B

Desired result: route to Server B (idle, has `model-y`).

### The Gap: No Post-Request Model Tracking

`activeModels` tracks in-flight requests only. After a request completes, there is no record of what model each server last served — even though Ollama keeps that model warm in VRAM for a configurable period (`OLLAMA_KEEP_ALIVE`, default 5 minutes).

This means the router cannot prefer a server that already has the model hot in VRAM when it's between requests.

---

## Solution

### 1. Add `lastModel` to `ServerStatus`

Track what model each server most recently completed a request for. This approximates "what's hot in VRAM right now."

```typescript
// In ServerPoolService.ts
export interface ServerStatus {
    // ... existing fields ...
    lastModel: string | null;  // NEW: model last served (likely still in VRAM)
}
```

Set `lastModel` in `decrementActiveRequests()` when a request finishes.

### 2. Expand Routing to 5 Priority Steps

Replace the 3-step priority with a 5-step model-affinity-aware priority:

| Step | Name | Condition | Rationale |
|------|------|-----------|-----------|
| 1 | **Sticky** | Actively running this model AND under limit | Best: model loaded, no swap needed |
| 2 | **Warm Idle** | Idle AND `lastModel` matches requested model | Great: model likely in VRAM, no active load |
| 3 | **Cold Idle** | Any idle server (has the model available) | Good: clean slate, will need to load model |
| 4 | **Warm Overflow** | Busy, `lastModel` matches, under limit | Acceptable: parallel to active work, model likely loaded |
| 5 | **Cold Overflow** | Any server under limit | Last resort: likely forces VRAM swap |

Steps 1–3 preserve the original intent. Steps 2 and 4 are new and leverage `lastModel`.

### 3. Apply to Both Routing Methods

Both `reserveServerForModel()` (atomic, used for concurrent requests) and `getBestServerForModel()` (non-atomic, used for display/legacy) should be updated with the same logic.

---

## Implementation

### Files to Change

| File | Change |
|------|--------|
| [ServerPoolService.ts](../../../src/services/ServerPoolService.ts) | Add `lastModel` to `ServerStatus`; update `initialize()`, `refreshPool()`, `refreshServer()`, `decrementActiveRequests()`, `reserveServerForModel()`, `getBestServerForModel()` |

No other files need changes. Both auto-routing endpoints share the same code path and both inherit the improvement automatically:

| Endpoint | serverName | Routing path |
|----------|------------|--------------|
| `POST /v1/chat/completions` | `'any'` | → `reserveServerForModel()` (streaming) / `dispatchOrQueueChat()` (non-streaming) |
| `POST /api/chat/completions/any` | `'any'` | → `reserveServerForModel()` (streaming) / `dispatchOrQueueChat()` (non-streaming) |

The only differences between these two endpoints are response format (`/v1` strips `lmapi` metadata; `/any` includes it) and that `/any` supports a `maxParallelPerServer` body parameter override. Since the routing improvement lives entirely in `reserveServerForModel()`, both endpoints benefit equally.

### Detailed Changes

#### `ServerStatus` interface

```typescript
export interface ServerStatus {
    config: ServerConfig;
    isOnline: boolean;
    models: string[];
    runningModels: string[];
    activeModels: string[];
    activeRequests: number;
    lastChecked: number;
    lastModel: string | null;  // ADD: model last completed on this server
}
```

#### `initialize()` and `refreshPool()` / `refreshServer()`

Add `lastModel: null` for new entries. When refreshing, preserve the existing `lastModel` (same as `activeModels` / `activeRequests` are preserved today).

```typescript
const newStatus: ServerStatus = {
    // ... existing fields ...
    lastModel: oldStatus?.lastModel ?? null,  // preserve across refresh
};
```

#### `decrementActiveRequests()`

After decrementing, set `lastModel` to the model that just finished (the one being removed):

```typescript
static decrementActiveRequests(serverName: string, modelName: string) {
    const status = this.statusMap.get(serverName);
    if (status && status.activeRequests > 0) {
        status.activeRequests--;
        const index = status.activeModels.indexOf(modelName);
        if (index !== -1) {
            status.activeModels.splice(index, 1);
        }
        status.lastModel = modelName;  // ADD: track last served model
        SocketService.emitActiveRequestsChanged(serverName, status.activeRequests);
    }
}
```

#### `reserveServerForModel()` — updated 5-step priority

```typescript
static reserveServerForModel(modelName: string, maxParallelOverride?: number): ServerStatus | undefined {
    const candidates = this.getAvailableServersForModel(modelName);
    const maxParallel = maxParallelOverride ?? ConfigService.getMaxParallelPerServer();

    // 1. Sticky: actively running this model, under limit
    const sticky = candidates.find(s =>
        s.activeModels.some(m => this.modelMatches(m, modelName)) &&
        s.activeRequests < maxParallel
    );
    if (sticky) {
        this.incrementActiveRequests(sticky.config.name, modelName);
        return sticky;
    }

    // 2. Warm Idle: idle AND last served this model (likely in VRAM)
    const warmIdle = candidates.find(s =>
        s.activeRequests === 0 &&
        s.lastModel !== null && this.modelMatches(s.lastModel, modelName)
    );
    if (warmIdle) {
        this.incrementActiveRequests(warmIdle.config.name, modelName);
        return warmIdle;
    }

    // 3. Cold Idle: any idle server
    const coldIdle = candidates.find(s => s.activeRequests === 0);
    if (coldIdle) {
        this.incrementActiveRequests(coldIdle.config.name, modelName);
        return coldIdle;
    }

    // 4. Warm Overflow: busy but last served this model, under limit
    const warmOverflow = candidates.find(s =>
        s.lastModel !== null && this.modelMatches(s.lastModel, modelName) &&
        s.activeRequests < maxParallel
    );
    if (warmOverflow) {
        this.incrementActiveRequests(warmOverflow.config.name, modelName);
        return warmOverflow;
    }

    // 5. Cold Overflow: any server under limit (may force VRAM swap)
    const coldOverflow = candidates.find(s => s.activeRequests < maxParallel);
    if (coldOverflow) {
        this.incrementActiveRequests(coldOverflow.config.name, modelName);
        return coldOverflow;
    }

    return undefined; // All servers at capacity
}
```

Apply the same logic to `getBestServerForModel()` (without the `incrementActiveRequests` calls).

---

## Behavior After This Change

### Scenario: Server A busy with `model-x`, Server B idle with `model-y`

Request for `model-y`:
- Step 1 Sticky: skip (no server actively running `model-y`)
- Step 2 Warm Idle: skip (Server B idle but `lastModel` is null or different on first run)
- Step 3 Cold Idle: **→ Server B** ✓

After Server B has served `model-y` once and goes idle:
- Step 2 Warm Idle: **→ Server B** ✓ (lastModel = `model-y`, VRAM likely warm)

### Scenario: Both servers busy, Server A's lastModel matches

Request for `model-y` when all servers are active:
- Steps 1–3: skip (no idle/sticky match)
- Step 4 Warm Overflow: **→ Server A** (if lastModel = `model-y`, parallel may not need reload)
- Step 5: fallback only if no warm match

### Your Original Parallel-Agent Scenario

Multiple agents using different large models (each consuming full VRAM of one machine):
- Agent using `model-x` → Server A (sticky/warm)
- Agent using `model-y` → Server B (warm idle / cold idle)
- Each machine serves its own model, VRAM swap only occurs when truly necessary

---

## Notes

- `lastModel` is an approximation. Ollama's actual VRAM state depends on `OLLAMA_KEEP_ALIVE` (default 5 min). After expiry, the model is unloaded even though `lastModel` still reflects it. This heuristic still significantly reduces unnecessary swaps without requiring Ollama API polling.
- `runningModels` from Ollama's `/api/ps` endpoint is polled during `refreshPool()` and could be used as a more accurate signal for what's currently in VRAM — but it's only updated on pool refresh, not per-request, so `lastModel` is a better real-time signal.
- The existing `activeModels` field (in-flight tracking) is unaffected.

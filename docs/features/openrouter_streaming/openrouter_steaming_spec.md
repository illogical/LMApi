# OpenRouter Streaming & Provider Flag Implementation Spec
**Phase 8 Implementation Plan**

## Overview
This specification covers the implementation of SSE streaming support for OpenRouter cloud provider and the addition of a `provider` parameter to enable explicit provider targeting. The primary goal is to provide full LMAPI observability (logging, metrics, history tracking) for cloud-only model testing.

## Current State Analysis

### What Works Today
- ✅ OpenRouter non-streaming requests via fallback logic
- ✅ Ollama SSE streaming (local servers)
- ✅ `PromptHistory` DB logging for both Ollama and OpenRouter
- ✅ Provider configuration in `providers.json`
- ✅ Automatic fallback when no local server available

### Current Limitations
- ❌ OpenRouter requests always use `stream: false` (line 132 in `ProviderService.ts`)
- ❌ No way to explicitly target OpenRouter without waiting for fallback
- ❌ Cannot test cloud-only models unless local servers are unavailable
- ❌ No provider filtering in `/prompt-history` endpoint

## Implementation Requirements

### 1. **OpenRouter SSE Streaming Support**

#### 1.1 Update `ProviderService.sendChatCompletion()`
**File:** `src/services/ProviderService.ts`

**Changes Required:**
1. Add optional `res?: Response` parameter to method signature
2. Remove hardcoded `stream: false` on line 132
3. Respect `body.stream` value from request
4. Add streaming response handler similar to `ChatCompletionService.handleStreamingResponse()`
5. Return accumulated response for DB logging

**Method Signature:**
```typescript
static async sendChatCompletion(
    provider: ProviderConfig,
    body: ChatCompletionRequest,
    res?: Response  // NEW: for streaming
): Promise<ChatCompletionResponse>
```

**Streaming Logic:**
```typescript
const payload = {
    ...openAIBody,
    stream: body.stream || false  // Respect request setting
};

// If streaming and response object provided
if (payload.stream && res) {
    return await this.handleProviderStreamingResponse(response, res, provider);
}

// Otherwise, buffered response
const data = await response.json() as ChatCompletionResponse;
return data;
```

#### 1.2 Implement `ProviderService.handleProviderStreamingResponse()`
**File:** `src/services/ProviderService.ts`

**NEW Private Method:**
```typescript
private static async handleProviderStreamingResponse(
    providerResponse: globalThis.Response,
    clientRes: Response,
    provider: ProviderConfig
): Promise<ChatCompletionResponse>
```

**Implementation Details:**
- Set SSE headers on `clientRes`
- Read SSE chunks from `providerResponse.body`
- Parse `data: {...}` lines (OpenRouter uses same SSE format as OpenAI)
- Forward each chunk to client: `clientRes.write('data: ' + JSON.stringify(chunk) + '\n\n')`
- Accumulate response for return value (needed for DB logging)
- Handle `[DONE]` sentinel
- Handle tool calls accumulation (same pattern as Ollama streaming)
- End response with `clientRes.end()`

**Error Handling:**
- Wrap in try/catch
- If error after streaming starts, write error chunk and end stream
- Always return accumulated response (even if partial)

### 2. **Provider Flag Parameter**

#### 2.1 Update `ChatCompletionRequest` Type
**File:** `src/types.ts`

Add new optional field:
```typescript
export interface ChatCompletionRequest {
    // ... existing fields ...
    stream?: boolean;
    // LMAPI extensions
    serverName?: string;
    models?: string[];
    groupId?: string;
    maxParallelPerServer?: number;
    provider?: string;  // NEW: explicit provider targeting (e.g., "openrouter")
}
```

#### 2.2 Update Zod Schema
**File:** `src/routes/chatCompletionRoutes.ts`

Add to both schemas:
```typescript
const LMAPIChatCompletionSchema = z.object({
    // ... existing fields ...
    provider: z.string().optional(),  // NEW
});

const ChatCompletionSchema = z.object({
    // ... existing fields ...
    provider: z.string().optional(),  // NEW (for /v1/chat/completions)
});
```

#### 2.3 Update Routing Logic

**Affected Files:**
- `src/routes/chatCompletionRoutes.ts` (all endpoints)
- `src/services/QueueService.ts` (`dispatchOrQueueChat`, `runChatRequestStreaming`)

**New Routing Priority:**
1. **If `provider` specified:** Route to that provider explicitly
2. **Else if `serverName` specified:** Route to that local server
3. **Else:** Use existing auto-routing logic (prefer local, fallback to cloud)

**Validation:**
- If `provider` specified, validate it exists via `ProviderService.getProvider()`
- Return 400 error if provider not found or disabled

### 3. **Endpoint Updates**

#### 3.1 `/v1/chat/completions` (OpenAI-compatible)
**File:** `src/routes/chatCompletionRoutes.ts` (line ~83)

**Changes:**
```typescript
router.post('/v1/chat/completions', async (req, res) => {
    try {
        const body = ChatCompletionSchema.parse(req.body);
        
        // NEW: Check for explicit provider targeting
        if (body.provider) {
            return await handleProviderRequest(body, res, false); // Helper function
        }
        
        // Existing auto-routing logic for local servers
        const availability = ensureModelAvailable(body.model);
        // ... rest of existing code
    }
});
```

#### 3.2 `/api/chat/completions/any`
**File:** `src/routes/chatCompletionRoutes.ts` (line ~143)

**Changes:**
```typescript
router.post('/chat/completions/any', async (req, res) => {
    try {
        const body = LMAPIChatCompletionSchema.parse(req.body);
        
        // NEW: Check for explicit provider targeting
        if (body.provider) {
            return await handleProviderRequest(body, res, true); // Include LMAPI metadata
        }
        
        // Existing auto-routing logic
        // ... rest of existing code
    }
});
```

#### 3.3 `/api/chat/completions/server`
**File:** `src/routes/chatCompletionRoutes.ts` (line ~187)

**No changes needed** - this endpoint already targets specific servers. Provider flag would be ignored here (document this behavior).

#### 3.4 New Helper Function: `handleProviderRequest()`
**File:** `src/routes/chatCompletionRoutes.ts`

**NEW Function:**
```typescript
async function handleProviderRequest(
    body: ChatCompletionRequest,
    res: Response,
    includeLmapiMetadata: boolean
): Promise<void> {
    const provider = ProviderService.getProvider(body.provider!);
    
    if (!provider) {
        return res.status(400).json(createErrorResponse(
            `Provider '${body.provider}' not found or disabled`,
            'invalid_request_error',
            'provider',
            'provider_not_found'
        ));
    }
    
    // Check if model is supported by provider
    if (!provider.models.includes(body.model) && !provider.models.includes('*')) {
        return res.status(400).json(createErrorResponse(
            `Model '${body.model}' not available on provider '${body.provider}'`,
            'invalid_request_error',
            'model',
            'model_not_available_on_provider'
        ));
    }
    
    const request: ChatCompletionRequest = { ...body };
    
    // Handle streaming
    if (body.stream) {
        await QueueService.runCloudProviderRequestStreaming(
            body.provider!,
            request,
            res
        );
        return;
    }
    
    // Non-streaming
    const result = await QueueService.runCloudProviderRequest(
        body.provider!,
        request
    );
    
    // Remove LMAPI metadata if OpenAI-compatible endpoint
    if (!includeLmapiMetadata) {
        const { lmapi, ...openAIResponse } = result;
        res.json(openAIResponse);
    } else {
        res.json(result);
    }
}
```

### 4. **QueueService Updates**

#### 4.1 New Method: `runCloudProviderRequestStreaming()`
**File:** `src/services/QueueService.ts`

**NEW Public Method:**
```typescript
static async runCloudProviderRequestStreaming(
    providerName: string,
    request: ChatCompletionRequest,
    res: Response
): Promise<void> {
    const requestId = randomUUID();
    
    const provider = ProviderService.getProvider(providerName);
    if (!provider) {
        throw new Error(`Provider ${providerName} not found`);
    }
    
    LogService.info(`Dispatching streaming chat request ${requestId} to cloud provider ${providerName}`, { 
        model: request.model 
    });
    
    const startTime = Date.now();
    const createdAt = new Date().toISOString();
    const lastUserMessage = ChatCompletionService.extractLastUserMessage(request.messages);
    
    // 1. Insert pending DB record
    let dbId: number | bigint | undefined;
    try {
        dbId = DbService.insertPromptHistory({
            serverName: providerName,
            modelName: request.model,
            prompt: lastUserMessage,
            temperature: request.temperature,
            createdAt,
            groupId: request.groupId,
            requestType: 'chat',
        });
    } catch (dbErr) {
        LogService.error('Failed to insert pending cloud provider streaming record', { error: dbErr });
    }
    
    try {
        // This will stream to client AND return accumulated response
        const response = await ProviderService.sendChatCompletion(provider, request, res);
        
        const durationMs = Date.now() - startTime;
        const responseAt = new Date().toISOString();
        const usage = ProviderService.extractUsage(response);
        const responseContent = ProviderService.extractResponseContent(response);
        
        // 2. Update DB record with success
        if (dbId !== undefined) {
            try {
                DbService.updatePromptHistory(dbId, {
                    responseText: responseContent,
                    responseDurationMs: durationMs,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    responseAt,
                    isError: false,
                });
            } catch (dbErr) {
                LogService.error('Failed to update cloud provider streaming record', { error: dbErr });
            }
        }
        
    } catch (error: any) {
        LogService.error(`Cloud provider streaming request ${requestId} failed on ${providerName}`, { error });
        
        // 3. Update DB record with error
        if (dbId !== undefined) {
            try {
                DbService.updatePromptHistory(dbId, {
                    responseText: error.message || 'Unknown error',
                    responseDurationMs: Date.now() - startTime,
                    responseAt: new Date().toISOString(),
                    isError: true,
                });
            } catch (dbErr) {
                LogService.error('Failed to update error in cloud provider streaming record', { error: dbErr });
            }
        }
        
        throw error;
    }
}
```

#### 4.2 Make `runCloudProviderRequest()` Public
**File:** `src/services/QueueService.ts` (line ~567)

**Change:**
```typescript
// Before:
private static async runCloudProviderRequest(

// After:
static async runCloudProviderRequest(  // Remove 'private'
```

### 5. **Prompt History Filtering**

#### 5.1 Add Provider Filter to `/prompt-history`
**File:** `src/routes/promptHistoryRoutes.ts`

**Update Query Schema:**
```typescript
const QuerySchema = z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    model: z.string().optional(),
    serverName: z.string().optional(),
    provider: z.string().optional(),  // NEW: alias for serverName (provider names stored as serverName)
    sortBy: z.enum(['createdAt', 'duration', 'serverName', 'modelName']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
});
```

**Update Query Logic:**
```typescript
const filters: any[] = [];
if (query.model) {
    filters.push(`ModelName = ?`);
    bindings.push(query.model);
}

// Support both serverName and provider (they're the same column)
if (query.serverName) {
    filters.push(`ServerName = ?`);
    bindings.push(query.serverName);
} else if (query.provider) {
    filters.push(`ServerName = ?`);
    bindings.push(query.provider);
}
```

### 6. **Documentation Updates**

#### 6.1 Update SPECIFICATION.md
**File:** `docs/SPECIFICATION.md`

Add to Section 4.4:
```markdown
#### Provider Parameter
All chat completion endpoints support an optional `provider` parameter for explicit cloud provider targeting:

```json
{
  "model": "openai/gpt-oss-120b:free",
  "provider": "openrouter",  // NEW: explicit provider targeting
  "stream": true,
  "messages": [...]
}
```

When `provider` is specified:
- Request routes directly to the named provider (e.g., "openrouter")
- Bypasses local server routing and fallback logic
- Enables testing of cloud-only models with full LMAPI observability
- Returns 400 error if provider not found or model not supported

#### Streaming Control
The `stream` parameter controls response format:
- `"stream": true` → SSE streaming (real-time chunks)
- `"stream": false` → Buffered response (default)

Streaming is supported for:
- Local Ollama servers
- OpenRouter cloud provider (Phase 8+)

All streaming requests are logged to `PromptHistory` upon completion.
```

### 7. **Testing Plan**

#### 7.1 Update `scripts/testChatCompletions.ts`
Add new test cases:

**Test Case 1: OpenRouter Streaming (Explicit)**
```typescript
async function testOpenRouterStreaming() {
    console.log('\n=== Test: OpenRouter Streaming (Explicit) ===');
    
    const response = await fetch('http://localhost:3000/api/chat/completions/any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'openai/gpt-oss-20b:free',
            provider: 'openrouter',  // Explicit targeting
            stream: true,
            messages: [
                { role: 'user', content: 'Count from 1 to 5 slowly.' }
            ]
        })
    });
    
    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim() && l.startsWith('data: '));
        
        for (const line of lines) {
            const data = line.slice(6);
            if (data === '[DONE]') {
                console.log('Stream complete');
                return;
            }
            
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
                process.stdout.write(content);
            }
        }
    }
}
```

**Test Case 2: Local vs Provider Comparison**
```typescript
async function testLocalVsCloudComparison() {
    console.log('\n=== Test: Local vs Cloud Comparison ===');
    
    const prompt = { 
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        stream: false
    };
    
    // Test 1: Ollama (local)
    const localResult = await fetch('http://localhost:3000/api/chat/completions/any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prompt, model: 'llama3.2' })
    }).then(r => r.json());
    
    console.log('Local:', localResult.lmapi);
    
    // Test 2: OpenRouter (explicit)
    const cloudResult = await fetch('http://localhost:3000/api/chat/completions/any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ...prompt, 
            model: 'openai/gpt-oss-20b:free',
            provider: 'openrouter'  // Force cloud even if local could handle it
        })
    }).then(r => r.json());
    
    console.log('Cloud:', cloudResult.lmapi);
}
```

**Test Case 3: Provider History Filtering**
```typescript
async function testProviderHistoryFiltering() {
    console.log('\n=== Test: Provider History Filtering ===');
    
    // Query OpenRouter requests
    const history = await fetch('http://localhost:3000/prompt-history?provider=openrouter&limit=5')
        .then(r => r.json());
    
    console.log(`Found ${history.total} OpenRouter requests`);
    console.log('Recent:', history.data.slice(0, 3));
}
```

#### 7.2 Create Test Report Script
**File:** `scripts/testProviderStreaming.ts`

Create a comprehensive test that:
1. Tests streaming with various OpenRouter models
2. Compares streaming vs non-streaming response accuracy
3. Validates DB logging for streamed responses
4. Tests error handling (invalid provider, model not found)
5. Generates HTML report similar to `testTranscriptionSummary.ts`

### 8. **Implementation Order**

**Recommended sequence:**

1. **Step 1: Type & Schema Updates** (15 min)
   - Update `ChatCompletionRequest` interface
   - Update Zod schemas
   - No runtime changes, safe to implement first

2. **Step 2: ProviderService Streaming** (45 min)
   - Add `res` parameter to `sendChatCompletion()`
   - Implement `handleProviderStreamingResponse()`
   - Test with manual curl command
   - **Checkpoint:** OpenRouter streaming works in isolation

3. **Step 3: QueueService Integration** (30 min)
   - Make `runCloudProviderRequest()` public
   - Implement `runCloudProviderRequestStreaming()`
   - Test DB logging for streamed responses
   - **Checkpoint:** Full observability for streaming

4. **Step 4: Provider Flag Routing** (45 min)
   - Implement `handleProviderRequest()` helper
   - Update `/v1/chat/completions` endpoint
   - Update `/api/chat/completions/any` endpoint
   - Test explicit provider targeting
   - **Checkpoint:** Can target OpenRouter without fallback

5. **Step 5: History Filtering** (15 min)
   - Update `/prompt-history` query schema
   - Add provider filter logic
   - Test filtering
   - **Checkpoint:** Can filter OpenRouter requests

6. **Step 6: Testing & Documentation** (30 min)
   - Add test cases to `testChatCompletions.ts`
   - Update SPECIFICATION.md
   - Run full test suite
   - Generate test report
   - **Checkpoint:** Complete, tested, documented

**Total Estimated Time:** ~2.5 hours

### 9. **Success Criteria**

Phase 8 is complete when:

- ✅ OpenRouter requests support `"stream": true`
- ✅ SSE chunks are forwarded to client in real-time
- ✅ Streamed responses are logged to `PromptHistory` (two-phase insert/update)
- ✅ `provider` parameter explicitly routes to cloud providers
- ✅ Can test cloud-only models without disabling local servers
- ✅ `/prompt-history?provider=openrouter` filters correctly
- ✅ All existing tests pass
- ✅ New test cases validate streaming and provider flag
- ✅ SPECIFICATION.md documents new features

### 10. **Edge Cases & Error Handling**

**Handle these scenarios:**

1. **Invalid Provider**
   - Return 400: `"Provider 'xyz' not found or disabled"`

2. **Model Not on Provider**
   - Return 400: `"Model 'llama3.2' not available on provider 'openrouter'"`

3. **Provider + ServerName Conflict**
   - Behavior: `provider` takes precedence (document this)
   - Alternative: Return 400 error (implementer's choice)

4. **Streaming Error Mid-Response**
   - Send error SSE chunk: `data: {"error": "..."}\n\n`
   - Update DB with partial response + error flag
   - End stream gracefully

5. **OpenRouter Rate Limit**
   - Log error to `PromptHistory`
   - Return 429 error to client
   - Don't retry automatically (future: rate limiting)

6. **Network Timeout**
   - 10 minute timeout for streaming (same as non-streaming)
   - Update DB with timeout error
   - Close stream

### 11. **Future Enhancements (Post-Phase 8)**

Out of scope for Phase 8, but document for Phase 9:

- Cost tracking (parse `usage` from OpenRouter responses)
- Rate limiting per provider
- Retry logic with exponential backoff
- Multi-provider load balancing
- Dashboard provider visibility
- `/api/generate/*` endpoints with provider parameter
- Stream caching/replay for testing

---

## Implementation Checklist

Use this checklist to track progress:

- [ ] Update `ChatCompletionRequest` interface with `provider` field
- [ ] Update Zod schemas for provider validation
- [ ] Implement `ProviderService.handleProviderStreamingResponse()`
- [ ] Update `ProviderService.sendChatCompletion()` for streaming
- [ ] Implement `QueueService.runCloudProviderRequestStreaming()`
- [ ] Make `QueueService.runCloudProviderRequest()` public
- [ ] Implement `handleProviderRequest()` helper in routes
- [ ] Update `/v1/chat/completions` endpoint
- [ ] Update `/api/chat/completions/any` endpoint
- [ ] Update `/prompt-history` with provider filter
- [ ] Add test cases to `testChatCompletions.ts`
- [ ] Update SPECIFICATION.md documentation
- [ ] Run full test suite and validate
- [ ] Mark Phase 8 complete in TASK.md

**Estimated Complexity:** Medium
**Risk Level:** Low (extends existing patterns)
**Dependencies:** None (all prerequisites from Phase 7 complete)

# Chat Completions Test Script

## Overview

The `testChatCompletions.ts` script provides comprehensive verification of all chat completion endpoints, including streaming, tool calling, and cloud provider fallback.

## Running the Tests

```bash
# Make sure the LMAPI server is running
npm run dev

# In another terminal, run the tests
npm run test:chat
```

## What It Tests

### 1. OpenAI-Compatible Endpoint
- **Basic chat completion** - Verifies standard OpenAI format responses
- **Streaming** - Tests SSE streaming with chunk validation

### 2. LMAPI Routing Endpoints
- **/api/chat/completions/any** - Auto-routing to best server
- **/api/chat/completions/any (streaming)** - Streaming with auto-routing
- **/api/chat/completions/server** - Specific server targeting
- **/api/chat/completions/batch** - Multiple models in parallel
- **/api/chat/completions/all** - Broadcast to all servers

### 3. Tool/Function Calling
- Verifies tools are passed through to Ollama
- Checks for tool_calls in responses
- Tests OpenAI-compatible tool format

### 4. Cloud Provider Fallback
- Tests OpenRouter fallback for unavailable models
- Handles both configured and unconfigured scenarios
- Verifies proper error handling

## Configuration

The script uses environment variables for configuration:

```bash
# Optional: Override defaults
export PORT=3111
export TEST_CHAT_MODEL=llama3.1
export TEST_CHAT_MODEL_SECONDARY=phi4
export TEST_CLOUD_MODEL=anthropic/claude-sonnet-4
export TEST_TIMEOUT_MS=120000
export TEST_STREAMING_TIMEOUT_MS=180000
```

## Output

The script provides:

1. **Real-time progress** - See each test as it runs
2. **Pass/fail status** - Clear ✅/❌ for each test
3. **Feature breakdown** - Separate stats for streaming, tools, cloud
4. **Detailed summary** - Full results with timing and errors
5. **Exit code** - Non-zero on failure for CI/CD integration

### Example Output

```
==== Chat Completions Test Runner ====
Base URL: http://localhost:3111
Chat Model: llama3.1
...

✅ OpenAI-compatible endpoint (basic) (200) — Response: "4..."
✅ OpenAI-compatible endpoint (streaming) (200) — Received 15 chunks
✅ LMAPI /any endpoint (200) — Server: localhost, Duration: 234ms
...

📊 SUMMARY
   Total tests: 9
   Passed: 9 ✅
   Failed: 0 ❌
   Total duration: 8234ms

📋 FEATURE BREAKDOWN
   Streaming: 2/2 passed
   Tool Calling: 1/1 passed
   Cloud Provider: 1/1 passed

✅ All tests passed!
```

## Requirements

- LMAPI server must be running
- At least one Ollama server configured in `servers.json`
- Models specified in environment variables must be available
- For cloud provider tests: `OPENROUTER_API_KEY` in `.env` (optional)

## Troubleshooting

### Test timeouts
Increase timeout values:
```bash
export TEST_TIMEOUT_MS=300000
export TEST_STREAMING_TIMEOUT_MS=600000
```

### Model not available
Check available models on your Ollama servers:
```bash
curl http://localhost:11434/api/tags
```

Update test models:
```bash
export TEST_CHAT_MODEL=your-model-name
```

### Cloud provider tests fail with 503
This is expected if OpenRouter is not configured. The test passes as long as it returns 503 (service unavailable) rather than an unexpected error.

## CI/CD Integration

The script returns a non-zero exit code on failure, making it suitable for automated testing:

```bash
npm run test:chat || exit 1
```

## Adding More Tests

Edit `scripts/testChatCompletions.ts` to add new test cases. Follow the existing pattern:

```typescript
{
    const body = { /* your test request */ };
    const resp = await request('POST', '/your/endpoint', body);
    const ok = resp.ok && /* your validation */;
    
    results.push({
        name: 'Your test name',
        method: 'POST',
        path: '/your/endpoint',
        ok,
        status: resp.status,
        note: ok ? 'Success message' : undefined,
        error: resp.error || 'Failure message',
        // ...
    });
}
```

## Related Documentation

- [SPECIFICATION.md](../docs/SPECIFICATION.md) - API reference
- [OPENROUTER.md](../docs/OPENROUTER.md) - Cloud provider setup
- [api.http](../api.http) - Request examples

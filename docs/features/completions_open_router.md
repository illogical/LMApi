# LMAPI Chat Completions & Tool Calling Implementation Plan

## Overview

This document outlines the implementation plan for extending LMAPI to support the OpenAI-compatible `/v1/chat/completions` endpoint with full tool/function calling capabilities. This will enable LMAPI to support both Ollama and OpenRouter providers using a unified API interface.

## Current State

- LMAPI currently supports only Ollama's `/api/generate` endpoint
- No support for chat-based completions format
- No tool/function calling capabilities
- Provides observability, pooling, and load balancing for Ollama servers

## Goals

1. Add support for `/v1/chat/completions` endpoint (OpenAI-compatible)
2. Implement tool/function calling capabilities
3. Support both Ollama and OpenRouter as backend providers
4. Maintain existing observability, pooling, and load balancing features
5. Provide unified interface regardless of backend provider

---

## Implementation Details

### 1. API Endpoint Structure

#### New Endpoint: `/v1/chat/completions`

**Request Format (OpenAI-compatible):**

```json
{
  "model": "llama3.1",
  "messages": [
    {
      "role": "system|user|assistant|tool",
      "content": "string",
      "name": "string (optional, for tool role)",
      "tool_calls": [] // (optional, for assistant role)
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "string",
        "description": "string",
        "parameters": {
          "type": "object",
          "properties": {},
          "required": []
        }
      }
    }
  ],
  "tool_choice": "auto|none|required|{\"type\": \"function\", \"function\": {\"name\": \"...\"}}", // optional
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false,
  "top_p": 1.0,
  "frequency_penalty": 0.0,
  "presence_penalty": 0.0,
  "stop": ["string"],
  "n": 1
}
```

**Response Format (Non-streaming):**

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "llama3.1",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "string or null",
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\": \"San Francisco\"}"
            }
          }
        ]
      },
      "finish_reason": "stop|length|tool_calls|content_filter"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**Response Format (Streaming):**

Each chunk is a Server-Sent Event (SSE) with format:
```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"llama3.1","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"llama3.1","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"llama3.1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Streaming with Tool Calls:**
```
data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"loc"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\":"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

---

### 2. Provider Configuration

#### Provider Types

```typescript
enum ProviderType {
  Ollama = 'ollama',
  OpenRouter = 'openrouter'
}

interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey?: string; // Required for OpenRouter, optional for Ollama
  models?: string[]; // Available models for this provider
  priority?: number; // For load balancing
  healthCheckEndpoint?: string;
}
```

#### Provider-Specific Base URLs

- **Ollama**: `http://{server}:{port}/v1` (default port: 11434)
- **OpenRouter**: `https://openrouter.ai/api/v1`

#### Authentication Handling

**Ollama:**
- No authentication required by default
- Optional: Basic auth if configured on Ollama server
- Header format: `Authorization: Basic {base64(username:password)}`

**OpenRouter:**
- Required: API key authentication
- Header format: `Authorization: Bearer {api_key}`
- Optional headers:
  - `HTTP-Referer`: Your app URL (for rankings)
  - `X-Title`: Your app name (for rankings)

---

### 3. Tool Calling Implementation

#### Tool Definition Schema

Tools are defined using JSON Schema format:

```typescript
interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}
```

#### Tool Call Flow

1. **User Request with Tools**:
   - Client sends messages + tools definition
   - LMAPI forwards to backend provider

2. **Model Responds with Tool Calls**:
   - Response contains `tool_calls` array in assistant message
   - Each tool call has: `id`, `type`, `function.name`, `function.arguments`
   - `finish_reason` will be `"tool_calls"`

3. **Client Executes Tools**:
   - Client parses tool calls
   - Executes each function locally
   - Formats results as tool messages

4. **Client Sends Tool Results**:
   - Append tool result messages to conversation
   - Each message has `role: "tool"`, `tool_call_id`, `content` (JSON string)

5. **Model Generates Final Response**:
   - Model processes tool results
   - Generates final answer based on tool outputs

#### Tool Choice Options

```typescript
type ToolChoice = 
  | 'auto'      // Model decides whether to call tools
  | 'none'      // Model will not call tools
  | 'required'  // Model must call at least one tool
  | {           // Force specific tool
      type: 'function',
      function: { name: string }
    };
```

#### Model Capability Detection

Not all models support tool calling. Maintain a list of tool-capable models:

**Ollama Tool-Capable Models:**
- `llama3.1:*` (8b, 70b, 405b)
- `llama3.2:*` (1b, 3b)
- `mistral:*`
- `mixtral:*`
- `qwen2.5:*`
- `command-r:*`
- `command-r-plus:*`
- `firefunction-v2:*`

**OpenRouter:**
- Most modern models support tools
- Check OpenRouter's model documentation for capabilities
- Models from: OpenAI, Anthropic, Google, Mistral, Cohere typically support tools

**Implementation:**
```typescript
interface ModelCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxTokens: number;
}

// Maintain capability registry
const modelCapabilities: Record<string, ModelCapabilities>;
```

---

### 4. Request/Response Translation

#### Ollama Translation

Ollama's `/v1/chat/completions` endpoint is already OpenAI-compatible, so minimal translation needed:

**Request:** Pass through as-is
**Response:** Pass through as-is
**Headers:** No authentication unless configured

#### OpenRouter Translation

OpenRouter is fully OpenAI-compatible:

**Request:** Pass through as-is
**Response:** Pass through as-is
**Headers:** Add `Authorization: Bearer {api_key}`

**Optional OpenRouter-specific features:**
```json
{
  "provider": {
    "order": ["Anthropic", "OpenAI"],  // Provider preference
    "allow_fallbacks": true
  },
  "transforms": ["middle-out"]  // Prompt transformation
}
```

---

### 5. Streaming Implementation

#### Server-Sent Events (SSE)

Both providers return streaming responses as SSE format:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

#### Streaming Handler

```typescript
async function* streamChatCompletion(
  provider: ProviderConfig,
  request: ChatCompletionRequest
): AsyncGenerator<ChatCompletionChunk> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(provider),
    body: JSON.stringify({ ...request, stream: true })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        
        try {
          const chunk = JSON.parse(data);
          yield chunk;
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
}
```

#### Tool Calls in Streaming

When streaming tool calls:
- `delta.tool_calls` array contains incremental updates
- Each tool call has an `index` to track which call is being updated
- `arguments` field is streamed incrementally as a string
- Client must reassemble the complete JSON arguments

```typescript
// Accumulate streaming tool calls
const toolCallsBuffer: Record<number, {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}> = {};

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  
  if (delta?.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      const idx = toolCall.index;
      
      if (!toolCallsBuffer[idx]) {
        toolCallsBuffer[idx] = {
          id: toolCall.id,
          type: toolCall.type,
          function: { name: toolCall.function.name, arguments: '' }
        };
      }
      
      if (toolCall.function?.arguments) {
        toolCallsBuffer[idx].function.arguments += toolCall.function.arguments;
      }
    }
  }
}
```

---

### 6. Observability & Metrics

#### Metrics to Track

**Request Metrics:**
- Request count by endpoint (`/v1/chat/completions`)
- Request count by provider (Ollama vs OpenRouter)
- Request count by model
- Tool calling requests vs standard chat requests

**Performance Metrics:**
- Response latency (time to first token, total time)
- Token throughput (tokens per second)
- Streaming vs non-streaming performance
- Tool call execution time

**Tool-Specific Metrics:**
- Tool call frequency by function name
- Tool call success/failure rate
- Average tool calls per request
- Tool result size

**Provider Health:**
- Provider availability (health checks)
- Provider error rates
- Provider latency percentiles (p50, p95, p99)

#### Logging

**Request Logging:**
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "request_id": "req_abc123",
  "endpoint": "/v1/chat/completions",
  "provider": "ollama",
  "server": "ollama-server-1",
  "model": "llama3.1",
  "has_tools": true,
  "tool_count": 3,
  "message_count": 5,
  "stream": false
}
```

**Response Logging:**
```json
{
  "timestamp": "2024-01-15T10:30:02Z",
  "request_id": "req_abc123",
  "status": "success",
  "latency_ms": 2345,
  "tokens": {
    "prompt": 150,
    "completion": 75,
    "total": 225
  },
  "finish_reason": "tool_calls",
  "tool_calls_made": 2
}
```

**Tool Call Logging:**
```json
{
  "timestamp": "2024-01-15T10:30:01Z",
  "request_id": "req_abc123",
  "tool_call_id": "call_abc123",
  "function_name": "get_weather",
  "arguments": "{\"location\": \"San Francisco\"}",
  "status": "pending"
}
```

---

### 7. Load Balancing & Pooling

#### Provider Pool Management

**Ollama Server Pool:**
- Multiple Ollama servers configured as providers
- Health checks to detect availability
- Round-robin or weighted distribution
- Failover to healthy servers

**Mixed Provider Pool:**
- Combine Ollama servers with OpenRouter
- Route based on model availability
- Priority-based routing (prefer local Ollama, fallback to OpenRouter)
- Cost-aware routing (OpenRouter has per-token costs)

#### Load Balancing Strategies

**Round Robin:**
```typescript
class RoundRobinBalancer {
  private currentIndex = 0;
  
  selectProvider(providers: ProviderConfig[]): ProviderConfig {
    const provider = providers[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % providers.length;
    return provider;
  }
}
```

**Least Connections:**
```typescript
class LeastConnectionsBalancer {
  private connections = new Map<string, number>();
  
  selectProvider(providers: ProviderConfig[]): ProviderConfig {
    return providers.reduce((least, current) => {
      const leastConns = this.connections.get(least.baseUrl) || 0;
      const currentConns = this.connections.get(current.baseUrl) || 0;
      return currentConns < leastConns ? current : least;
    });
  }
}
```

**Model-Aware Routing:**
```typescript
function selectProviderForModel(
  model: string,
  providers: ProviderConfig[]
): ProviderConfig {
  // Filter providers that support the requested model
  const capable = providers.filter(p => 
    !p.models || p.models.includes(model)
  );
  
  // Prefer local Ollama over OpenRouter
  const ollama = capable.filter(p => p.type === 'ollama');
  if (ollama.length > 0) {
    return loadBalance(ollama);
  }
  
  return loadBalance(capable);
}
```

---

### 8. Error Handling

#### Provider-Specific Errors

**Ollama Errors:**
```json
{
  "error": "model not found",
  "error_code": "model_not_found"
}
```

**OpenRouter Errors:**
```json
{
  "error": {
    "message": "Model not found",
    "type": "invalid_request_error",
    "code": "model_not_found"
  }
}
```

#### Error Response Format (OpenAI-compatible)

```json
{
  "error": {
    "message": "Model 'unknown-model' not found",
    "type": "invalid_request_error",
    "param": "model",
    "code": "model_not_found"
  }
}
```

#### Error Handling Strategy

```typescript
class LMAPIError {
  constructor(
    public message: string,
    public type: string,
    public code: string,
    public statusCode: number,
    public provider?: string
  ) {}
}

// Common error scenarios
const ERROR_HANDLERS = {
  MODEL_NOT_FOUND: (model: string, provider: string) => 
    new LMAPIError(
      `Model '${model}' not available on ${provider}`,
      'invalid_request_error',
      'model_not_found',
      404,
      provider
    ),
  
  TOOL_NOT_SUPPORTED: (model: string) =>
    new LMAPIError(
      `Model '${model}' does not support tool calling`,
      'invalid_request_error',
      'tools_not_supported',
      400
    ),
  
  PROVIDER_UNAVAILABLE: (provider: string) =>
    new LMAPIError(
      `Provider '${provider}' is currently unavailable`,
      'service_unavailable',
      'provider_down',
      503,
      provider
    ),
  
  RATE_LIMIT: (provider: string, retryAfter?: number) =>
    new LMAPIError(
      `Rate limit exceeded for provider '${provider}'`,
      'rate_limit_error',
      'rate_limit_exceeded',
      429,
      provider
    )
};
```

#### Retry Logic

```typescript
async function fetchWithRetry(
  provider: ProviderConfig,
  request: ChatCompletionRequest,
  maxRetries = 3
): Promise<ChatCompletionResponse> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetch(provider, request);
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx except 429)
      if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
```

---

### 9. Configuration Schema

#### LMAPI Configuration File

```json
{
  "providers": [
    {
      "id": "ollama-local-1",
      "type": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "priority": 1,
      "healthCheck": {
        "enabled": true,
        "interval": 30000,
        "endpoint": "/api/tags"
      },
      "models": ["llama3.1", "mistral", "qwen2.5"]
    },
    {
      "id": "ollama-server-2",
      "type": "ollama",
      "baseUrl": "http://192.168.1.100:11434/v1",
      "priority": 2,
      "healthCheck": {
        "enabled": true,
        "interval": 30000
      }
    },
    {
      "id": "openrouter-fallback",
      "type": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "${OPENROUTER_API_KEY}",
      "priority": 3,
      "rateLimit": {
        "requestsPerMinute": 60
      }
    }
  ],
  "loadBalancing": {
    "strategy": "least-connections",
    "preferLocal": true
  },
  "observability": {
    "logging": {
      "level": "info",
      "format": "json"
    },
    "metrics": {
      "enabled": true,
      "port": 9090
    }
  },
  "defaults": {
    "temperature": 0.7,
    "maxTokens": 2000,
    "timeout": 300000
  }
}
```

---

### 10. Implementation Phases

#### Phase 1: Core Chat Completions (Non-streaming, No Tools)
- Implement `/v1/chat/completions` endpoint
- Support basic message format
- Provider configuration and routing
- Ollama integration
- Basic error handling
- Health checks

#### Phase 2: Tool Calling Support
- Implement tool definition schema
- Support tool calls in requests/responses
- Model capability detection
- Tool call flow handling
- Tool-specific error handling

#### Phase 3: Streaming Support
- Implement SSE streaming
- Handle streaming tool calls
- Buffer management for incremental updates
- Streaming error handling

#### Phase 4: OpenRouter Integration
- Add OpenRouter provider type
- Authentication handling
- OpenRouter-specific features
- Cost tracking

#### Phase 5: Advanced Features
- Enhanced load balancing (model-aware, cost-aware)
- Comprehensive observability dashboard
- Request/response caching
- Rate limiting per provider
- Advanced retry strategies

---

## Testing Strategy

### Unit Tests
- Request/response parsing
- Provider configuration validation
- Tool definition schema validation
- Error handling logic

### Integration Tests
- End-to-end chat completion flow
- Tool calling flow (multi-turn conversation)
- Streaming responses
- Provider failover
- Load balancing behavior

### Provider-Specific Tests
- Ollama-specific features
- OpenRouter-specific features
- Cross-provider compatibility

### Performance Tests
- Concurrent request handling
- Streaming throughput
- Load balancing efficiency
- Memory usage under load

---

## Documentation Requirements

### API Documentation
- OpenAPI/Swagger specification for `/v1/chat/completions`
- Request/response examples
- Tool calling examples
- Error codes reference

### Provider Setup Guides
- Ollama server configuration
- OpenRouter account setup
- Multi-provider configuration examples

### Developer Guide
- Tool calling implementation guide
- Streaming client implementation
- Best practices for load balancing

---

## Success Criteria

1. ✅ `/v1/chat/completions` endpoint fully operational
2. ✅ Tool calling works with Ollama models
3. ✅ Tool calling works with OpenRouter models
4. ✅ Streaming responses functional for both providers
5. ✅ Load balancing distributes requests across Ollama servers
6. ✅ Failover to OpenRouter when Ollama unavailable
7. ✅ Observability metrics capture tool calling data
8. ✅ 100% backwards compatibility with existing generate endpoint
9. ✅ Comprehensive test coverage (>80%)
10. ✅ Documentation complete and accurate

---

## Additional Considerations

### Security
- API key storage (environment variables, secrets management)
- Rate limiting to prevent abuse
- Input validation for tool definitions
- Sanitization of tool call arguments

### Performance Optimization
- Connection pooling for providers
- Response caching for identical requests
- Request batching where supported
- Keep-alive connections

### Future Enhancements
- Support for vision models (image inputs)
- Support for audio models
- Fine-tuning API integration
- Embeddings endpoint
- Model comparison/benchmarking tools
- A/B testing framework

---

## References

- [OpenAI API Documentation - Chat Completions](https://platform.openai.com/docs/api-reference/chat)
- [OpenAI API Documentation - Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Ollama OpenAI Compatibility](https://github.com/ollama/ollama/blob/main/docs/openai.md)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [JSON Schema Specification](https://json-schema.org/)
# OpenRouter Integration Guide

This guide explains how to configure and use OpenRouter as a cloud provider fallback for LMAPI.

## Overview

OpenRouter integration allows LMAPI to automatically fall back to cloud-hosted models when:
- The requested model is not available on any local Ollama server
- All local servers are at capacity
- You explicitly want to use a cloud model

## Configuration

### 1. Get an OpenRouter API Key

1. Sign up at [OpenRouter](https://openrouter.ai/)
2. Get your API key from the dashboard
3. Add credits to your account

### 2. Set Up Environment Variable

Create or update your `.env` file in the project root:

```env
OPENROUTER_API_KEY=your_api_key_here
```

### 3. Configure Providers

The `src/config/providers.json` file configures cloud providers. The default configuration:

```json
{
  "openrouter": {
    "enabled": true,
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKeyEnvVar": "OPENROUTER_API_KEY",
    "headers": {
      "HTTP-Referer": "https://lmapi.local",
      "X-Title": "LMAPI"
    },
    "models": [
      "anthropic/claude-sonnet-4",
      "openai/gpt-4o",
      "google/gemini-2.0-flash-exp"
    ],
    "routing": {
      "priority": "fallback",
      "allowedEndpoints": ["chat/completions"]
    }
  }
}
```

#### Configuration Options

- **enabled**: Enable/disable the provider
- **baseUrl**: OpenRouter API base URL
- **apiKeyEnvVar**: Name of the environment variable containing your API key
- **headers**: Custom headers sent with each request
  - `HTTP-Referer`: Your app's URL (for OpenRouter analytics)
  - `X-Title`: Your app's name (for OpenRouter analytics)
- **models**: Array of model IDs available through OpenRouter
  - See [OpenRouter Models](https://openrouter.ai/models) for the full list
- **routing.priority**: 
  - `fallback`: Only use when local servers unavailable (default)
  - `primary`: Prefer cloud provider over local servers (future feature)
- **routing.allowedEndpoints**: Which endpoints can use this provider

### 4. Restart the Server

After updating configuration:

```bash
npm run dev
# or
npm start
```

You should see in the logs:
```
INFO: Loaded cloud provider: openrouter (3 models)
INFO: Provider service initialized with 1 provider(s)
```

## Usage

### Automatic Fallback

Simply request a model that exists on OpenRouter but not locally:

```http
POST http://localhost:3000/v1/chat/completions
Content-Type: application/json

{
    "model": "anthropic/claude-sonnet-4",
    "messages": [
        { "role": "user", "content": "Hello!" }
    ]
}
```

LMAPI will:
1. Check local Ollama servers for the model
2. If not found, route to OpenRouter
3. Return the response with LMAPI metadata indicating the provider

### Mixed Local/Cloud Usage

You can have models available both locally and on OpenRouter. LMAPI will always prefer local servers when available:

```http
POST http://localhost:3000/api/chat/completions/any
Content-Type: application/json

{
    "model": "gpt-4o",
    "messages": [
        { "role": "user", "content": "Explain quantum computing." }
    ]
}
```

- If `gpt-4o` is running on an Ollama server → uses local
- If all local servers are busy → routes to OpenRouter
- If `gpt-4o` not available locally → routes to OpenRouter

### LMAPI Metadata

Responses from cloud providers include metadata:

```json
{
    "id": "chatcmpl-123",
    "object": "chat.completion",
    "model": "anthropic/claude-sonnet-4",
    "choices": [...],
    "usage": {...},
    "lmapi": {
        "server_name": "openrouter",
        "duration_ms": 1234,
        "group_id": null
    }
}
```

The `server_name` field will show "openrouter" for cloud requests.

## Available Models

### Updating the Model List

Edit `src/config/providers.json` to add or remove models:

```json
{
  "openrouter": {
    "models": [
      "anthropic/claude-sonnet-4",
      "anthropic/claude-opus-4",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash-exp",
      "google/gemini-pro-1.5-exp",
      "meta-llama/llama-3.3-70b-instruct"
    ]
  }
}
```

### Popular OpenRouter Models

- **Anthropic Claude**:
  - `anthropic/claude-sonnet-4`
  - `anthropic/claude-opus-4`
  - `anthropic/claude-3.5-sonnet`

- **OpenAI GPT**:
  - `openai/gpt-4o`
  - `openai/gpt-4o-mini`
  - `openai/o1-preview`

- **Google Gemini**:
  - `google/gemini-2.0-flash-exp`
  - `google/gemini-pro-1.5-exp`

- **Meta Llama**:
  - `meta-llama/llama-3.3-70b-instruct`
  - `meta-llama/llama-3.1-405b-instruct`

See the full list at: https://openrouter.ai/models

## Logging and Observability

### Prompt History

All OpenRouter requests are logged to the `PromptHistory` database table with:
- `serverName` = "openrouter"
- `requestType` = "chat"
- Token counts from the response
- Duration in milliseconds

### Dashboard

The real-time dashboard displays OpenRouter requests alongside local server requests, allowing you to monitor:
- Which requests went to the cloud
- Response times
- Token usage
- Error rates

## Troubleshooting

### API Key Not Found

If you see:
```
WARN: Provider openrouter enabled but API key OPENROUTER_API_KEY not found in environment
```

Solution:
1. Create a `.env` file in the project root
2. Add `OPENROUTER_API_KEY=your_key_here`
3. Restart the server

### Provider Not Being Used

If requests queue instead of routing to OpenRouter:

1. Check that the model is listed in `providers.json`:
```json
"models": ["your-model-here"]
```

2. Verify the provider is enabled:
```json
"enabled": true
```

3. Check logs for initialization errors

### Rate Limiting

OpenRouter has rate limits. If you hit them:
1. Check your OpenRouter dashboard for limits
2. Add delays between requests
3. Consider upgrading your OpenRouter plan

## Cost Tracking

OpenRouter charges per token. To track costs:

1. View usage in your OpenRouter dashboard
2. Check `PromptHistory` for token counts:
```sql
SELECT 
    SUM(inputTokens) as total_input_tokens,
    SUM(outputTokens) as total_output_tokens
FROM PromptHistory 
WHERE serverName = 'openrouter';
```

3. Calculate costs based on [OpenRouter Pricing](https://openrouter.ai/models)

## Future Enhancements

Planned features for Phase 8:
- SSE streaming for OpenRouter
- Cost tracking in the API
- Per-provider rate limiting
- Dashboard cost display
- Multiple cloud provider support

## Security Notes

- Never commit your `.env` file to version control
- Keep your OpenRouter API key secure
- Use the `.env` pattern for all sensitive credentials
- Rotate API keys periodically

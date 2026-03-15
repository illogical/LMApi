# LMApi Agent Guidelines

This file provides coding standards and operational guidance for agents working in this repository.

## Build, Lint, and Test Commands

### Running the Application
```bash
npm run dev      # Run with ts-node (development)
npm run build    # Compile TypeScript to dist/
npm run start    # Run compiled JavaScript from dist/
```

### Testing
This project uses manual test scripts rather than a test framework. Run tests with ts-node:

```bash
# Test all routes
npm run test:routes

# Test specific endpoints
npm run test:route:any           # Test /generate/any endpoint
npm run test:route:transcribe    # Test transcription summary
npm run test:chat                # Test chat completions

# Run a single test script directly
ts-node scripts/testRoutes.ts
ts-node scripts/testGenerateAny.ts
ts-node scripts/testTranscriptionSummary.ts
ts-node scripts/testChatCompletions.ts
ts-node scripts/testGrouping.ts
```

### Environment Variables
Create a `.env` file in the root:
```env
PORT=3111
MAX_PARALLEL_PER_SERVER=4
SERVER_CHECK_INTERVAL_MS=300000
LOG_LEVEL=trace
```

## Code Style Guidelines

### General Principles
- Use TypeScript with strict mode enabled (`"strict": true` in tsconfig.json)
- Prefer static service methods over class instantiation (see LogService pattern)
- Keep functions small and focused
- Use Zod for request validation

### Formatting
- **Indentation**: 4 spaces (not tabs)
- **Line length**: No hard limit, but keep lines reasonable (~120 chars ideal)
- **Trailing commas**: Optional
- **Semicolons**: Required

### Imports
Organize imports in the following order:
1. Node.js built-ins (e.g., `path`, `crypto`)
2. External packages (e.g., `express`, `pino`, `zod`)
3. Internal modules (e.g., `../services/LogService`)

Example:
```typescript
import path from 'path';
import { randomUUID } from 'crypto';
import express from 'express';
import { z } from 'zod';
import { LogService } from './services/LogService';
import { ConfigService } from './services/ConfigService';
```

### Naming Conventions
- **Classes**: PascalCase (e.g., `ServerPoolService`)
- **Functions/variables**: camelCase (e.g., `getServers()`, `serverName`)
- **Constants**: PascalCase for static constants, UPPER_SNAKE_CASE for runtime config
- **Interfaces/types**: PascalCase (e.g., `PromptRequest`, `ChatMessage`)
- **Files**: kebab-case (e.g., `server-routes.ts`, `log-service.ts`)

### TypeScript Patterns

#### Interface vs Type
- Use `interface` for object shapes that may be extended
- Use `type` for unions, intersections, and primitives

```typescript
// Preferred for object shapes
export interface PromptRequest {
    prompt: string;
    model: string;
    serverName?: string;
}

// Preferred for unions
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
```

#### Return Types
Always specify return types for functions, especially for async operations:
```typescript
async function getServer(name: string): Promise<ServerStatus | null> {
    // ...
}
```

#### Optional Properties
Use `?` for optional properties rather than `| undefined`:
```typescript
interface Example {
    required: string;
    optional?: string;  // Good
    optionalBad: string | undefined;  // Avoid
}
```

### Service Layer Pattern
Services use static methods. Follow this pattern:
```typescript
export class LogService {
    static trace(msg: string, obj?: object) {
        logger.trace(obj, msg);
    }

    static info(msg: string, obj?: object) {
        logger.info(obj, msg);
    }

    static error(msg: string, obj?: object) {
        logger.error(obj, msg);
    }
}
```

Usage:
```typescript
LogService.info('Server started', { port: 3111 });
```

### Request Validation with Zod
Validate incoming request bodies using Zod schemas:
```typescript
import { z } from 'zod';

const GenerateRequestSchema = z.object({
    prompt: z.string().min(1),
    model: z.string().min(1),
    serverName: z.string().optional(),
    params: z.object({
        temperature: z.number().min(0).max(2).optional(),
    }).optional(),
});

router.post('/generate/any', (req, res) => {
    const result = GenerateRequestSchema.safeParse(req.body);
    if (!result.success) {
        return res.status(400).json({ error: 'Invalid request', details: result.error });
    }
    // proceed with result.data
});
```

### Error Handling

#### Route Error Handling
Always handle errors explicitly and return appropriate status codes:
```typescript
router.get('/servers/:name/status', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
});
```

#### Async Error Handling
Use try/catch for async operations:
```typescript
router.post('/servers/refresh', async (req, res) => {
    try {
        await ServerPoolService.refreshPool();
        const servers = ServerPoolService.getServers();
        res.json({ success: true, servers });
    } catch (error) {
        LogService.error('Failed to refresh servers', { error });
        res.status(500).json({ error: 'Failed to refresh servers' });
    }
});
```

#### Global Error Handler
Express error handler should be at the end of app.ts:
```typescript
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    LogService.error('Unhandled error', { error: err });
    res.status(500).json({ error: 'Internal Server Error' });
});
```

### Logging
Use LogService for all logging:
```typescript
LogService.trace('Request details', { method: req.method, url: req.url });
LogService.debug('Processing prompt', { model: promptRequest.model });
LogService.info('Server added', { serverName: name, url: baseUrl });
LogService.warn('Server unreachable', { serverName: name, attempt: retryCount });
LogService.error('Request failed', { error: err, model: modelName });
```

### API Response Patterns

#### Success Responses
```typescript
// Single item
res.json({ success: true, server: serverStatus });

// List
res.json({ servers: serverList });

// With metadata
res.json({
    total: records.length,
    page: 1,
    pageSize: 50,
    records: results,
});
```

#### Error Responses
```typescript
// Not found
res.status(404).json({ error: 'Server not found' });

// Validation error
res.status(400).json({ error: 'Invalid request', details: validationErrors });

// Server error
res.status(500).json({ error: 'Failed to process request' });
```

### WebSocket Events
When emitting Socket.IO events, use constants from constants.ts:
```typescript
import { SOCKET_EVENTS } from '../constants';

io.emit(SOCKET_EVENTS.SERVER_STATUS_CHANGED, { serverName, isOnline });
io.emit(SOCKET_EVENTS.PROMPT_HISTORY_ADDED, record);
```

### Database
- Use better-sqlite3 for SQLite operations
- Initialize in DbService.initialize()
- Follow schema documented in README.md

### Configuration
- Use ConfigService for all configuration values
- Load .env via `dotenv/config` at app entry point
- Avoid hardcoding configuration values in services

### Testing Guidelines
When writing test scripts:
- Use environment variables for configurable values (PORT, BASE_URL, TEST_MODEL, etc.)
- Set reasonable timeouts (default 60 seconds for LLM requests)
- Log request/response details for debugging
- Use meaningful test names
- Handle errors gracefully and report results

Example test structure:
```typescript
const PORT = process.env.PORT || '3111';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

async function request(method: string, path: string, body?: unknown) {
    const url = `${BASE_URL}${path}`;
    // ... implementation
}

async function main() {
    const resp = await request('GET', '/api/servers');
    // assertions and logging
}
```

### File Organization
```
src/
├── app.ts                 # Express app entry point
├── constants.ts           # Application constants
├── types.ts               # TypeScript interfaces/types
├── config/                # JSON configuration files
├── prompts/               # Prompt templates
├── public/                # Static assets (dashboard)
├── routes/                # Express route handlers
│   ├── server-routes.ts
│   ├── prompt-routes.ts
│   └── ...
└── services/              # Business logic services
    ├── LogService.ts
    ├── ServerPoolService.ts
    └── ...
```

### Important Notes
- This project uses CommonJS (`"type": "commonjs"` in package.json)
- Routes are mounted under `/api` prefix (except OpenAI-compatible endpoints)
- OpenAI-compatible endpoints (`/v1/chat/completions`) are mounted at root
- Server pool prioritizes by configuration order (index 0 = highest priority)

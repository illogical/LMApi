import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import { ConfigService } from './services/ConfigService';
import { LogService } from './services/LogService';

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'LMApi',
            description: `Intelligent request router and load balancer for multiple Ollama LLM servers
with cloud fallback via OpenRouter.

## Routing Strategy (Priority-Fill, VRAM-Aware)
1. **Sticky** — Reuse a server *actively processing* the requested model
2. **Warm Idle** — Pick an idle server whose last model matches and is likely still in VRAM
3. **Cold Idle** — Pick any idle server (servers.json order = priority)
4. **Warm Overflow** — Assign to a busy server whose last model matches (avoids VRAM swap)
5. **Cold Overflow** — Assign to any busy server still below MAX_PARALLEL_PER_SERVER
6. **Queue** — Enqueue if all servers at capacity; dispatch when a slot opens

## Streaming
Endpoints that support \`stream: true\` return \`text/event-stream\` responses.
Each event is prefixed with \`data: \` followed by JSON. The final event is \`data: [DONE]\`.`,
            version: '1.0.0',
            license: {
                name: 'MIT',
            },
        },
        servers: [
            {
                url: `http://localhost:${ConfigService.getPort()}`,
                description: 'Local development server',
            },
        ],
        tags: [
            { name: 'Health', description: 'Health check endpoint' },
            { name: 'Servers', description: 'Server pool management and status' },
            { name: 'Models', description: 'Model discovery and availability' },
            { name: 'Prompts', description: 'Prompt generation and embeddings' },
            { name: 'Chat Completions', description: 'OpenAI-compatible and LMAPI chat completion endpoints' },
            { name: 'History', description: 'Prompt history and analytics' },
            { name: 'Agents', description: 'Domain-specific AI agents (summarization, etc.)' },
            { name: 'Requests', description: 'Active request tracking and queue inspection' },
            { name: 'Evaluate', description: 'Model evaluation and comparison' },
            { name: 'Config', description: 'Runtime configuration' },
        ],
    },
    apis: ['./src/routes/*.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app: Express): void {
    // Serve the Swagger UI at /api-docs
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'LMApi — API Docs',
    }));

    // Serve the raw OpenAPI JSON spec
    app.get('/api-docs.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.json(swaggerSpec);
    });

    LogService.info('Swagger UI available at /api-docs');
}

import { Router } from 'express';
import { z } from 'zod';
import { QueueService } from '../services/QueueService';
import { ServerPoolService } from '../services/ServerPoolService';
import { ChatCompletionRequest } from '../types';
import { randomUUID } from 'crypto';
import { LogService } from '../services/LogService';
import { ProviderService } from '../services/ProviderService';

const router = Router();

// Zod validation schemas for chat completions
const ChatMessageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(z.any()), z.null()]).optional(),
    name: z.string().optional(),
    tool_calls: z.array(z.any()).optional(),
    tool_call_id: z.string().optional()
});

const ChatCompletionSchema = z.object({
    model: z.string(),
    messages: z.array(ChatMessageSchema).min(1),
    tools: z.array(z.any()).optional(),
    tool_choice: z.any().optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    top_p: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    stream: z.boolean().optional().default(false),
    n: z.number().optional(),
    provider: z.string().optional()
});

const EmbeddingSchema = z.object({
    model: z.string(),
    input: z.union([z.string(), z.array(z.string())]),
});

// LMAPI extensions for routing endpoints
const LMAPIChatCompletionSchema = ChatCompletionSchema.extend({
    serverName: z.string().optional(),
    models: z.array(z.string()).optional(),
    groupId: z.string().optional(),
    maxParallelPerServer: z.number().int().positive().optional(),
    provider: z.string().optional()
});

// Batch endpoint schema - omits model field and requires models array instead
const BatchChatCompletionSchema = ChatCompletionSchema.omit({ model: true }).extend({
    models: z.array(z.string()), // Required for batch endpoint
    groupId: z.string().optional(),
    maxParallelPerServer: z.number().int().positive().optional()
});

// Helper to check model availability
function ensureModelAvailable(modelName: string) {
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    if (servers.length) {
        return { ok: true };
    }

    const provider = ProviderService.getProviderForModel(modelName);
    if (provider && provider.routing.priority === 'fallback') {
        return { ok: true };
    }

    return { ok: false, message: `No available servers or cloud providers host model "${modelName}"` };
}

// Helper to create OpenAI-compatible error response
function createErrorResponse(message: string, type: string = 'invalid_request_error', param: string | null = null, code: string | null = null) {
    return {
        error: {
            message,
            type,
            param,
            code
        }
    };
}

/**
 * Handle explicit provider targeting
 */
async function handleProviderRequest(
    body: ChatCompletionRequest,
    res: any,
    includeLmapiMetadata: boolean
): Promise<void> {
    // Check that provider is specified
    if (!body.provider) {
        return res.status(400).json(createErrorResponse(
            'Provider parameter is required',
            'invalid_request_error',
            'provider',
            'provider_required'
        ));
    }

    const provider = ProviderService.getProvider(body.provider);
    
    if (!provider) {
        return res.status(400).json(createErrorResponse(
            `Provider '${body.provider}' not found or disabled`,
            'invalid_request_error',
            'provider',
            'provider_not_found'
        ));
    }
    
    // Check if model is supported by provider
    if (!ProviderService.providerSupportsModel(provider, body.model)) {
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
            body.provider,
            request,
            res
        );
        return;
    }
    
    // Non-streaming
    const result = await QueueService.runCloudProviderRequest(
        body.provider,
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

/**
 * @openapi
 * /v1/chat/completions:
 *   post:
 *     tags: [Chat Completions]
 *     summary: OpenAI-compatible chat completion
 *     description: |
 *       Auto-routes to the best available server. Returns standard OpenAI response
 *       format without LMAPI metadata. Supports streaming (SSE) and non-streaming.
 *       When stream is true, returns text/event-stream with "data: [DONE]" sentinel.
 *       Supports optional provider field for explicit cloud provider targeting.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatCompletionRequest'
 *     responses:
 *       200:
 *         description: Chat completion response (OpenAI-compatible, no LMAPI metadata)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatCompletionResponse'
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: "SSE stream of ChatCompletionChunk objects, ending with data: [DONE]"
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenAIError'
 *       503:
 *         description: Model not available on any server
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenAIError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenAIError'
 */
router.post('/v1/chat/completions', async (req, res) => {
    try {
        const body = ChatCompletionSchema.parse(req.body);
        
        // Check for explicit provider targeting
        if (body.provider) {
            return await handleProviderRequest(body, res, false);
        }
        
        const availability = ensureModelAvailable(body.model);
        if (!availability.ok) {
            return res.status(503).json(createErrorResponse(
                availability.message || 'Model not available',
                'invalid_request_error',
                'model',
                'model_not_found'
            ));
        }

        const request: ChatCompletionRequest = {
            ...body,
            serverName: 'any'
        };

        // Handle streaming
        if (body.stream) {
            const server = ServerPoolService.reserveServerForModel(body.model);
            if (!server) {
                return res.status(503).json(createErrorResponse(
                    'No servers available',
                    'server_error',
                    null,
                    'no_servers_available'
                ));
            }
            
            // This will stream directly to the response
            await QueueService.runChatRequestStreaming(server, request, res);
            return;
        }

        // Non-streaming
        const result = await QueueService.dispatchOrQueueChat(request);
        
        // Remove LMAPI metadata for OpenAI compatibility
        const { lmapi, ...openAIResponse } = result;
        
        res.json(openAIResponse);
    } catch (error: any) {
        LogService.error('[/v1/chat/completions] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json(createErrorResponse(
                'Invalid request body: ' + error.message,
                'invalid_request_error'
            ));
        }
        if (!res.headersSent) {
            res.status(500).json(createErrorResponse(error.message, 'server_error'));
        }
    }
});

/**
 * @openapi
 * /api/chat/completions/any:
 *   post:
 *     tags: [Chat Completions]
 *     summary: LMAPI chat completion with auto-routing
 *     description: |
 *       Auto-selects the best server via the priority-fill routing strategy.
 *       Returns response with LMAPI metadata (server_name, duration_ms, etc.).
 *       Supports streaming (SSE) and non-streaming. Supports explicit provider targeting.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LMAPIChatCompletionRequest'
 *     responses:
 *       200:
 *         description: Chat completion response with LMAPI metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LMAPIChatCompletionResponse'
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: "SSE stream ending with data: [DONE]"
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Model not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/chat/completions/any', async (req, res) => {
    try {
        const body = LMAPIChatCompletionSchema.parse(req.body);
        
        // Check for explicit provider targeting
        if (body.provider) {
            return await handleProviderRequest(body, res, true);
        }
        
        const availability = ensureModelAvailable(body.model);
        if (!availability.ok) {
            return res.status(503).json({ error: availability.message });
        }

        const request: ChatCompletionRequest = {
            ...body,
            serverName: 'any'
        };

        // Handle streaming
        if (body.stream) {
            const server = ServerPoolService.reserveServerForModel(body.model, body.maxParallelPerServer);
            if (!server) {
                return res.status(503).json({ error: 'No servers available' });
            }
            
            await QueueService.runChatRequestStreaming(server, request, res);
            return;
        }

        // Non-streaming
        const result = await QueueService.dispatchOrQueueChat(request);
        res.json(result);
    } catch (error: any) {
        LogService.error('[/api/chat/completions/any] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * @openapi
 * /api/chat/completions/server:
 *   post:
 *     tags: [Chat Completions]
 *     summary: Chat completion on a specific server
 *     description: |
 *       Routes to a specific named server. The `serverName` field is required.
 *       Supports streaming (SSE) and non-streaming.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/LMAPIChatCompletionRequest'
 *               - required: [serverName]
 *     responses:
 *       200:
 *         description: Chat completion response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LMAPIChatCompletionResponse'
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: "SSE stream ending with data: [DONE]"
 *       400:
 *         description: serverName is required or model not supported
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/chat/completions/server', async (req, res) => {
    try {
        const body = LMAPIChatCompletionSchema.parse(req.body);
        
        if (!body.serverName) {
            return res.status(400).json({ error: 'serverName is required' });
        }

        const server = ServerPoolService.getServer(body.serverName);
        if (!server) {
            return res.status(404).json({ error: `Server "${body.serverName}" not found` });
        }

        if (!ServerPoolService.serverSupportsModel(server, body.model)) {
            return res.status(400).json({ 
                error: `Server "${body.serverName}" does not support model "${body.model}"` 
            });
        }

        const request: ChatCompletionRequest = {
            ...body
        };

        // Handle streaming
        if (body.stream) {
            ServerPoolService.incrementActiveRequests(server.config.name, body.model);
            await QueueService.runChatRequestStreaming(server, request, res);
            return;
        }

        // Non-streaming
        const result = await QueueService.dispatchOrQueueChat(request);
        res.json(result);
    } catch (error: any) {
        LogService.error('[/api/chat/completions/server] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * @openapi
 * /api/chat/completions/batch:
 *   post:
 *     tags: [Chat Completions]
 *     summary: Batch chat completion across multiple models
 *     description: |
 *       Sends the same messages to multiple models in parallel. Each model is
 *       auto-routed to the best available server. Returns all results grouped
 *       by a shared group_id.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BatchChatCompletionRequest'
 *     responses:
 *       200:
 *         description: Batch results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LMAPIChatCompletionResponse'
 *                 group_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Some models not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/chat/completions/batch', async (req, res) => {
    try {
        const body = BatchChatCompletionSchema.parse(req.body);

        if (body.models.length === 0) {
            return res.status(400).json({ error: 'models array is required and must not be empty' });
        }

        // Check availability of all models
        const unavailableModels: string[] = [];
        for (const model of body.models) {
            const availability = ensureModelAvailable(model);
            if (!availability.ok) {
                unavailableModels.push(model);
            }
        }

        if (unavailableModels.length > 0) {
            return res.status(503).json({ 
                error: `Models not available: ${unavailableModels.join(', ')}` 
            });
        }

        const groupId = body.groupId || randomUUID();

        // Create requests for each model
        const requests = body.models.map(model => {
            const request: ChatCompletionRequest = {
                ...body,
                model,
                serverName: 'any',
                groupId
            };
            return QueueService.dispatchOrQueueChat(request);
        });

        // Execute in parallel
        const results = await Promise.all(requests);

        res.json({
            results,
            group_id: groupId
        });
    } catch (error: any) {
        LogService.error('[/api/chat/completions/batch] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /api/chat/completions/all:
 *   post:
 *     tags: [Chat Completions]
 *     summary: Broadcast chat completion to all servers
 *     description: |
 *       Broadcasts the same chat messages to all servers that have the specified model.
 *       Returns results from every server grouped by a shared group_id.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LMAPIChatCompletionRequest'
 *     responses:
 *       200:
 *         description: Results from all servers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/LMAPIChatCompletionResponse'
 *                 group_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: model is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: No servers host the requested model
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/chat/completions/all', async (req, res) => {
    try {
        const body = LMAPIChatCompletionSchema.parse(req.body);
        
        if (!body.model) {
            return res.status(400).json({ error: 'model is required' });
        }

        const servers = ServerPoolService.getAvailableServersForModel(body.model);
        if (servers.length === 0) {
            return res.status(503).json({ 
                error: `No available servers host model "${body.model}"` 
            });
        }

        const groupId = body.groupId || randomUUID();

        // Create requests for each server
        const requests = servers.map(server => {
            const request: ChatCompletionRequest = {
                ...body,
                serverName: server.config.name,
                groupId
            };
            return QueueService.dispatchChatDirect(server, request);
        });

        // Execute in parallel
        const results = await Promise.all(requests);

        res.json({
            results,
            group_id: groupId
        });
    } catch (error: any) {
        LogService.error('[/api/chat/completions/all] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /v1/models:
 *   get:
 *     tags: [Models]
 *     summary: OpenAI-compatible model listing
 *     description: |
 *       Returns local Ollama models and enabled cloud-provider models in
 *       OpenAI's model list format, for clients like Open WebUI.
 *     responses:
 *       200:
 *         description: Model list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 object:
 *                   type: string
 *                   example: list
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       object:
 *                         type: string
 *                       owned_by:
 *                         type: string
 */
router.get('/v1/models', (req, res) => {
    const servers = ServerPoolService.getServers();
    const allModels = new Set<string>();
    servers.forEach(s => s.models.forEach(m => allModels.add(m)));
    const sorted = Array.from(allModels).sort((a, b) => a.localeCompare(b));
    const data = sorted.map(id => ({ id, object: 'model', owned_by: 'lmapi' }));

    for (const provider of ProviderService.getProviders()) {
        for (const model of provider.models) {
            data.push({ id: model, object: 'model', owned_by: provider.name });
        }
    }

    res.json({ object: 'list', data });
});

/**
 * @openapi
 * /v1/embeddings:
 *   post:
 *     tags: [Embeddings]
 *     summary: OpenAI-compatible embeddings
 *     description: |
 *       Wraps LMApi's embedding dispatch path in OpenAI's embedding response
 *       shape. Accepts a single input string or an array of strings.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [model, input]
 *             properties:
 *               model:
 *                 type: string
 *               input:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: Embedding results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 object:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 model:
 *                   type: string
 *                 usage:
 *                   type: object
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenAIError'
 *       503:
 *         description: Model not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenAIError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OpenAIError'
 */
router.post('/v1/embeddings', async (req, res) => {
    try {
        const body = EmbeddingSchema.parse(req.body);
        const availability = ensureModelAvailable(body.model);
        if (!availability.ok) {
            return res.status(503).json(createErrorResponse(
                availability.message || 'Model not available',
                'invalid_request_error', 'model', 'model_not_found'
            ));
        }
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        const results = await Promise.all(inputs.map((text, index) =>
            QueueService.dispatchOrQueue({
                prompt: text,
                model: body.model,
                serverName: 'any',
                params: { embedding: true },
            }).then(r => ({ object: 'embedding', embedding: r.response, index }))
        ));
        res.json({
            object: 'list',
            data: results,
            model: body.model,
            usage: { prompt_tokens: 0, total_tokens: 0 },
        });
    } catch (error: any) {
        LogService.error('[/v1/embeddings] Error', { error, url: req.originalUrl, method: req.method, body: req.body });
        if (error.name === 'ZodError') {
            return res.status(400).json(createErrorResponse('Invalid request body: ' + error.message, 'invalid_request_error'));
        }
        if (!res.headersSent) {
            res.status(500).json(createErrorResponse(error.message, 'server_error'));
        }
    }
});

export { router as chatCompletionRoutes };

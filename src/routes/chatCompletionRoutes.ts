import { Router } from 'express';
import { z } from 'zod';
import { QueueService } from '../services/QueueService';
import { ServerPoolService } from '../services/ServerPoolService';
import { ChatCompletionRequest } from '../types';
import { randomUUID } from 'crypto';
import { LogService } from '../services/LogService';

const router = Router();

// Zod validation schemas for chat completions
const ChatMessageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.null()]).optional(),
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
    n: z.number().optional()
});

// LMAPI extensions for routing endpoints
const LMAPIChatCompletionSchema = ChatCompletionSchema.extend({
    serverName: z.string().optional(),
    models: z.array(z.string()).optional(),
    groupId: z.string().optional(),
    maxParallelPerServer: z.number().int().positive().optional()
});

// Helper to check model availability
function ensureModelAvailable(modelName: string) {
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    if (!servers.length) {
        return { ok: false, message: `No available servers host model "${modelName}"` };
    }
    return { ok: true };
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
 * OpenAI-compatible endpoint: POST /v1/chat/completions
 * Auto-routes to best available server (like /any)
 * Returns standard OpenAI response (no LMAPI metadata)
 */
router.post('/v1/chat/completions', async (req, res) => {
    try {
        const body = ChatCompletionSchema.parse(req.body);
        
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
        LogService.error('[/v1/chat/completions] Error', { error });
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
 * LMAPI routing endpoint: POST /api/chat/completions/any
 * Auto-selects best server via ServerPoolService
 * Returns response with LMAPI metadata
 */
router.post('/chat/completions/any', async (req, res) => {
    try {
        const body = LMAPIChatCompletionSchema.parse(req.body);
        
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
        LogService.error('[/api/chat/completions/any] Error', { error });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * LMAPI routing endpoint: POST /api/chat/completions/server
 * Routes to a specific named server
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
        LogService.error('[/api/chat/completions/server] Error', { error });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

/**
 * LMAPI routing endpoint: POST /api/chat/completions/batch
 * Sends same messages to multiple models in parallel
 */
router.post('/chat/completions/batch', async (req, res) => {
    try {
        const body = LMAPIChatCompletionSchema.parse(req.body);
        
        if (!body.models || body.models.length === 0) {
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
        LogService.error('[/api/chat/completions/batch] Error', { error });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

/**
 * LMAPI routing endpoint: POST /api/chat/completions/all
 * Broadcasts to all servers that have the model
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
        LogService.error('[/api/chat/completions/all] Error', { error });
        if (error.name === 'ZodError') {
            return res.status(400).json({ error: 'Invalid request body: ' + error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

export { router as chatCompletionRoutes };

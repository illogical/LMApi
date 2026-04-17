import { Router } from 'express';
import { QueueService } from '../services/QueueService';
import { z } from 'zod';
import { PromptRequest, PromptResponse } from '../types';
import { ServerPoolService } from '../services/ServerPoolService';
import { PromptService } from '../services/PromptService';
import { randomUUID } from 'crypto';

const router = Router();

// Helper function to convert camelCase response fields to snake_case for Ollama schema compatibility
function transformResponseToOllamaSchema(response: PromptResponse): any {
    return {
        response: response.response,
        duration_ms: response.durationMs,
        server_name: response.serverName,
        model: response.model,
        created_at: response.created_at,
        thinking: response.thinking,
        load_duration: response.loadDuration,
        eval_duration: response.evalDuration,
        total_duration: response.totalDuration,
        prompt_eval_count: response.inputTokens,
        eval_count: response.outputTokens
    };
}

const PromptSchema = z.object({
    prompt: z.string(),
    model: z.string(),
    serverName: z.string().optional(),
    groupId: z.string().optional(),
    params: z.record(z.any()).optional(),
    maxParallelPerServer: z.number().int().positive().optional(),
});

// Schema for /generate/all
const AllPromptSchema = z.object({
    prompt: z.string(),
    model: z.string().optional(),
    params: z.record(z.any()).optional(),
    maxParallelPerServer: z.number().int().positive().optional(),
});

const BatchPromptSchema = z.object({
    prompt: z.string(),
    models: z.array(z.string()),
    params: z.record(z.any()).optional(),
    maxParallelPerServer: z.number().int().positive().optional(),
});

function ensureModelAvailable(modelName: string) {
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    if (!servers.length) {
        return { ok: false, message: `No available servers host model "${modelName}"` };
    }
    return { ok: true };
}

/**
 * @openapi
 * /api/prompts/random:
 *   get:
 *     tags: [Prompts]
 *     summary: Get a random prompt
 *     description: Returns a random prompt from the built-in prompt collection.
 *     responses:
 *       200:
 *         description: A random prompt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prompt:
 *                   type: string
 */
router.get('/prompts/random', (req, res) => {
    const prompt = PromptService.getRandomPrompt();
    res.json({ prompt });
});

/**
 * @openapi
 * /api/generate/any:
 *   post:
 *     tags: [Prompts]
 *     summary: Generate with auto-routing
 *     description: Sends a prompt to the best available server using the priority-fill routing strategy. Returns an Ollama-compatible response.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PromptRequest'
 *     responses:
 *       200:
 *         description: Generated response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromptResponse'
 *       503:
 *         description: No servers available for the requested model
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
router.post('/generate/any', async (req, res) => {
    try {
        const body = PromptSchema.parse(req.body);
        const availability = ensureModelAvailable(body.model);
        if (!availability.ok) {
            return res.status(503).json({ error: availability.message });
        }
        const request: PromptRequest = {
            prompt: body.prompt,
            model: body.model,
            serverName: 'any',
            groupId: body.groupId,
            params: body.params,
            maxParallelPerServer: body.maxParallelPerServer
        };

        // We allow QueueService to handle the queueing.
        const result = await QueueService.dispatchOrQueue(request);
        res.json(transformResponseToOllamaSchema(result));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /api/generate/server:
 *   post:
 *     tags: [Prompts]
 *     summary: Generate on a specific server
 *     description: Sends a prompt to a specific named Ollama server. The `serverName` field is required.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/PromptRequest'
 *               - required: [serverName]
 *     responses:
 *       200:
 *         description: Generated response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromptResponse'
 *       400:
 *         description: serverName is required
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
 *       503:
 *         description: Server does not have the requested model
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
router.post('/generate/server', async (req, res) => {
    try {
        const body = PromptSchema.parse(req.body);
        if (!body.serverName) {
            return res.status(400).json({ error: 'serverName is required' });
        }

        const server = ServerPoolService.getServer(body.serverName);
        if (!server) {
            return res.status(404).json({ error: `Server "${body.serverName}" not found` });
        }

        if (!ServerPoolService.serverSupportsModel(server, body.model)) {
            return res.status(503).json({ error: `Server "${body.serverName}" does not have model "${body.model}" available` });
        }

        const request: PromptRequest = {
            prompt: body.prompt,
            model: body.model,
            serverName: body.serverName,
            groupId: body.groupId,
            params: body.params,
            maxParallelPerServer: body.maxParallelPerServer
        };

        const result = await QueueService.dispatchDirect(server, request);
        res.json(transformResponseToOllamaSchema(result));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /api/generate/all:
 *   post:
 *     tags: [Prompts]
 *     summary: Generate on all servers
 *     description: Sends a prompt to all available servers that host the specified model (or all servers if model is "all" or omitted). Returns results from all servers.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [prompt]
 *             properties:
 *               prompt:
 *                 type: string
 *               model:
 *                 type: string
 *                 description: Model name, or omit/"all" to send to every online server
 *               params:
 *                 type: object
 *                 additionalProperties: true
 *               maxParallelPerServer:
 *                 type: integer
 *                 minimum: 1
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
 *                     $ref: '#/components/schemas/PromptResponse'
 *                 groupId:
 *                   type: string
 *                   format: uuid
 *       503:
 *         description: No servers available
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
// /generate/all: send prompt to all available servers for a model
router.post('/generate/all', async (req, res) => {
    try {
        const body = AllPromptSchema.parse(req.body);
        let servers: any[] = [];
        const targetModel = body.model;

        if (!targetModel || targetModel === 'all') {
            servers = ServerPoolService.getServers().filter(s => s.isOnline && s.models.length > 0);
        } else {
            servers = ServerPoolService.getAvailableServersForModel(targetModel);
        }

        if (!servers.length) {
            return res.status(503).json({ error: targetModel && targetModel !== 'all' ? `No available servers host model "${targetModel}"` : 'No online servers available' });
        }

        // For collecting all responses
        const responses: any[] = [];
        let completed = 0;
        let responded = false;
        const groupId = randomUUID();

        // Helper to check if all are done and respond
        function tryRespond() {
            if (!responded && completed === servers.length) {
                responded = true;
                res.json({ results: responses, groupId });
            }
        }

        // For each server, send the prompt in parallel
        servers.forEach(async (server) => {
            const start = Date.now();
            const modelToUse = targetModel && targetModel !== 'all' ? targetModel : server.models[0];
            const request: PromptRequest = {
                prompt: body.prompt,
                model: modelToUse,
                serverName: server.config.name,
                params: body.params,
                groupId,
                maxParallelPerServer: body.maxParallelPerServer
            };
            try {
                // Use dispatchDirect to target specific server
                const result = await QueueService.dispatchDirect(server, request);
                // Insert prompt history and emit event (handled by QueueService.runRequest, but ensure here for clarity)
                // (DbService.insertPromptHistory and SocketService.emitPromptHistoryAdded are called in QueueService)
                responses.push(transformResponseToOllamaSchema(result));
            } catch (err: any) {
                responses.push({
                    serverName: server.config.name,
                    error: err.message || 'Request failed',
                    durationMs: Date.now() - start,
                    model: modelToUse
                });
            } finally {
                completed++;
                tryRespond();
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /api/embed:
 *   post:
 *     tags: [Prompts]
 *     summary: Generate embeddings
 *     description: Generates a vector embedding for the given text using the specified model. Routes to the best available server.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PromptRequest'
 *     responses:
 *       200:
 *         description: Embedding result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromptResponse'
 *       503:
 *         description: No servers available for the requested model
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
router.post('/embed', async (req, res) => {
    try {
        const body = PromptSchema.parse(req.body);
        const availability = ensureModelAvailable(body.model);
        if (!availability.ok) {
            return res.status(503).json({ error: availability.message });
        }
        const request: PromptRequest = {
            prompt: body.prompt, // 'prompt' field used for input text
            model: body.model,
            serverName: 'any',
            params: { ...body.params, embedding: true },
            maxParallelPerServer: body.maxParallelPerServer
        };

        const result = await QueueService.dispatchOrQueue(request);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /api/generate/batch:
 *   post:
 *     tags: [Prompts]
 *     summary: Generate with multiple models
 *     description: Sends the same prompt to multiple models in parallel. Each model is routed to the best available server.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BatchPromptRequest'
 *     responses:
 *       200:
 *         description: Results from all models
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PromptResponse'
 *                 groupId:
 *                   type: string
 *                   format: uuid
 *       503:
 *         description: Some models are not available
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
router.post('/generate/batch', async (req, res) => {
    try {
        const body = BatchPromptSchema.parse(req.body);

        const missingModels = body.models.filter((model, idx, arr) => {
            // de-duplicate models while checking
            if (arr.indexOf(model) !== idx) return false;
            return ServerPoolService.getAvailableServersForModel(model).length === 0;
        });

        if (missingModels.length) {
            return res.status(503).json({ error: `No available servers host: ${missingModels.join(', ')}` });
        }

        const groupId = randomUUID();

        // Create multiple requests
        const promises = body.models.map(model => {
            const request: PromptRequest = {
                prompt: body.prompt,
                model: model,
                serverName: 'any', // Let the system decide best server for each model
                params: body.params,
                groupId,
                maxParallelPerServer: body.maxParallelPerServer
            };
            return QueueService.dispatchOrQueue(request);
        });

        const results = await Promise.all(promises);
        res.json({ results: results.map(transformResponseToOllamaSchema), groupId });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const promptRoutes = router;

import { Router } from 'express';
import { QueueService } from '../services/QueueService';
import { z } from 'zod';
import { PromptRequest } from '../types';
import { ServerPoolService } from '../services/ServerPoolService';
import { PromptService } from '../services/PromptService';
import { randomUUID } from 'crypto';

const router = Router();

const PromptSchema = z.object({
    prompt: z.string(),
    model: z.string(),
    serverName: z.string().optional(),
    groupId: z.string().optional(),
    params: z.record(z.any()).optional(),
});

// Schema for /generate/all
const AllPromptSchema = z.object({
    prompt: z.string(),
    model: z.string().optional(),
    params: z.record(z.any()).optional(),
});

const BatchPromptSchema = z.object({
    prompt: z.string(),
    models: z.array(z.string()),
    params: z.record(z.any()).optional(),
});

function ensureModelAvailable(modelName: string) {
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    if (!servers.length) {
        return { ok: false, message: `No available servers host model "${modelName}"` };
    }
    return { ok: true };
}

router.get('/prompts/random', (req, res) => {
    const prompt = PromptService.getRandomPrompt();
    res.json({ prompt });
});

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
            params: body.params
        };

        // We allow QueueService to handle the queueing.
        const result = await QueueService.dispatchOrQueue(request);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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
            params: body.params
        };

        const result = await QueueService.dispatchDirect(server, request);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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
                groupId
            };
            try {
                // Use dispatchDirect to target specific server
                const result = await QueueService.dispatchDirect(server, request);
                // Insert prompt history and emit event (handled by QueueService.runRequest, but ensure here for clarity)
                // (DbService.insertPromptHistory and SocketService.emitPromptHistoryAdded are called in QueueService)
                responses.push({
                    serverName: result.serverName,
                    response: result.response,
                    durationMs: result.durationMs,
                    model: result.model,
                    created_at: result.created_at
                });
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
            params: { ...body.params, embedding: true }
        };

        const result = await QueueService.dispatchOrQueue(request);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

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
                groupId
            };
            return QueueService.dispatchOrQueue(request);
        });

        const results = await Promise.all(promises);
        res.json({ results, groupId });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const promptRoutes = router;

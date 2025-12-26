import { Router } from 'express';
import { QueueService } from '../services/QueueService';
import { z } from 'zod';
import { PromptRequest } from '../types';
import { ServerPoolService } from '../services/ServerPoolService';

const router = Router();

const PromptSchema = z.object({
    prompt: z.string(),
    model: z.string(),
    serverName: z.string().optional(),
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
            params: body.params
        };

        const result = await QueueService.dispatchOrQueue(request);
        res.json(result);
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

        // Create multiple requests
        const promises = body.models.map(model => {
            const request: PromptRequest = {
                prompt: body.prompt,
                model: model,
                serverName: 'any', // Let the system decide best server for each model
                params: body.params
            };
            return QueueService.dispatchOrQueue(request);
        });

        const results = await Promise.all(promises);
        res.json({ results });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export const promptRoutes = router;

import { Router } from 'express';
import { ServerPoolService } from '../services/ServerPoolService';

const router = Router();

/**
 * @openapi
 * /api/models:
 *   get:
 *     tags: [Models]
 *     summary: List all models
 *     description: Returns a deduplicated, sorted list of all model names across all configured servers.
 *     responses:
 *       200:
 *         description: All model names
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["llama3.1:8b", "mistral:latest", "qwen2:7b"]
 */
router.get('/models', (req, res) => {
    const servers = ServerPoolService.getServers();
    const allModels = new Set<string>();
    servers.forEach(s => s.models.forEach(m => allModels.add(m)));
    const sortedModels = Array.from(allModels).sort((a, b) => a.localeCompare(b));
    res.json({ models: sortedModels });
});

/**
 * @openapi
 * /api/models/loaded:
 *   get:
 *     tags: [Models]
 *     summary: List models on online servers
 *     description: Returns a deduplicated, sorted list of models available on servers that are currently online.
 *     responses:
 *       200:
 *         description: Available model names
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/models/loaded', (req, res) => {
    const servers = ServerPoolService.getServers().filter(s => s.isOnline);
    const availableModels = new Set<string>();
    servers.forEach(s => s.models.forEach(m => availableModels.add(m)));
    const sortedModels = Array.from(availableModels).sort((a, b) => a.localeCompare(b));
    res.json({ models: sortedModels });
});

/**
 * @openapi
 * /api/models/by-server:
 *   get:
 *     tags: [Models]
 *     summary: List models grouped by server
 *     description: Returns models available on each online, non-disabled server.
 *     responses:
 *       200:
 *         description: Models grouped by server
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 servers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       models:
 *                         type: array
 *                         items:
 *                           type: string
 */
router.get('/models/by-server', (req, res) => {
    const servers = ServerPoolService.getServers()
        .filter(s => s.isOnline && !s.config.disabled)
        .map(s => ({
            name: s.config.name,
            models: [...s.models].sort((a, b) => a.localeCompare(b)),
        }));
    res.json({ servers });
});

/**
 * @openapi
 * /api/models/{model}/servers:
 *   get:
 *     tags: [Models]
 *     summary: List servers hosting a model
 *     description: Returns the names of all available servers that have the specified model.
 *     parameters:
 *       - in: path
 *         name: model
 *         required: true
 *         schema:
 *           type: string
 *         description: Model name (e.g., "llama3.1:8b")
 *     responses:
 *       200:
 *         description: Server names hosting the model
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 servers:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.get('/models/:model/servers', (req, res) => {
    const modelName = req.params.model;
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    res.json({ servers: servers.map(s => s.config.name) });
});

export const modelRoutes = router;

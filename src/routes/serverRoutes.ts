import { Router } from 'express';
import { ServerPoolService } from '../services/ServerPoolService';
import { ConfigService } from '../services/ConfigService';
import { ServerConfigService } from '../services/ServerConfigService';
import { z } from 'zod';

const router = Router();

/**
 * @openapi
 * /api/config:
 *   get:
 *     tags: [Config]
 *     summary: Get runtime configuration
 *     description: Returns the current runtime configuration values for the LMApi instance.
 *     responses:
 *       200:
 *         description: Current configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 maxParallelPerServer:
 *                   type: integer
 *                   description: Maximum concurrent requests per Ollama server
 *                 serverCheckIntervalMs:
 *                   type: integer
 *                   description: Interval (ms) between background health checks
 *                 port:
 *                   type: integer
 *                   description: HTTP server port
 *                 logLevel:
 *                   type: string
 *                   description: Current Pino log level
 *                 serverCount:
 *                   type: integer
 *                   description: Total number of configured servers
 */
router.get('/config', (req, res) => {
    res.json({
        maxParallelPerServer: ConfigService.getMaxParallelPerServer(),
        serverCheckIntervalMs: ConfigService.getServerCheckIntervalMs(),
        port: ConfigService.getPort(),
        logLevel: ConfigService.getLogLevel(),
        serverCount: ConfigService.getServers().length
    });
});

/**
 * @openapi
 * /api/servers:
 *   get:
 *     tags: [Servers]
 *     summary: List all servers
 *     description: Returns the full list of configured Ollama servers with their current status, models, and active request counts.
 *     responses:
 *       200:
 *         description: Array of server status objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ServerStatus'
 */
router.get('/servers', (req, res) => {
    const servers = ServerPoolService.getServers();
    res.json(servers);
});

/**
 * @openapi
 * /api/servers/available:
 *   get:
 *     tags: [Servers]
 *     summary: List available servers
 *     description: Returns only servers that are online and not disabled.
 *     responses:
 *       200:
 *         description: Available servers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 servers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServerStatus'
 */
router.get('/servers/available', (req, res) => {
    const servers = ServerPoolService.getServers().filter(s => s.isOnline && !s.config.disabled);
    res.json({ servers });
});

/**
 * @openapi
 * /api/servers/{name}/status:
 *   get:
 *     tags: [Servers]
 *     summary: Get server status
 *     description: Returns the current status of a specific server by name.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Server name
 *     responses:
 *       200:
 *         description: Server status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServerStatus'
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/servers/:name/status', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
});

/**
 * @openapi
 * /api/servers/{name}/models:
 *   get:
 *     tags: [Servers]
 *     summary: List models on a server
 *     description: Returns all models available on the specified server.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Server name
 *     responses:
 *       200:
 *         description: Models list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/servers/:name/models', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    // TODO: We strictly use cache or trigger refresh? logic is in ServerPool/ModelCache
    // ServerPoolService.statusMap has the models.
    res.json({ models: server.models });
});

/**
 * @openapi
 * /api/servers/{name}/models/loaded:
 *   get:
 *     tags: [Servers]
 *     summary: List loaded (running) models on a server
 *     description: Returns models currently loaded into VRAM on the specified server.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Server name
 *     responses:
 *       200:
 *         description: Running models
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 running:
 *                   type: array
 *                   items:
 *                     type: object
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/servers/:name/models/loaded', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    res.json({ running: server.runningModels });
});

/**
 * @openapi
 * /api/servers/refresh:
 *   post:
 *     tags: [Servers]
 *     summary: Refresh all servers
 *     description: Triggers a health check and model list refresh for all configured servers.
 *     responses:
 *       200:
 *         description: Refresh successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 servers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServerStatus'
 *       500:
 *         description: Refresh failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/servers/refresh', async (req, res) => {
    try {
        await ServerPoolService.refreshPool();
        const servers = ServerPoolService.getServers();
        res.json({ success: true, servers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh servers' });
    }
});

/**
 * @openapi
 * /api/servers/{name}/refresh:
 *   post:
 *     tags: [Servers]
 *     summary: Refresh a specific server
 *     description: Triggers a health check and model list refresh for the specified server.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Server name
 *     responses:
 *       200:
 *         description: Server refreshed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 server:
 *                   $ref: '#/components/schemas/ServerStatus'
 *       404:
 *         description: Server not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Refresh failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/servers/:name/refresh', async (req, res) => {
    try {
        const server = ServerPoolService.getServer(req.params.name);
        if (!server) {
            return res.status(404).json({ error: 'Server not found' });
        }
        await ServerPoolService.refreshServer(req.params.name);
        const updatedServer = ServerPoolService.getServer(req.params.name);
        res.json({ success: true, server: updatedServer });
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh server' });
    }
});

/**
 * @openapi
 * /api/servers/{name}/disabled:
 *   patch:
 *     tags: [Servers]
 *     summary: Enable or disable a server
 *     description: Dynamically enable or disable a server in the pool. Changes are persisted to servers.json.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Server name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [disabled]
 *             properties:
 *               disabled:
 *                 type: boolean
 *                 description: Set to true to disable, false to enable
 *     responses:
 *       200:
 *         description: Server updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 servers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServerStatus'
 *       400:
 *         description: Invalid request body
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
 */
// PATCH /api/servers/:name/disabled — enable or disable a server in real time
router.patch('/servers/:name/disabled', (req, res) => {
    const DisabledSchema = z.object({ disabled: z.boolean() });
    const parsed = DisabledSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Body must be { disabled: boolean }' });
    }

    try {
        const updatedServers = ServerConfigService.setDisabled(req.params.name, parsed.data.disabled);
        ServerPoolService.applyConfigUpdate(updatedServers);
        res.json({ success: true, servers: ServerPoolService.getServers() });
    } catch (error: any) {
        const status = error.message?.includes('not found') ? 404 : 500;
        res.status(status).json({ error: error.message ?? 'Failed to update server' });
    }
});

/**
 * @openapi
 * /api/servers/order:
 *   put:
 *     tags: [Servers]
 *     summary: Reorder servers
 *     description: Reorder the server pool priority. Persists the new order to servers.json. Index 0 is highest priority for routing.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [names]
 *             properties:
 *               names:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Ordered array of server names (highest priority first)
 *                 minItems: 1
 *     responses:
 *       200:
 *         description: Order updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 servers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServerStatus'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Server not found in list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// PUT /api/servers/order — reorder servers, persists to servers.json (affects routing priority)
router.put('/servers/order', (req, res) => {
    const OrderSchema = z.object({ names: z.array(z.string()).min(1) });
    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Body must be { names: string[] }' });
    }

    try {
        const updatedServers = ServerConfigService.reorderServers(parsed.data.names);
        ServerPoolService.applyConfigUpdate(updatedServers);
        res.json({ success: true, servers: ServerPoolService.getServers() });
    } catch (error: any) {
        const status = error.message?.includes('not found') ? 404 : 500;
        res.status(status).json({ error: error.message ?? 'Failed to reorder servers' });
    }
});

export const serverRoutes = router;

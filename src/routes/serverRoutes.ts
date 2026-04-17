import { Router } from 'express';
import { ServerPoolService } from '../services/ServerPoolService';
import { ConfigService } from '../services/ConfigService';
import { ServerConfigService } from '../services/ServerConfigService';
import { z } from 'zod';

const router = Router();

router.get('/config', (req, res) => {
    res.json({
        maxParallelPerServer: ConfigService.getMaxParallelPerServer(),
        serverCheckIntervalMs: ConfigService.getServerCheckIntervalMs(),
        port: ConfigService.getPort(),
        logLevel: ConfigService.getLogLevel(),
        serverCount: ConfigService.getServers().length
    });
});

router.get('/servers', (req, res) => {
    const servers = ServerPoolService.getServers();
    res.json(servers);
});

router.get('/servers/available', (req, res) => {
    const servers = ServerPoolService.getServers().filter(s => s.isOnline && !s.config.disabled);
    res.json({ servers });
});

router.get('/servers/:name/status', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
});

router.get('/servers/:name/models', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    // TODO: We strictly use cache or trigger refresh? logic is in ServerPool/ModelCache
    // ServerPoolService.statusMap has the models.
    res.json({ models: server.models });
});

router.get('/servers/:name/models/loaded', (req, res) => {
    const server = ServerPoolService.getServer(req.params.name);
    if (!server) {
        return res.status(404).json({ error: 'Server not found' });
    }
    res.json({ running: server.runningModels });
});

router.post('/servers/refresh', async (req, res) => {
    try {
        await ServerPoolService.refreshPool();
        const servers = ServerPoolService.getServers();
        res.json({ success: true, servers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh servers' });
    }
});

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

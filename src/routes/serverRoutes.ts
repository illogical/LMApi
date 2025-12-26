import { Router } from 'express';
import { ServerPoolService } from '../services/ServerPoolService';
import { z } from 'zod';

const router = Router();

router.get('/servers', (req, res) => {
    const servers = ServerPoolService.getServers();
    res.json(servers);
});

router.get('/servers/available', (req, res) => {
    const servers = ServerPoolService.getServers().filter(s => s.isOnline);
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
    // We strictly use cache or trigger refresh? logic is in ServerPool/ModelCache
    // ServerPoolService.statusMap has the models.
    res.json({ models: server.models });
});

export const serverRoutes = router;

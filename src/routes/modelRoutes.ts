import { Router } from 'express';
import { ServerPoolService } from '../services/ServerPoolService';

const router = Router();

router.get('/models', (req, res) => {
    const servers = ServerPoolService.getServers();
    const allModels = new Set<string>();
    servers.forEach(s => s.models.forEach(m => allModels.add(m)));
    const sortedModels = Array.from(allModels).sort((a, b) => a.localeCompare(b));
    res.json({ models: sortedModels });
});

router.get('/models/loaded', (req, res) => {
    const servers = ServerPoolService.getServers().filter(s => s.isOnline);
    const availableModels = new Set<string>();
    servers.forEach(s => s.models.forEach(m => availableModels.add(m)));
    const sortedModels = Array.from(availableModels).sort((a, b) => a.localeCompare(b));
    res.json({ models: sortedModels });
});

router.get('/models/:model/servers', (req, res) => {
    const modelName = req.params.model;
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    res.json({ servers: servers.map(s => s.config.name) });
});

export const modelRoutes = router;

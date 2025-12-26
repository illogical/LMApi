import { Router } from 'express';
import { ServerPoolService } from '../services/ServerPoolService';

const router = Router();

router.get('/models/:model/servers', (req, res) => {
    const modelName = req.params.model;
    const servers = ServerPoolService.getAvailableServersForModel(modelName);
    res.json({ servers: servers.map(s => s.config.name) });
});

export const modelRoutes = router;

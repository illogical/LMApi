import { Router } from 'express';
import { DbService } from '../services/DbService';
import { ServerPoolService } from '../services/ServerPoolService';
import { RequestRegistryService } from '../services/RequestRegistryService';

export const healthRoutes = Router();

healthRoutes.get('/health', (_req, res) => {
    let dbOk = false;
    try {
        DbService.getDb().prepare('SELECT 1').get();
        dbOk = true;
    } catch {
        dbOk = false;
    }

    const onlineServers = ServerPoolService.getServers().filter(s => s.isOnline).length;

    res.json({
        ok: true,
        db: dbOk,
        onlineServers,
        activeRequests: RequestRegistryService.getActive().length,
        queueLength: RequestRegistryService.getQueueSnapshot().length,
    });
});

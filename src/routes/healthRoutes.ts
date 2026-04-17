import { Router } from 'express';
import { DbService } from '../services/DbService';
import { ServerPoolService } from '../services/ServerPoolService';
import { RequestRegistryService } from '../services/RequestRegistryService';

export const healthRoutes = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     description: Returns the health status of the LMApi service including database connectivity, online server count, active requests, and queue length.
 *     responses:
 *       200:
 *         description: Service health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   example: true
 *                 db:
 *                   type: boolean
 *                   description: Whether the SQLite database is responsive
 *                 onlineServers:
 *                   type: integer
 *                   description: Number of Ollama servers currently online
 *                 activeRequests:
 *                   type: integer
 *                   description: Number of requests currently being processed
 *                 queueLength:
 *                   type: integer
 *                   description: Number of requests waiting in the queue
 */
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

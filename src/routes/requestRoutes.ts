import { Router } from 'express';
import { RequestRegistryService } from '../services/RequestRegistryService';

export const requestRoutes = Router();

/**
 * @openapi
 * /api/requests/active:
 *   get:
 *     tags: [Requests]
 *     summary: List active requests
 *     description: Returns all requests currently being processed (queued, dispatching, streaming, evaluating).
 *     responses:
 *       200:
 *         description: Active requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requests:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ActiveRequestState'
 */
requestRoutes.get('/requests/active', (_req, res) => {
    res.json({ requests: RequestRegistryService.getActive() });
});

/**
 * @openapi
 * /api/requests/{requestId}:
 *   get:
 *     tags: [Requests]
 *     summary: Get request status
 *     description: Returns the current state of a specific request by its ID.
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *         description: Request ID (UUID)
 *     responses:
 *       200:
 *         description: Request state
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ActiveRequestState'
 *       404:
 *         description: Request not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
requestRoutes.get('/requests/:requestId', (req, res) => {
    const state = RequestRegistryService.getOne(req.params.requestId);
    if (!state) {
        res.status(404).json({ error: 'Request not found' });
        return;
    }
    res.json(state);
});

/**
 * @openapi
 * /api/groups/{groupId}:
 *   get:
 *     tags: [Requests]
 *     summary: Get group status
 *     description: Returns aggregated status for a group of related requests (batch/broadcast operations).
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *         description: Group ID (UUID)
 *     responses:
 *       200:
 *         description: Group status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GroupStatus'
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
requestRoutes.get('/groups/:groupId', (req, res) => {
    const status = RequestRegistryService.getGroupStatus(req.params.groupId);
    if (!status) {
        res.status(404).json({ error: 'Group not found' });
        return;
    }
    res.json(status);
});

/**
 * @openapi
 * /api/queue:
 *   get:
 *     tags: [Requests]
 *     summary: Get queue snapshot
 *     description: Returns a snapshot of all requests currently waiting in the queue.
 *     responses:
 *       200:
 *         description: Queue contents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queue:
 *                   type: array
 *                   items:
 *                     type: object
 *                 length:
 *                   type: integer
 *                   description: Number of items in the queue
 */
requestRoutes.get('/queue', (_req, res) => {
    const queue = RequestRegistryService.getQueueSnapshot();
    res.json({ queue, length: queue.length });
});

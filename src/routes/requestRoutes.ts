import { Router } from 'express';
import { RequestRegistryService } from '../services/RequestRegistryService';

export const requestRoutes = Router();

requestRoutes.get('/requests/active', (_req, res) => {
    res.json({ requests: RequestRegistryService.getActive() });
});

requestRoutes.get('/requests/:requestId', (req, res) => {
    const state = RequestRegistryService.getOne(req.params.requestId);
    if (!state) {
        res.status(404).json({ error: 'Request not found' });
        return;
    }
    res.json(state);
});

requestRoutes.get('/groups/:groupId', (req, res) => {
    const status = RequestRegistryService.getGroupStatus(req.params.groupId);
    if (!status) {
        res.status(404).json({ error: 'Group not found' });
        return;
    }
    res.json(status);
});

requestRoutes.get('/queue', (_req, res) => {
    const queue = RequestRegistryService.getQueueSnapshot();
    res.json({ queue, length: queue.length });
});

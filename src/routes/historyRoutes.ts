import { Router } from 'express';
import { z } from 'zod';
import { DbService } from '../services/DbService';

const router = Router();

const QuerySchema = z.object({
    limit: z.coerce.number().min(1).max(200).default(50),
    page: z.coerce.number().min(1).default(1),
    sort: z.enum(['createdAt', 'responseDurationMs', 'serverName', 'modelName']).default('createdAt'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    model: z.string().trim().min(1).optional(),
    serverName: z.string().trim().min(1).optional(),
});

router.get('/prompt-history', (req, res) => {
    try {
        const parsed = QuerySchema.parse(req.query);
        const limit = parsed.limit;
        const page = parsed.page;
        const offset = (page - 1) * limit;

        const { total, records } = DbService.getPromptHistory({
            limit,
            offset,
            sort: parsed.sort,
            direction: parsed.dir.toUpperCase() as 'ASC' | 'DESC',
            modelName: parsed.model,
            serverName: parsed.serverName,
        });

        res.json({
            total,
            page,
            pageSize: limit,
            records,
        });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

export const historyRoutes = router;

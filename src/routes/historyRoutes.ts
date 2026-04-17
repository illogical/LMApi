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
    provider: z.string().trim().min(1).optional(),
    groupId: z.string().trim().min(1).optional(),
    requestType: z.enum(['generate', 'chat', 'embed', 'agent']).optional(),
    isError: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
    createdAfter: z.string().datetime({ offset: true }).optional(),
    createdBefore: z.string().datetime({ offset: true }).optional(),
    durationGt: z.coerce.number().min(0).optional(),
    durationLt: z.coerce.number().min(0).optional(),
});

/**
 * @openapi
 * /api/prompt-history:
 *   get:
 *     tags: [History]
 *     summary: Query prompt history
 *     description: Returns paginated prompt history records with filtering and sorting options.
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *         description: Number of records per page
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [createdAt, responseDurationMs, serverName, modelName]
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: dir
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort direction
 *       - in: query
 *         name: model
 *         schema:
 *           type: string
 *         description: Filter by model name
 *       - in: query
 *         name: serverName
 *         schema:
 *           type: string
 *         description: Filter by server name
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *         description: Filter by provider (alias for serverName)
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: string
 *         description: Filter by group ID
 *       - in: query
 *         name: requestType
 *         schema:
 *           type: string
 *           enum: [generate, chat, embed, agent]
 *         description: Filter by request type
 *       - in: query
 *         name: isError
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Filter by error status
 *       - in: query
 *         name: createdAfter
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter records created after this timestamp (ISO 8601)
 *       - in: query
 *         name: createdBefore
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Filter records created before this timestamp (ISO 8601)
 *       - in: query
 *         name: durationGt
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Filter records with duration greater than this (ms)
 *       - in: query
 *         name: durationLt
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Filter records with duration less than this (ms)
 *     responses:
 *       200:
 *         description: Paginated history records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Total number of matching records
 *                 page:
 *                   type: integer
 *                 pageSize:
 *                   type: integer
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/prompt-history', (req, res) => {
    try {
        const parsed = QuerySchema.parse(req.query);
        const limit = parsed.limit;
        const page = parsed.page;
        const offset = (page - 1) * limit;

        // Support both serverName and provider (they're the same column)
        const serverNameFilter = parsed.serverName || parsed.provider;

        const { total, records } = DbService.getPromptHistory({
            limit,
            offset,
            sort: parsed.sort,
            direction: parsed.dir.toUpperCase() as 'ASC' | 'DESC',
            modelName: parsed.model,
            serverName: serverNameFilter,
            groupId: parsed.groupId,
            requestType: parsed.requestType,
            isError: parsed.isError,
            createdAfter: parsed.createdAfter,
            createdBefore: parsed.createdBefore,
            durationGt: parsed.durationGt,
            durationLt: parsed.durationLt,
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

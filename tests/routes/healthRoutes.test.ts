import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { healthRoutes } from '../../src/routes/healthRoutes';
import { DbService } from '../../src/services/DbService';
import { ServerPoolService } from '../../src/services/ServerPoolService';
import { RequestRegistryService } from '../../src/services/RequestRegistryService';

vi.mock('../../src/services/DbService', () => ({
    DbService: {
        getDb: vi.fn().mockReturnValue({
            prepare: vi.fn().mockReturnValue({
                get: vi.fn().mockReturnValue({ '1': 1 }),
            }),
        }),
        initialize: vi.fn(),
    },
}));

vi.mock('../../src/services/ServerPoolService', () => ({
    ServerPoolService: {
        getServers: vi.fn().mockReturnValue([
            { config: { name: 'alpha' }, isOnline: true },
            { config: { name: 'beta' }, isOnline: false },
        ]),
    },
}));

vi.mock('../../src/services/RequestRegistryService', () => ({
    RequestRegistryService: {
        getActive: vi.fn().mockReturnValue([
            { requestId: 'req-1', phase: 'evaluating' },
        ]),
        getQueueSnapshot: vi.fn().mockReturnValue([
            { requestId: 'req-2', phase: 'queued' },
        ]),
    },
}));

describe('healthRoutes', () => {
    const app = createTestApp(healthRoutes, '/');

    describe('GET /health', () => {
        it('should return health status', async () => {
            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.db).toBe(true);
            expect(res.body.onlineServers).toBe(1);
            expect(res.body.activeRequests).toBe(1);
            expect(res.body.queueLength).toBe(1);
        });

        it('should report db as false when SELECT 1 fails', async () => {
            vi.mocked(DbService.getDb).mockReturnValueOnce({
                prepare: vi.fn().mockReturnValue({
                    get: vi.fn().mockImplementation(() => { throw new Error('DB error'); }),
                }),
            } as any);

            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body.db).toBe(false);
        });
    });
});

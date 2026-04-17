import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { requestRoutes } from '../../src/routes/requestRoutes';
import { RequestRegistryService } from '../../src/services/RequestRegistryService';

vi.mock('../../src/services/RequestRegistryService', () => ({
    RequestRegistryService: {
        getActive: vi.fn(),
        getOne: vi.fn(),
        getGroupStatus: vi.fn(),
        getQueueSnapshot: vi.fn(),
    },
}));

describe('requestRoutes', () => {
    const app = createTestApp(requestRoutes);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/requests/active', () => {
        it('should return active requests', async () => {
            vi.mocked(RequestRegistryService.getActive).mockReturnValue([
                {
                    requestId: 'req-1',
                    requestType: 'chat',
                    modelName: 'llama3.2',
                    phase: 'evaluating',
                    startedAt: new Date().toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    elapsedMs: 100,
                    retryCount: 0,
                },
            ]);

            const res = await request(app).get('/api/requests/active');
            expect(res.status).toBe(200);
            expect(res.body.requests).toHaveLength(1);
            expect(res.body.requests[0].requestId).toBe('req-1');
        });

        it('should return empty array when no active requests', async () => {
            vi.mocked(RequestRegistryService.getActive).mockReturnValue([]);

            const res = await request(app).get('/api/requests/active');
            expect(res.status).toBe(200);
            expect(res.body.requests).toHaveLength(0);
        });
    });

    describe('GET /api/requests/:requestId', () => {
        it('should return a specific request', async () => {
            vi.mocked(RequestRegistryService.getOne).mockReturnValue({
                requestId: 'req-1',
                requestType: 'generate',
                modelName: 'llama3.2',
                phase: 'completed',
                startedAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
                elapsedMs: 500,
                retryCount: 0,
            });

            const res = await request(app).get('/api/requests/req-1');
            expect(res.status).toBe(200);
            expect(res.body.requestId).toBe('req-1');
        });

        it('should return 404 for nonexistent request', async () => {
            vi.mocked(RequestRegistryService.getOne).mockReturnValue(undefined);

            const res = await request(app).get('/api/requests/nonexistent');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Request not found');
        });
    });

    describe('GET /api/groups/:groupId', () => {
        it('should return group status', async () => {
            vi.mocked(RequestRegistryService.getGroupStatus).mockReturnValue({
                groupId: 'grp-1',
                total: 3,
                queued: 0,
                running: 1,
                completed: 2,
                failed: 0,
                byModel: { 'llama3.2': 2, 'qwen2.5': 1 },
                byServer: { alpha: 3 },
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const res = await request(app).get('/api/groups/grp-1');
            expect(res.status).toBe(200);
            expect(res.body.groupId).toBe('grp-1');
            expect(res.body.total).toBe(3);
        });

        it('should return 404 for nonexistent group', async () => {
            vi.mocked(RequestRegistryService.getGroupStatus).mockReturnValue(null);

            const res = await request(app).get('/api/groups/nonexistent');
            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Group not found');
        });
    });

    describe('GET /api/queue', () => {
        it('should return queue snapshot', async () => {
            vi.mocked(RequestRegistryService.getQueueSnapshot).mockReturnValue([
                {
                    requestId: 'q-1',
                    requestType: 'chat',
                    modelName: 'llama3.2',
                    phase: 'queued',
                    startedAt: new Date().toISOString(),
                    lastActivityAt: new Date().toISOString(),
                    elapsedMs: 50,
                    retryCount: 0,
                },
            ]);

            const res = await request(app).get('/api/queue');
            expect(res.status).toBe(200);
            expect(res.body.queue).toHaveLength(1);
            expect(res.body.length).toBe(1);
        });

        it('should return empty queue', async () => {
            vi.mocked(RequestRegistryService.getQueueSnapshot).mockReturnValue([]);

            const res = await request(app).get('/api/queue');
            expect(res.status).toBe(200);
            expect(res.body.queue).toHaveLength(0);
            expect(res.body.length).toBe(0);
        });
    });
});

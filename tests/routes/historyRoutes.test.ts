import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { historyRoutes } from '../../src/routes/historyRoutes';
import { DbService } from '../../src/services/DbService';

vi.mock('../../src/services/DbService', () => ({
    DbService: {
        getPromptHistory: vi.fn(),
    },
}));

describe('historyRoutes', () => {
    const app = createTestApp(historyRoutes);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/prompt-history', () => {
        it('should return paginated prompt history with defaults', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({
                total: 100,
                records: [
                    {
                        id: 1,
                        serverName: 'alpha',
                        modelName: 'llama3.2',
                        prompt: 'Hello',
                        responseText: 'Hi',
                        responseDurationMs: 1500,
                        createdAt: new Date().toISOString(),
                        isError: false,
                    },
                ] as any,
            });

            const res = await request(app).get('/api/prompt-history');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(100);
            expect(res.body.page).toBe(1);
            expect(res.body.pageSize).toBe(50);
            expect(res.body.records).toHaveLength(1);
        });

        it('should accept pagination parameters', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 100, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?limit=10&page=2');

            expect(res.status).toBe(200);
            expect(res.body.page).toBe(2);
            expect(res.body.pageSize).toBe(10);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 10,
                    offset: 10,
                })
            );
        });

        it('should accept model filter', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?model=llama3.2');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    modelName: 'llama3.2',
                })
            );
        });

        it('should accept serverName filter', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?serverName=alpha');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    serverName: 'alpha',
                })
            );
        });

        it('should accept provider as alias for serverName', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?provider=openrouter');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    serverName: 'openrouter',
                })
            );
        });

        it('should accept sort and direction', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?sort=responseDurationMs&dir=asc');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    sort: 'responseDurationMs',
                    direction: 'ASC',
                })
            );
        });

        it('should accept groupId filter', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?groupId=test-group');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    groupId: 'test-group',
                })
            );
        });

        it('should accept requestType filter', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?requestType=chat');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    requestType: 'chat',
                })
            );
        });

        it('should accept isError filter', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?isError=true');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    isError: true,
                })
            );
        });

        it('should accept duration range filters', async () => {
            vi.mocked(DbService.getPromptHistory).mockReturnValue({ total: 5, records: [] });

            const res = await request(app)
                .get('/api/prompt-history?durationGt=100&durationLt=5000');

            expect(res.status).toBe(200);
            expect(DbService.getPromptHistory).toHaveBeenCalledWith(
                expect.objectContaining({
                    durationGt: 100,
                    durationLt: 5000,
                })
            );
        });

        it('should return 400 for invalid limit', async () => {
            const res = await request(app)
                .get('/api/prompt-history?limit=0');

            expect(res.status).toBe(400);
        });

        it('should return 400 for limit exceeding max', async () => {
            const res = await request(app)
                .get('/api/prompt-history?limit=500');

            expect(res.status).toBe(400);
        });

        it('should return 400 for invalid sort field', async () => {
            const res = await request(app)
                .get('/api/prompt-history?sort=invalidField');

            expect(res.status).toBe(400);
        });

        it('should return 400 for invalid requestType', async () => {
            const res = await request(app)
                .get('/api/prompt-history?requestType=invalid');

            expect(res.status).toBe(400);
        });
    });
});

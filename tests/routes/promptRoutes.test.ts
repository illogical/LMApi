import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { promptRoutes } from '../../src/routes/promptRoutes';
import { QueueService } from '../../src/services/QueueService';
import { ServerPoolService } from '../../src/services/ServerPoolService';
import { PromptService } from '../../src/services/PromptService';

vi.mock('../../src/services/QueueService', () => ({
    QueueService: {
        dispatchOrQueue: vi.fn(),
        dispatchDirect: vi.fn(),
    },
}));

vi.mock('../../src/services/ServerPoolService', () => ({
    ServerPoolService: {
        getAvailableServersForModel: vi.fn(),
        getServer: vi.fn(),
        serverSupportsModel: vi.fn(),
        getServers: vi.fn(),
    },
}));

vi.mock('../../src/services/PromptService', () => ({
    PromptService: {
        getRandomPrompt: vi.fn().mockReturnValue('What is the meaning of life?'),
    },
}));

describe('promptRoutes', () => {
    const app = createTestApp(promptRoutes);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/prompts/random', () => {
        it('should return a random prompt', async () => {
            const res = await request(app).get('/api/prompts/random');

            expect(res.status).toBe(200);
            expect(res.body.prompt).toBe('What is the meaning of life?');
        });
    });

    describe('POST /api/generate/any', () => {
        it('should dispatch a generate request', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueue).mockResolvedValue({
                response: 'Hello!',
                durationMs: 1500,
                serverName: 'alpha',
                model: 'llama3.2',
            });

            const res = await request(app)
                .post('/api/generate/any')
                .send({ prompt: 'Hello', model: 'llama3.2' });

            expect(res.status).toBe(200);
            expect(res.body.response).toBe('Hello!');
            expect(res.body.server_name).toBe('alpha');
            expect(res.body.duration_ms).toBe(1500);
        });

        it('should return 503 when model not available', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([]);

            const res = await request(app)
                .post('/api/generate/any')
                .send({ prompt: 'Hello', model: 'nonexistent' });

            expect(res.status).toBe(503);
        });

        it('should return 500 for invalid request body (missing prompt)', async () => {
            const res = await request(app)
                .post('/api/generate/any')
                .send({ model: 'llama3.2' });

            expect(res.status).toBe(500);
        });

        it('should accept optional params', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueue).mockResolvedValue({
                response: 'Hi',
                durationMs: 1000,
                serverName: 'alpha',
                model: 'llama3.2',
            });

            const res = await request(app)
                .post('/api/generate/any')
                .send({
                    prompt: 'Hello',
                    model: 'llama3.2',
                    params: { temperature: 0.7 },
                    groupId: 'test-group',
                    maxParallelPerServer: 2,
                });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/generate/server', () => {
        it('should dispatch to specific server', async () => {
            const mockServer = { config: { name: 'alpha' } } as any;
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServer);
            vi.mocked(ServerPoolService.serverSupportsModel).mockReturnValue(true);
            vi.mocked(QueueService.dispatchDirect).mockResolvedValue({
                response: 'Hello!',
                durationMs: 2000,
                serverName: 'alpha',
                model: 'llama3.2',
            });

            const res = await request(app)
                .post('/api/generate/server')
                .send({ prompt: 'Hello', model: 'llama3.2', serverName: 'alpha' });

            expect(res.status).toBe(200);
            expect(res.body.server_name).toBe('alpha');
        });

        it('should return 400 when serverName is missing', async () => {
            const res = await request(app)
                .post('/api/generate/server')
                .send({ prompt: 'Hello', model: 'llama3.2' });

            expect(res.status).toBe(400);
        });

        it('should return 404 when server not found', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(undefined);

            const res = await request(app)
                .post('/api/generate/server')
                .send({ prompt: 'Hello', model: 'llama3.2', serverName: 'nonexistent' });

            expect(res.status).toBe(404);
        });

        it('should return 503 when server does not support model', async () => {
            const mockServer = { config: { name: 'alpha' } } as any;
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServer);
            vi.mocked(ServerPoolService.serverSupportsModel).mockReturnValue(false);

            const res = await request(app)
                .post('/api/generate/server')
                .send({ prompt: 'Hello', model: 'unsupported', serverName: 'alpha' });

            expect(res.status).toBe(503);
        });
    });

    describe('POST /api/embed', () => {
        it('should dispatch embed request', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueue).mockResolvedValue({
                response: [0.1, 0.2, 0.3],
                durationMs: 100,
                serverName: 'alpha',
                model: 'nomic-embed',
            });

            const res = await request(app)
                .post('/api/embed')
                .send({ prompt: 'Hello', model: 'nomic-embed' });

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.response)).toBe(true);
        });

        it('should return 503 when embed model not available', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([]);

            const res = await request(app)
                .post('/api/embed')
                .send({ prompt: 'Hello', model: 'nonexistent-embed' });

            expect(res.status).toBe(503);
        });
    });

    describe('POST /api/generate/batch', () => {
        it('should dispatch batch generation', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueue).mockResolvedValue({
                response: 'Response',
                durationMs: 1000,
                serverName: 'alpha',
                model: 'llama3.2',
            });

            const res = await request(app)
                .post('/api/generate/batch')
                .send({ prompt: 'Hello', models: ['llama3.2', 'qwen2.5'] });

            expect(res.status).toBe(200);
            expect(res.body.results).toHaveLength(2);
            expect(res.body.groupId).toBeDefined();
        });

        it('should return 503 when some models not available', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockImplementation((model: string) => {
                if (model === 'llama3.2') return [{} as any];
                return [];
            });

            const res = await request(app)
                .post('/api/generate/batch')
                .send({ prompt: 'Hello', models: ['llama3.2', 'nonexistent'] });

            expect(res.status).toBe(503);
        });
    });

    describe('Zod schema validation', () => {
        it('should reject request missing prompt field', async () => {
            const res = await request(app)
                .post('/api/generate/any')
                .send({ model: 'llama3.2' });

            expect(res.status).toBe(500); // Zod error thrown
        });

        it('should reject request missing model field', async () => {
            const res = await request(app)
                .post('/api/generate/any')
                .send({ prompt: 'Hello' });

            expect(res.status).toBe(500);
        });

        it('should reject batch with missing models array', async () => {
            const res = await request(app)
                .post('/api/generate/batch')
                .send({ prompt: 'Hello' });

            expect(res.status).toBe(500);
        });

        it('should accept valid maxParallelPerServer', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueue).mockResolvedValue({
                response: 'OK', durationMs: 100, serverName: 'a', model: 'm',
            });

            const res = await request(app)
                .post('/api/generate/any')
                .send({ prompt: 'Hi', model: 'llama3.2', maxParallelPerServer: 2 });

            expect(res.status).toBe(200);
        });

        it('should reject negative maxParallelPerServer', async () => {
            const res = await request(app)
                .post('/api/generate/any')
                .send({ prompt: 'Hi', model: 'llama3.2', maxParallelPerServer: -1 });

            expect(res.status).toBe(500);
        });
    });
});

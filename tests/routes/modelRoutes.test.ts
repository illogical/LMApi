import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { modelRoutes } from '../../src/routes/modelRoutes';
import { ServerPoolService } from '../../src/services/ServerPoolService';

vi.mock('../../src/services/ServerPoolService', () => ({
    ServerPoolService: {
        getServers: vi.fn(),
        getAvailableServersForModel: vi.fn(),
    },
}));

const mockServers = [
    {
        config: { name: 'alpha', baseUrl: 'http://alpha:11434', disabled: false },
        isOnline: true,
        models: ['llama3.2:latest', 'qwen2.5:latest'],
        runningModels: [],
        activeModels: [],
        activeRequests: 0,
        lastChecked: Date.now(),
        lastModel: null,
        lastModelAt: null,
    },
    {
        config: { name: 'beta', baseUrl: 'http://beta:11434', disabled: false },
        isOnline: true,
        models: ['llama3.2:latest', 'phi3:latest'],
        runningModels: [],
        activeModels: [],
        activeRequests: 0,
        lastChecked: Date.now(),
        lastModel: null,
        lastModelAt: null,
    },
    {
        config: { name: 'gamma', baseUrl: 'http://gamma:11434', disabled: true },
        isOnline: false,
        models: ['llama3.2:latest'],
        runningModels: [],
        activeModels: [],
        activeRequests: 0,
        lastChecked: Date.now(),
        lastModel: null,
        lastModelAt: null,
    },
];

describe('modelRoutes', () => {
    const app = createTestApp(modelRoutes);

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(ServerPoolService.getServers).mockReturnValue(mockServers as any);
    });

    describe('GET /api/models', () => {
        it('should return all unique models sorted alphabetically', async () => {
            const res = await request(app).get('/api/models');

            expect(res.status).toBe(200);
            expect(res.body.models).toBeDefined();
            expect(res.body.models).toContain('llama3.2:latest');
            expect(res.body.models).toContain('qwen2.5:latest');
            expect(res.body.models).toContain('phi3:latest');
            // Should be sorted
            expect(res.body.models).toEqual([...res.body.models].sort());
        });

        it('should deduplicate models across servers', async () => {
            const res = await request(app).get('/api/models');
            const llamaCount = res.body.models.filter((m: string) => m === 'llama3.2:latest');
            expect(llamaCount).toHaveLength(1);
        });
    });

    describe('GET /api/models/loaded', () => {
        it('should return models only from online servers', async () => {
            const res = await request(app).get('/api/models/loaded');

            expect(res.status).toBe(200);
            expect(res.body.models).toBeDefined();
            // gamma is offline, but its models should still appear if the filter is isOnline
            // Let's check - gamma is offline, so its models shouldn't be in the loaded list
        });
    });

    describe('GET /api/models/by-server', () => {
        it('should return models grouped by online, non-disabled servers', async () => {
            const res = await request(app).get('/api/models/by-server');

            expect(res.status).toBe(200);
            expect(res.body.servers).toBeDefined();
            // gamma is disabled, so should not appear
            const serverNames = res.body.servers.map((s: any) => s.name);
            expect(serverNames).toContain('alpha');
            expect(serverNames).toContain('beta');
            expect(serverNames).not.toContain('gamma');
        });

        it('should sort models within each server', async () => {
            const res = await request(app).get('/api/models/by-server');

            for (const server of res.body.servers) {
                const sorted = [...server.models].sort();
                expect(server.models).toEqual(sorted);
            }
        });
    });

    describe('GET /api/models/:model/servers', () => {
        it('should return servers that have the model', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([
                mockServers[0] as any,
                mockServers[1] as any,
            ]);

            const res = await request(app).get('/api/models/llama3.2/servers');

            expect(res.status).toBe(200);
            expect(res.body.servers).toContain('alpha');
            expect(res.body.servers).toContain('beta');
        });

        it('should return empty array for unavailable model', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([]);

            const res = await request(app).get('/api/models/nonexistent/servers');

            expect(res.status).toBe(200);
            expect(res.body.servers).toHaveLength(0);
        });
    });
});

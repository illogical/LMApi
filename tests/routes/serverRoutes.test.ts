import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { serverRoutes } from '../../src/routes/serverRoutes';
import { ServerPoolService } from '../../src/services/ServerPoolService';
import { ConfigService } from '../../src/services/ConfigService';
import { ServerConfigService } from '../../src/services/ServerConfigService';

vi.mock('../../src/services/ServerPoolService', () => ({
    ServerPoolService: {
        getServers: vi.fn(),
        getServer: vi.fn(),
        refreshPool: vi.fn(),
        refreshServer: vi.fn(),
        applyConfigUpdate: vi.fn(),
    },
}));

vi.mock('../../src/services/ConfigService', () => ({
    ConfigService: {
        getMaxParallelPerServer: vi.fn().mockReturnValue(4),
        getServerCheckIntervalMs: vi.fn().mockReturnValue(300000),
        getPort: vi.fn().mockReturnValue(3111),
        getLogLevel: vi.fn().mockReturnValue('trace'),
        getServers: vi.fn().mockReturnValue([
            { name: 'alpha', baseUrl: 'http://alpha:11434' },
            { name: 'beta', baseUrl: 'http://beta:11434' },
        ]),
    },
}));

vi.mock('../../src/services/ServerConfigService', () => ({
    ServerConfigService: {
        setDisabled: vi.fn(),
        reorderServers: vi.fn(),
    },
}));

const mockServerStatus = {
    config: { name: 'alpha', baseUrl: 'http://alpha:11434' },
    isOnline: true,
    models: ['llama3.2:latest'],
    runningModels: ['llama3.2:latest'],
    activeModels: [],
    activeRequests: 0,
    lastChecked: Date.now(),
    lastModel: null,
    lastModelAt: null,
};

describe('serverRoutes', () => {
    const app = createTestApp(serverRoutes);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/config', () => {
        it('should return configuration values', async () => {
            const res = await request(app).get('/api/config');

            expect(res.status).toBe(200);
            expect(res.body.maxParallelPerServer).toBe(4);
            expect(res.body.serverCheckIntervalMs).toBe(300000);
            expect(res.body.port).toBe(3111);
            expect(res.body.logLevel).toBe('trace');
            expect(res.body.serverCount).toBe(2);
        });
    });

    describe('GET /api/servers', () => {
        it('should return all servers', async () => {
            vi.mocked(ServerPoolService.getServers).mockReturnValue([mockServerStatus as any]);

            const res = await request(app).get('/api/servers');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].config.name).toBe('alpha');
        });
    });

    describe('GET /api/servers/available', () => {
        it('should return only online, non-disabled servers', async () => {
            vi.mocked(ServerPoolService.getServers).mockReturnValue([
                { ...mockServerStatus, isOnline: true, config: { name: 'alpha', baseUrl: 'http://a' } } as any,
                { ...mockServerStatus, isOnline: false, config: { name: 'beta', baseUrl: 'http://b' } } as any,
                { ...mockServerStatus, isOnline: true, config: { name: 'gamma', baseUrl: 'http://c', disabled: true } } as any,
            ]);

            const res = await request(app).get('/api/servers/available');

            expect(res.status).toBe(200);
            expect(res.body.servers).toHaveLength(1);
            expect(res.body.servers[0].config.name).toBe('alpha');
        });
    });

    describe('GET /api/servers/:name/status', () => {
        it('should return server status', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServerStatus as any);

            const res = await request(app).get('/api/servers/alpha/status');

            expect(res.status).toBe(200);
            expect(res.body.config.name).toBe('alpha');
        });

        it('should return 404 for nonexistent server', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(undefined);

            const res = await request(app).get('/api/servers/nonexistent/status');

            expect(res.status).toBe(404);
            expect(res.body.error).toBe('Server not found');
        });
    });

    describe('GET /api/servers/:name/models', () => {
        it('should return server models', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServerStatus as any);

            const res = await request(app).get('/api/servers/alpha/models');

            expect(res.status).toBe(200);
            expect(res.body.models).toContain('llama3.2:latest');
        });

        it('should return 404 for nonexistent server', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(undefined);

            const res = await request(app).get('/api/servers/nonexistent/models');

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/servers/:name/models/loaded', () => {
        it('should return running models', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServerStatus as any);

            const res = await request(app).get('/api/servers/alpha/models/loaded');

            expect(res.status).toBe(200);
            expect(res.body.running).toContain('llama3.2:latest');
        });
    });

    describe('POST /api/servers/refresh', () => {
        it('should refresh all servers', async () => {
            vi.mocked(ServerPoolService.refreshPool).mockResolvedValue();
            vi.mocked(ServerPoolService.getServers).mockReturnValue([mockServerStatus as any]);

            const res = await request(app).post('/api/servers/refresh');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.servers).toBeDefined();
        });

        it('should return 500 on failure', async () => {
            vi.mocked(ServerPoolService.refreshPool).mockRejectedValue(new Error('Failed'));

            const res = await request(app).post('/api/servers/refresh');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/servers/:name/refresh', () => {
        it('should refresh a specific server', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServerStatus as any);
            vi.mocked(ServerPoolService.refreshServer).mockResolvedValue();

            const res = await request(app).post('/api/servers/alpha/refresh');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should return 404 for nonexistent server', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(undefined);

            const res = await request(app).post('/api/servers/nonexistent/refresh');

            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/servers/:name/disabled', () => {
        it('should toggle server disabled state', async () => {
            const updatedServers = [{ name: 'alpha', baseUrl: 'http://alpha:11434', disabled: true }];
            vi.mocked(ServerConfigService.setDisabled).mockReturnValue(updatedServers);
            vi.mocked(ServerPoolService.getServers).mockReturnValue([]);

            const res = await request(app)
                .patch('/api/servers/alpha/disabled')
                .send({ disabled: true });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(ServerConfigService.setDisabled).toHaveBeenCalledWith('alpha', true);
        });

        it('should return 400 for invalid body', async () => {
            const res = await request(app)
                .patch('/api/servers/alpha/disabled')
                .send({ disabled: 'not-a-boolean' });

            expect(res.status).toBe(400);
        });

        it('should return 404 for nonexistent server', async () => {
            vi.mocked(ServerConfigService.setDisabled).mockImplementation(() => {
                throw new Error('Server not found');
            });

            const res = await request(app)
                .patch('/api/servers/nonexistent/disabled')
                .send({ disabled: true });

            expect(res.status).toBe(404);
        });
    });

    describe('PUT /api/servers/order', () => {
        it('should reorder servers', async () => {
            const newOrder = [{ name: 'beta', baseUrl: 'http://beta:11434' }, { name: 'alpha', baseUrl: 'http://alpha:11434' }];
            vi.mocked(ServerConfigService.reorderServers).mockReturnValue(newOrder);
            vi.mocked(ServerPoolService.getServers).mockReturnValue([]);

            const res = await request(app)
                .put('/api/servers/order')
                .send({ names: ['beta', 'alpha'] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should return 400 for invalid body', async () => {
            const res = await request(app)
                .put('/api/servers/order')
                .send({ names: [] });

            expect(res.status).toBe(400);
        });
    });
});

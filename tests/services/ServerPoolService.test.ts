import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerPoolService, ServerStatus } from '../../src/services/ServerPoolService';
import { ConfigService, ServerConfig } from '../../src/services/ConfigService';
import { ModelCacheService } from '../../src/services/ModelCacheService';
import { SocketService } from '../../src/services/SocketService';

// Mock dependencies
vi.mock('../../src/services/ConfigService', () => ({
    ConfigService: {
        getServers: vi.fn(),
        getMaxParallelPerServer: vi.fn().mockReturnValue(4),
        getServerCheckIntervalMs: vi.fn().mockReturnValue(300000),
        getOllamaKeepAliveMs: vi.fn().mockReturnValue(300000),
        loadConfig: vi.fn(),
    },
}));

vi.mock('../../src/services/ModelCacheService', () => ({
    ModelCacheService: {
        refreshCache: vi.fn().mockResolvedValue([]),
        getRunningModels: vi.fn().mockResolvedValue([]),
        getModels: vi.fn().mockResolvedValue([]),
        clearCache: vi.fn(),
    },
}));

describe('ServerPoolService', () => {
    const testServers: ServerConfig[] = [
        { name: 'alpha', baseUrl: 'http://192.168.1.10:11434' },
        { name: 'beta', baseUrl: 'http://192.168.1.20:11434' },
        { name: 'gamma', baseUrl: 'http://192.168.1.30:11434' },
    ];

    beforeEach(async () => {
        vi.clearAllMocks();

        vi.mocked(ConfigService.getServers).mockReturnValue(testServers);
        vi.mocked(ModelCacheService.refreshCache).mockImplementation(async (baseUrl: string) => {
            if (baseUrl.includes('192.168.1.10')) return ['llama3.2:latest', 'qwen2.5:latest'];
            if (baseUrl.includes('192.168.1.20')) return ['llama3.2:latest', 'phi3:latest'];
            if (baseUrl.includes('192.168.1.30')) return ['qwen2.5:latest'];
            return [];
        });
        vi.mocked(ModelCacheService.getRunningModels).mockResolvedValue([]);

        await ServerPoolService.initialize();
    });

    describe('initialize', () => {
        it('should create status entries for all configured servers', () => {
            const servers = ServerPoolService.getServers();
            expect(servers).toHaveLength(3);
        });

        it('should mark servers with models as online', () => {
            const alpha = ServerPoolService.getServer('alpha');
            expect(alpha?.isOnline).toBe(true);
            expect(alpha?.models).toContain('llama3.2:latest');
        });
    });

    describe('getServers', () => {
        it('should return all servers', () => {
            const servers = ServerPoolService.getServers();
            expect(servers).toHaveLength(3);
            expect(servers.map(s => s.config.name)).toEqual(['alpha', 'beta', 'gamma']);
        });
    });

    describe('getServer', () => {
        it('should return a specific server by name', () => {
            const server = ServerPoolService.getServer('alpha');
            expect(server).toBeDefined();
            expect(server?.config.name).toBe('alpha');
        });

        it('should return undefined for nonexistent server', () => {
            const server = ServerPoolService.getServer('nonexistent');
            expect(server).toBeUndefined();
        });
    });

    describe('getAvailableServersForModel', () => {
        it('should return servers that have the requested model', () => {
            const servers = ServerPoolService.getAvailableServersForModel('llama3.2');
            expect(servers).toHaveLength(2);
            expect(servers.map(s => s.config.name)).toContain('alpha');
            expect(servers.map(s => s.config.name)).toContain('beta');
        });

        it('should not return disabled servers', async () => {
            vi.mocked(ConfigService.getServers).mockReturnValue([
                { name: 'alpha', baseUrl: 'http://192.168.1.10:11434', disabled: true },
                { name: 'beta', baseUrl: 'http://192.168.1.20:11434' },
            ]);
            await ServerPoolService.initialize();

            const servers = ServerPoolService.getAvailableServersForModel('llama3.2');
            expect(servers.map(s => s.config.name)).not.toContain('alpha');
        });

        it('should return empty array for unavailable model', () => {
            const servers = ServerPoolService.getAvailableServersForModel('nonexistent-model');
            expect(servers).toHaveLength(0);
        });
    });

    describe('reserveServerForModel', () => {
        it('should reserve a server for a model and increment active requests', () => {
            const server = ServerPoolService.reserveServerForModel('llama3.2');
            expect(server).toBeDefined();
            expect(server?.activeRequests).toBe(1);
        });

        it('should prefer sticky server (actively running model)', () => {
            // First reserve alpha for llama3.2
            ServerPoolService.reserveServerForModel('llama3.2');
            const alpha = ServerPoolService.getServer('alpha');
            expect(alpha?.activeRequests).toBe(1);

            // Second request should go to same server (sticky)
            const server = ServerPoolService.reserveServerForModel('llama3.2');
            expect(server?.config.name).toBe('alpha');
            expect(server?.activeRequests).toBe(2);
        });

        it('should prefer idle server when no sticky option', () => {
            // Reserve alpha for qwen2.5
            ServerPoolService.reserveServerForModel('qwen2.5');

            // Request llama3.2 - should go to beta (idle) not alpha (busy with different model)
            const server = ServerPoolService.reserveServerForModel('llama3.2');
            expect(server?.config.name).toBe('beta');
        });

        it('should return undefined when all servers at capacity', () => {
            vi.mocked(ConfigService.getMaxParallelPerServer).mockReturnValue(1);

            ServerPoolService.reserveServerForModel('llama3.2'); // alpha
            ServerPoolService.reserveServerForModel('llama3.2'); // beta

            const server = ServerPoolService.reserveServerForModel('llama3.2');
            expect(server).toBeUndefined();
        });

        it('should respect maxParallelOverride', () => {
            const server1 = ServerPoolService.reserveServerForModel('llama3.2', 1);
            expect(server1).toBeDefined();

            // Both alpha and beta now have 1 request; with override of 1, no more room
            // Actually only one was reserved, let's reserve the second
            const server2 = ServerPoolService.reserveServerForModel('llama3.2', 1);
            expect(server2).toBeDefined();

            // Now both at capacity with override=1
            const server3 = ServerPoolService.reserveServerForModel('llama3.2', 1);
            expect(server3).toBeUndefined();
        });
    });

    describe('serverSupportsModel', () => {
        it('should return true if server has the model and is online', () => {
            const server = ServerPoolService.getServer('alpha')!;
            expect(ServerPoolService.serverSupportsModel(server, 'llama3.2')).toBe(true);
        });

        it('should return false if server does not have the model', () => {
            const server = ServerPoolService.getServer('alpha')!;
            expect(ServerPoolService.serverSupportsModel(server, 'phi3')).toBe(false);
        });

        it('should handle model tags correctly (latest is implicit)', () => {
            const server = ServerPoolService.getServer('alpha')!;
            expect(ServerPoolService.serverSupportsModel(server, 'llama3.2:latest')).toBe(true);
            expect(ServerPoolService.serverSupportsModel(server, 'llama3.2')).toBe(true);
        });
    });

    describe('incrementActiveRequests / decrementActiveRequests', () => {
        it('should increment and decrement active request count', () => {
            ServerPoolService.incrementActiveRequests('alpha', 'llama3.2');
            expect(ServerPoolService.getServer('alpha')?.activeRequests).toBe(1);

            ServerPoolService.decrementActiveRequests('alpha', 'llama3.2');
            expect(ServerPoolService.getServer('alpha')?.activeRequests).toBe(0);
        });

        it('should track active models on increment', () => {
            ServerPoolService.incrementActiveRequests('alpha', 'llama3.2');
            expect(ServerPoolService.getServer('alpha')?.activeModels).toContain('llama3.2');
        });

        it('should remove from active models on decrement', () => {
            ServerPoolService.incrementActiveRequests('alpha', 'llama3.2');
            ServerPoolService.decrementActiveRequests('alpha', 'llama3.2');
            expect(ServerPoolService.getServer('alpha')?.activeModels).not.toContain('llama3.2');
        });

        it('should track lastModel on decrement', () => {
            ServerPoolService.incrementActiveRequests('alpha', 'llama3.2');
            ServerPoolService.decrementActiveRequests('alpha', 'llama3.2');

            const server = ServerPoolService.getServer('alpha');
            expect(server?.lastModel).toBe('llama3.2');
            expect(server?.lastModelAt).toBeGreaterThan(0);
        });

        it('should not decrement below 0', () => {
            ServerPoolService.decrementActiveRequests('alpha', 'llama3.2');
            expect(ServerPoolService.getServer('alpha')?.activeRequests).toBe(0);
        });

        it('should emit active requests changed event', () => {
            ServerPoolService.incrementActiveRequests('alpha', 'llama3.2');
            expect(SocketService.emitActiveRequestsChanged).toHaveBeenCalledWith('alpha', 1);
        });
    });

    describe('applyConfigUpdate', () => {
        it('should update server config while preserving live state', () => {
            ServerPoolService.incrementActiveRequests('alpha', 'llama3.2');

            const newConfig: ServerConfig[] = [
                { name: 'alpha', baseUrl: 'http://192.168.1.10:11434', disabled: true },
                { name: 'beta', baseUrl: 'http://192.168.1.20:11434' },
            ];

            ServerPoolService.applyConfigUpdate(newConfig);

            const alpha = ServerPoolService.getServer('alpha');
            expect(alpha?.config.disabled).toBe(true);
            expect(alpha?.activeRequests).toBe(1); // preserved
        });

        it('should handle new servers in config', () => {
            const newConfig: ServerConfig[] = [
                ...testServers,
                { name: 'delta', baseUrl: 'http://192.168.1.40:11434' },
            ];

            ServerPoolService.applyConfigUpdate(newConfig);

            const delta = ServerPoolService.getServer('delta');
            expect(delta).toBeDefined();
            expect(delta?.isOnline).toBe(false); // New server starts offline
        });

        it('should emit config update events', () => {
            ServerPoolService.applyConfigUpdate(testServers);
            expect(SocketService.emit).toHaveBeenCalled();
            expect(SocketService.emitServersUpdated).toHaveBeenCalled();
        });
    });

    describe('refreshPool', () => {
        it('should refresh all non-disabled servers', async () => {
            vi.mocked(ModelCacheService.refreshCache).mockClear();
            await ServerPoolService.refreshPool();
            expect(ModelCacheService.refreshCache).toHaveBeenCalledTimes(3);
        });

        it('should skip disabled servers during refresh', async () => {
            vi.mocked(ConfigService.getServers).mockReturnValue([
                { name: 'alpha', baseUrl: 'http://192.168.1.10:11434', disabled: true },
                { name: 'beta', baseUrl: 'http://192.168.1.20:11434' },
            ]);

            vi.mocked(ModelCacheService.refreshCache).mockClear();
            await ServerPoolService.refreshPool();

            // Only beta should be refreshed
            const calls = vi.mocked(ModelCacheService.refreshCache).mock.calls;
            expect(calls.some(c => c[0].includes('192.168.1.10'))).toBe(false);
            expect(calls.some(c => c[0].includes('192.168.1.20'))).toBe(true);
        });
    });

    describe('getBestServerForModel', () => {
        it('should return best server without reserving', () => {
            const server = ServerPoolService.getBestServerForModel('llama3.2');
            expect(server).toBeDefined();
            expect(server?.activeRequests).toBe(0); // Not incremented
        });

        it('should return undefined if no server has the model', () => {
            const server = ServerPoolService.getBestServerForModel('nonexistent');
            expect(server).toBeUndefined();
        });
    });
});

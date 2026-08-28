import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Router } from 'express';
import type { Server } from 'node:http';
import createLmApiAdapter from '../adapter';
import type { HostedApplicationOptions } from '../contracts';
import { buildRouter } from '../../app';
import { AppPaths } from '../../config/AppPaths';
import { ConfigService } from '../../services/ConfigService';
import { DbService } from '../../services/DbService';
import { ProviderService } from '../../services/ProviderService';
import { ServerPoolService } from '../../services/ServerPoolService';
import { SocketService } from '../../services/SocketService';
import { RequestRegistryService } from '../../services/RequestRegistryService';

const fakeRouter = { __fake: 'router' } as unknown as Router;

vi.mock('../../app', () => ({
    buildRouter: vi.fn().mockReturnValue(fakeRouter),
}));

vi.mock('../../config/AppPaths', () => ({
    AppPaths: { configure: vi.fn() },
}));

vi.mock('../../services/ConfigService', () => ({
    ConfigService: { loadConfig: vi.fn() },
}));

vi.mock('../../services/DbService', () => ({
    DbService: {
        initialize: vi.fn(),
        dispose: vi.fn(),
        isInitialized: vi.fn().mockReturnValue(true),
    },
}));

vi.mock('../../services/ProviderService', () => ({
    ProviderService: { initialize: vi.fn() },
}));

vi.mock('../../services/ServerPoolService', () => ({
    ServerPoolService: {
        initialize: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
    },
}));

// Local override of tests/setup.ts's global SocketService stub — this file
// needs isInitialized(), which that stub doesn't define.
vi.mock('../../services/SocketService', () => ({
    SocketService: {
        initialize: vi.fn(),
        dispose: vi.fn(),
        isInitialized: vi.fn().mockReturnValue(true),
    },
}));

vi.mock('../../services/RequestRegistryService', () => ({
    RequestRegistryService: {
        getActive: vi.fn().mockReturnValue([]),
        pruneCompleted: vi.fn(),
    },
}));

function baseOptions(overrides: Partial<HostedApplicationOptions> = {}): HostedApplicationOptions {
    return {
        applicationId: 'lmapi',
        repositoryRoot: 'C:\\fake\\repo',
        basePath: '/lmapi/',
        hostOrigin: 'http://localhost:4000',
        dataPath: 'C:\\fake\\data\\lmapi',
        config: undefined,
        logger: { child: vi.fn(), log: vi.fn(), flush: vi.fn() } as any,
        ...overrides,
    };
}

describe('createLmApiAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(DbService.isInitialized).mockReturnValue(true);
        vi.mocked(SocketService.isInitialized).mockReturnValue(true);
        vi.mocked(buildRouter).mockReturnValue(fakeRouter);
        vi.mocked(ServerPoolService.initialize).mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('factory call has zero side effects', () => {
        createLmApiAdapter(baseOptions());

        expect(AppPaths.configure).not.toHaveBeenCalled();
        expect(ConfigService.loadConfig).not.toHaveBeenCalled();
        expect(DbService.initialize).not.toHaveBeenCalled();
        expect(ProviderService.initialize).not.toHaveBeenCalled();
        expect(ServerPoolService.initialize).not.toHaveBeenCalled();
        expect(buildRouter).not.toHaveBeenCalled();
    });

    it('exposes the contract version and no router before initialize()', () => {
        const app = createLmApiAdapter(baseOptions());
        expect(app.contractVersion).toBe(1);
        expect(app.router).toBeUndefined();
    });

    describe('initialize()', () => {
        it('wires paths, config, and services in order, then exposes the router', async () => {
            const options = baseOptions();
            const app = createLmApiAdapter(options);

            await app.initialize!();

            expect(AppPaths.configure).toHaveBeenCalledWith({
                repositoryRoot: options.repositoryRoot,
                dataDir: options.dataPath,
                serversConfigPath: 'C:\\fake\\data\\lmapi\\servers.json',
            });
            expect(ConfigService.loadConfig).toHaveBeenCalled();
            expect(DbService.initialize).toHaveBeenCalled();
            expect(ProviderService.initialize).toHaveBeenCalled();
            expect(buildRouter).toHaveBeenCalledWith(options.basePath);
            expect(ServerPoolService.initialize).toHaveBeenCalled();
            expect(app.router).toBe(fakeRouter);
        });

        it('rejects clearly on an invalid adapterConfig without touching any service', async () => {
            const app = createLmApiAdapter(baseOptions({ config: 'not-an-object' as any }));

            await expect(app.initialize!()).rejects.toThrow(/Invalid LMApi adapterConfig/);
            expect(AppPaths.configure).not.toHaveBeenCalled();
            expect(DbService.initialize).not.toHaveBeenCalled();
        });
    });

    describe('getStatus()', () => {
        it('reports degraded before initialize()', async () => {
            const app = createLmApiAdapter(baseOptions());
            const status = await app.getStatus();
            expect(status.state).toBe('degraded');
            expect(status.summary).toMatch(/not initialized/i);
        });

        it('reports degraded when DbService is not initialized', async () => {
            const app = createLmApiAdapter(baseOptions());
            await app.initialize!();
            vi.mocked(DbService.isInitialized).mockReturnValue(false);

            const status = await app.getStatus();
            expect(status.state).toBe('degraded');
            expect(status.summary).toMatch(/database/i);
        });

        it('reports degraded when the realtime channel is not attached', async () => {
            const app = createLmApiAdapter(baseOptions());
            await app.initialize!();
            vi.mocked(SocketService.isInitialized).mockReturnValue(false);

            const status = await app.getStatus();
            expect(status.state).toBe('degraded');
            expect(status.summary).toMatch(/realtime/i);
        });

        it('reports ready once db and realtime are both initialized', async () => {
            const app = createLmApiAdapter(baseOptions());
            await app.initialize!();

            const status = await app.getStatus();
            expect(status.state).toBe('ready');
        });
    });

    describe('getActiveWork()', () => {
        it('reports no active work when the registry is empty', async () => {
            const app = createLmApiAdapter(baseOptions());
            const work = await app.getActiveWork!();
            expect(work.hasActiveWork).toBe(false);
        });

        it('reports active work with a count when the registry is non-empty', async () => {
            vi.mocked(RequestRegistryService.getActive).mockReturnValue([
                { requestId: 'a' } as any,
                { requestId: 'b' } as any,
            ]);

            const app = createLmApiAdapter(baseOptions());
            const work = await app.getActiveWork!();
            expect(work.hasActiveWork).toBe(true);
            expect(work.description).toContain('2');
        });
    });

    describe('attachRealtime()', () => {
        it('initializes SocketService with the shared server and basePath, and returns a Disposer', async () => {
            const options = baseOptions();
            const app = createLmApiAdapter(options);
            const fakeServer = {} as Server;

            const disposer = await app.attachRealtime!(fakeServer);

            expect(SocketService.initialize).toHaveBeenCalledWith(fakeServer, options.basePath);
            expect(typeof disposer).toBe('function');

            await disposer!();
            expect(SocketService.dispose).toHaveBeenCalled();
        });
    });

    describe('dispose()', () => {
        it('clears the prune interval and disposes ServerPoolService/DbService, but not SocketService', async () => {
            vi.useFakeTimers();
            const app = createLmApiAdapter(baseOptions());
            await app.initialize!();

            await app.dispose!();

            expect(ServerPoolService.dispose).toHaveBeenCalled();
            expect(DbService.dispose).toHaveBeenCalled();
            expect(SocketService.dispose).not.toHaveBeenCalled();

            const pruneCalls = vi.mocked(RequestRegistryService.pruneCompleted).mock.calls.length;
            vi.advanceTimersByTime(120_000);
            expect(vi.mocked(RequestRegistryService.pruneCompleted).mock.calls.length).toBe(pruneCalls);
        });

        it('is idempotent (safe to call twice, and before initialize())', async () => {
            const app = createLmApiAdapter(baseOptions());
            await expect(app.dispose!()).resolves.not.toThrow();

            await app.initialize!();
            await app.dispose!();
            await expect(app.dispose!()).resolves.not.toThrow();
            expect(DbService.dispose).toHaveBeenCalledTimes(1);
            expect(ServerPoolService.dispose).toHaveBeenCalledTimes(1);
        });
    });
});

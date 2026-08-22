import { join } from 'node:path';
import type { Server } from 'node:http';
import { buildRouter } from '../app';
import { AppPaths } from '../config/AppPaths';
import { ConfigService } from '../services/ConfigService';
import { DbService } from '../services/DbService';
import { ProviderService } from '../services/ProviderService';
import { ServerPoolService } from '../services/ServerPoolService';
import { SocketService } from '../services/SocketService';
import { RequestRegistryService } from '../services/RequestRegistryService';
import { parseHostedConfig } from './config';
import {
    HOSTED_CONTRACT_VERSION,
    type Disposer,
    type HostedApplication,
    type HostedApplicationOptions,
} from './contracts';

const PRUNE_INTERVAL_MS = 60_000;

/**
 * LMApi's HomeBase hosted-adapter factory
 * (docs/plans/2026-08-16-homebase-integration.md, phase 7).
 *
 * This file is the actual implementation and is what tests import
 * (`src/host/__tests__/`) — it uses ordinary `export default`. It is NOT the
 * compiled entry point HomeBase loads: `./index.ts` re-exports this via
 * `export =` instead, because HomeBase's dynamic `import()` needs the raw
 * CJS interop shape `export =` produces (see `index.ts`'s docblock for why).
 *
 * Import-safety (plan §3): this module and the factory call below must have
 * zero side effects — no I/O, no timers, no env reads, no service
 * `.initialize()` calls. All resource acquisition happens inside
 * `initialize()`; releasing it is `dispose()`'s job.
 */
export default function createLmApiAdapter(options: HostedApplicationOptions): HostedApplication {
    const state: {
        since: string;
        initialized: boolean;
        disposed: boolean;
        pruneInterval: ReturnType<typeof setInterval> | undefined;
    } = {
        since: new Date().toISOString(),
        initialized: false,
        disposed: false,
        pruneInterval: undefined,
    };

    // Set by initialize() — the contract's `router` getter must exist on the
    // returned object from the start (Object.defineProperty-free via a
    // closure variable), but is only populated once buildRouter() has run.
    let router: HostedApplication['router'];

    const app: HostedApplication = {
        contractVersion: HOSTED_CONTRACT_VERSION,

        get router() {
            return router;
        },

        async initialize() {
            // Validated for forward-compatibility even though no field is
            // consumed yet (host/config.ts) — surfaces a bad adapterConfig
            // as an initialize() rejection rather than silently ignoring it.
            parseHostedConfig(options.config);

            AppPaths.configure({
                repositoryRoot: options.repositoryRoot,
                dataDir: options.dataPath,
                serversConfigPath: join(options.dataPath, 'servers.json'),
            });

            ConfigService.loadConfig();
            DbService.initialize();
            ProviderService.initialize();
            router = buildRouter(options.basePath);
            await ServerPoolService.initialize();

            // Mirrors app.ts's standalone interval (prunes completed/failed
            // registry entries so it doesn't grow unbounded); unref'd since
            // this timer alone should never keep HomeBase's process alive.
            state.pruneInterval = setInterval(() => RequestRegistryService.pruneCompleted(), PRUNE_INTERVAL_MS);
            state.pruneInterval.unref?.();

            state.initialized = true;
            state.since = new Date().toISOString();
        },

        async attachRealtime(server: Server): Promise<Disposer> {
            SocketService.initialize(server, options.basePath);
            return () => SocketService.dispose();
        },

        async getStatus() {
            if (!state.initialized) {
                return { state: 'degraded' as const, summary: 'Not initialized', since: state.since };
            }
            if (!DbService.isInitialized()) {
                return { state: 'degraded' as const, summary: 'Database connection is not initialized', since: state.since };
            }
            if (!SocketService.isInitialized()) {
                return { state: 'degraded' as const, summary: 'Realtime channel is not attached', since: state.since };
            }
            return { state: 'ready' as const, summary: 'LMApi is running', since: state.since };
        },

        async getActiveWork() {
            const active = RequestRegistryService.getActive();
            if (active.length === 0) {
                return { hasActiveWork: false };
            }
            return {
                hasActiveWork: true,
                description: `${active.length} in-flight request(s)`,
            };
        },

        async dispose() {
            if (state.disposed) return;
            state.disposed = true;

            if (state.pruneInterval) {
                clearInterval(state.pruneInterval);
                state.pruneInterval = undefined;
            }

            // SocketService.dispose() runs via attachRealtime()'s returned
            // Disposer, invoked by HomeBase ahead of this method — not
            // duplicated here.
            ServerPoolService.dispose();
            DbService.dispose();
        },
    };

    return app;
}

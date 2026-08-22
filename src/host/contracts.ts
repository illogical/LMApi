import type { Router } from 'express';
import type { Server } from 'node:http';
import type { ApplicationLogger } from '../logging/ApplicationLogger';

/**
 * HomeBase's Phase 4 hosted-application contract (plan §3), transcribed from
 * `src/contracts/hostedApplication.ts` in the HomeBase checkout
 * (`c:\LocalDev\Projects\HomeBase`) since LMApi does not depend on HomeBase
 * as a package. Keep in sync manually if HomeBase's contract changes — there
 * is no shared package to pull types from. `ApplicationLogger` itself lives
 * in `src/logging/ApplicationLogger.ts` (added phase 3) and is re-exported
 * here for convenience.
 */
export const HOSTED_CONTRACT_VERSION = 1 as const;

export type { ApplicationLogger };

export interface HostedApplicationOptions {
    readonly applicationId: string;
    readonly repositoryRoot: string;
    /** Always e.g. "/lmapi/" in practice — trailing slash, computed by HomeBase. */
    readonly basePath: `/${string}/`;
    readonly hostOrigin: string | undefined;
    /** `<HOMEBASE_DATA_PATH>/apps/lmapi` — created via mkdir(recursive) before the factory runs. */
    readonly dataPath: string;
    /** Opaque passthrough from the registry's `adapterConfig` — validated by us, see host/config.ts. */
    readonly config: Readonly<Record<string, unknown>> | undefined;
    readonly logger: ApplicationLogger;
}

export type Disposer = () => void | Promise<void>;

export interface HostedApplication {
    readonly contractVersion: typeof HOSTED_CONTRACT_VERSION;
    initialize?(): Promise<void>;
    readonly router?: Router;
    readonly staticAssets?: { readonly directory: string; readonly spaFallback: boolean };
    attachRealtime?(server: Server): Promise<Disposer | void>;
    getStatus(): Promise<{ state: 'ready' | 'degraded'; summary: string; since: string }>;
    getActiveWork?(): Promise<{ hasActiveWork: boolean; description?: string }>;
    dispose?(): Promise<void>;
}

export type CreateHostedApplication = (options: HostedApplicationOptions) => HostedApplication;

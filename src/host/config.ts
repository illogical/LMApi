import { z } from 'zod';

/**
 * Validates HomeBase's opaque `options.config` (the registry's
 * `adapterConfig`). LMApi doesn't require any hosted-mode-only fields today —
 * `ConfigService`'s existing env-var reads plus `servers.json`/`providers.json`
 * (copied into `options.dataPath` on first run, per plan §7.1) already cover
 * everything a hosted instance needs. This schema exists so a future field
 * can be added without a breaking change, and to document that `port` must
 * never be one of them — hosted mode never listens itself, HomeBase owns the
 * shared http.Server.
 */
export const hostedConfigSchema = z.object({}).passthrough();

export type HostedConfig = z.infer<typeof hostedConfigSchema>;

/**
 * Parses and validates `options.config`. Callers must call this from
 * `initialize()`, not from the factory itself, so a bad config surfaces as
 * an `initialize()` rejection HomeBase can mark `unavailable`, not a
 * factory-call-time throw.
 */
export function parseHostedConfig(config: Readonly<Record<string, unknown>> | undefined): HostedConfig {
    const result = hostedConfigSchema.safeParse(config ?? {});
    if (!result.success) {
        throw new Error(`Invalid LMApi adapterConfig: ${result.error.message}`);
    }
    return result.data;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Matches HomeBase's `ApplicationLogger` contract shape
 * (HomeBase/src/contracts/hostedApplication.ts) so a hosted adapter can pass
 * `options.logger` straight through with no adaptation. Not yet wired into
 * LogService — added ahead of the phase 7 hosted adapter.
 */
export interface ApplicationLogger {
    child(bindings: Readonly<Record<string, unknown>>): ApplicationLogger;
    log(level: LogLevel, event: string, message: string, context?: Readonly<Record<string, unknown>>): void;
    flush?(): Promise<void>;
}

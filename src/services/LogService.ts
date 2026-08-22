import pino from 'pino';
import { ConfigService } from './ConfigService';
import { AppPaths } from '../config/AppPaths';

/**
 * Builds the pino-pretty/pino-roll transport. This spawns worker threads and
 * opens the log file, so it must never run at module-load time (importing
 * this module must not perform I/O) — only from `getLogger()`, which itself
 * only runs on first actual log call.
 */
function buildTransport() {
    return pino.transport({
        targets: [
            {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
                level: 'trace', // Console logs everything in dev
            },
            {
                target: 'pino-roll',
                options: {
                    file: AppPaths.getLogsBasePath(),
                    frequency: 'daily',
                    mkdir: true,
                    extension: '.log',
                    dateFormat: 'yyyy-MM-dd',
                    limit: {
                        count: 14 // Keep 2 weeks of logs
                    }
                },
                level: 'trace',
            },
        ],
    });
}

let loggerInstance: pino.Logger | null = null;

function getLogger(): pino.Logger {
    if (!loggerInstance) {
        loggerInstance = pino(
            {
                level: ConfigService.getLogLevel(),
                timestamp: pino.stdTimeFunctions.isoTime,
            },
            buildTransport()
        );
    }
    return loggerInstance;
}

export const logger = new Proxy({} as pino.Logger, {
    get: (target, prop) => {
        return getLogger()[prop as keyof pino.Logger];
    },
});

export class LogService {
    /**
     * Explicitly constructs the file/console transport. Called by the
     * standalone entry point before any logging happens, so log output
     * starts from a deterministic point rather than whichever call happens
     * to log first. Also invoked lazily by `getLogger()` as a safety net
     * (e.g. for tests that log without calling this first) — safe to call
     * more than once.
     */
    static initializeFileLogging(): void {
        getLogger();
    }

    static trace(msg: string, obj?: object) {
        logger.trace(obj, msg);
    }

    static debug(msg: string, obj?: object) {
        logger.debug(obj, msg);
    }

    static info(msg: string, obj?: object) {
        logger.info(obj, msg);
    }

    static warn(msg: string, obj?: object) {
        logger.warn(obj, msg);
    }

    static error(msg: string, obj?: object) {
        logger.error(obj, msg);
    }
}

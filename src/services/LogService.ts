import pino from 'pino';
import path from 'path';
import { ConfigService } from './ConfigService';

const transport = pino.transport({
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
                file: path.join(process.cwd(), 'logs', 'log'),
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

let loggerInstance: pino.Logger | null = null;

function getLogger(): pino.Logger {
    if (!loggerInstance) {
        loggerInstance = pino(
            {
                level: ConfigService.getLogLevel(),
                timestamp: pino.stdTimeFunctions.isoTime,
            },
            transport
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

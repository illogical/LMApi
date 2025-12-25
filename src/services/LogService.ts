import pino from 'pino';
import path from 'path';

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

export const logger = pino(
    {
        level: process.env.LOG_LEVEL || 'trace',
        timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport
);

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

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { LogService } from './LogService';

const ServerSchema = z.object({
    name: z.string(),
    baseUrl: z.string().url(),
});

const ConfigSchema = z.array(ServerSchema);

export type ServerConfig = z.infer<typeof ServerSchema>;

export class ConfigService {
    // Configuration and environment variables
    private static configPath = path.join(process.cwd(), 'src', 'config', 'servers.json');
    private static servers: ServerConfig[] = [];
    private static maxParallelPerServer: number = 4;
    private static port: number = 3000;
    private static logLevel: string = 'trace';
    private static serverCheckIntervalMs: number = 5 * 60 * 1000; // 5 minutes default

    /**
     * Loads all configuration from files and environment variables.
     * Must be called early in application startup before services use config values.
     */
    static loadConfig() {
        try {
            // Load environment variables
            this.loadEnvVars();

            if (!fs.existsSync(this.configPath)) {
                LogService.error(`Config file not found at ${this.configPath}`);
                throw new Error(`Config file not found at ${this.configPath}`);
            }

            const rawData = fs.readFileSync(this.configPath, 'utf-8');
            const json = JSON.parse(rawData);

            const parsed = ConfigSchema.safeParse(json);

            if (!parsed.success) {
                LogService.error('Invalid configuration schema', parsed.error);
                throw new Error('Invalid configuration schema');
            }

            this.servers = parsed.data;
            LogService.info(`Loaded ${this.servers.length} servers from config`);
        } catch (error) {
            LogService.error('Failed to load configuration', { error });
            throw error;
        }
    }

    /**
     * Loads all environment variables with their default values.
     * 
     * Environment Variables:
     * - PORT: Server port (default: 3000)
     * - LOG_LEVEL: Pino log level (default: 'trace')
     * - SERVER_CHECK_INTERVAL_MS: Background server health check interval in milliseconds (default: 5 minutes)
     * - MAX_PARALLEL_PER_SERVER: Maximum concurrent requests per server (default: 4)
     */
    private static loadEnvVars() {
        // PORT: Server listening port
        // Default: 3000
        if (process.env.PORT) {
            const val = parseInt(process.env.PORT);
            if (!isNaN(val) && val > 0) {
                this.port = val;
            }
        }

        // LOG_LEVEL: Pino logger level ('trace', 'debug', 'info', 'warn', 'error', 'fatal')
        // Default: 'trace'
        if (process.env.LOG_LEVEL) {
            this.logLevel = process.env.LOG_LEVEL;
        }

        // SERVER_CHECK_INTERVAL_MS: How often to check server health status (in milliseconds)
        // Default: 300000 (5 minutes)
        if (process.env.SERVER_CHECK_INTERVAL_MS) {
            const val = parseInt(process.env.SERVER_CHECK_INTERVAL_MS);
            if (!isNaN(val) && val > 0) {
                this.serverCheckIntervalMs = val;
            }
        }

        // MAX_PARALLEL_PER_SERVER: Maximum number of parallel requests to send to each server
        // Default: 4
        if (process.env.MAX_PARALLEL_PER_SERVER) {
            const val = parseInt(process.env.MAX_PARALLEL_PER_SERVER);
            if (!isNaN(val) && val > 0) {
                this.maxParallelPerServer = val;
            }
        }
    }

    static getServers(): ServerConfig[] {
        if (this.servers.length === 0) {
            this.loadConfig();
        }
        return this.servers;
    }

    /**
     * Gets the server port from configuration
     * @returns The port number to listen on
     */
    static getPort(): number {
        return this.port;
    }

    /**
     * Gets the log level from configuration
     * @returns The pino logger level string
     */
    static getLogLevel(): string {
        return this.logLevel;
    }

    /**
     * Gets the server health check interval
     * @returns Interval in milliseconds
     */
    static getServerCheckIntervalMs(): number {
        return this.serverCheckIntervalMs;
    }

    /**
     * Gets the maximum parallel requests per server
     * @returns The maximum number of concurrent requests
     */
    static getMaxParallelPerServer(): number {
        return this.maxParallelPerServer;
    }
}

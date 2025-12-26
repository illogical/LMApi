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
    private static configPath = path.join(process.cwd(), 'src', 'config', 'servers.json');
    private static servers: ServerConfig[] = [];

    static loadConfig() {
        try {
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

    static getServers(): ServerConfig[] {
        if (this.servers.length === 0) {
            this.loadConfig();
        }
        return this.servers;
    }
}

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { ConfigService, ServerConfig } from './ConfigService';
import { LogService } from './LogService';

const ServerSchema = z.object({
    name: z.string(),
    baseUrl: z.string().url(),
    disabled: z.boolean().optional(),
});

const ConfigSchema = z.array(ServerSchema);

/**
 * Handles real-time read/write of servers.json.
 * Complements ConfigService (which handles startup loading) by adding
 * persistence for in-flight config changes like disabling servers or reordering.
 */
export class ServerConfigService {
    private static configPath = path.join(process.cwd(), 'src', 'config', 'servers.json');

    static getConfigPath(): string {
        return this.configPath;
    }

    /** Reads and validates servers.json from disk. */
    static readServers(): ServerConfig[] {
        const rawData = fs.readFileSync(this.configPath, 'utf-8');
        const json = JSON.parse(rawData);
        const parsed = ConfigSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error(`Invalid servers.json schema: ${parsed.error.message}`);
        }
        return parsed.data;
    }

    /** Atomically writes the server list to disk and syncs ConfigService's in-memory cache. */
    static saveServers(servers: ServerConfig[]): void {
        const json = JSON.stringify(servers, null, 4);
        fs.writeFileSync(this.configPath, json, 'utf-8');
        ConfigService.updateServers(servers);
        LogService.info(`servers.json saved (${servers.length} entries)`);
    }

    /**
     * Sets the disabled flag on a named server, persists, and returns the updated list.
     * Throws if the server name is not found.
     */
    static setDisabled(name: string, disabled: boolean): ServerConfig[] {
        const servers = this.readServers();
        const server = servers.find(s => s.name === name);
        if (!server) {
            throw new Error(`Server "${name}" not found`);
        }
        if (disabled) {
            server.disabled = true;
        } else {
            delete server.disabled;
        }
        this.saveServers(servers);
        LogService.info(`Server "${name}" ${disabled ? 'disabled' : 'enabled'}`);
        return servers;
    }

    /**
     * Reorders servers to match the given ordered name list, persists, and returns the updated list.
     * All existing server names must be present in orderedNames.
     */
    static reorderServers(orderedNames: string[]): ServerConfig[] {
        const servers = this.readServers();

        const serverMap = new Map(servers.map(s => [s.name, s]));
        if (orderedNames.length !== servers.length) {
            throw new Error(`Expected ${servers.length} server names, got ${orderedNames.length}`);
        }
        const reordered: ServerConfig[] = [];
        for (const name of orderedNames) {
            const server = serverMap.get(name);
            if (!server) {
                throw new Error(`Server "${name}" not found`);
            }
            reordered.push(server);
        }
        this.saveServers(reordered);
        LogService.info(`Server order updated: ${orderedNames.join(', ')}`);
        return reordered;
    }
}

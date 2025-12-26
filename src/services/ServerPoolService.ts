import { ConfigService, ServerConfig } from './ConfigService';
import { ModelCacheService } from './ModelCacheService';
import { LogService } from './LogService';

export interface ServerStatus {
    config: ServerConfig;
    isOnline: boolean;
    models: string[];
    activeRequests: number;
    lastChecked: number;
}

export class ServerPoolService {
    private static statusMap = new Map<string, ServerStatus>();

    private static modelMatches(availableModel: string, requestedModel: string): boolean {
        const parse = (name: string) => {
            const [base, tag] = name.split(':');
            return { base, tag: tag ?? 'latest' };
        };

        const a = parse(availableModel);
        const b = parse(requestedModel);
        return a.base === b.base && a.tag === b.tag;
    }

    static async initialize() {
        const servers = ConfigService.getServers();
        for (const server of servers) {
            this.statusMap.set(server.name, {
                config: server,
                isOnline: false, // Assume offline until checked
                models: [],
                activeRequests: 0,
                lastChecked: 0
            });
        }
        await this.refreshPool();
    }

    static async refreshPool() {
        LogService.debug('Refreshing server pool status');
        const servers = ConfigService.getServers();

        // Check all servers in parallel
        await Promise.all(servers.map(async (server) => {
            const models = await ModelCacheService.refreshCache(server.baseUrl);
            const isOnline = models.length > 0;

            this.statusMap.set(server.name, {
                config: server,
                isOnline,
                models,
                activeRequests: this.statusMap.get(server.name)?.activeRequests || 0,
                lastChecked: Date.now()
            });
        }));
    }

    static async refreshServer(serverName: string) {
        LogService.debug(`Refreshing server status for ${serverName}`);
        const server = this.statusMap.get(serverName);
        if (!server) {
            throw new Error(`Server ${serverName} not found`);
        }

        const models = await ModelCacheService.refreshCache(server.config.baseUrl);
        const isOnline = models.length > 0;

        this.statusMap.set(serverName, {
            config: server.config,
            isOnline,
            models,
            activeRequests: server.activeRequests,
            lastChecked: Date.now()
        });
    }

    static getServers(): ServerStatus[] {
        return Array.from(this.statusMap.values());
    }

    static getServer(name: string): ServerStatus | undefined {
        return this.statusMap.get(name);
    }

    static getAvailableServersForModel(modelName: string): ServerStatus[] {
        const allServers = this.getServers();
        return allServers.filter(s => s.isOnline && s.models.some(m => this.modelMatches(m, modelName)));
    }

    // Returns the highest priority server (first in config) that has the model, is online, and IS FREE (activeRequests == 0)
    // Or simply the one with least load? 
    // Spec says: "If multiple servers... are free... If none free, enqueue".
    // Let's interpret "free" as activeRequests < 1 (assuming 1 slot per server for now, or maybe make it configurable later).
    static getBestServerForModel(modelName: string): ServerStatus | undefined {
        const candidates = this.getAvailableServersForModel(modelName);

        // Filter for free servers
        const freeCandidates = candidates.filter(s => s.activeRequests === 0);

        if (freeCandidates.length > 0) {
            return freeCandidates[0]; // Priority order
        }

        return undefined; // No free servers
    }

    static serverSupportsModel(server: ServerStatus, modelName: string): boolean {
        return server.isOnline && server.models.some(m => this.modelMatches(m, modelName));
    }

    static incrementActiveRequests(serverName: string) {
        const status = this.statusMap.get(serverName);
        if (status) {
            status.activeRequests++;
        }
    }

    static decrementActiveRequests(serverName: string) {
        const status = this.statusMap.get(serverName);
        if (status && status.activeRequests > 0) {
            status.activeRequests--;
        }
    }
}

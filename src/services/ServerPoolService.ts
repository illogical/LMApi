import { ConfigService, ServerConfig } from './ConfigService';
import { ModelCacheService } from './ModelCacheService';
import { LogService } from './LogService';
import { SocketService } from './SocketService';

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
        this.startBackgroundCheck();
    }

    private static startBackgroundCheck() {
        const defaultInterval = process.env.SERVER_CHECK_INTERVAL_MS 
            ? parseInt(process.env.SERVER_CHECK_INTERVAL_MS) 
            : 5 * 60 * 1000; // 5 minutes
        const intervalMs = defaultInterval;
        LogService.info(`Starting background server status check every ${intervalMs}ms`);
        setInterval(async () => {
            await this.refreshPool();
        }, intervalMs);
    }

    static async refreshPool() {
        LogService.debug('Refreshing server pool status');
        const servers = ConfigService.getServers();
        let anyChanged = false;

        // Check all servers in parallel
        await Promise.all(servers.map(async (server) => {
            const oldStatus = this.statusMap.get(server.name);
            const models = await ModelCacheService.refreshCache(server.baseUrl);
            const isOnline = models.length > 0;

            const newStatus: ServerStatus = {
                config: server,
                isOnline,
                models,
                activeRequests: oldStatus?.activeRequests || 0,
                lastChecked: Date.now()
            };

            // Check if status changed
            if (!oldStatus || oldStatus.isOnline !== isOnline || JSON.stringify(oldStatus.models) !== JSON.stringify(models)) {
                LogService.info(`Server status changed for ${server.name}: ${isOnline ? 'Online' : 'Offline'}`);
                this.statusMap.set(server.name, newStatus);
                SocketService.emitServerStatusChanged(newStatus);
                anyChanged = true;
            } else {
                this.statusMap.set(server.name, newStatus);
            }
        }));

        if (anyChanged) {
            SocketService.emitServersUpdated(this.getServers());
        }
    }

    static async refreshServer(serverName: string) {
        LogService.debug(`Refreshing server status for ${serverName}`);
        const server = this.statusMap.get(serverName);
        if (!server) {
            throw new Error(`Server ${serverName} not found`);
        }

        const models = await ModelCacheService.refreshCache(server.config.baseUrl);
        const isOnline = models.length > 0;

        const newStatus: ServerStatus = {
            config: server.config,
            isOnline,
            models,
            activeRequests: server.activeRequests,
            lastChecked: Date.now()
        };

        this.statusMap.set(serverName, newStatus);
        SocketService.emitServerStatusChanged(newStatus);
        SocketService.emitServersUpdated(this.getServers());
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
            SocketService.emitActiveRequestsChanged(serverName, status.activeRequests);
        }
    }

    static decrementActiveRequests(serverName: string) {
        const status = this.statusMap.get(serverName);
        if (status && status.activeRequests > 0) {
            status.activeRequests--;
            SocketService.emitActiveRequestsChanged(serverName, status.activeRequests);
        }
    }
}

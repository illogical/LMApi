import { ConfigService, ServerConfig } from './ConfigService';
import { ModelCacheService } from './ModelCacheService';
import { LogService } from './LogService';
import { SocketService } from './SocketService';

export interface ServerStatus {
    config: ServerConfig;
    isOnline: boolean;
    models: string[];
    runningModels: string[];
    activeModels: string[]; // Models currently being processed by active requests
    activeRequests: number;
    lastChecked: number;
}

export class ServerPoolService {
    private static statusMap = new Map<string, ServerStatus>();
    private static checkInterval: NodeJS.Timeout | null = null;

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
                runningModels: [],
                activeModels: [],
                activeRequests: 0,
                lastChecked: 0
            });
        }
        await this.refreshPool();

        // Register socket callbacks to manage background check
        SocketService.setSubscriberCallbacks(
            () => this.startBackgroundCheck(),
            () => this.stopBackgroundCheck()
        );

        // Start if there are already subscribers (unlikely during init but good for robustness)
        if (SocketService.getSubscriberCount() > 0) {
            this.startBackgroundCheck();
        }
    }

    private static startBackgroundCheck() {
        if (this.checkInterval) {
            return; // Already running
        }

        const checkIntervalDefaultMinutes = 5;
        const checkInterval = process.env.SERVER_CHECK_INTERVAL_MS 
            ? parseInt(process.env.SERVER_CHECK_INTERVAL_MS) 
            : checkIntervalDefaultMinutes * 60 * 1000;
        LogService.info(`Starting background server status check every ${checkIntervalDefaultMinutes} minutes (Subscribers active)`);
        
        this.checkInterval = setInterval(async () => {
            await this.refreshPool();
        }, checkInterval);
    }

    private static stopBackgroundCheck() {
        if (this.checkInterval) {
            LogService.info('Stopping background server status check (No subscribers)');
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    static async refreshPool() {
        LogService.debug('Refreshing server pool status');
        const servers = ConfigService.getServers();
        let anyChanged = false;

        // Check all servers in parallel
        await Promise.all(servers.map(async (server) => {
            const oldStatus = this.statusMap.get(server.name);
            const [models, runningModels] = await Promise.all([
                ModelCacheService.refreshCache(server.baseUrl),
                ModelCacheService.getRunningModels(server.baseUrl)
            ]);
            const isOnline = models.length > 0;

            const newStatus: ServerStatus = {
                config: server,
                isOnline,
                models,
                runningModels,
                activeModels: oldStatus?.activeModels || [],
                activeRequests: oldStatus?.activeRequests || 0,
                lastChecked: Date.now()
            };

            // Check if status changed
            const statusChanged = !oldStatus || 
                oldStatus.isOnline !== isOnline || 
                JSON.stringify(oldStatus.models) !== JSON.stringify(models) ||
                JSON.stringify(oldStatus.runningModels) !== JSON.stringify(runningModels);

            if (statusChanged) {
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

        const [models, runningModels] = await Promise.all([
            ModelCacheService.refreshCache(server.config.baseUrl),
            ModelCacheService.getRunningModels(server.config.baseUrl)
        ]);
        const isOnline = models.length > 0;

        const newStatus: ServerStatus = {
            config: server.config,
            isOnline,
            models,
            runningModels,
            activeModels: server.activeModels,
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

    // Returns the best server for a model based on priority-fill routing:
    // 1. Sticky: First server already running the model (under parallel limit)
    // 2. Idle: First completely idle server (to avoid mixing models if possible)
    // 3. Overflow: First server under parallel limit (even if running other models)
    static getBestServerForModel(modelName: string): ServerStatus | undefined {
        const candidates = this.getAvailableServersForModel(modelName);
        const maxParallel = ConfigService.getMaxParallelPerServer();

        // 1. Sticky: Check for servers already running this model and under limit
        const stickyCandidate = candidates.find(s => 
            s.activeModels.some(m => this.modelMatches(m, modelName)) && 
            s.activeRequests < maxParallel
        );
        if (stickyCandidate) return stickyCandidate;

        // 2. Idle: Check for completely idle servers
        const idleCandidate = candidates.find(s => s.activeRequests === 0);
        if (idleCandidate) return idleCandidate;

        // 3. Overflow: Check for any server under the limit
        const overflowCandidate = candidates.find(s => s.activeRequests < maxParallel);
        if (overflowCandidate) return overflowCandidate;

        return undefined; // All servers at capacity
    }

    static serverSupportsModel(server: ServerStatus, modelName: string): boolean {
        return server.isOnline && server.models.some(m => this.modelMatches(m, modelName));
    }

    static incrementActiveRequests(serverName: string, modelName: string) {
        const status = this.statusMap.get(serverName);
        if (status) {
            status.activeRequests++;
            status.activeModels.push(modelName);
            SocketService.emitActiveRequestsChanged(serverName, status.activeRequests);
        }
    }

    static decrementActiveRequests(serverName: string, modelName: string) {
        const status = this.statusMap.get(serverName);
        if (status && status.activeRequests > 0) {
            status.activeRequests--;
            const index = status.activeModels.indexOf(modelName);
            if (index !== -1) {
                status.activeModels.splice(index, 1);
            }
            SocketService.emitActiveRequestsChanged(serverName, status.activeRequests);
        }
    }
}

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
    lastModel: string | null;   // Last model served (likely still warm in VRAM)
    lastModelAt: number | null; // Timestamp (ms) when lastModel was set
}

export class ServerPoolService {
    private static statusMap = new Map<string, ServerStatus>();
    private static checkInterval: NodeJS.Timeout | null = null;

    // Returns true if the server's last-served model matches and is within the keep-alive window.
    // Used to determine whether a model is likely still loaded in Ollama's VRAM.
    private static isModelWarm(server: ServerStatus, modelName: string): boolean {
        if (server.lastModel === null || server.lastModelAt === null) return false;
        if (!this.modelMatches(server.lastModel, modelName)) return false;
        return (Date.now() - server.lastModelAt) < ConfigService.getOllamaKeepAliveMs();
    }

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
                lastChecked: 0,
                lastModel: null,
                lastModelAt: null
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

        const checkInterval = ConfigService.getServerCheckIntervalMs();
        const checkIntervalMinutes = Math.round(checkInterval / 60 / 1000);
        LogService.info(`Starting background server status check every ${checkIntervalMinutes} minutes (Subscribers active)`);
        
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
                lastChecked: Date.now(),
                lastModel: oldStatus?.lastModel ?? null,
                lastModelAt: oldStatus?.lastModelAt ?? null
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
            lastChecked: Date.now(),
            lastModel: server.lastModel,
            lastModelAt: server.lastModelAt
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

    // Atomically finds and reserves the best server for a model.
    // This prevents race conditions by combining server selection and reservation into a single operation.
    // Returns the reserved server or undefined if all servers are at capacity.
    //
    // Priority (designed to minimize VRAM model swaps):
    // 1. Sticky      — actively running this model + under limit (no swap, no load)
    // 2. Warm Idle   — idle + lastModel matches (model likely still in VRAM)
    // 3. Cold Idle   — any idle server (will load model, but no active work disrupted)
    // 4. Warm Overflow — busy + lastModel matches + under limit (parallel, model likely loaded)
    // 5. Cold Overflow — any server under limit (last resort; may force VRAM swap)
    static reserveServerForModel(modelName: string, maxParallelOverride?: number): ServerStatus | undefined {
        const candidates = this.getAvailableServersForModel(modelName);
        const maxParallel = maxParallelOverride ?? ConfigService.getMaxParallelPerServer();

        // 1. Sticky: actively running this model, under limit
        const sticky = candidates.find(s =>
            s.activeModels.some(m => this.modelMatches(m, modelName)) &&
            s.activeRequests < maxParallel
        );
        if (sticky) {
            this.incrementActiveRequests(sticky.config.name, modelName);
            LogService.debug(`[reserveServerForModel] Reserved sticky server: ${sticky.config.name} (active: ${sticky.activeRequests}, limit: ${maxParallel})`);
            return sticky;
        }

        // 2. Warm Idle: idle + last served this model within keep-alive window (likely still in VRAM)
        const warmIdle = candidates.find(s =>
            s.activeRequests === 0 && this.isModelWarm(s, modelName)
        );
        if (warmIdle) {
            this.incrementActiveRequests(warmIdle.config.name, modelName);
            LogService.debug(`[reserveServerForModel] Reserved warm idle server: ${warmIdle.config.name} (lastModel: ${warmIdle.lastModel}, limit: ${maxParallel})`);
            return warmIdle;
        }

        // 3. Cold Idle: any idle server
        const coldIdle = candidates.find(s => s.activeRequests === 0);
        if (coldIdle) {
            this.incrementActiveRequests(coldIdle.config.name, modelName);
            LogService.debug(`[reserveServerForModel] Reserved cold idle server: ${coldIdle.config.name} (limit: ${maxParallel})`);
            return coldIdle;
        }

        // 4. Warm Overflow: busy + last served this model within keep-alive window + under limit (avoids swap)
        const warmOverflow = candidates.find(s =>
            this.isModelWarm(s, modelName) && s.activeRequests < maxParallel
        );
        if (warmOverflow) {
            this.incrementActiveRequests(warmOverflow.config.name, modelName);
            LogService.debug(`[reserveServerForModel] Reserved warm overflow server: ${warmOverflow.config.name} (lastModel: ${warmOverflow.lastModel}, active: ${warmOverflow.activeRequests}, limit: ${maxParallel})`);
            return warmOverflow;
        }

        // 5. Cold Overflow: any server under limit (may force VRAM swap)
        const coldOverflow = candidates.find(s => s.activeRequests < maxParallel);
        if (coldOverflow) {
            this.incrementActiveRequests(coldOverflow.config.name, modelName);
            LogService.debug(`[reserveServerForModel] Reserved cold overflow server: ${coldOverflow.config.name} (active: ${coldOverflow.activeRequests}, limit: ${maxParallel})`);
            return coldOverflow;
        }

        LogService.debug(`[reserveServerForModel] No available server for model: ${modelName} (limit: ${maxParallel})`);
        return undefined; // All servers at capacity
    }

    // Returns the best server for a model based on priority-fill routing (without reserving).
    // For concurrent requests, use reserveServerForModel() to avoid race conditions.
    // Mirrors the same 5-step priority as reserveServerForModel().
    static getBestServerForModel(modelName: string): ServerStatus | undefined {
        const candidates = this.getAvailableServersForModel(modelName);
        const maxParallel = ConfigService.getMaxParallelPerServer();

        // 1. Sticky: actively running this model, under limit
        const sticky = candidates.find(s =>
            s.activeModels.some(m => this.modelMatches(m, modelName)) &&
            s.activeRequests < maxParallel
        );
        if (sticky) return sticky;

        // 2. Warm Idle: idle + last served this model within keep-alive window (likely still in VRAM)
        const warmIdle = candidates.find(s =>
            s.activeRequests === 0 && this.isModelWarm(s, modelName)
        );
        if (warmIdle) return warmIdle;

        // 3. Cold Idle: any idle server
        const coldIdle = candidates.find(s => s.activeRequests === 0);
        if (coldIdle) return coldIdle;

        // 4. Warm Overflow: busy + last served this model within keep-alive window + under limit
        const warmOverflow = candidates.find(s =>
            this.isModelWarm(s, modelName) && s.activeRequests < maxParallel
        );
        if (warmOverflow) return warmOverflow;

        // 5. Cold Overflow: any server under limit (may force VRAM swap)
        return candidates.find(s => s.activeRequests < maxParallel);
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
            status.lastModel = modelName;
            status.lastModelAt = Date.now();
            SocketService.emitActiveRequestsChanged(serverName, status.activeRequests);
        }
    }
}

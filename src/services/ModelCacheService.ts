import { LogService } from './LogService';

interface CacheEntry {
    models: string[];
    timestamp: number;
}

export class ModelCacheService {
    private static cache = new Map<string, CacheEntry>();
    private static readonly TTL_MS = 30 * 60 * 1000; // 30 minutes cache

    static async getModels(baseUrl: string): Promise<string[]> {
        const now = Date.now();
        const entry = this.cache.get(baseUrl);

        if (entry && now - entry.timestamp < this.TTL_MS) {
            return entry.models;
        }

        return this.refreshCache(baseUrl);
    }

    static async refreshCache(baseUrl: string): Promise<string[]> {
        try {
            const url = `${baseUrl}/api/tags`;
            LogService.debug(`Fetching models from ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }

            const data = await response.json() as { models: { name: string }[] };
            const modelNames = data.models.map((m: any) => m.name).sort((a: string, b: string) => a.localeCompare(b));

            this.cache.set(baseUrl, {
                models: modelNames,
                timestamp: Date.now(),
            });

            LogService.info(`Cached ${modelNames.length} models for ${baseUrl}`, { models: modelNames });
            return modelNames;
        } catch (error: any) {
            LogService.warn(`Error fetching models from ${baseUrl}: ${error.message}`, { error });
            // If we fail to fetch, we should probably clear the cache or return empty
            // so the server is marked offline. 
            this.cache.delete(baseUrl);
            return [];
        }
    }

    static async getRunningModels(baseUrl: string): Promise<string[]> {
        try {
            const url = `${baseUrl}/api/ps`;
            LogService.debug(`Fetching running models from ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout

            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Failed to fetch running models: ${response.statusText}`);
            }

            const data = await response.json() as { models: { name: string }[] };
            return data.models.map((m: any) => m.name).sort((a: string, b: string) => a.localeCompare(b));
        } catch (error: any) {
            LogService.warn(`Error fetching running models from ${baseUrl}: ${error.message}`, { error });
            return [];
        }
    }

    static clearCache(baseUrl: string) {
        this.cache.delete(baseUrl);
    }
}

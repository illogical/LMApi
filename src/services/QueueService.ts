import { randomUUID } from 'crypto';
import { LogService } from './LogService';
import { ServerPoolService, ServerStatus } from './ServerPoolService';
import { DbService } from './DbService';
import { PromptRequest, PromptResponse, QueueItem } from '../types';

export class QueueService {
    private static queue: QueueItem[] = [];
    private static isProcessing = false;

    /**
     * Prefer immediate dispatch when a server is free; fall back to queue when none are available.
     */
    static async dispatchOrQueue(request: PromptRequest): Promise<PromptResponse> {
        const server = this.findServerForRequest(request);

        if (server) {
            const id = randomUUID();
            return this.runRequest(server, request, id);
        }

        return this.enqueue(request);
    }

    /**
     * Force an immediate dispatch to a specific server, bypassing queue availability checks.
     */
    static async dispatchDirect(server: ServerStatus, request: PromptRequest): Promise<PromptResponse> {
        const id = randomUUID();
        return this.runRequest(server, request, id);
    }

    static async enqueue(request: PromptRequest): Promise<PromptResponse> {
        const id = randomUUID();
        LogService.debug(`Enqueueing request ${id}`, { model: request.model });

        return new Promise<PromptResponse>((resolve, reject) => {
            const item: QueueItem = {
                id,
                request,
                createdAt: Date.now(),
                resolve,
                reject,
            };
            this.queue.push(item);
            this.processQueue();
        });
    }

    static async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const remainingQueue: QueueItem[] = [];

            for (const item of this.queue) {
                const server = this.findServerForRequest(item.request);

                if (server) {
                    this.executeRequest(server, item);
                } else {
                    remainingQueue.push(item);
                }
            }

            this.queue = remainingQueue;

        } catch (error) {
            LogService.error('Error in processQueue', { error });
        } finally {
            this.isProcessing = false;
        }
    }

    private static executeRequest(server: ServerStatus, item: QueueItem) {
        this.runRequest(server, item.request, item.id)
            .then(item.resolve)
            .catch(item.reject);
    }

    private static findServerForRequest(request: PromptRequest): ServerStatus | undefined {
        if (request.serverName && request.serverName !== 'any') {
            const specific = ServerPoolService.getServer(request.serverName);
            if (specific && specific.activeRequests === 0 && ServerPoolService.serverSupportsModel(specific, request.model)) {
                return specific;
            }
            return undefined;
        }

        return ServerPoolService.getBestServerForModel(request.model);
    }

    private static async runRequest(server: ServerStatus, request: PromptRequest, id?: string): Promise<PromptResponse> {
        const requestId = id ?? randomUUID();
        const serverName = server.config.name;

        ServerPoolService.incrementActiveRequests(serverName);
        LogService.info(`Dispatching request ${requestId} to ${serverName}`, { model: request.model });

        const startTime = Date.now();

        try {
            const endpoint = request.params?.embedding ? '/api/embeddings' : '/api/generate';
            const url = `${server.config.baseUrl}${endpoint}`;

            const payload: any = {
                model: request.model,
                prompt: request.prompt,
                stream: false,
                ...request.params
            };

            delete payload.embedding;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 600000);

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const data = await response.json() as any;
            const durationMs = Date.now() - startTime;
            const hasResponse = data?.response != null || data?.embedding != null;

            const result: PromptResponse = {
                response: data.response || (data.embedding ? JSON.stringify(data.embedding) : ''),
                durationMs,
                serverName,
                model: request.model,
                created_at: new Date().toISOString()
            };

            if (hasResponse) {
                try {
                    DbService.insertPromptHistory({
                        serverName,
                        modelName: request.model,
                        prompt: request.prompt,
                        responseText: result.response,
                        responseDurationMs: durationMs,
                        estimatedTokens: data.eval_count ?? data.evalCount ?? null,
                        temperature: request.params?.temperature,
                        createdAt: result.created_at,
                    });
                } catch (dbErr) {
                    LogService.error('Failed to save to history', { error: dbErr });
                }
            } else {
                LogService.debug('Skipping history insert: no response returned', { id: requestId, serverName, model: request.model });
            }

            return result;

        } catch (error: any) {
            LogService.error(`Request ${requestId} failed on ${serverName}`, { error });
            throw error;
        } finally {
            ServerPoolService.decrementActiveRequests(serverName);
            this.processQueue();
        }
    }
}

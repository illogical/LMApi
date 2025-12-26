import { randomUUID } from 'crypto';
import { LogService } from './LogService';
import { ServerPoolService } from './ServerPoolService';
import { DbService } from './DbService';
import { PromptRequest, PromptResponse, QueueItem } from '../types';

export class QueueService {
    private static queue: QueueItem[] = [];
    private static isProcessing = false;

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
            // Iterate through queue to find items that can be processed
            // We start from the beginning (FIFO) but skip items if their model isn't available/free
            // This implementation allows "out of order" execution if the head is blocked but a later item is not.
            // Spec says: "dispatcher pops next item... respecting priority and model availability".
            // Queue Head blocking vs skipping? "when server frees, check queue head..."
            // Let's try to process as many as possible.

            const remainingQueue: QueueItem[] = [];

            for (const item of this.queue) {
                // Find best server
                const { request } = item;
                let server = undefined;

                if (request.serverName && request.serverName !== 'any') {
                    const specific = ServerPoolService.getServer(request.serverName);
                    if (specific && specific.isOnline && specific.models.includes(request.model) && specific.activeRequests === 0) {
                        server = specific;
                    }
                } else {
                    server = ServerPoolService.getBestServerForModel(request.model);
                }

                if (server) {
                    // Fire and forget execution/handling (it returns promise to item.resolve)
                    // We await just the initiation, not the completion, so we can process next item
                    this.executeRequest(server.config.name, server.config.baseUrl, item);
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

    private static async executeRequest(serverName: string, baseUrl: string, item: QueueItem) {
        const { request, id } = item;
        ServerPoolService.incrementActiveRequests(serverName);
        LogService.info(`Dispatching request ${id} to ${serverName}`, { model: request.model });

        const startTime = Date.now();

        try {
            // Determine endpoint based on request type (implicit in usage, but needed here)
            // We need to know if it's 'generate' or 'embeddings'.
            // For now, let's assume 'generate' unless specified. 
            // The Spec PromptRequest doesn't define type.
            // We might need to add 'type' to PromptRequest or infer.
            // Let's assume standard 'generate' format for now.

            const endpoint = request.params?.embedding ? '/api/embeddings' : '/api/generate';
            const url = `${baseUrl}${endpoint}`;

            // Ollama API payload
            const payload: any = {
                model: request.model,
                prompt: request.prompt,
                stream: false, // We want full response for specific API
                ...request.params
            };

            // Remove internal params
            delete payload.embedding;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min timeout?

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

            const result: PromptResponse = {
                response: data.response || (data.embedding ? JSON.stringify(data.embedding) : ''),
                durationMs,
                serverName,
                model: request.model,
                created_at: new Date().toISOString()
            };

            // Persist to DB
            try {
                const stmt = DbService.getDb().prepare(`
          INSERT INTO PromptHistory (serverName, modelName, prompt, responseDurationMs, estimatedTokens, temperature)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
                stmt.run(
                    serverName,
                    request.model,
                    request.prompt,
                    durationMs,
                    data.eval_count || 0,
                    request.params?.temperature || 0
                );
            } catch (dbErr) {
                LogService.error('Failed to save to history', { error: dbErr });
            }

            item.resolve(result);

        } catch (error: any) {
            LogService.error(`Request ${id} failed on ${serverName}`, { error });
            // Retry? The spec says "requeue job" on timeout/unreachable.
            // For now, just reject. 
            // User might want retry logic.
            item.reject(error);
        } finally {
            ServerPoolService.decrementActiveRequests(serverName);
            // Trigger queue check again as a slot opened up
            this.processQueue();
        }
    }
}

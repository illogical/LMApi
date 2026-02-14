import { randomUUID } from 'crypto';
import { LogService } from './LogService';
import { ServerPoolService, ServerStatus } from './ServerPoolService';
import { ConfigService } from './ConfigService';
import { DbService } from './DbService';
import { PromptRequest, PromptResponse, QueueItem, ChatCompletionRequest, ChatCompletionResponse, ChatQueueItem } from '../types';
import { ChatCompletionService } from './ChatCompletionService';

export class QueueService {
    private static queue: QueueItem[] = [];
    private static chatQueue: ChatQueueItem[] = [];
    private static isProcessing = false;
    private static isChatProcessing = false;

    /**
     * Prefer immediate dispatch when a server is free; fall back to queue when none are available.
     */
    static async dispatchOrQueue(request: PromptRequest): Promise<PromptResponse> {
        let server: ServerStatus | undefined;

        // Use atomic reservation for 'any' server requests to prevent race conditions
        if (!request.serverName || request.serverName === 'any') {
            server = ServerPoolService.reserveServerForModel(request.model, request.maxParallelPerServer);
        } else {
            // For specific server requests, use traditional find + increment
            server = this.findServerForRequest(request);
            if (server) {
                ServerPoolService.incrementActiveRequests(server.config.name, request.model);
            }
        }

        if (server) {
            const id = randomUUID();
            return this.runRequest(server, request, id);
        }

        LogService.debug(`[dispatchOrQueue] No server available, enqueueing request`);
        return this.enqueue(request);
    }

    /**
     * Force an immediate dispatch to a specific server, bypassing queue availability checks.
     */
    static async dispatchDirect(server: ServerStatus, request: PromptRequest): Promise<PromptResponse> {
        ServerPoolService.incrementActiveRequests(server.config.name, request.model);
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
                let server: ServerStatus | undefined;

                // Use atomic reservation for 'any' server requests
                if (!item.request.serverName || item.request.serverName === 'any') {
                    server = ServerPoolService.reserveServerForModel(item.request.model, item.request.maxParallelPerServer);
                } else {
                    // For specific server requests, use traditional find + increment
                    server = this.findServerForRequest(item.request);
                    if (server) {
                        ServerPoolService.incrementActiveRequests(server.config.name, item.request.model);
                    }
                }

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
        // This method should only be called for specific server requests
        // For 'any' server requests, use ServerPoolService.reserveServerForModel() directly
        if (request.serverName && request.serverName !== 'any') {
            const specific = ServerPoolService.getServer(request.serverName);
            const maxParallel = ConfigService.getMaxParallelPerServer();
            if (specific && specific.activeRequests < maxParallel && ServerPoolService.serverSupportsModel(specific, request.model)) {
                LogService.debug(`[findServerForRequest] Found specific server: ${specific.config.name} (active: ${specific.activeRequests})`);
                return specific;
            }
            LogService.debug(`[findServerForRequest] Specific server ${request.serverName} not available`);
            return undefined;
        }

        // Fallback for legacy code paths - prefer using reserveServerForModel() instead
        const chosen = ServerPoolService.getBestServerForModel(request.model);
        LogService.debug(`[findServerForRequest] Model: ${request.model}, Chosen Server: ${chosen?.config.name || 'NONE'}, Active: ${chosen?.activeRequests || 'N/A'}`);
        return chosen;
    }

    private static async runRequest(server: ServerStatus, request: PromptRequest, id?: string): Promise<PromptResponse> {
        const requestId = id ?? randomUUID();
        const serverName = server.config.name;

        LogService.info(`Dispatching request ${requestId} to ${serverName}`, { model: request.model });

        const startTime = Date.now();
        const createdAt = new Date().toISOString();

        // 1. Insert pending record
        let dbId: number | bigint | undefined;
        try {
            dbId = DbService.insertPromptHistory({
                serverName,
                modelName: request.model,
                prompt: request.prompt,
                temperature: request.params?.temperature,
                createdAt,
                groupId: request.groupId,
            });

            
        } catch (dbErr) {
            LogService.error('Failed to insert pending history record', { error: dbErr });
        }

        try {
            // Asynchronously check for identical prompts and assign groupId if needed
            if (dbId && request.prompt) {
                setImmediate(() => {
                    DbService.assignGroupIdByPrompt(dbId!, request.prompt!)
                        .catch(err => LogService.error('Error in assignGroupIdByPrompt', { error: err }));
                });
            }
        } catch (dbErr) {
            LogService.error('Failed to update pending history record\'s groupId', { error: dbErr });
        }

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
            const responseAt = new Date().toISOString();

            // Calculate evalDuration as combination of prompt eval time and output eval time
            const evalDuration = (data.prompt_eval_duration || 0) + (data.eval_duration || 0);

            const result: PromptResponse = {
                response: data.response || data.embedding || '',
                durationMs,
                serverName,
                model: request.model,
                created_at: createdAt,
                thinking: data.thinking || undefined,
                loadDuration: data.load_duration || undefined,
                evalDuration: evalDuration || undefined,
                totalDuration: data.total_duration || undefined,
                inputTokens: data.prompt_eval_count || undefined,
                outputTokens: data.eval_count || undefined
            };

            // 2. Update record with success
            if (dbId !== undefined) {
                try {
                    DbService.updatePromptHistory(dbId, {
                        responseText: typeof result.response === 'string' ? result.response : JSON.stringify(result.response),
                        responseDurationMs: durationMs,
                        inputTokens: data.prompt_eval_count ?? data.promptEvalCount ?? null,
                        outputTokens: data.eval_count ?? data.evalCount ?? null,
                        loadDuration: data.load_duration ?? null,
                        evalDuration: evalDuration || null,
                        totalDuration: data.total_duration ?? null,
                        thinking: data.thinking ?? null,
                        responseAt,
                        isError: false,
                    });
                } catch (dbErr) {
                    LogService.error('Failed to update history record', { error: dbErr });
                }
            }

            return result;

        } catch (error: any) {
            LogService.error(`Request ${requestId} failed on ${serverName}`, { error });
            
            // 3. Update record with error
            if (dbId !== undefined) {
                try {
                    DbService.updatePromptHistory(dbId, {
                        responseText: error.message || 'Unknown error',
                        responseDurationMs: Date.now() - startTime,
                        responseAt: new Date().toISOString(),
                        isError: true,
                    });
                } catch (dbErr) {
                    LogService.error('Failed to update history record with error', { error: dbErr });
                }
            }
            throw error;
        } finally {
            ServerPoolService.decrementActiveRequests(serverName, request.model);
            this.processQueue();
        }
    }

    /**
     * Chat Completions: Prefer immediate dispatch when a server is free; fall back to queue when none are available.
     */
    static async dispatchOrQueueChat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        let server: ServerStatus | undefined;

        // Use atomic reservation for 'any' server requests to prevent race conditions
        if (!request.serverName || request.serverName === 'any') {
            server = ServerPoolService.reserveServerForModel(request.model, request.maxParallelPerServer);
        } else {
            // For specific server requests, use traditional find + increment
            server = this.findServerForChatRequest(request);
            if (server) {
                ServerPoolService.incrementActiveRequests(server.config.name, request.model);
            }
        }

        if (server) {
            const id = randomUUID();
            return this.runChatRequest(server, request, id);
        }

        LogService.debug(`[dispatchOrQueueChat] No server available, enqueueing chat request`);
        return this.enqueueChat(request);
    }

    /**
     * Force an immediate chat dispatch to a specific server, bypassing queue availability checks.
     */
    static async dispatchChatDirect(server: ServerStatus, request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        ServerPoolService.incrementActiveRequests(server.config.name, request.model);
        const id = randomUUID();
        return this.runChatRequest(server, request, id);
    }

    static async enqueueChat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const id = randomUUID();
        LogService.debug(`Enqueueing chat request ${id}`, { model: request.model });

        return new Promise<ChatCompletionResponse>((resolve, reject) => {
            const item: ChatQueueItem = {
                id,
                request,
                createdAt: Date.now(),
                resolve,
                reject,
            };
            this.chatQueue.push(item);
            this.processChatQueue();
        });
    }

    static async processChatQueue() {
        if (this.isChatProcessing) return;
        this.isChatProcessing = true;

        try {
            const remainingQueue: ChatQueueItem[] = [];

            for (const item of this.chatQueue) {
                let server: ServerStatus | undefined;

                // Use atomic reservation for 'any' server requests
                if (!item.request.serverName || item.request.serverName === 'any') {
                    server = ServerPoolService.reserveServerForModel(item.request.model, item.request.maxParallelPerServer);
                } else {
                    // For specific server requests, use traditional find + increment
                    server = this.findServerForChatRequest(item.request);
                    if (server) {
                        ServerPoolService.incrementActiveRequests(server.config.name, item.request.model);
                    }
                }

                if (server) {
                    this.executeChatRequest(server, item);
                } else {
                    remainingQueue.push(item);
                }
            }

            this.chatQueue = remainingQueue;

        } catch (error) {
            LogService.error('Error in processChatQueue', { error });
        } finally {
            this.isChatProcessing = false;
        }
    }

    private static executeChatRequest(server: ServerStatus, item: ChatQueueItem) {
        this.runChatRequest(server, item.request, item.id)
            .then(item.resolve)
            .catch(item.reject);
    }

    private static findServerForChatRequest(request: ChatCompletionRequest): ServerStatus | undefined {
        // This method should only be called for specific server requests
        if (request.serverName && request.serverName !== 'any') {
            const specific = ServerPoolService.getServer(request.serverName);
            const maxParallel = ConfigService.getMaxParallelPerServer();
            if (specific && specific.activeRequests < maxParallel && ServerPoolService.serverSupportsModel(specific, request.model)) {
                LogService.debug(`[findServerForChatRequest] Found specific server: ${specific.config.name} (active: ${specific.activeRequests})`);
                return specific;
            }
            LogService.debug(`[findServerForChatRequest] Specific server ${request.serverName} not available`);
            return undefined;
        }

        // Fallback for legacy code paths
        const chosen = ServerPoolService.getBestServerForModel(request.model);
        LogService.debug(`[findServerForChatRequest] Model: ${request.model}, Chosen Server: ${chosen?.config.name || 'NONE'}, Active: ${chosen?.activeRequests || 'N/A'}`);
        return chosen;
    }

    private static async runChatRequest(server: ServerStatus, request: ChatCompletionRequest, id?: string): Promise<ChatCompletionResponse> {
        const requestId = id ?? randomUUID();
        const serverName = server.config.name;

        LogService.info(`Dispatching chat request ${requestId} to ${serverName}`, { model: request.model });

        const startTime = Date.now();
        const createdAt = new Date().toISOString();

        // Extract last user message for DB logging
        const lastUserMessage = ChatCompletionService.extractLastUserMessage(request.messages);

        // 1. Insert pending record
        let dbId: number | bigint | undefined;
        try {
            dbId = DbService.insertPromptHistory({
                serverName,
                modelName: request.model,
                prompt: lastUserMessage,
                temperature: request.temperature,
                createdAt,
                groupId: request.groupId,
                requestType: 'chat',
            });
        } catch (dbErr) {
            LogService.error('Failed to insert pending chat history record', { error: dbErr });
        }

        try {
            // Send chat completion request to Ollama
            const response = await ChatCompletionService.sendToServer(server, request);
            
            const durationMs = Date.now() - startTime;
            const responseAt = new Date().toISOString();

            // Extract usage info
            const usage = ChatCompletionService.extractUsage(response);
            const responseContent = ChatCompletionService.extractResponseContent(response);

            // 2. Update record with success
            if (dbId !== undefined) {
                try {
                    DbService.updatePromptHistory(dbId, {
                        responseText: responseContent,
                        responseDurationMs: durationMs,
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                        responseAt,
                        isError: false,
                    });
                } catch (dbErr) {
                    LogService.error('Failed to update chat history record', { error: dbErr });
                }
            }

            // Add LMAPI metadata
            response.lmapi = {
                server_name: serverName,
                duration_ms: durationMs,
                group_id: request.groupId
            };

            return response;

        } catch (error: any) {
            LogService.error(`Chat request ${requestId} failed on ${serverName}`, { error });
            
            // 3. Update record with error
            if (dbId !== undefined) {
                try {
                    DbService.updatePromptHistory(dbId, {
                        responseText: error.message || 'Unknown error',
                        responseDurationMs: Date.now() - startTime,
                        responseAt: new Date().toISOString(),
                        isError: true,
                    });
                } catch (dbErr) {
                    LogService.error('Failed to update chat history record with error', { error: dbErr });
                }
            }
            throw error;
        } finally {
            ServerPoolService.decrementActiveRequests(serverName, request.model);
            this.processChatQueue();
        }
    }
}

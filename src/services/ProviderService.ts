import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { LogService } from './LogService';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types';
import type { Response } from 'express';

// Zod schema for provider configuration
const ProviderConfigSchema = z.object({
    enabled: z.boolean(),
    baseUrl: z.string().url(),
    apiKeyEnvVar: z.string(),
    headers: z.record(z.string()),
    models: z.array(z.string()),
    routing: z.object({
        priority: z.enum(['primary', 'fallback']),
        allowedEndpoints: z.array(z.string())
    })
});

const ProvidersConfigSchema = z.record(ProviderConfigSchema);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema> & { name: string };
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

export class ProviderService {
    private static providers = new Map<string, ProviderConfig>();
    private static configPath = path.join(process.cwd(), 'src', 'config', 'providers.json');
    private static initialized = false;

    /**
     * Load and validate providers.json configuration
     */
    static initialize(): void {
        if (this.initialized) {
            return;
        }

        try {
            if (!fs.existsSync(this.configPath)) {
                LogService.warn('providers.json not found, cloud providers disabled');
                this.initialized = true;
                return;
            }

            const fileContent = fs.readFileSync(this.configPath, 'utf-8');
            const config = JSON.parse(fileContent);
            const validated = ProvidersConfigSchema.parse(config);

            // Load enabled providers
            for (const [name, providerConfig] of Object.entries(validated)) {
                if (providerConfig.enabled) {
                    // Check if API key is available
                    const apiKey = process.env[providerConfig.apiKeyEnvVar];
                    if (!apiKey) {
                        LogService.warn(`Provider ${name} enabled but API key ${providerConfig.apiKeyEnvVar} not found in environment`);
                        continue;
                    }

                    this.providers.set(name, { ...providerConfig, name });
                    LogService.info(`Loaded cloud provider: ${name} (${providerConfig.models.length} models)`);
                }
            }

            this.initialized = true;
            LogService.info(`Provider service initialized with ${this.providers.size} provider(s)`);

        } catch (error: any) {
            LogService.error('Failed to initialize ProviderService', { error });
            this.initialized = true; // Mark as initialized even on error to prevent retry loops
        }
    }

    /**
     * Check if a model is available on any cloud provider
     */
    static getProviderForModel(model: string): ProviderConfig | undefined {
        if (!this.initialized) {
            this.initialize();
        }

        for (const provider of this.providers.values()) {
            if (provider.models.includes(model)) {
                return provider;
            }
        }

        return undefined;
    }

    /**
     * Get all available providers
     */
    static getProviders(): ProviderConfig[] {
        if (!this.initialized) {
            this.initialize();
        }
        
        return Array.from(this.providers.values());
    }

    /**
     * Get a specific provider by name
     */
    static getProvider(name: string): ProviderConfig | undefined {
        if (!this.initialized) {
            this.initialize();
        }
        
        return this.providers.get(name);
    }

    /**
     * Send a chat completion request to a cloud provider (e.g., OpenRouter)
     */
    static async sendChatCompletion(
        provider: ProviderConfig,
        body: ChatCompletionRequest,
        res?: Response
    ): Promise<ChatCompletionResponse> {
        const url = `${provider.baseUrl}/chat/completions`;
        
        // Get API key from environment
        const apiKey = process.env[provider.apiKeyEnvVar];
        if (!apiKey) {
            throw new Error(`API key ${provider.apiKeyEnvVar} not found in environment`);
        }

        // Strip LMAPI-specific fields
        const { serverName, models, groupId, maxParallelPerServer, provider: providerParam, ...openAIBody } = body;

        const payload = {
            ...openAIBody,
            stream: body.stream || false
        };

        LogService.debug(`[ProviderService] Sending request to ${provider.name}`, {
            model: payload.model,
            messageCount: payload.messages.length,
            stream: payload.stream
        });

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...provider.headers
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`${provider.name} API error: ${response.statusText} - ${errorText}`);
            }

            // Handle streaming response
            if (payload.stream && res) {
                return await this.handleProviderStreamingResponse(response, res, provider);
            }

            // Handle non-streaming response
            const data = await response.json() as ChatCompletionResponse;
            
            LogService.debug(`[ProviderService] Received response from ${provider.name}`, {
                id: data.id,
                choices: data.choices?.length || 0
            });

            return data;

        } catch (error: any) {
            clearTimeout(timeoutId);
            LogService.error(`[ProviderService] Request failed for ${provider.name}`, { error });
            throw error;
        }
    }

    /**
     * Handle SSE streaming response from cloud provider
     * Forwards chunks to the client and accumulates final response for DB logging
     */
    private static async handleProviderStreamingResponse(
        providerResponse: globalThis.Response,
        clientRes: Response,
        provider: ProviderConfig
    ): Promise<ChatCompletionResponse> {
        // Set SSE headers
        clientRes.setHeader('Content-Type', 'text/event-stream');
        clientRes.setHeader('Cache-Control', 'no-cache');
        clientRes.setHeader('Connection', 'keep-alive');

        const reader = providerResponse.body?.getReader();
        const decoder = new TextDecoder();
        
        let accumulatedResponse: ChatCompletionResponse | null = null;
        let buffer = '';

        try {
            if (!reader) {
                throw new Error('No response body reader available');
            }

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        
                        if (data === '[DONE]') {
                            clientRes.write('data: [DONE]\n\n');
                            break;
                        }

                        try {
                            const chunk = JSON.parse(data);

                            // Accumulate the final response for logging
                            if (!accumulatedResponse) {
                                // Convert streaming delta format to message format for the accumulated response
                                const initial = { ...chunk };
                                if (initial.choices) {
                                    initial.choices = initial.choices.map((c: any) => ({
                                        ...c,
                                        message: { role: 'assistant', content: c.delta?.content || '' },
                                    }));
                                }
                                accumulatedResponse = initial;
                            } else {
                                // Append delta content to accumulated message
                                if (chunk.choices) {
                                    for (const choice of chunk.choices) {
                                        const existing = accumulatedResponse.choices?.[choice.index];
                                        if (existing && choice.delta?.content) {
                                            existing.message.content = (existing.message.content || '') + choice.delta.content;
                                        }
                                        if (choice.delta?.tool_calls) {
                                            // Accumulate tool calls
                                            if (!existing.message.tool_calls) {
                                                existing.message.tool_calls = [];
                                            }
                                            for (const toolCall of choice.delta.tool_calls) {
                                                const existingToolCall = existing.message.tool_calls[toolCall.index || 0];
                                                if (!existingToolCall) {
                                                    existing.message.tool_calls[toolCall.index || 0] = {
                                                        id: toolCall.id || '',
                                                        type: 'function',
                                                        function: {
                                                            name: toolCall.function?.name || '',
                                                            arguments: toolCall.function?.arguments || ''
                                                        }
                                                    };
                                                } else {
                                                    if (toolCall.function?.name) {
                                                        existingToolCall.function.name = toolCall.function.name;
                                                    }
                                                    if (toolCall.function?.arguments) {
                                                        existingToolCall.function.arguments += toolCall.function.arguments;
                                                    }
                                                }
                                            }
                                        }
                                        if (choice.finish_reason) {
                                            if (existing) existing.finish_reason = choice.finish_reason;
                                        }
                                    }
                                }
                                if (chunk.usage) {
                                    accumulatedResponse.usage = chunk.usage;
                                }
                            }

                            // Forward to client
                            clientRes.write(`data: ${data}\n\n`);
                        } catch (parseError) {
                            LogService.error('[ProviderService] Failed to parse streaming chunk', { parseError, data });
                        }
                    }
                }
            }

            // Send final [DONE] if not already sent
            clientRes.write('data: [DONE]\n\n');
            clientRes.end();

            // Return accumulated response for DB logging
            if (!accumulatedResponse) {
                throw new Error('No response accumulated from stream');
            }

            LogService.debug(`[ProviderService] Streaming completed from ${provider.name}`, {
                id: accumulatedResponse.id,
                choices: accumulatedResponse.choices?.length || 0
            });

            return accumulatedResponse;

        } catch (error: any) {
            LogService.error('[ProviderService] Streaming error', { error });
            
            // Try to send error to client if not already closed
            if (!clientRes.writableEnded) {
                clientRes.write(`data: {"error": "${error.message}"}\n\n`);
                clientRes.end();
            }
            
            throw error;
        }
    }

    /**
     * Extract token usage from provider response for DB logging
     */
    static extractUsage(response: ChatCompletionResponse): {
        inputTokens?: number;
        outputTokens?: number;
    } {
        return {
            inputTokens: response.usage?.prompt_tokens,
            outputTokens: response.usage?.completion_tokens
        };
    }

    /**
     * Extract assistant response content from provider response
     */
    static extractResponseContent(response: ChatCompletionResponse): string {
        if (response.choices && response.choices.length > 0) {
            return response.choices[0].message.content || '';
        }
        return '';
    }
}

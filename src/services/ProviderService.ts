import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { LogService } from './LogService';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types';

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
        body: ChatCompletionRequest
    ): Promise<ChatCompletionResponse> {
        const url = `${provider.baseUrl}/chat/completions`;
        
        // Get API key from environment
        const apiKey = process.env[provider.apiKeyEnvVar];
        if (!apiKey) {
            throw new Error(`API key ${provider.apiKeyEnvVar} not found in environment`);
        }

        // Strip LMAPI-specific fields
        const { serverName, models, groupId, maxParallelPerServer, ...openAIBody } = body;

        const payload = {
            ...openAIBody,
            stream: false // Phase 7: non-streaming only
        };

        LogService.debug(`[ProviderService] Sending request to ${provider.name}`, {
            model: payload.model,
            messageCount: payload.messages.length
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

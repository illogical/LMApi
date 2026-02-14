import { LogService } from './LogService';
import { ServerStatus } from './ServerPoolService';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types';

export class ChatCompletionService {
    /**
     * Send a chat completion request to an Ollama server's /v1/chat/completions endpoint.
     * Strips LMAPI-specific fields before forwarding.
     */
    static async sendToServer(
        server: ServerStatus,
        body: ChatCompletionRequest
    ): Promise<ChatCompletionResponse> {
        const url = `${server.config.baseUrl}/v1/chat/completions`;
        
        // Strip LMAPI-specific fields
        const { serverName, models, groupId, maxParallelPerServer, ...openAIBody } = body;
        
        // Force stream: false for Phase 5 (streaming in Phase 6)
        const payload = {
            ...openAIBody,
            stream: false
        };

        LogService.debug(`[ChatCompletionService] Sending request to ${url}`, { 
            model: payload.model,
            messageCount: payload.messages.length 
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Ollama API error: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json() as ChatCompletionResponse;
            
            LogService.debug(`[ChatCompletionService] Received response from ${server.config.name}`, {
                id: data.id,
                choices: data.choices?.length || 0
            });

            return data;

        } catch (error: any) {
            clearTimeout(timeoutId);
            LogService.error(`[ChatCompletionService] Request failed for ${server.config.name}`, { error });
            throw error;
        }
    }

    /**
     * Extract token usage from chat completion response for DB logging
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
     * Extract the last user message content from messages array for DB logging
     */
    static extractLastUserMessage(messages: any[]): string {
        // Find last user message
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user' && messages[i].content) {
                return messages[i].content;
            }
        }
        return '';
    }

    /**
     * Extract assistant response content from chat completion response
     */
    static extractResponseContent(response: ChatCompletionResponse): string {
        if (response.choices && response.choices.length > 0) {
            return response.choices[0].message.content || '';
        }
        return '';
    }
}

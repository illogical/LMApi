import { LogService } from './LogService';
import { ServerStatus } from './ServerPoolService';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types';
import type { Response } from 'express';

export class ChatCompletionService {
    /**
     * Send a chat completion request to an Ollama server's /v1/chat/completions endpoint.
     * Strips LMAPI-specific fields before forwarding.
     * If res is provided, streams the response; otherwise returns buffered response.
     */
    static async sendToServer(
        server: ServerStatus,
        body: ChatCompletionRequest,
        res?: Response
    ): Promise<ChatCompletionResponse> {
        const url = `${server.config.baseUrl}/v1/chat/completions`;
        
        // Strip LMAPI-specific fields
        const { serverName, models, groupId, maxParallelPerServer, ...openAIBody } = body;
        
        // Use the stream setting from the request body
        const payload = {
            ...openAIBody,
            stream: body.stream || false
        };

        LogService.debug(`[ChatCompletionService] Sending request to ${url}`, { 
            model: payload.model,
            messageCount: payload.messages.length,
            stream: payload.stream
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

            // Handle streaming response
            if (payload.stream && res) {
                return await this.handleStreamingResponse(response, res, server);
            }

            // Handle non-streaming response
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
     * Handle SSE streaming response from Ollama
     * Forwards chunks to the client and accumulates final response for DB logging
     */
    private static async handleStreamingResponse(
        ollamaResponse: globalThis.Response,
        clientRes: Response,
        server: ServerStatus
    ): Promise<ChatCompletionResponse> {
        // Set SSE headers
        clientRes.setHeader('Content-Type', 'text/event-stream');
        clientRes.setHeader('Cache-Control', 'no-cache');
        clientRes.setHeader('Connection', 'keep-alive');

        const reader = ollamaResponse.body?.getReader();
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
                            LogService.error('[ChatCompletionService] Failed to parse streaming chunk', { parseError, data });
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

            LogService.debug(`[ChatCompletionService] Streaming completed from ${server.config.name}`, {
                id: accumulatedResponse.id,
                choices: accumulatedResponse.choices?.length || 0
            });

            return accumulatedResponse;

        } catch (error: any) {
            LogService.error('[ChatCompletionService] Streaming error', { error });
            
            // Try to send error to client if not already closed
            if (!clientRes.writableEnded) {
                clientRes.write(`data: {"error": "${error.message}"}\n\n`);
                clientRes.end();
            }
            
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
            const choice = response.choices[0];
            if (choice.message?.content) {
                return choice.message.content;
            }
            // Represent tool calls in the response text for DB logging
            const toolCalls = choice.message?.tool_calls;
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                return toolCalls.map((tc: any) =>
                    `[tool_call: ${tc.function?.name}(${tc.function?.arguments || ''})]`
                ).join(' ');
            }
        }
        return '';
    }
}

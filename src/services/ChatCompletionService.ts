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
        const payload: Record<string, any> = {
            ...openAIBody,
            stream: body.stream || false
        };

        // Request usage data in the final streaming chunk (Ollama supports this)
        if (payload.stream) {
            payload.stream_options = { include_usage: true };
        }

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

        const streamStartMs = Date.now();
        let firstTokenMs: number | undefined;
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

                            // Capture time-to-first-token on the first chunk with actual content
                            if (firstTokenMs === undefined) {
                                const hasContent = chunk.choices?.some((c: any) =>
                                    c.delta?.content || (Array.isArray(c.delta?.tool_calls) && c.delta.tool_calls.length > 0)
                                );
                                if (hasContent) {
                                    firstTokenMs = Date.now() - streamStartMs;
                                }
                            }

                            // Accumulate the final response for logging
                            if (!accumulatedResponse) {
                                // Convert streaming delta format to message format for the accumulated response
                                const initial = { ...chunk };
                                if (initial.choices) {
                                    initial.choices = initial.choices.map((c: any) => ({
                                        ...c,
                                        message: {
                                            role: 'assistant',
                                            content: c.delta?.content || '',
                                            tool_calls: c.delta?.tool_calls
                                                ? c.delta.tool_calls.map((tc: any) => ({
                                                    id: tc.id,
                                                    type: tc.type || 'function',
                                                    function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' }
                                                }))
                                                : undefined,
                                        },
                                    }));
                                }
                                accumulatedResponse = initial;
                            } else {
                                // Append delta content and tool_calls to accumulated message
                                if (chunk.choices) {
                                    for (const choice of chunk.choices) {
                                        const existing = accumulatedResponse.choices?.[choice.index];
                                        if (existing) {
                                            if (choice.delta?.content) {
                                                existing.message.content = (existing.message.content || '') + choice.delta.content;
                                            }
                                            // Accumulate tool_call argument fragments
                                            if (choice.delta?.tool_calls) {
                                                for (const tcDelta of choice.delta.tool_calls) {
                                                    const idx = tcDelta.index ?? 0;
                                                    if (!existing.message.tool_calls) {
                                                        existing.message.tool_calls = [];
                                                    }
                                                    if (!existing.message.tool_calls[idx]) {
                                                        existing.message.tool_calls[idx] = {
                                                            id: tcDelta.id || '',
                                                            type: tcDelta.type || 'function',
                                                            function: { name: tcDelta.function?.name || '', arguments: '' }
                                                        };
                                                    }
                                                    if (tcDelta.function?.arguments) {
                                                        existing.message.tool_calls[idx].function.arguments += tcDelta.function.arguments;
                                                    }
                                                    if (tcDelta.function?.name && !existing.message.tool_calls[idx].function.name) {
                                                        existing.message.tool_calls[idx].function.name = tcDelta.function.name;
                                                    }
                                                }
                                            }
                                            if (choice.finish_reason) {
                                                existing.finish_reason = choice.finish_reason;
                                            }
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

            // Attach TTFT for QueueService to read before it overwrites lmapi
            if (firstTokenMs !== undefined) {
                accumulatedResponse.lmapi = {
                    server_name: server.config.name,
                    duration_ms: 0,  // placeholder; QueueService overwrites this
                    ttft_ms: firstTokenMs,
                };
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
                const content = messages[i].content;
                if (typeof content === 'string') return content;
                if (Array.isArray(content)) return JSON.stringify(content);
            }
        }
        return '';
    }

    /**
     * Extract assistant response content from chat completion response.
     * Returns only text content; tool calls are handled separately via extractToolCalls().
     */
    static extractResponseContent(response: ChatCompletionResponse): string {
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            if (typeof choice.message?.content === 'string' && choice.message.content) {
                return choice.message.content;
            }
        }
        return '';
    }

    /**
     * Extract raw tool_calls array from chat completion response for DB logging.
     * Returns undefined if no tool calls are present.
     */
    static extractToolCalls(response: ChatCompletionResponse): any[] | undefined {
        const toolCalls = response.choices?.[0]?.message?.tool_calls;
        return Array.isArray(toolCalls) && toolCalls.length > 0 ? toolCalls : undefined;
    }
}

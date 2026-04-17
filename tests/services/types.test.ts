import { describe, it, expect } from 'vitest';
import type {
    PromptParams,
    PromptRequest,
    PromptResponse,
    QueueItem,
    ChatMessage,
    ToolCall,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChoice,
    ChatQueueItem,
    RequestPhase,
    ActiveRequestState,
    GroupStatus,
    EvaluationRequest,
    EvaluationResult,
} from '../../src/types';

describe('types', () => {
    describe('PromptRequest', () => {
        it('should accept valid prompt request with required fields', () => {
            const request: PromptRequest = {
                prompt: 'Hello',
                model: 'llama3.2',
            };
            expect(request.prompt).toBe('Hello');
            expect(request.model).toBe('llama3.2');
        });

        it('should accept optional fields', () => {
            const request: PromptRequest = {
                prompt: 'Hello',
                model: 'llama3.2',
                serverName: 'alpha',
                params: { temperature: 0.7 },
                groupId: 'test-group',
                maxParallelPerServer: 2,
            };
            expect(request.serverName).toBe('alpha');
            expect(request.params?.temperature).toBe(0.7);
            expect(request.groupId).toBe('test-group');
            expect(request.maxParallelPerServer).toBe(2);
        });
    });

    describe('PromptResponse', () => {
        it('should accept string response', () => {
            const response: PromptResponse = {
                response: 'Hello back!',
                durationMs: 1500,
                serverName: 'alpha',
                model: 'llama3.2',
            };
            expect(response.response).toBe('Hello back!');
        });

        it('should accept array response (embeddings)', () => {
            const response: PromptResponse = {
                response: [0.1, 0.2, 0.3],
                durationMs: 100,
                serverName: 'beta',
                model: 'nomic-embed',
            };
            expect(Array.isArray(response.response)).toBe(true);
        });
    });

    describe('ChatMessage', () => {
        it('should accept all valid roles', () => {
            const roles: ChatMessage['role'][] = ['system', 'user', 'assistant', 'tool'];
            for (const role of roles) {
                const msg: ChatMessage = { role, content: 'test' };
                expect(msg.role).toBe(role);
            }
        });

        it('should accept optional tool_calls', () => {
            const msg: ChatMessage = {
                role: 'assistant',
                tool_calls: [{
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'test', arguments: '{}' },
                }],
            };
            expect(msg.tool_calls).toHaveLength(1);
        });
    });

    describe('ChatCompletionRequest', () => {
        it('should accept minimal valid request', () => {
            const req: ChatCompletionRequest = {
                model: 'llama3.2',
                messages: [{ role: 'user', content: 'Hi' }],
            };
            expect(req.model).toBe('llama3.2');
            expect(req.messages).toHaveLength(1);
        });

        it('should accept all LMAPI extensions', () => {
            const req: ChatCompletionRequest = {
                model: 'llama3.2',
                messages: [{ role: 'user', content: 'Hi' }],
                serverName: 'alpha',
                models: ['llama3.2', 'qwen2.5'],
                groupId: 'group-1',
                maxParallelPerServer: 2,
                provider: 'openrouter',
                stream: true,
                temperature: 0.7,
                max_tokens: 1000,
            };
            expect(req.provider).toBe('openrouter');
            expect(req.stream).toBe(true);
        });
    });

    describe('RequestPhase', () => {
        it('should accept all valid phases', () => {
            const phases: RequestPhase[] = [
                'queued', 'dispatching', 'evaluating', 'streaming',
                'completed', 'failed', 'cancelled',
            ];
            expect(phases).toHaveLength(7);
        });
    });

    describe('ActiveRequestState', () => {
        it('should accept valid state', () => {
            const state: ActiveRequestState = {
                requestId: 'req-1',
                requestType: 'chat',
                modelName: 'llama3.2',
                phase: 'queued',
                startedAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
                elapsedMs: 0,
                retryCount: 0,
            };
            expect(state.requestId).toBe('req-1');
            expect(state.phase).toBe('queued');
        });
    });

    describe('GroupStatus', () => {
        it('should accept valid group status', () => {
            const status: GroupStatus = {
                groupId: 'group-1',
                total: 3,
                queued: 0,
                running: 2,
                completed: 1,
                failed: 0,
                byModel: { 'llama3.2': 2, 'qwen2.5': 1 },
                byServer: { alpha: 3 },
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            expect(status.total).toBe(3);
            expect(status.byModel['llama3.2']).toBe(2);
        });
    });

    describe('EvaluationRequest', () => {
        it('should accept prompt-based request', () => {
            const req: EvaluationRequest = {
                prompt: 'Test prompt',
                models: ['llama3.2'],
            };
            expect(req.prompt).toBe('Test prompt');
        });

        it('should accept file-based request', () => {
            const req: EvaluationRequest = {
                filePath: '/path/to/prompt.md',
                models: ['llama3.2', 'qwen2.5'],
                temperature: 0.7,
                max_tokens: 1000,
                generateReport: false,
            };
            expect(req.filePath).toBe('/path/to/prompt.md');
        });
    });

    describe('EvaluationResult', () => {
        it('should accept successful result', () => {
            const result: EvaluationResult = {
                model: 'llama3.2',
                server_name: 'alpha',
                duration_ms: 2000,
                finish_reason: 'stop',
                response_text: 'Hello!',
                input_tokens: 10,
                output_tokens: 20,
                tokens_per_second: 10.0,
            };
            expect(result.model).toBe('llama3.2');
            expect(result.tokens_per_second).toBe(10.0);
        });

        it('should accept error result', () => {
            const result: EvaluationResult = {
                model: 'llama3.2',
                server_name: 'alpha',
                duration_ms: 500,
                finish_reason: 'error',
                response_text: '',
                error: 'Model not available',
            };
            expect(result.error).toBe('Model not available');
        });
    });
});

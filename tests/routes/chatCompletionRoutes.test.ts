import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { chatCompletionRoutes } from '../../src/routes/chatCompletionRoutes';
import { QueueService } from '../../src/services/QueueService';
import { ServerPoolService } from '../../src/services/ServerPoolService';
import { ProviderService } from '../../src/services/ProviderService';

vi.mock('../../src/services/QueueService', () => ({
    QueueService: {
        dispatchOrQueueChat: vi.fn(),
        dispatchChatDirect: vi.fn(),
        runChatRequestStreaming: vi.fn(),
        runCloudProviderRequestStreaming: vi.fn(),
        runCloudProviderRequest: vi.fn(),
    },
}));

vi.mock('../../src/services/ServerPoolService', () => ({
    ServerPoolService: {
        getAvailableServersForModel: vi.fn(),
        getServer: vi.fn(),
        serverSupportsModel: vi.fn(),
        getServers: vi.fn(),
        reserveServerForModel: vi.fn(),
        decrementActiveRequests: vi.fn(),
    },
}));

vi.mock('../../src/services/ProviderService', () => ({
    ProviderService: {
        getProviderForModel: vi.fn(),
        getProvider: vi.fn(),
        providerSupportsModel: vi.fn(),
        sendChatCompletion: vi.fn(),
    },
}));

const mockChatResponse = {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: Date.now(),
    model: 'llama3.2',
    choices: [{
        index: 0,
        message: { role: 'assistant' as const, content: 'Hello there!' },
        finish_reason: 'stop',
    }],
    lmapi: {
        server_name: 'alpha',
        duration_ms: 1500,
    },
};

describe('chatCompletionRoutes', () => {
    // Mount at both /api and / (root) to test both OpenAI-compatible and LMAPI endpoints
    const app = createTestApp(chatCompletionRoutes, '/api');

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('POST /api/chat/completions/any', () => {
        it('should dispatch chat completion to any server', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                });

            expect(res.status).toBe(200);
            expect(res.body.choices).toHaveLength(1);
            expect(res.body.choices[0].message.content).toBe('Hello there!');
            expect(res.body.lmapi).toBeDefined();
        });

        it('should return 503 when model not available', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([]);
            vi.mocked(ProviderService.getProviderForModel).mockReturnValue(undefined);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'nonexistent',
                    messages: [{ role: 'user', content: 'Hello' }],
                });

            expect(res.status).toBe(503);
        });

        it('should return 400 for missing messages', async () => {
            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({ model: 'llama3.2' });

            expect(res.status).toBe(400);
        });

        it('should return 400 for empty messages array', async () => {
            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({ model: 'llama3.2', messages: [] });

            expect(res.status).toBe(400);
        });

        it('should return 400 for invalid message role', async () => {
            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'invalid', content: 'Hello' }],
                });

            expect(res.status).toBe(400);
        });

        it('should accept all valid message roles', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant' },
                        { role: 'user', content: 'Hello' },
                        { role: 'assistant', content: 'Hi' },
                        { role: 'user', content: 'How are you?' },
                    ],
                });

            expect(res.status).toBe(200);
        });

        it('should accept optional parameters', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                    temperature: 0.7,
                    max_tokens: 1000,
                    top_p: 0.9,
                    frequency_penalty: 0.5,
                    presence_penalty: 0.5,
                    stream: false,
                });

            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/chat/completions/server', () => {
        it('should dispatch to specific server', async () => {
            const mockServer = { config: { name: 'alpha' } } as any;
            vi.mocked(ServerPoolService.getServer).mockReturnValue(mockServer);
            vi.mocked(ServerPoolService.serverSupportsModel).mockReturnValue(true);
            vi.mocked(QueueService.dispatchChatDirect).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/server')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                    serverName: 'alpha',
                });

            expect(res.status).toBe(200);
        });

        it('should return 400 when serverName is missing', async () => {
            const res = await request(app)
                .post('/api/chat/completions/server')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                });

            expect(res.status).toBe(400);
        });

        it('should return 404 when server not found', async () => {
            vi.mocked(ServerPoolService.getServer).mockReturnValue(undefined);

            const res = await request(app)
                .post('/api/chat/completions/server')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                    serverName: 'nonexistent',
                });

            expect(res.status).toBe(404);
        });
    });

    describe('POST /api/chat/completions/batch', () => {
        it('should dispatch batch chat completions', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/batch')
                .send({
                    models: ['llama3.2', 'qwen2.5'],
                    messages: [{ role: 'user', content: 'Hello' }],
                });

            expect(res.status).toBe(200);
            expect(res.body.results).toHaveLength(2);
            expect(res.body.group_id).toBeDefined();
        });

        it('should return 400 when models array is missing', async () => {
            const res = await request(app)
                .post('/api/chat/completions/batch')
                .send({
                    messages: [{ role: 'user', content: 'Hello' }],
                });

            expect(res.status).toBe(400);
        });
    });

    describe('Zod schema validation', () => {
        it('should reject missing model field', async () => {
            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    messages: [{ role: 'user', content: 'Hello' }],
                });

            expect(res.status).toBe(400);
        });

        it('should accept messages with tool role and tool_call_id', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [
                        { role: 'user', content: 'What is the weather?' },
                        {
                            role: 'assistant',
                            tool_calls: [{
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'get_weather', arguments: '{"location":"NYC"}' },
                            }],
                        },
                        { role: 'tool', content: 'Sunny, 75°F', tool_call_id: 'call_1' },
                    ],
                });

            expect(res.status).toBe(200);
        });

        it('should accept null content in messages', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [
                        { role: 'user', content: 'Hello' },
                        { role: 'assistant', content: null, tool_calls: [] },
                    ],
                });

            expect(res.status).toBe(200);
        });

        it('should accept tools array', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                    tools: [{
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            description: 'Get weather for a location',
                            parameters: { type: 'object', properties: { location: { type: 'string' } } },
                        },
                    }],
                });

            expect(res.status).toBe(200);
        });

        it('should accept stop as string', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                    stop: '\n',
                });

            expect(res.status).toBe(200);
        });

        it('should accept stop as array of strings', async () => {
            vi.mocked(ServerPoolService.getAvailableServersForModel).mockReturnValue([{} as any]);
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue(mockChatResponse);

            const res = await request(app)
                .post('/api/chat/completions/any')
                .send({
                    model: 'llama3.2',
                    messages: [{ role: 'user', content: 'Hello' }],
                    stop: ['\n', 'END'],
                });

            expect(res.status).toBe(200);
        });
    });
});

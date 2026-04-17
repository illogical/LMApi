import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';
import { evaluateRoutes } from '../../src/routes/evaluateRoutes';
import { QueueService } from '../../src/services/QueueService';
import { SocketService } from '../../src/services/SocketService';
import { EvaluationReportService } from '../../src/services/EvaluationReportService';
import { ChatCompletionService } from '../../src/services/ChatCompletionService';
import fs from 'fs/promises';

vi.mock('../../src/services/QueueService', () => ({
    QueueService: {
        dispatchOrQueueChat: vi.fn(),
    },
}));

vi.mock('../../src/services/EvaluationReportService', () => ({
    EvaluationReportService: {
        generate: vi.fn(),
    },
}));

vi.mock('../../src/services/ChatCompletionService', () => ({
    ChatCompletionService: {
        extractUsage: vi.fn().mockReturnValue({ inputTokens: 10, outputTokens: 20 }),
        extractResponseContent: vi.fn().mockReturnValue('Test response'),
        extractToolCalls: vi.fn().mockReturnValue(undefined),
    },
}));

vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
    },
}));

describe('evaluateRoutes', () => {
    const app = createTestApp(evaluateRoutes);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('POST /api/evaluate', () => {
        it('should evaluate models with prompt', async () => {
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue({
                id: 'test',
                object: 'chat.completion',
                created: Date.now(),
                model: 'llama3.2',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
                lmapi: { server_name: 'alpha', duration_ms: 1000 },
            });
            vi.mocked(EvaluationReportService.generate).mockResolvedValue({
                filePath: '/reports/eval-test.md',
                fileName: 'eval-test.md',
            });

            const res = await request(app)
                .post('/api/evaluate')
                .send({ prompt: 'Say hello', models: ['llama3.2'] });

            expect(res.status).toBe(200);
            expect(res.body.group_id).toBeDefined();
            expect(res.body.results).toHaveLength(1);
            expect(res.body.duration_ms).toBeGreaterThanOrEqual(0);
            expect(res.body.report_path).toBeDefined();
        });

        it('should evaluate multiple models', async () => {
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue({
                id: 'test',
                object: 'chat.completion',
                created: Date.now(),
                model: 'llama3.2',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
                lmapi: { server_name: 'alpha', duration_ms: 1000 },
            });
            vi.mocked(EvaluationReportService.generate).mockResolvedValue({
                filePath: '/reports/eval-test.md',
                fileName: 'eval-test.md',
            });

            const res = await request(app)
                .post('/api/evaluate')
                .send({ prompt: 'Say hello', models: ['llama3.2', 'qwen2.5'] });

            expect(res.status).toBe(200);
            expect(res.body.results).toHaveLength(2);
        });

        it('should return 400 when no prompt or filePath provided', async () => {
            const res = await request(app)
                .post('/api/evaluate')
                .send({ models: ['llama3.2'] });

            expect(res.status).toBe(400);
        });

        it('should return 400 for empty models array', async () => {
            const res = await request(app)
                .post('/api/evaluate')
                .send({ prompt: 'Test', models: [] });

            expect(res.status).toBe(400);
        });

        it('should return 400 for disallowed file extension', async () => {
            const res = await request(app)
                .post('/api/evaluate')
                .send({ filePath: '/tmp/test.exe', models: ['llama3.2'] });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('extension not allowed');
        });

        it('should return 400 for relative file path', async () => {
            const res = await request(app)
                .post('/api/evaluate')
                .send({ filePath: 'relative/path.md', models: ['llama3.2'] });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('absolute');
        });

        it('should handle file read from filePath', async () => {
            vi.mocked(fs.readFile).mockResolvedValue('Prompt from file');
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue({
                id: 'test',
                object: 'chat.completion',
                created: Date.now(),
                model: 'llama3.2',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Response' }, finish_reason: 'stop' }],
                lmapi: { server_name: 'alpha', duration_ms: 500 },
            });
            vi.mocked(EvaluationReportService.generate).mockResolvedValue({
                filePath: '/reports/eval.md',
                fileName: 'eval.md',
            });

            const res = await request(app)
                .post('/api/evaluate')
                .send({ filePath: '/tmp/test.md', models: ['llama3.2'] });

            expect(res.status).toBe(200);
            expect(fs.readFile).toHaveBeenCalledWith('/tmp/test.md', 'utf-8');
        });

        it('should skip report generation when generateReport is false', async () => {
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue({
                id: 'test',
                object: 'chat.completion',
                created: Date.now(),
                model: 'llama3.2',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
                lmapi: { server_name: 'alpha', duration_ms: 1000 },
            });

            const res = await request(app)
                .post('/api/evaluate')
                .send({ prompt: 'Test', models: ['llama3.2'], generateReport: false });

            expect(res.status).toBe(200);
            expect(EvaluationReportService.generate).not.toHaveBeenCalled();
            expect(res.body.report_path).toBeUndefined();
        });

        it('should emit socket events during evaluation', async () => {
            vi.mocked(QueueService.dispatchOrQueueChat).mockResolvedValue({
                id: 'test',
                object: 'chat.completion',
                created: Date.now(),
                model: 'llama3.2',
                choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
                lmapi: { server_name: 'alpha', duration_ms: 1000 },
            });
            vi.mocked(EvaluationReportService.generate).mockResolvedValue({
                filePath: '/reports/eval.md',
                fileName: 'eval.md',
            });

            await request(app)
                .post('/api/evaluate')
                .send({ prompt: 'Test', models: ['llama3.2'] });

            expect(SocketService.emitEvalLaneStarted).toHaveBeenCalled();
            expect(SocketService.emitEvalLaneCompleted).toHaveBeenCalled();
            expect(SocketService.emitEvalAllCompleted).toHaveBeenCalled();
        });

        it('should handle dispatch failures gracefully', async () => {
            vi.mocked(QueueService.dispatchOrQueueChat).mockRejectedValue(new Error('No server available'));
            vi.mocked(EvaluationReportService.generate).mockResolvedValue({
                filePath: '/reports/eval.md',
                fileName: 'eval.md',
            });

            const res = await request(app)
                .post('/api/evaluate')
                .send({ prompt: 'Test', models: ['llama3.2'] });

            expect(res.status).toBe(200);
            expect(res.body.results[0].error).toBe('No server available');
            expect(res.body.results[0].finish_reason).toBe('error');
        });
    });

    describe('GET /api/evaluate/file', () => {
        it('should return file content', async () => {
            vi.mocked(fs.readFile).mockResolvedValue('File content here');

            const res = await request(app)
                .get('/api/evaluate/file?path=/tmp/test.md');

            expect(res.status).toBe(200);
            expect(res.body.content).toBe('File content here');
        });

        it('should return 400 when path not provided', async () => {
            const res = await request(app)
                .get('/api/evaluate/file');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('required');
        });

        it('should return 400 for relative path', async () => {
            const res = await request(app)
                .get('/api/evaluate/file?path=relative/file.md');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('absolute');
        });

        it('should return 400 for disallowed extension', async () => {
            const res = await request(app)
                .get('/api/evaluate/file?path=/tmp/test.js');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('extension not allowed');
        });

        it('should return 404 for nonexistent file', async () => {
            vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

            const res = await request(app)
                .get('/api/evaluate/file?path=/tmp/nonexistent.md');

            expect(res.status).toBe(404);
        });
    });
});

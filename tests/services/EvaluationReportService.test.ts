import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationReportService } from '../../src/services/EvaluationReportService';
import type { EvaluationResult } from '../../src/types';
import fs from 'fs/promises';

vi.mock('fs/promises', () => ({
    default: {
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('EvaluationReportService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('generate', () => {
        const baseResults: EvaluationResult[] = [
            {
                model: 'llama3.2',
                server_name: 'alpha',
                duration_ms: 2000,
                input_tokens: 10,
                output_tokens: 50,
                tokens_per_second: 25.0,
                finish_reason: 'stop',
                response_text: 'Hello from llama!',
            },
            {
                model: 'qwen2.5',
                server_name: 'beta',
                duration_ms: 1500,
                input_tokens: 10,
                output_tokens: 40,
                tokens_per_second: 26.7,
                finish_reason: 'stop',
                response_text: 'Hello from qwen!',
            },
        ];

        it('should generate a report and return file info', async () => {
            const result = await EvaluationReportService.generate('Test prompt', baseResults, 'group-123');

            expect(result.fileName).toMatch(/^eval-\d{8}-\d{6}\.md$/);
            expect(result.filePath).toContain('reports');
            expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('reports'), { recursive: true });
            expect(fs.writeFile).toHaveBeenCalledOnce();
        });

        it('should include prompt in the report', async () => {
            await EvaluationReportService.generate('My test prompt', baseResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('My test prompt');
        });

        it('should include group ID in the report', async () => {
            await EvaluationReportService.generate('Prompt', baseResults, 'group-abc');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('group-abc');
        });

        it('should sort results by duration ascending', async () => {
            await EvaluationReportService.generate('Prompt', baseResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;

            // qwen2.5 (1500ms) should appear before llama3.2 (2000ms)
            const qwenPos = content.indexOf('qwen2.5');
            const llamaPos = content.indexOf('llama3.2');
            expect(qwenPos).toBeLessThan(llamaPos);
        });

        it('should include summary table headers', async () => {
            await EvaluationReportService.generate('Prompt', baseResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('| Model | Server | Duration (ms) | Tok/s | Output Tokens | Finish Reason |');
        });

        it('should handle results with errors', async () => {
            const errorResults: EvaluationResult[] = [
                {
                    model: 'bad-model',
                    server_name: 'alpha',
                    duration_ms: 500,
                    finish_reason: 'error',
                    response_text: '',
                    error: 'Model not found',
                },
            ];

            await EvaluationReportService.generate('Prompt', errorResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('**Error:** Model not found');
        });

        it('should include thinking section when present', async () => {
            const thinkingResults: EvaluationResult[] = [
                {
                    model: 'thinking-model',
                    server_name: 'alpha',
                    duration_ms: 3000,
                    finish_reason: 'stop',
                    response_text: 'Final answer',
                    thinking: 'Step 1: Analyze. Step 2: Respond.',
                },
            ];

            await EvaluationReportService.generate('Prompt', thinkingResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('Thinking');
            expect(content).toContain('Step 1: Analyze');
        });

        it('should include tool calls when present', async () => {
            const toolResults: EvaluationResult[] = [
                {
                    model: 'tool-model',
                    server_name: 'alpha',
                    duration_ms: 2000,
                    finish_reason: 'tool_calls',
                    response_text: 'Using tools',
                    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"test"}' } }],
                },
            ];

            await EvaluationReportService.generate('Prompt', toolResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('Tool Calls');
            expect(content).toContain('search');
        });

        it('should include metrics line when tokens present', async () => {
            await EvaluationReportService.generate('Prompt', baseResults, 'group-1');

            const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
            const content = writeCall[1] as string;
            expect(content).toContain('Input tokens:');
            expect(content).toContain('Output tokens:');
        });
    });
});

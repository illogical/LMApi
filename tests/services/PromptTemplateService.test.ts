import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromptTemplateService } from '../../src/services/PromptTemplateService';
import path from 'path';
import fs from 'fs/promises';

// Mock fs/promises for template loading
vi.mock('fs/promises', () => ({
    default: {
        readFile: vi.fn(),
    },
}));

describe('PromptTemplateService', () => {
    let service: PromptTemplateService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PromptTemplateService('/test/prompts');
    });

    describe('constructor', () => {
        it('should use provided basePath', () => {
            const svc = new PromptTemplateService('/custom/path');
            expect(svc).toBeDefined();
        });

        it('should use default basePath when not provided', () => {
            const svc = new PromptTemplateService();
            expect(svc).toBeDefined();
        });
    });

    describe('estimateTokens', () => {
        it('should estimate tokens at ~4 chars per token', () => {
            expect(service.estimateTokens('abcd')).toBe(1);
            expect(service.estimateTokens('abcdefgh')).toBe(2);
            expect(service.estimateTokens('a')).toBe(1);
        });

        it('should return 0 for empty string', () => {
            expect(service.estimateTokens('')).toBe(0);
        });

        it('should return at least 1 for non-empty strings', () => {
            expect(service.estimateTokens('ab')).toBeGreaterThanOrEqual(1);
        });

        it('should handle long text', () => {
            const longText = 'a'.repeat(1000);
            expect(service.estimateTokens(longText)).toBe(250);
        });
    });

    describe('buildSummarizeTranscriptionPrompt', () => {
        it('should load template and replace transcript placeholder', async () => {
            vi.mocked(fs.readFile).mockResolvedValue('Summarize: {{transcript}}');

            const result = await service.buildSummarizeTranscriptionPrompt('My transcript');

            expect(result.responseText).toBe('Summarize: My transcript');
            expect(result.estimatedTokenCount).toBeGreaterThan(0);
            expect(fs.readFile).toHaveBeenCalledWith(
                path.resolve('/test/prompts', 'summarize/transcription.md'),
                'utf-8'
            );
        });
    });

    describe('buildTranscriptionTitleFromSummary', () => {
        it('should load template and replace summary placeholder', async () => {
            vi.mocked(fs.readFile).mockResolvedValue('Title from: {{summary}}');

            const result = await service.buildTranscriptionTitleFromSummary('My summary');

            expect(result.responseText).toBe('Title from: My summary');
            expect(result.estimatedTokenCount).toBeGreaterThan(0);
            expect(fs.readFile).toHaveBeenCalledWith(
                path.resolve('/test/prompts', 'generate/transcription-title.md'),
                'utf-8'
            );
        });
    });
});

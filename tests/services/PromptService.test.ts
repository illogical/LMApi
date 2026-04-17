import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromptService } from '../../src/services/PromptService';
import fs from 'fs';

vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    },
}));

describe('PromptService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getRandomPrompt', () => {
        it('should return fallback when no examples loaded', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            // getRandomPrompt calls loadExamples internally when examples is empty.
            // If examples were set by a prior test, loadExamples returns [] but
            // doesn't clear the static field. We need to ensure it starts clean.
            // Force loadExamples to run and clear state:
            PromptService.loadExamples(); // This won't set examples since file doesn't exist

            const prompt = PromptService.getRandomPrompt();
            expect(prompt).toBe('Hello, how are you?');
        });

        it('should return a prompt from loaded examples', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify(['Test Prompt A', 'Test Prompt B'])
            );

            PromptService.loadExamples();
            const prompt = PromptService.getRandomPrompt();
            expect(['Test Prompt A', 'Test Prompt B']).toContain(prompt);
        });
    });

    describe('loadExamples', () => {
        it('should load examples from file', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(
                JSON.stringify(['Prompt 1', 'Prompt 2', 'Prompt 3'])
            );

            const examples = PromptService.loadExamples();
            expect(examples).toHaveLength(3);
            expect(examples).toContain('Prompt 1');
        });

        it('should return empty array if file not found', () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            const examples = PromptService.loadExamples();
            expect(examples).toEqual([]);
        });

        it('should return empty array on parse error', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

            const examples = PromptService.loadExamples();
            expect(examples).toEqual([]);
        });
    });
});

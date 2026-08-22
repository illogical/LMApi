import fs from 'fs';
import { LogService } from './LogService';
import { AppPaths } from '../config/AppPaths';

export class PromptService {
    private static examples: string[] = [];

    static loadExamples(): string[] {
        try {
            const examplesPath = AppPaths.getPromptExamplesPath();
            if (!fs.existsSync(examplesPath)) {
                LogService.warn(`Prompt examples file not found at ${examplesPath}`);
                return [];
            }

            const rawData = fs.readFileSync(examplesPath, 'utf-8');
            this.examples = JSON.parse(rawData);
            return this.examples;
        } catch (error) {
            LogService.error('Failed to load prompt examples', { error });
            return [];
        }
    }

    static getRandomPrompt(): string {
        if (this.examples.length === 0) {
            this.loadExamples();
        }
        if (this.examples.length === 0) {
            return "Hello, how are you?";
        }
        const index = Math.floor(Math.random() * this.examples.length);
        return this.examples[index];
    }
}

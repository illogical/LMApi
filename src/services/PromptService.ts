import fs from 'fs';
import path from 'path';
import { LogService } from './LogService';

export class PromptService {
    private static examplesPath = path.join(process.cwd(), 'src', 'config', 'promptExamples.json');
    private static examples: string[] = [];

    static loadExamples(): string[] {
        try {
            if (!fs.existsSync(this.examplesPath)) {
                LogService.warn(`Prompt examples file not found at ${this.examplesPath}`);
                return [];
            }

            const rawData = fs.readFileSync(this.examplesPath, 'utf-8');
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

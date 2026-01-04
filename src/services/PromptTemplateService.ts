import fs from 'fs/promises';
import path from 'path';
import { LogService } from './LogService';

export interface PromptTemplateResponse {
  responseText: string;
  estimatedTokenCount: number;
}

export class PromptTemplateService {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || path.resolve(process.cwd(), 'src', 'prompts');
  }

  private async loadTemplate(filename: string): Promise<string> {
    const filePath = path.resolve(this.basePath, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  }

  private replacePlaceholders(template: string, values: Record<string, string>): string {
    let result = template;
    for (const [key, val] of Object.entries(values)) {
      const placeholder = `{{${key}}}`;
      result = result.split(placeholder).join(val);
    }
    return result;
  }

  // Simple token estimation helper. Uses an average of ~4 characters per token.
  public estimateTokens(text: string): number {
    if (!text) return 0;
    const approx = Math.ceil(text.length / 4);
    return Math.max(1, approx);
  }

  public async buildSummarizeTranscriptionPrompt(transcript: string): Promise<PromptTemplateResponse> {
    const template = await this.loadTemplate('summarize/transcription.md');
    const responseText = this.replacePlaceholders(template, { transcript });
    const estimatedTokenCount = this.estimateTokens(responseText);
    LogService.debug('Estimated token count for transcription summary prompt', { estimatedTokenCount });
    return { responseText, estimatedTokenCount };
  }

  public async buildTranscriptionTitleFromSummary(summary: string): Promise<PromptTemplateResponse> {
    const template = await this.loadTemplate('generate/transcription-title.md');
    const responseText = this.replacePlaceholders(template, { summary });
    const estimatedTokenCount = this.estimateTokens(responseText);
    LogService.debug('Estimated token count for transcription title prompt', { estimatedTokenCount });
    return { responseText, estimatedTokenCount };
  }
}

export default PromptTemplateService;

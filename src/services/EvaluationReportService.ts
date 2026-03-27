import { promises as fs } from 'fs';
import * as path from 'path';
import { EvaluationResult } from '../types';

export class EvaluationReportService {
    static async generate(prompt: string, results: EvaluationResult[], groupId: string): Promise<{ filePath: string; fileName: string }> {
        const outDir = path.resolve(process.cwd(), 'reports');
        await fs.mkdir(outDir, { recursive: true });

        const timestamp = new Date();
        const ts = this.formatTimestampForFile(timestamp);
        const fileName = `eval-${ts}.md`;
        const filePath = path.join(outDir, fileName);

        const markdown = this.buildMarkdown(prompt, results, groupId, timestamp);
        await fs.writeFile(filePath, markdown, 'utf8');

        return { filePath, fileName };
    }

    private static formatTimestampForFile(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}-${hour}${minute}${second}`;
    }

    private static formatTimestampForDisplay(date: Date): string {
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    private static buildMarkdown(prompt: string, results: EvaluationResult[], groupId: string, timestamp: Date): string {
        const lines: string[] = [];

        // Header
        lines.push('# Model Evaluation Report');
        lines.push('');
        lines.push(`**Date:** ${this.formatTimestampForDisplay(timestamp)}`);
        lines.push(`**Group ID:** \`${groupId}\``);
        lines.push(`**Models Evaluated:** ${results.length}`);
        lines.push('');

        // Prompt
        lines.push('## Prompt');
        lines.push('');
        lines.push('```');
        lines.push(prompt);
        lines.push('```');
        lines.push('');

        // Results Summary Table
        lines.push('## Results Summary');
        lines.push('');
        lines.push('| Model | Server | Duration | Tokens/s | Output Tokens | Finish Reason |');
        lines.push('|---|---|---|---|---|---|');

        // Sort by duration for ranking
        const sortedResults = [...results].sort((a, b) => {
            if (a.error && !b.error) return 1;
            if (!a.error && b.error) return -1;
            return a.duration_ms - b.duration_ms;
        });

        for (const result of sortedResults) {
            if (result.error) {
                lines.push(`| ${result.model} | ${result.server_name} | ERROR | — | — | — |`);
            } else {
                const duration = result.duration_ms.toLocaleString();
                const tokPerSec = result.tokens_per_second ? Math.round(result.tokens_per_second) : '—';
                const outTokens = result.output_tokens ?? '—';
                lines.push(`| ${result.model} | ${result.server_name} | ${duration} ms | ${tokPerSec} | ${outTokens} | ${result.finish_reason} |`);
            }
        }

        lines.push('');

        // Model Responses
        lines.push('## Model Responses');
        lines.push('');

        for (const result of sortedResults) {
            const tokPerSec = result.tokens_per_second ? Math.round(result.tokens_per_second) : '—';
            const duration = result.duration_ms.toLocaleString();
            lines.push(`### ${result.model} (${result.server_name} · ${duration} ms · ${tokPerSec} tok/s)`);
            lines.push('');

            if (result.error) {
                lines.push('**Error:**');
                lines.push('```');
                lines.push(result.error);
                lines.push('```');
            } else {
                // Thinking section (if present)
                if (result.thinking) {
                    lines.push('#### Thinking');
                    lines.push('');
                    lines.push('```');
                    lines.push(result.thinking);
                    lines.push('```');
                    lines.push('');
                }

                // Tool calls section (if present)
                if (result.tool_calls && result.tool_calls.length > 0) {
                    lines.push('#### Tool Calls');
                    lines.push('');
                    lines.push('```json');
                    lines.push(JSON.stringify(result.tool_calls, null, 2));
                    lines.push('```');
                    lines.push('');
                }

                // Response text
                lines.push('#### Response');
                lines.push('');
                lines.push('```');
                lines.push(result.response_text);
                lines.push('```');
            }

            lines.push('');
            lines.push('---');
            lines.push('');
        }

        return lines.join('\n');
    }
}

import fs from 'fs/promises';
import path from 'path';
import { EvaluationResult } from '../types';
import { AppPaths } from '../config/AppPaths';

export class EvaluationReportService {
    static async generate(
        prompt: string,
        results: EvaluationResult[],
        groupId: string
    ): Promise<{ filePath: string; fileName: string }> {
        const now = new Date();
        const stamp = now.toISOString()
            .replace(/[-:]/g, '')
            .replace('T', '-')
            .substring(0, 15); // YYYYMMDDHHmmss → YYYYMMDDHHmmss

        const fileName = `eval-${stamp}.md`;
        const reportsDir = AppPaths.getReportsDir();
        await fs.mkdir(reportsDir, { recursive: true });
        const filePath = path.join(reportsDir, fileName);

        const sorted = [...results].sort((a, b) => a.duration_ms - b.duration_ms);

        const lines: string[] = [
            `# Model Evaluation Report`,
            ``,
            `**Date:** ${now.toISOString()}  `,
            `**Group ID:** \`${groupId}\`  `,
            `**Models evaluated:** ${results.length}`,
            ``,
            `## Prompt`,
            ``,
            '```',
            prompt,
            '```',
            ``,
            `## Summary`,
            ``,
            `| Model | Server | Duration (ms) | Tok/s | Output Tokens | Finish Reason |`,
            `|-------|--------|--------------|-------|---------------|---------------|`,
        ];

        for (const r of sorted) {
            const tokPerSec = r.tokens_per_second != null ? r.tokens_per_second.toFixed(1) : '—';
            const outputTok = r.output_tokens != null ? String(r.output_tokens) : '—';
            const dur = r.error ? `${r.duration_ms} ⚠` : r.duration_ms.toLocaleString();
            lines.push(`| ${r.model} | ${r.server_name} | ${dur} | ${tokPerSec} | ${outputTok} | ${r.finish_reason} |`);
        }

        lines.push('');
        lines.push('## Responses');
        lines.push('');

        for (const r of sorted) {
            const dur = r.duration_ms.toLocaleString();
            const tokPerSec = r.tokens_per_second != null ? `${r.tokens_per_second.toFixed(1)} tok/s` : '';
            lines.push(`### ${r.model} (${r.server_name} · ${dur}ms${tokPerSec ? ' · ' + tokPerSec : ''})`);
            lines.push('');

            if (r.error) {
                lines.push(`> **Error:** ${r.error}`);
                lines.push('');
                continue;
            }

            if (r.thinking) {
                lines.push('<details>');
                lines.push('<summary>Thinking</summary>');
                lines.push('');
                lines.push('```');
                lines.push(r.thinking);
                lines.push('```');
                lines.push('</details>');
                lines.push('');
            }

            lines.push('```');
            lines.push(r.response_text);
            lines.push('```');
            lines.push('');

            if (r.tool_calls && r.tool_calls.length > 0) {
                lines.push('**Tool Calls:**');
                lines.push('');
                lines.push('```json');
                lines.push(JSON.stringify(r.tool_calls, null, 2));
                lines.push('```');
                lines.push('');
            }

            const metrics: string[] = [];
            if (r.input_tokens != null) metrics.push(`Input tokens: ${r.input_tokens}`);
            if (r.output_tokens != null) metrics.push(`Output tokens: ${r.output_tokens}`);
            if (r.load_duration_ms != null) metrics.push(`Load time: ${r.load_duration_ms.toLocaleString()}ms`);
            if (r.eval_duration_ms != null) metrics.push(`Gen time: ${r.eval_duration_ms.toLocaleString()}ms`);
            if (metrics.length > 0) {
                lines.push(`_${metrics.join(' · ')}_`);
                lines.push('');
            }
        }

        await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
        return { filePath, fileName };
    }
}

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ChatCompletionRequest, EvaluationResult } from '../types';
import { QueueService } from '../services/QueueService';
import { SocketService } from '../services/SocketService';
import { EvaluationReportService } from '../services/EvaluationReportService';
import { LogService } from '../services/LogService';

const router = Router();

const EvaluationSchema = z.object({
    prompt: z.string().optional(),
    filePath: z.string().optional(),
    models: z.array(z.string()).min(1, 'At least one model is required'),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    generateReport: z.boolean().optional().default(true),
}).refine(data => data.prompt || data.filePath, {
    message: 'Either prompt or filePath must be provided',
});

const ALLOWED_EXTENSIONS = ['.md', '.txt', '.text', '.prompt'];

router.post('/evaluate', async (req, res) => {
    try {
        const body = EvaluationSchema.parse(req.body);
        const groupId = randomUUID();
        const startTime = Date.now();

        let prompt = body.prompt || '';

        // If filePath is provided, read the file
        if (body.filePath && !body.prompt) {
            const ext = path.extname(body.filePath).toLowerCase();
            if (!ALLOWED_EXTENSIONS.includes(ext)) {
                return res.status(400).json({ 
                    error: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` 
                });
            }

            try {
                prompt = await fs.readFile(body.filePath, 'utf8');
            } catch (error: any) {
                LogService.error('Failed to read file', { filePath: body.filePath, error });
                return res.status(404).json({ error: `Failed to read file: ${error.message}` });
            }
        }

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt content is empty' });
        }

        LogService.info(`Starting evaluation for group ${groupId} with ${body.models.length} models`);

        // Dispatch all models in parallel
        const promises = body.models.map((model, index) => {
            const chatRequest: ChatCompletionRequest = {
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: body.temperature,
                max_tokens: body.max_tokens,
                groupId,
            };

            // Emit lane started event
            SocketService.emitEvalLaneStarted(groupId, model, index);

            return QueueService.dispatchOrQueueChat(chatRequest)
                .then(response => {
                    const result: EvaluationResult = {
                        model,
                        server_name: response.lmapi?.server_name || 'unknown',
                        duration_ms: response.lmapi?.duration_ms || 0,
                        input_tokens: response.usage?.prompt_tokens,
                        output_tokens: response.usage?.completion_tokens,
                        tokens_per_second: undefined,
                        load_duration_ms: undefined,
                        eval_duration_ms: undefined,
                        finish_reason: response.choices[0]?.finish_reason || 'unknown',
                        response_text: response.choices[0]?.message?.content || '',
                        thinking: response.choices[0]?.message?.thinking,
                        tool_calls: response.choices[0]?.message?.tool_calls,
                    };

                    // Calculate tokens per second if we have the data
                    if (result.output_tokens && response.lmapi?.duration_ms) {
                        const durationSec = response.lmapi.duration_ms / 1000;
                        result.tokens_per_second = result.output_tokens / durationSec;
                    }

                    // Emit lane completed event
                    SocketService.emitEvalLaneCompleted(groupId, model, result);

                    return result;
                })
                .catch(error => {
                    const errorResult: EvaluationResult = {
                        model,
                        server_name: 'unknown',
                        duration_ms: 0,
                        finish_reason: 'error',
                        response_text: '',
                        error: error.message,
                    };

                    // Emit lane completed event even for errors
                    SocketService.emitEvalLaneCompleted(groupId, model, errorResult);

                    return errorResult;
                });
        });

        // Wait for all to complete
        const results = await Promise.all(promises);
        const totalDuration = Date.now() - startTime;

        // Generate report if requested
        let reportPath: string | undefined;
        if (body.generateReport) {
            try {
                const report = await EvaluationReportService.generate(prompt, results, groupId);
                reportPath = report.filePath;
                LogService.info(`Evaluation report generated: ${report.filePath}`);
            } catch (error: any) {
                LogService.error('Failed to generate evaluation report', { error });
            }
        }

        // Emit all completed event
        SocketService.emitEvalAllCompleted(groupId, results, reportPath);

        res.json({
            group_id: groupId,
            results,
            duration_ms: totalDuration,
            report_path: reportPath,
        });

    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        LogService.error('Evaluation error', { error });
        res.status(500).json({ error: error.message });
    }
});

router.get('/evaluate/file', async (req, res) => {
    try {
        const filePath = req.query.path as string;

        if (!filePath) {
            return res.status(400).json({ error: 'path query parameter is required' });
        }

        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return res.status(400).json({ 
                error: `Invalid file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` 
            });
        }

        try {
            const content = await fs.readFile(filePath, 'utf8');
            res.json({ content });
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'File not found' });
            }
            LogService.error('Failed to read file', { filePath, error });
            res.status(500).json({ error: `Failed to read file: ${error.message}` });
        }

    } catch (error: any) {
        LogService.error('File validation error', { error });
        res.status(500).json({ error: error.message });
    }
});

export const evaluateRoutes = router;

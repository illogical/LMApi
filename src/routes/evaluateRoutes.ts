import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { QueueService } from '../services/QueueService';
import { SocketService } from '../services/SocketService';
import { EvaluationReportService } from '../services/EvaluationReportService';
import { ChatCompletionService } from '../services/ChatCompletionService';
import { EvaluationResult } from '../types';

export const evaluateRoutes = Router();

const ALLOWED_EXTENSIONS = new Set(['.md', '.txt', '.text', '.prompt']);

const EvaluateSchema = z.object({
    prompt: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    models: z.array(z.string().min(1)).min(1),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().min(1).optional(),
    generateReport: z.boolean().default(true),
});

/**
 * @openapi
 * /api/evaluate:
 *   post:
 *     tags: [Evaluate]
 *     summary: Evaluate multiple models
 *     description: Sends the same prompt to multiple models in parallel and collects comparative metrics (duration, tokens, tokens/sec). Optionally generates a markdown report.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/EvaluationRequest'
 *     responses:
 *       200:
 *         description: Evaluation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group_id:
 *                   type: string
 *                   format: uuid
 *                 results:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/EvaluationResult'
 *                 duration_ms:
 *                   type: number
 *                   description: Total wall-clock duration for the evaluation
 *                 report_path:
 *                   type: string
 *                   description: Path to the generated markdown report (if generateReport was true)
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
evaluateRoutes.post('/evaluate', async (req, res) => {
    let body: z.infer<typeof EvaluateSchema>;
    try {
        body = EvaluateSchema.parse(req.body);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
        return;
    }

    if (!body.prompt && !body.filePath) {
        res.status(400).json({ error: 'At least one of prompt or filePath must be provided' });
        return;
    }

    let prompt = body.prompt ?? '';

    if (body.filePath) {
        const ext = path.extname(body.filePath).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            res.status(400).json({ error: `File extension not allowed. Use: ${[...ALLOWED_EXTENSIONS].join(', ')}` });
            return;
        }
        if (!path.isAbsolute(body.filePath)) {
            res.status(400).json({ error: 'filePath must be an absolute path' });
            return;
        }
        try {
            prompt = await fs.readFile(body.filePath, 'utf-8');
        } catch (err: any) {
            const status = err.code === 'ENOENT' ? 404 : 400;
            res.status(status).json({ error: `Could not read file: ${err.message}` });
            return;
        }
    }

    const groupId = randomUUID();
    const startTime = Date.now();

    const dispatches = body.models.map((model, laneIndex) => {
        const request = {
            model,
            messages: [{ role: 'user' as const, content: prompt }],
            temperature: body.temperature,
            max_tokens: body.max_tokens,
            groupId,
        };

        SocketService.emitEvalLaneStarted(groupId, model, laneIndex);

        const started = Date.now();
        return QueueService.dispatchOrQueueChat(request).then(
            (response): EvaluationResult => {
                const duration_ms = Date.now() - started;
                const usage = ChatCompletionService.extractUsage(response);
                const response_text = ChatCompletionService.extractResponseContent(response);
                const tool_calls = ChatCompletionService.extractToolCalls(response);
                const finish_reason = response.choices?.[0]?.finish_reason ?? 'unknown';
                const server_name = response.lmapi?.server_name ?? 'unknown';
                const actual_duration = response.lmapi?.duration_ms ?? duration_ms;
                const tokens_per_second = usage.outputTokens && actual_duration > 0
                    ? parseFloat((usage.outputTokens / (actual_duration / 1000)).toFixed(2))
                    : undefined;

                const result: EvaluationResult = {
                    model,
                    server_name,
                    duration_ms: actual_duration,
                    input_tokens: usage.inputTokens,
                    output_tokens: usage.outputTokens,
                    tokens_per_second,
                    finish_reason,
                    response_text,
                    tool_calls: tool_calls ?? undefined,
                };

                SocketService.emitEvalLaneCompleted(groupId, model, result);
                return result;
            },
            (error: Error): EvaluationResult => {
                const duration_ms = Date.now() - started;
                const result: EvaluationResult = {
                    model,
                    server_name: 'unknown',
                    duration_ms,
                    finish_reason: 'error',
                    response_text: '',
                    error: error.message,
                };
                SocketService.emitEvalLaneCompleted(groupId, model, result);
                return result;
            }
        );
    });

    const results = await Promise.all(dispatches);
    const duration_ms = Date.now() - startTime;

    let report_path: string | undefined;
    if (body.generateReport) {
        try {
            const report = await EvaluationReportService.generate(prompt, results, groupId);
            report_path = report.fileName;
        } catch (err: any) {
            // Report generation failure is non-fatal
        }
    }

    SocketService.emitEvalAllCompleted(groupId, results, report_path);

    res.json({ group_id: groupId, results, duration_ms, report_path });
});

/**
 * @openapi
 * /api/evaluate/file:
 *   get:
 *     tags: [Evaluate]
 *     summary: Read a file for evaluation
 *     description: Reads and returns the content of a file to be used as an evaluation prompt. Only allows files with specific extensions (.md, .txt, .text, .prompt).
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Absolute file path to read
 *     responses:
 *       200:
 *         description: File content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: string
 *       400:
 *         description: Invalid path or disallowed extension
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: File not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
evaluateRoutes.get('/evaluate/file', async (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';

    if (!filePath) {
        res.status(400).json({ error: 'path query parameter is required' });
        return;
    }

    if (!path.isAbsolute(filePath)) {
        res.status(400).json({ error: 'path must be absolute' });
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        res.status(400).json({ error: `File extension not allowed. Use: ${[...ALLOWED_EXTENSIONS].join(', ')}` });
        return;
    }

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
    } catch (err: any) {
        const status = err.code === 'ENOENT' ? 404 : 400;
        res.status(status).json({ error: err.message });
    }
});

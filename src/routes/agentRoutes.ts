import { Router } from 'express';
import { QueueService } from '../services/QueueService';
import { ServerPoolService } from '../services/ServerPoolService';
import PromptTemplateService from '../services/PromptTemplateService';

const router = Router();

// Exported router so it can be mounted under /api
export const agentRoutes = router;

// Build a prompt from a transcription and dispatch it like other prompt endpoints.
/**
 * @openapi
 * /api/agents/summarize/transcript:
 *   post:
 *     tags: [Agents]
 *     summary: Summarize a transcript
 *     description: Accepts a transcription text and generates a structured summary using the specified model. Uses a built-in summarization prompt template.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transcript, model]
 *             properties:
 *               transcript:
 *                 type: string
 *                 description: The transcription text to summarize
 *               model:
 *                 type: string
 *                 description: Model to use for summarization
 *     responses:
 *       200:
 *         description: Summarization result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromptResponse'
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: No servers available for the model
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/agents/summarize/transcript', async (req, res) => {
	try {
		const transcript = (req.body && req.body.transcript) || req.query?.transcript;
		const model = (req.body && req.body.model) || req.query?.model;

		if (!transcript) {
			return res.status(400).json({ error: 'transcript is required in body or query' });
		}

		if (!model) {
			return res.status(400).json({ error: 'model is required in body or query' });
		}

		const available = ServerPoolService.getAvailableServersForModel(model);
		if (!available.length) {
			return res.status(503).json({ error: `No available servers host model "${model}"` });
		}

		const templateSvc = new PromptTemplateService();
		const { responseText: promptText } = await templateSvc.buildSummarizeTranscriptionPrompt(transcript);

		const request = {
			prompt: promptText,
			model,
			serverName: 'any'
		};

		const result = await QueueService.dispatchOrQueue(request as any);

		// Return the standard PromptResponse object
		res.json(result);
	} catch (error: any) {
		res.status(500).json({ error: error.message });
	}
});

/**
 * @openapi
 * /api/agents/summarize/transcript/title:
 *   post:
 *     tags: [Agents]
 *     summary: Generate a title from a summary
 *     description: Given a summary text, generates a concise title using the specified model. Uses a built-in title generation prompt template.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [summary, model]
 *             properties:
 *               summary:
 *                 type: string
 *                 description: The summary text to generate a title for
 *               model:
 *                 type: string
 *                 description: Model to use for title generation
 *     responses:
 *       200:
 *         description: Title generation result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PromptResponse'
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: No servers available for the model
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/agents/summarize/transcript/title', async (req, res) => {
    try {
        const summary = (req.body && req.body.summary) || req.query?.summary;
        const model = (req.body && req.body.model) || req.query?.model;

        if (!summary) {
            return res.status(400).json({ error: 'summary is required in body or query' });
        }

        if (!model) {
            return res.status(400).json({ error: 'model is required in body or query' });
        }

        const available = ServerPoolService.getAvailableServersForModel(model);
        if (!available.length) {
            return res.status(503).json({ error: `No available servers host model "${model}"` });
        }

        const templateSvc = new PromptTemplateService();
        const { responseText: promptText } = await templateSvc.buildTranscriptionTitleFromSummary(summary);

        const request = {
            prompt: promptText,
            model,
            serverName: 'any'
        };

        const result = await QueueService.dispatchOrQueue(request as any);

        // Return the standard PromptResponse object
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
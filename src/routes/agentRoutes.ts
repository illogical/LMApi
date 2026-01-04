import { Router } from 'express';
import { QueueService } from '../services/QueueService';
import { ServerPoolService } from '../services/ServerPoolService';
import PromptTemplateService from '../services/PromptTemplateService';

const router = Router();

// Build a prompt from a transcription and dispatch it like other prompt endpoints.
router.post('/agents/transcribe', async (req, res) => {
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
		const { responseText: promptText, estimatedTokenCount } = await templateSvc.buildSummarizeTranscriptionPrompt(transcript);

		const request = {
			prompt: promptText,
			model,
			serverName: 'any',
			params: { estimatedInputTokens: estimatedTokenCount }
		};

		const result = await QueueService.dispatchOrQueue(request as any);

		// Return the standard PromptResponse object
		res.json(result);
	} catch (error: any) {
		res.status(500).json({ error: error.message });
	}
});
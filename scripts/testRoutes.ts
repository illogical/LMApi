import { randomUUID } from 'crypto';

/**
 * Hit every public API endpoint to verify the server is healthy and report useful feedback.
 *
 * Notes on responses and improvements (kept close to the tests for easy discovery):
 * - /servers: Today returns an array of ServerStatus (config, isOnline, models, activeRequests, lastChecked).
 *   Consider adding: latency to each server, lastSuccess, lastError, and a lightweight health summary.
 * - /servers/:name/status: Mirrors ServerStatus. Consider exposing current queue depth per server.
 * - /servers/:name/models: Returns { models: string[] }. Consider adding model metadata (size, family, quantization).
 * - /models/:model/servers: Returns { servers: string[] }. Consider adding per-server priority and cost/latency hints.
 * - /generate/*: Returns the queue result. Consider surfacing requestId, position in queue, and estimated start/finish time.
 * - /embed: Uses prompt text as the embedding input. Consider renaming request field to `text` for clarity and adding vector size.
 * - Missing endpoints worth adding: queue depth snapshot (/queue/status), cache info (/cache/models), and a readiness probe (/healthz).
 */

// Environment overrides let you point the tests at any instance without editing code.
const PORT = process.env.PORT || '3111';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SERVER_NAME = process.env.TEST_SERVER_NAME || 'Localhost';
const MODEL_PRIMARY = process.env.TEST_MODEL_PRIMARY || 'granite3.3';
const MODEL_SECONDARY = process.env.TEST_MODEL_SECONDARY || 'ministral-3';
const EMBED_MODEL = process.env.TEST_EMBED_MODEL || 'nomic-embed-text:v1.5';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 60 * 1000); // 60 seconds default
const MAX_PARALLEL_PER_SERVER = Number(process.env.MAX_PARALLEL_PER_SERVER || 1); // for testing parallel limits

interface TestResult {
	name: string;
	method: string;
	path: string;
	ok: boolean;
	status?: number;
	note?: string;
	error?: string;
	elapsedMs?: number;
	requestBody?: any;
	responseData?: any;
	serverName?: string;
	groupId?: string;
	requestTimestamp?: string;
}

async function request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status?: number; data?: any; error?: string; elapsedMs: number; timestamp: string; }> {
	const url = `${BASE_URL}${path}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const timestamp = new Date().toISOString();

	// Log request details
	console.log(`\n🔵 ${method} ${path}`);
	if (body) {
		console.log('   Request body:', JSON.stringify(body, null, 2));
	}

	const startTime = Date.now();
	try {
		const res = await fetch(url, {
			method,
			headers: body ? { 'Content-Type': 'application/json' } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});

		const elapsed = Date.now() - startTime;
		const text = await res.text();
		let data: any;
		try {
			data = text ? JSON.parse(text) : undefined;
		} catch {
			data = text;
		}

		// Log response details
		console.log(`   Response (${elapsed}ms):`, res.status, res.statusText);
		if (data) {
			const preview = typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data, null, 2).substring(0, 500);
			console.log('   Response data:', preview + (preview.length >= 200 || preview.length >= 500 ? '...' : ''));
		}

		return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text, elapsedMs: elapsed, timestamp };
	} catch (err: any) {
		const elapsed = Date.now() - startTime;
		const reason = err?.name === 'AbortError' ? `Request timed out after ${elapsed}ms` : err?.message || 'Unknown error';
		console.log(`   Error (${elapsed}ms):`, reason);
		return { ok: false, error: reason, status: undefined, data: undefined, elapsedMs: elapsed, timestamp };
	} finally {
		clearTimeout(timer);
	}
}

function logResult(result: TestResult) {
	const statusPart = result.status ? ` (status ${result.status})` : '';
	const notePart = result.note ? ` — ${result.note}` : '';
	if (result.ok) {
		console.log(`\n✅ ${result.method} ${result.path}${statusPart}${notePart}`);
	} else {
		console.error(`\n❌ ${result.method} ${result.path}${statusPart} — ${result.error || 'Request failed'}`);
	}
}

function ensureArray(value: any): boolean {
	return Array.isArray(value);
}

function hasKeys(obj: any, keys: string[]): boolean {
	return !!obj && typeof obj === 'object' && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
}

async function main() {
		console.log(`\n==== API Test Runner ====`);
		console.log(`Base URL for all requests: ${BASE_URL}`);
		console.log(`MAX_PARALLEL_PER_SERVER: ${MAX_PARALLEL_PER_SERVER}`);
		const results: TestResult[] = [];
		const scriptStartTime = Date.now();

	// /api/servers — expected: array of ServerStatus entries with config + state.
	{
		const resp = await request('GET', '/api/servers');
		const ok = resp.ok && ensureArray(resp.data);
		results.push({
			name: 'List servers',
			method: 'GET',
			path: '/api/servers',
			ok,
			status: resp.status,
			note: ok ? 'Received server list' : undefined,
			error: resp.error || (!ok ? 'Expected an array of servers' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/servers/available — expected: { servers: ServerStatus[] } filtered to online.
	{
		const resp = await request('GET', '/api/servers/available');
		const ok = resp.ok && resp.data && ensureArray(resp.data.servers);
		results.push({
			name: 'Available servers',
			method: 'GET',
			path: '/api/servers/available',
			ok,
			status: resp.status,
			note: ok ? `Online servers: ${resp.data.servers.length}` : undefined,
			error: resp.error || (!ok ? 'Expected { servers: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/servers/:name/status — expected: a single ServerStatus.
	{
		const resp = await request('GET', `/api/servers/${SERVER_NAME}/status`);
		const ok = resp.ok && hasKeys(resp.data, ['config', 'isOnline', 'models']);
		results.push({
			name: 'Server status',
			method: 'GET',
			path: `/api/servers/${SERVER_NAME}/status`,
			ok,
			status: resp.status,
			note: ok ? `Online: ${resp.data.isOnline}, models: ${resp.data.models?.length || 0}` : undefined,
			error: resp.error || (!ok ? 'Expected ServerStatus payload' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/servers/:name/models — expected: { models: string[] }.
	{
		const resp = await request('GET', `/api/servers/${SERVER_NAME}/models`);
		const ok = resp.ok && resp.data && ensureArray(resp.data.models);
		results.push({
			name: 'Server models',
			method: 'GET',
			path: `/api/servers/${SERVER_NAME}/models`,
			ok,
			status: resp.status,
			note: ok ? `Models discovered: ${resp.data.models.length}` : undefined,
			error: resp.error || (!ok ? 'Expected { models: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/models/:model/servers — expected: { servers: string[] }.
	{
		const resp = await request('GET', `/api/models/${MODEL_PRIMARY}/servers`);
		const ok = resp.ok && resp.data && ensureArray(resp.data.servers);
		results.push({
			name: 'Servers for model',
			method: 'GET',
			path: `/api/models/${MODEL_PRIMARY}/servers`,
			ok,
			status: resp.status,
			note: ok ? `Servers offering ${MODEL_PRIMARY}: ${resp.data.servers.join(', ') || 'none'}` : undefined,
			error: resp.error || (!ok ? 'Expected { servers: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/generate/any — expected: queue/enqueue result; we do not assert shape beyond object existence.
	{
		const body = {
			prompt: 'Why is the sky blue?',
			model: MODEL_PRIMARY,
			params: { temperature: 0.7 },
		};
		const resp = await request('POST', '/api/generate/any', body);
		const ok = resp.ok && resp.data && typeof resp.data === 'object';
		results.push({
			name: 'Generate (any server)',
			method: 'POST',
			path: '/api/generate/any',
			ok,
			status: resp.status,
			note: ok ? 'Request accepted' : undefined,
			error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
			serverName: resp.data?.serverName,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/generate/any with MODEL_SECONDARY — expected: same as above but with different model
	// to verify it will try to send requests to different servers when available.
	{
		const body = {
			prompt: 'Why is the sky blue?',
			model: MODEL_SECONDARY,
			params: { temperature: 0.7 },
		};
		const resp = await request('POST', '/api/generate/any', body);
		const ok = resp.ok && resp.data && typeof resp.data === 'object';
		results.push({
			name: 'Generate (any server - secondary model)',
			method: 'POST',
			path: '/api/generate/any',
			ok,
			status: resp.status,
			note: ok ? `Request accepted with ${MODEL_SECONDARY}` : undefined,
			error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
			serverName: resp.data?.serverName,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/generate/any parallel requests — verify MAX_PARALLEL_PER_SERVER distribution
	// Send 2 different prompts to the same model. If multiple servers are available and
	// MAX_PARALLEL_PER_SERVER=1, requests should be distributed between servers.
	{
		const groupId = `parallel-test-${randomUUID()}`;
		const prompts = [
			'Summarize the history of artificial intelligence.',
			'What are the main challenges in machine learning?'
		];
		
		const requests = prompts.map(prompt => {
			const body = {
				prompt,
				model: MODEL_PRIMARY,
				groupId,
				params: { temperature: 0.5 },
			};
			return request('POST', '/api/generate/any', body);
		});

		const responses = await Promise.all(requests);
		
		responses.forEach((resp, index) => {
			const ok = resp.ok && resp.data && typeof resp.data === 'object';
			results.push({
				name: `Generate (any server - parallel distribution) - Request ${index + 1}`,
				method: 'POST',
				path: '/api/generate/any',
				ok,
				status: resp.status,
				note: ok ? `With MAX_PARALLEL_PER_SERVER=${MAX_PARALLEL_PER_SERVER}, prompt: "${prompts[index]}"` : undefined,
				error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
				elapsedMs: resp.elapsedMs,
				requestBody: { prompt: prompts[index], model: MODEL_PRIMARY, groupId, params: { temperature: 0.5 } },
				responseData: resp.data,
				serverName: resp.data?.serverName,
				groupId,
				requestTimestamp: resp.timestamp,
			});
		});
	}

	// /api/generate/server — expected: same shape but respects requested server.
	// We send 3 parallel requests to verify concurrent handling and active request count.
	{
		const groupId = `server-parallel-${randomUUID()}`;
		const prompts = [
			'Write a haiku about code.',
			'Explain quantum entanglement in one sentence.',
			'What is the capital of France?'
		];
		
		const requests = prompts.map(prompt => {
			const body = {
				prompt,
				model: MODEL_PRIMARY,
				serverName: SERVER_NAME,
				groupId,
			};
			return request('POST', '/api/generate/server', body);
		});

		const responses = await Promise.all(requests);
		
		responses.forEach((resp, index) => {
			const ok = resp.ok && resp.data && typeof resp.data === 'object';
			results.push({
				name: `Generate (specific server) - Request ${index + 1}`,
				method: 'POST',
				path: '/api/generate/server',
				ok,
				status: resp.status,
				note: ok ? `Targeted server ${SERVER_NAME} with prompt: "${prompts[index]}"` : undefined,
				error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
				elapsedMs: resp.elapsedMs,
				requestBody: { prompt: prompts[index], model: MODEL_PRIMARY, serverName: SERVER_NAME, groupId },
				responseData: resp.data,
				serverName: resp.data?.serverName,
				groupId,
				requestTimestamp: resp.timestamp,
			});
		});
	}

	// /api/generate/batch — expected: { results: [...] } where each entry is queue response per model.
	{
		const body = {
			prompt: 'Summarize the theory of relativity and its implications.',
			models: [MODEL_PRIMARY, MODEL_SECONDARY],
		};
		const resp = await request('POST', '/api/generate/batch', body);
		const ok = resp.ok && resp.data && ensureArray(resp.data.results);
		results.push({
			name: 'Generate batch',
			method: 'POST',
			path: '/api/generate/batch',
			ok,
			status: resp.status,
			note: ok ? `Batch results count: ${resp.data.results.length}` : undefined,
			error: resp.error || (!ok ? 'Expected { results: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/generate/all — expected: { results: [...] } where each entry is response from a server.
	{
		const body = {
			prompt: 'Explain why a "perfectly efficient" market would actually be impossible to trade in, and what that implies for the role of information.',
			model: MODEL_PRIMARY,
		};
		const resp = await request('POST', '/api/generate/all', body);
		const ok = resp.ok && resp.data && ensureArray(resp.data.results);
		results.push({
			name: 'Generate all servers',
			method: 'POST',
			path: '/api/generate/all',
			ok,
			status: resp.status,
			note: ok ? `Responses from ${resp.data.results.length} servers` : undefined,
			error: resp.error || (!ok ? 'Expected { results: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// /api/embed — expected: embedding request accepted; params.embedding=true is set server-side.
	{
		const body = {
			prompt: 'This is a sentence to embed.',
			model: EMBED_MODEL,
		};
		const resp = await request('POST', '/api/embed', body);
		const ok = resp.ok && resp.data && typeof resp.data === 'object';
		results.push({
			name: 'Embeddings',
			method: 'POST',
			path: '/api/embed',
			ok,
			status: resp.status,
			note: ok ? 'Embedding request accepted' : undefined,
			error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
			requestTimestamp: resp.timestamp,
		});
	}

	// Emit per-endpoint results.
	results.forEach(logResult);

	// Summary
	const failed = results.filter(r => !r.ok);
	if (failed.length === 0) {
		console.log('\nAll endpoints responded successfully.');
	} else {
		console.error(`\n${failed.length} endpoint(s) failed:`);
		failed.forEach(r => console.error(`- ${r.method} ${r.path}: ${r.error || 'Unknown failure'}`));
		process.exitCode = 1;
	}

	// Generate HTML report
	try {
		const { ReportService } = await import('../src/services/ReportService');
		const timestamp = new Date().toISOString();
		const totalDurationMs = Date.now() - scriptStartTime;
		const { filePath, fileUrl } = await ReportService.generate(results, {
			baseUrl: BASE_URL,
			serverName: SERVER_NAME,
			modelPrimary: MODEL_PRIMARY,
			modelSecondary: MODEL_SECONDARY,
			embedModel: EMBED_MODEL,
			timeoutMs: TIMEOUT_MS,
			maxParallelPerServer: MAX_PARALLEL_PER_SERVER,
			timestamp,
			totalDurationMs,
		});
		console.log(`\n📄 HTML report written: ${filePath}`);
		console.log(`🔗 Open in browser: ${fileUrl}`);
	} catch (e) {
		console.error('Failed to write HTML report:', e);
	}
}

main().catch(err => {
	console.error('Unexpected error while running route tests:', err);
	process.exitCode = 1;
});

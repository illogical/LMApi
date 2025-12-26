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
const PORT = process.env.PORT || '3000';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SERVER_NAME = process.env.TEST_SERVER_NAME || 'localhost';
const MODEL_PRIMARY = process.env.TEST_MODEL_PRIMARY || 'qwen3';
const MODEL_SECONDARY = process.env.TEST_MODEL_SECONDARY || 'phi4';
const EMBED_MODEL = process.env.TEST_EMBED_MODEL || 'nomic-embed-text';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 30 * 1000); // 30 seconds default

interface TestResult {
	name: string;
	method: string;
	path: string;
	ok: boolean;
	status?: number;
	note?: string;
	error?: string;
	elapsedMs?: number;
	requestBody?: unknown;
	responseData?: any;
}

async function request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status?: number; data?: any; error?: string; elapsedMs: number; }> {
	const url = `${BASE_URL}${path}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

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

		return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text, elapsedMs: elapsed };
	} catch (err: any) {
		const elapsed = Date.now() - startTime;
		const reason = err?.name === 'AbortError' ? `Request timed out after ${elapsed}ms` : err?.message || 'Unknown error';
		console.log(`   Error (${elapsed}ms):`, reason);
		return { ok: false, error: reason, status: undefined, data: undefined, elapsedMs: elapsed };
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
	const results: TestResult[] = [];

	// /servers — expected: array of ServerStatus entries with config + state.
	{
		const resp = await request('GET', '/servers');
		const ok = resp.ok && ensureArray(resp.data);
		results.push({
			name: 'List servers',
			method: 'GET',
			path: '/servers',
			ok,
			status: resp.status,
			note: ok ? 'Received server list' : undefined,
			error: resp.error || (!ok ? 'Expected an array of servers' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
		});
	}

	// /servers/available — expected: { servers: ServerStatus[] } filtered to online.
	{
		const resp = await request('GET', '/servers/available');
		const ok = resp.ok && resp.data && ensureArray(resp.data.servers);
		results.push({
			name: 'Available servers',
			method: 'GET',
			path: '/servers/available',
			ok,
			status: resp.status,
			note: ok ? `Online servers: ${resp.data.servers.length}` : undefined,
			error: resp.error || (!ok ? 'Expected { servers: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
		});
	}

	// /servers/:name/status — expected: a single ServerStatus.
	{
		const resp = await request('GET', `/servers/${SERVER_NAME}/status`);
		const ok = resp.ok && hasKeys(resp.data, ['config', 'isOnline', 'models']);
		results.push({
			name: 'Server status',
			method: 'GET',
			path: `/servers/${SERVER_NAME}/status`,
			ok,
			status: resp.status,
			note: ok ? `Online: ${resp.data.isOnline}, models: ${resp.data.models?.length || 0}` : undefined,
			error: resp.error || (!ok ? 'Expected ServerStatus payload' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
		});
	}

	// /servers/:name/models — expected: { models: string[] }.
	{
		const resp = await request('GET', `/servers/${SERVER_NAME}/models`);
		const ok = resp.ok && resp.data && ensureArray(resp.data.models);
		results.push({
			name: 'Server models',
			method: 'GET',
			path: `/servers/${SERVER_NAME}/models`,
			ok,
			status: resp.status,
			note: ok ? `Models discovered: ${resp.data.models.length}` : undefined,
			error: resp.error || (!ok ? 'Expected { models: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
		});
	}

	// /models/:model/servers — expected: { servers: string[] }.
	{
		const resp = await request('GET', `/models/${MODEL_PRIMARY}/servers`);
		const ok = resp.ok && resp.data && ensureArray(resp.data.servers);
		results.push({
			name: 'Servers for model',
			method: 'GET',
			path: `/models/${MODEL_PRIMARY}/servers`,
			ok,
			status: resp.status,
			note: ok ? `Servers offering ${MODEL_PRIMARY}: ${resp.data.servers.join(', ') || 'none'}` : undefined,
			error: resp.error || (!ok ? 'Expected { servers: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			responseData: resp.data,
		});
	}

	// /generate/any — expected: queue/enqueue result; we do not assert shape beyond object existence.
	{
		const body = {
			prompt: 'Why is the sky blue?',
			model: MODEL_PRIMARY,
			params: { temperature: 0.7 },
		};
		const resp = await request('POST', '/generate/any', body);
		const ok = resp.ok && resp.data && typeof resp.data === 'object';
		results.push({
			name: 'Generate (any server)',
			method: 'POST',
			path: '/generate/any',
			ok,
			status: resp.status,
			note: ok ? 'Request accepted' : undefined,
			error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
		});
	}

	// /generate/server — expected: same shape but respects requested server.
	{
		const body = {
			prompt: 'Write a haiku about code.',
			model: MODEL_PRIMARY,
			serverName: SERVER_NAME,
		};
		const resp = await request('POST', '/generate/server', body);
		const ok = resp.ok && resp.data && typeof resp.data === 'object';
		results.push({
			name: 'Generate (specific server)',
			method: 'POST',
			path: '/generate/server',
			ok,
			status: resp.status,
			note: ok ? `Targeted server ${SERVER_NAME}` : undefined,
			error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
		});
	}

	// /generate/batch — expected: { results: [...] } where each entry is queue response per model.
	{
		const body = {
			prompt: 'Explain quantum computing in one sentence.',
			models: [MODEL_PRIMARY, MODEL_SECONDARY],
		};
		const resp = await request('POST', '/generate/batch', body);
		const ok = resp.ok && resp.data && ensureArray(resp.data.results);
		results.push({
			name: 'Generate batch',
			method: 'POST',
			path: '/generate/batch',
			ok,
			status: resp.status,
			note: ok ? `Batch results count: ${resp.data.results.length}` : undefined,
			error: resp.error || (!ok ? 'Expected { results: [...] }' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
		});
	}

	// /embed — expected: embedding request accepted; params.embedding=true is set server-side.
	{
		const body = {
			prompt: 'This is a sentence to embed.',
			model: EMBED_MODEL,
		};
		const resp = await request('POST', '/embed', body);
		const ok = resp.ok && resp.data && typeof resp.data === 'object';
		results.push({
			name: 'Embeddings',
			method: 'POST',
			path: '/embed',
			ok,
			status: resp.status,
			note: ok ? 'Embedding request accepted' : undefined,
			error: resp.error || (!ok ? 'Expected JSON response for enqueue/result' : undefined),
			elapsedMs: resp.elapsedMs,
			requestBody: body,
			responseData: resp.data,
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
		const { filePath, fileUrl } = await ReportService.generate(results, {
			baseUrl: BASE_URL,
			serverName: SERVER_NAME,
			modelPrimary: MODEL_PRIMARY,
			modelSecondary: MODEL_SECONDARY,
			embedModel: EMBED_MODEL,
			timeoutMs: TIMEOUT_MS,
			timestamp,
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

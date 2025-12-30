import { randomUUID } from 'crypto';

/**
 * Focused test script for /generate/any endpoint.
 * Tests server pooling and parallel request distribution.
 * Generates HTML report with detailed server assignment feedback.
 */

const PORT = process.env.PORT || '3111';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MODEL_PRIMARY = process.env.TEST_MODEL_PRIMARY || 'granite3.3';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 60 * 1000);
const MAX_PARALLEL_PER_SERVER = Number(process.env.MAX_PARALLEL_PER_SERVER || 2);

interface GenerateAnyTest {
	testName: string;
	parallelCount: number;
	expectedDistribution: string;
	results: GenerateAnyResult[];
	serverDistribution: Map<string, number>;
	timestamp: string;
	durationMs: number;
}

interface GenerateAnyResult {
	requestNumber: number;
	prompt: string;
	ok: boolean;
	status?: number;
	serverName?: string;
	durationMs: number;
	error?: string;
	timestamp: string;
}

interface ServerAvailability {
	count: number;
	names: string[];
}

async function checkServerAvailability(): Promise<ServerAvailability> {
	const resp = await request('GET', `/api/models/${MODEL_PRIMARY}/servers`);
	if (!resp.ok || !resp.data) {
		return { count: 0, names: [] };
	}
	const servers = resp.data.servers || [];
	return {
		count: servers.length,
		names: servers
	};
}

async function selectRandomPrompt(): Promise<string> {
	try {
		const fs = await import('fs/promises');
		const path = await import('path');
		const promptsPath = path.join(__dirname, '..', 'src', 'config', 'promptExamples.json');
		const content = await fs.readFile(promptsPath, 'utf-8');
		const prompts: string[] = JSON.parse(content);
		const randomIndex = Math.floor(Math.random() * prompts.length);
		return prompts[randomIndex];
	} catch (err) {
		console.warn('⚠️  Could not load promptExamples.json, using fallback prompt');
		return 'Explain the concept of machine learning in one sentence.';
	}
}

async function request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status?: number; data?: any; error?: string; elapsedMs: number; timestamp: string; }> {
	const url = `${BASE_URL}${path}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const timestamp = new Date().toISOString();

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

		return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text, elapsedMs: elapsed, timestamp };
	} catch (err: any) {
		const elapsed = Date.now() - startTime;
		const reason = err?.name === 'AbortError' ? `Request timed out after ${elapsed}ms` : err?.message || 'Unknown error';
		return { ok: false, error: reason, status: undefined, data: undefined, elapsedMs: elapsed, timestamp };
	} finally {
		clearTimeout(timer);
	}
}

async function testParallelRequests(parallelCount: number, testName: string, expectedDistribution: string, overrideMaxParallel?: number, specificPrompt?: string): Promise<GenerateAnyTest> {
	const effectiveMaxParallel = overrideMaxParallel ?? MAX_PARALLEL_PER_SERVER;
	
	console.log(`\n${'='.repeat(80)}`);
	console.log(`Test: ${testName}`);
	console.log(`Parallel Count: ${parallelCount}`);
	console.log(`MAX_PARALLEL_PER_SERVER: ${effectiveMaxParallel}`);
	if (specificPrompt) {
		console.log(`Using specific prompt: "${specificPrompt.substring(0, 70)}${specificPrompt.length > 70 ? '...' : ''}"`);
	}
	console.log(`Expected Distribution: ${expectedDistribution}`);
	console.log(`${'='.repeat(80)}\n`);

	const prompts = [
		'Explain the concept of machine learning in one sentence.',
		'What are the main differences between supervised and unsupervised learning?',
		'How does a neural network process information?',
		'Describe the importance of data preprocessing in machine learning.',
		'What is the role of activation functions in neural networks?',
		'Explain overfitting and how to prevent it.',
		'What are the key metrics for evaluating a classification model?',
		'How does backpropagation work in neural networks?',
		'What is the difference between batch and stochastic gradient descent?',
		'Describe the architecture of a transformer model.',
	];

	const testStartTime = Date.now();
	const results: GenerateAnyResult[] = [];

	// Create parallel requests
	const requestPromises = [];
	for (let i = 0; i < parallelCount; i++) {
		const prompt = specificPrompt || prompts[i % prompts.length];
		const body = {
			prompt,
			model: MODEL_PRIMARY,
			params: { temperature: 0.5 },
			maxParallelPerServer: effectiveMaxParallel,
		};

		console.log(`📤 Request ${i + 1}/${parallelCount}: "${prompt.substring(0, 50)}..."`);

		requestPromises.push(
			request('POST', '/api/generate/any', body).then(resp => ({
				requestNumber: i + 1,
				ok: resp.ok,
				status: resp.status,
				serverName: resp.data?.serverName,
				durationMs: resp.elapsedMs,
				error: resp.error,
				timestamp: resp.timestamp,
				prompt,
			}))
		);
	}

	// Wait for all requests to complete
	const responses = await Promise.all(requestPromises);

	// Process results
	responses.forEach(resp => {
		results.push({
			requestNumber: resp.requestNumber,
			prompt: resp.prompt,
			ok: resp.ok,
			status: resp.status,
			serverName: resp.serverName,
			durationMs: resp.durationMs,
			error: resp.error,
			timestamp: resp.timestamp,
		});

		const serverLabel = resp.serverName || 'UNKNOWN';
		const icon = resp.ok ? '✅' : '❌';
		console.log(`${icon} Request ${resp.requestNumber}: ${serverLabel} (${resp.durationMs}ms)`);
	});

	// Calculate distribution
	const serverDistribution = new Map<string, number>();
	results.forEach(r => {
		if (r.serverName) {
			serverDistribution.set(r.serverName, (serverDistribution.get(r.serverName) || 0) + 1);
		}
	});

	const durationMs = Date.now() - testStartTime;

	console.log(`\n📊 Server Distribution:`);
	serverDistribution.forEach((count, server) => {
		console.log(`   ${server}: ${count} request(s)`);
	});

	return {
		testName,
		parallelCount,
		expectedDistribution,
		results,
		serverDistribution,
		timestamp: new Date().toISOString(),
		durationMs,
	};
}

function generateHtmlReport(tests: GenerateAnyTest[], availableServers: ServerAvailability, purpose: string): string {
	const css = `
		:root {
			--bg: #080a0c;
			--panel: #11151c;
			--panel-hover: #161b25;
			--text: #e2e8f0;
			--text-muted: #94a3b8;
			--ok: #10b981;
			--fail: #ef4444;
			--warn: #f59e0b;
			--accent: #8ab4f8;
			--border: #1e293b;
			--code-bg: #020617;
		}
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: var(--bg);
			color: var(--text);
			line-height: 1.6;
		}
		.container {
			max-width: 1200px;
			margin: 0 auto;
			padding: 20px;
		}
		header {
			background: var(--panel);
			border: 1px solid var(--border);
			color: var(--text);
			padding: 30px;
			border-radius: 8px;
			margin-bottom: 30px;
		}
		header h1 { font-size: 2em; margin-bottom: 10px; color: var(--accent); }
		header .purpose {
			color: var(--text-muted);
			margin-bottom: 20px;
			font-size: 1.1em;
			max-width: 800px;
		}
		header .config {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
			gap: 15px;
			margin-top: 15px;
		}
		header .config-item {
			background: rgba(255,255,255,0.03);
			border: 1px solid var(--border);
			padding: 10px 15px;
			border-radius: 4px;
			font-size: 0.9em;
		}
		header .config-key { font-weight: bold; color: var(--accent); }
		.test-section {
			background: var(--panel);
			padding: 25px;
			margin-bottom: 20px;
			border-radius: 8px;
			border: 1px solid var(--border);
			box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
		}
		.test-header {
			border-bottom: 1px solid var(--border);
			padding-bottom: 15px;
			margin-bottom: 20px;
		}
		.test-header h2 { font-size: 1.5em; margin-bottom: 10px; color: var(--accent); }
		.test-meta {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 15px;
			font-size: 0.9em;
			color: var(--text-muted);
		}
		.distribution-chart {
			display: flex;
			gap: 20px;
			margin: 20px 0;
			align-items: flex-end;
			min-height: 200px;
			background: rgba(255,255,255,0.02);
			padding: 20px;
			border-radius: 8px;
		}
		.distribution-bar {
			display: flex;
			flex-direction: column;
			align-items: center;
			flex: 1;
		}
		.bar {
			width: 100%;
			background: linear-gradient(180deg, var(--accent) 0%, #4f46e5 100%);
			border-radius: 4px 4px 0 0;
			min-height: 40px;
			display: flex;
			align-items: flex-end;
			justify-content: center;
			color: white;
			font-weight: bold;
			font-size: 1.2em;
			box-shadow: 0 4px 12px rgba(0,0,0,0.3);
		}
		.bar-label {
			margin-top: 10px;
			font-weight: bold;
			text-align: center;
			color: var(--text-muted);
		}
		.requests-table {
			width: 100%;
			border-collapse: collapse;
			margin: 20px 0;
			font-size: 0.9em;
		}
		.requests-table th {
			background: rgba(255,255,255,0.05);
			padding: 12px;
			text-align: left;
			font-weight: bold;
			border-bottom: 2px solid var(--border);
			color: var(--accent);
		}
		.requests-table td {
			padding: 12px;
			border-bottom: 1px solid var(--border);
			color: var(--text);
		}
		.requests-table tr:hover {
			background: var(--panel-hover);
		}
		.status-ok { color: var(--ok); font-weight: bold; }
		.status-error { color: var(--fail); font-weight: bold; }
		.summary-stats {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
			gap: 15px;
			margin: 20px 0;
		}
		.stat-box {
			background: rgba(255,255,255,0.03);
			padding: 15px;
			border-left: 4px solid var(--accent);
			border-radius: 4px;
			border-top: 1px solid var(--border);
			border-right: 1px solid var(--border);
			border-bottom: 1px solid var(--border);
		}
		.stat-label {
			font-size: 0.85em;
			color: var(--text-muted);
			margin-bottom: 5px;
		}
		.stat-value {
			font-size: 1.8em;
			font-weight: bold;
			color: var(--text);
		}
		.warning {
			background: rgba(245, 158, 11, 0.1);
			border: 1px solid var(--warn);
			color: var(--warn);
			padding: 12px;
			border-radius: 4px;
			margin: 15px 0;
		}
		.success {
			background: rgba(16, 185, 129, 0.1);
			border: 1px solid var(--ok);
			color: var(--ok);
			padding: 12px;
			border-radius: 4px;
			margin: 15px 0;
		}
	`;

	let html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>/api/generate/any Test Report</title>
	<style>${css}</style>
</head>
<body>
	<div class="container">
		<header>
			<h1>🚀 /api/generate/any Endpoint Test Report</h1>
			<div class="purpose">${purpose}</div>
			<div class="config">
				<div class="config-item"><span class="config-key">Base URL:</span> ${BASE_URL}</div>
				<div class="config-item"><span class="config-key">Model:</span> ${MODEL_PRIMARY}</div>
				<div class="config-item"><span class="config-key">MAX_PARALLEL_PER_SERVER:</span> ${MAX_PARALLEL_PER_SERVER}</div>
				<div class="config-item"><span class="config-key">Timeout:</span> ${TIMEOUT_MS}ms</div>
				<div class="config-item"><span class="config-key">Available Servers:</span> ${availableServers.count} (${availableServers.names.join(', ')})</div>
				<div class="config-item"><span class="config-key">Generated:</span> ${new Date().toISOString()}</div>
			</div>
		</header>`;

	tests.forEach(test => {
		const successCount = test.results.filter(r => r.ok).length;
		const failureCount = test.results.filter(r => !r.ok).length;
		const avgDuration = Math.round(test.results.reduce((sum, r) => sum + r.durationMs, 0) / test.results.length);

		// Calculate max requests for scaling the distribution chart
		const maxRequests = Math.max(...Array.from(test.serverDistribution.values()));

		html += `
		<div class="test-section">
			<div class="test-header">
				<h2>${test.testName}</h2>
				<div class="test-meta">
					<div><strong>Parallel Requests:</strong> ${test.parallelCount}</div>
					<div><strong>Expected Distribution:</strong> ${test.expectedDistribution}</div>
					<div><strong>Test Duration:</strong> ${test.durationMs}ms</div>
					<div><strong>Timestamp:</strong> ${test.timestamp}</div>
				</div>
			</div>

			<div class="summary-stats">
				<div class="stat-box">
					<div class="stat-label">Success Rate</div>
					<div class="stat-value">${successCount}/${test.parallelCount}</div>
				</div>
				<div class="stat-box">
					<div class="stat-label">Failures</div>
					<div class="stat-value">${failureCount}</div>
				</div>
				<div class="stat-box">
					<div class="stat-label">Avg Response Time</div>
					<div class="stat-value">${avgDuration}ms</div>
				</div>
				<div class="stat-box">
					<div class="stat-label">Servers Used</div>
					<div class="stat-value">${test.serverDistribution.size}</div>
				</div>
			</div>

			${failureCount > 0 ? `<div class="warning">⚠️ ${failureCount} request(s) failed. Check the details below.</div>` : ''}

			<h3 style="margin-top: 20px;">📊 Server Distribution</h3>
			<div class="distribution-chart">
				${Array.from(test.serverDistribution.entries()).map(([server, count]) => {
					const percentage = (count / maxRequests) * 100;
					return `
					<div class="distribution-bar">
						<div class="bar" style="height: ${Math.max(20, percentage)}px;">
							${count}
						</div>
						<div class="bar-label">${server}</div>
					</div>
					`;
				}).join('')}
			</div>

			<h3 style="margin-top: 20px;">📋 Request Details</h3>
			<table class="requests-table">
				<thead>
					<tr>
						<th>#</th>
						<th>Status</th>
						<th>Server</th>
						<th>Duration</th>
						<th>Prompt</th>
						<th>Error</th>
					</tr>
				</thead>
				<tbody>
					${test.results.map(r => `
					<tr>
						<td>${r.requestNumber}</td>
						<td class="${r.ok ? 'status-ok' : 'status-error'}">${r.ok ? '✅ OK' : '❌ FAIL'}</td>
						<td>${r.serverName || '-'}</td>
						<td>${r.durationMs}ms</td>
						<td title="${r.prompt}">${r.prompt.substring(0, 50)}${r.prompt.length > 50 ? '...' : ''}</td>
						<td>${r.error || '-'}</td>
					</tr>
					`).join('')}
				</tbody>
			</table>
		</div>`;
	});

	html += `
	</div>
</body>
</html>`;

	return html;
}

async function main() {
	console.log(`\n${'='.repeat(80)}`);
	console.log('🎯 /api/generate/any Endpoint Test - Server Pooling Distribution');
	console.log(`${'='.repeat(80)}`);
	console.log(`Base URL: ${BASE_URL}`);
	console.log(`Model: ${MODEL_PRIMARY}`);

	// Check server availability
	console.log(`\n🔍 Server Availability Check:`);
	const availableServers = await checkServerAvailability();
	console.log(`   Available servers for model "${MODEL_PRIMARY}": ${availableServers.count}`);
	if (availableServers.count > 0) {
		console.log(`   Servers: ${availableServers.names.join(', ')}`);
	}
	
	if (availableServers.count < 2) {
		console.log(`\n${'='.repeat(80)}`);
		console.error(`\n❌ ERROR: Insufficient servers available for testing`);
		console.error(`\n   This test suite requires at least 2 servers with model "${MODEL_PRIMARY}" to be available.`);
		console.error(`   Current status: ${availableServers.count} server(s) available${availableServers.names.length > 0 ? ` (${availableServers.names.join(', ')})` : ''}`);
		console.error(`\n   💡 To run these tests, please ensure at least 2 Ollama servers are running`);
		console.error(`      with the "${MODEL_PRIMARY}" model available on each server.`);
		console.error(`\n   Example: Start additional Ollama servers on different ports and configure`);
		console.error(`            them in your servers.json file.`);
		console.log(`\n${'='.repeat(80)}\n`);
		process.exitCode = 1;
		return;
	}
	
	console.log(`   ✅ Sufficient servers available for testing`);

	// Query server's actual configuration
	console.log(`\n📋 Configuration Check:`);
	try {
		const configResp = await request('GET', '/api/config');
		if (configResp.ok && configResp.data) {
			console.log(`   Server Default MAX_PARALLEL_PER_SERVER: ${configResp.data.maxParallelPerServer}`);
			console.log(`   Test Override MAX_PARALLEL_PER_SERVER:  ${MAX_PARALLEL_PER_SERVER}`);
			console.log(`   Server Check Interval: ${configResp.data.serverCheckIntervalMs}ms`);
			console.log(`   Configured Servers: ${configResp.data.serverCount}`);
			console.log(`   ✅ Using per-request override for testing`);
		} else {
			console.log(`   ⚠️  Could not query server config - using test value ${MAX_PARALLEL_PER_SERVER}`);
		}
	} catch (e) {
		console.log(`   ❌ Error querying server config:`, e);
	}
	
	// Select random prompt for MAX_PARALLEL_PER_SERVER=1 tests
	console.log(`\n🎲 Selecting random prompt for override tests...`);
	const randomPrompt = await selectRandomPrompt();
	console.log(`   Selected: "${randomPrompt.substring(0, 70)}${randomPrompt.length > 70 ? '...' : ''}"`);
	
	console.log(`${'='.repeat(80)}`);

	const tests: GenerateAnyTest[] = [];

	// Test 1: 2 parallel requests
	const test1 = await testParallelRequests(
		2,
		'Test 1: 2 Parallel Requests (Default MAX_PARALLEL_PER_SERVER)',
		availableServers.count >= 2 
			? `With ${availableServers.count} servers: Distribute across servers respecting MAX_PARALLEL_PER_SERVER=${MAX_PARALLEL_PER_SERVER}`
			: `With ${availableServers.count} server(s): Both requests on available server(s)`
	);
	tests.push(test1);

	// Test 2: 3 parallel requests
	const test2 = await testParallelRequests(
		3,
		'Test 2: 3 Parallel Requests (Default MAX_PARALLEL_PER_SERVER)',
		availableServers.count >= 3
			? `With ${availableServers.count} servers: Distribute evenly, up to MAX_PARALLEL_PER_SERVER=${MAX_PARALLEL_PER_SERVER} per server`
			: `With ${availableServers.count} server(s): Distribute respecting MAX_PARALLEL_PER_SERVER=${MAX_PARALLEL_PER_SERVER} limit`
	);
	tests.push(test2);

	// Test 3: 4 parallel requests
	const test3 = await testParallelRequests(
		4,
		'Test 3: 4 Parallel Requests (Default MAX_PARALLEL_PER_SERVER)',
		`With ${availableServers.count} servers: Fill servers evenly respecting MAX_PARALLEL_PER_SERVER=${MAX_PARALLEL_PER_SERVER} limit`
	);
	tests.push(test3);
	
	// Test 4: 2 parallel requests with MAX_PARALLEL_PER_SERVER=1 override (same prompt)
	const test4 = await testParallelRequests(
		2,
		'Test 4: 2 Parallel Requests with MAX_PARALLEL_PER_SERVER=1 Override (Same Prompt)',
		availableServers.count >= 2
			? `With ${availableServers.count} servers: 1 request per server (2 servers used)`
			: `With ${availableServers.count} server(s): Queuing behavior, 1 at a time per server`,
		1,
		randomPrompt
	);
	tests.push(test4);
	
	// Test 5: 3 parallel requests with MAX_PARALLEL_PER_SERVER=1 override (same prompt)
	const test5 = await testParallelRequests(
		3,
		'Test 5: 3 Parallel Requests with MAX_PARALLEL_PER_SERVER=1 Override (Same Prompt)',
		availableServers.count >= 3
			? `With ${availableServers.count} servers: 1 request per server (3 servers used)`
			: `With ${availableServers.count} server(s): 1 per server, remaining queued (${availableServers.count} + queued)`,
		1,
		randomPrompt
	);
	tests.push(test5);

	// Generate HTML report
	try {
		const purpose = "This test validates the load balancing and request distribution logic of the /api/generate/any endpoint. It ensures that parallel requests are distributed across available servers according to the MAX_PARALLEL_PER_SERVER constraint, optimizing resource utilization and minimizing latency.";
		const htmlContent = generateHtmlReport(tests, availableServers, purpose);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
		const fileName = `generate-any-test-${timestamp}.html`;
		const filePath = `reports/${fileName}`;

		// Write HTML file
		const fs = await import('fs/promises');
		const path = await import('path');
		await fs.writeFile(filePath, htmlContent);

		const absolutePath = path.resolve(filePath);
		const fileUrl = `file:///${absolutePath.replace(/\\/g, '/')}`;

		console.log(`\n${'='.repeat(80)}`);
		console.log(`✅ HTML report generated: ${fileUrl}`);
		console.log(`${'='.repeat(80)}\n`);
	} catch (e) {
		console.error('Failed to write HTML report:', e);
	}

	// Summary
	console.log('\n' + '='.repeat(80));
	console.log('📈 Test Summary');
	console.log('='.repeat(80));
	tests.forEach(test => {
		const successCount = test.results.filter(r => r.ok).length;
		console.log(`\n${test.testName}`);
		console.log(`  Success: ${successCount}/${test.parallelCount}`);
		console.log(`  Servers Used: ${Array.from(test.serverDistribution.keys()).join(', ')}`);
		console.log(`  Distribution: ${Array.from(test.serverDistribution.entries()).map(([s, c]) => `${s}:${c}`).join(', ')}`);
	});
}

main().catch(err => {
	console.error('Unexpected error:', err);
	process.exitCode = 1;
});

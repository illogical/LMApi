import 'dotenv/config';
import { randomUUID } from 'crypto';

/**
 * Test script for Chat Completion endpoints
 * 
 * Tests:
 * - OpenAI-compatible /v1/chat/completions endpoint
 * - LMAPI routing variants (/any, /server, /batch, /all)
 * - Non-streaming chat completions
 * - SSE streaming chat completions
 * - Tool/function calling pass-through
 * - Cloud provider fallback (if configured)
 */

// Environment configuration
const PORT = process.env.PORT || '17100';
const LMAPI_BASE_URL = process.env.LMAPI_BASE_URL || `http://localhost:${PORT}`;
const SERVER_NAME = process.env.TEST_SERVER_NAME || 'Localhost';
const CHAT_MODEL = process.env.TEST_CHAT_MODEL || 'llama3.1';
const CHAT_MODEL_SECONDARY = process.env.TEST_CHAT_MODEL_SECONDARY || 'phi4';
const CLOUD_MODEL = process.env.TEST_CLOUD_MODEL || 'anthropic/claude-sonnet-4';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 120 * 1000); // 2 minutes for chat
const STREAMING_TIMEOUT_MS = Number(process.env.TEST_STREAMING_TIMEOUT_MS || 180 * 1000); // 3 minutes for streaming

// Diagnostic: Show which environment variables were loaded
console.log('\n📋 ENVIRONMENT CONFIGURATION:');
console.log(`   PORT: ${process.env.PORT ? `${process.env.PORT} (from env)` : `${PORT} (default)`}`);
console.log(`   LMAPI_BASE_URL: ${process.env.LMAPI_BASE_URL ? `${process.env.LMAPI_BASE_URL} (from env)` : `${LMAPI_BASE_URL} (default)`}`);
console.log(`   TEST_SERVER_NAME: ${process.env.TEST_SERVER_NAME ? `${process.env.TEST_SERVER_NAME} (from env)` : `${SERVER_NAME} (default)`}`);
console.log(`   TEST_CHAT_MODEL: ${process.env.TEST_CHAT_MODEL ? `${process.env.TEST_CHAT_MODEL} (from env)` : `${CHAT_MODEL} (default)`}`);
console.log(`   TEST_CHAT_MODEL_SECONDARY: ${process.env.TEST_CHAT_MODEL_SECONDARY ? `${process.env.TEST_CHAT_MODEL_SECONDARY} (from env)` : `${CHAT_MODEL_SECONDARY} (default)`}`);
console.log(`   TEST_CLOUD_MODEL: ${process.env.TEST_CLOUD_MODEL ? `${process.env.TEST_CLOUD_MODEL} (from env)` : `${CLOUD_MODEL} (default)`}`);
console.log(`   TEST_TIMEOUT_MS: ${process.env.TEST_TIMEOUT_MS ? `${process.env.TEST_TIMEOUT_MS} (from env)` : `${TIMEOUT_MS} (default)`}`);
console.log(`   TEST_STREAMING_TIMEOUT_MS: ${process.env.TEST_STREAMING_TIMEOUT_MS ? `${process.env.TEST_STREAMING_TIMEOUT_MS} (from env)` : `${STREAMING_TIMEOUT_MS} (default)`}`);
console.log(`   OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '✓ Set' : '✗ Not set'}`);

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
    streamChunks?: number;
    features?: {
        streaming?: boolean;
        toolCalling?: boolean;
        cloudProvider?: boolean;
    };
}

/**
 * Make a standard HTTP request
 */
async function request(
    method: string, 
    path: string, 
    body?: unknown
): Promise<{ ok: boolean; status?: number; data?: any; error?: string; elapsedMs: number }> {
    const url = `${LMAPI_BASE_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    console.log(`\n🔵 ${method} ${path}`);
    if (body) {
        const bodyStr = JSON.stringify(body, null, 2);
        console.log('   Request:', bodyStr.substring(0, 500) + (bodyStr.length > 500 ? '...' : ''));
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

        console.log(`   Response (${elapsed}ms):`, res.status, res.statusText);
        if (data) {
            const preview = typeof data === 'string' 
                ? data.substring(0, 200) 
                : JSON.stringify(data, null, 2).substring(0, 500);
            console.log('   Data:', preview + (preview.length >= 200 || preview.length >= 500 ? '...' : ''));
        }

        return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text, elapsedMs: elapsed };
    } catch (err: any) {
        const elapsed = Date.now() - startTime;
        const reason = err?.name === 'AbortError' ? `Timeout after ${elapsed}ms` : err?.message || 'Unknown error';
        console.log(`   Error (${elapsed}ms):`, reason);
        return { ok: false, error: reason, status: undefined, data: undefined, elapsedMs: elapsed };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Make a streaming SSE request
 */
async function requestStreaming(
    method: string,
    path: string,
    body: unknown
): Promise<{ ok: boolean; status?: number; chunks: string[]; error?: string; elapsedMs: number }> {
    const url = `${LMAPI_BASE_URL}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STREAMING_TIMEOUT_MS);

    console.log(`\n🔵 ${method} ${path} (STREAMING)`);
    const bodyStr = JSON.stringify(body, null, 2);
    console.log('   Request:', bodyStr.substring(0, 500) + (bodyStr.length > 500 ? '...' : ''));

    const startTime = Date.now();
    const chunks: string[] = [];
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        console.log(`   Response status:`, res.status, res.statusText);

        if (!res.ok) {
            const text = await res.text();
            const elapsed = Date.now() - startTime;
            return { ok: false, status: res.status, chunks: [], error: text, elapsedMs: elapsed };
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        
        if (!reader) {
            return { ok: false, chunks: [], error: 'No response body reader', elapsedMs: Date.now() - startTime };
        }

        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') {
                        console.log(`   Stream complete: ${chunks.length} chunks received`);
                        const elapsed = Date.now() - startTime;
                        return { ok: true, status: res.status, chunks, elapsedMs: elapsed };
                    }
                    chunks.push(data);
                    if (chunks.length <= 3 || chunks.length % 10 === 0) {
                        console.log(`   Chunk ${chunks.length}:`, data.substring(0, 100) + '...');
                    }
                }
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`   Stream ended: ${chunks.length} chunks received`);
        return { ok: true, status: res.status, chunks, elapsedMs: elapsed };

    } catch (err: any) {
        const elapsed = Date.now() - startTime;
        const reason = err?.name === 'AbortError' ? `Timeout after ${elapsed}ms` : err?.message || 'Unknown error';
        console.log(`   Error (${elapsed}ms):`, reason);
        return { ok: false, error: reason, status: undefined, chunks, elapsedMs: elapsed };
    } finally {
        clearTimeout(timer);
    }
}

function logResult(result: TestResult) {
    const statusPart = result.status ? ` (${result.status})` : '';
    const notePart = result.note ? ` — ${result.note}` : '';
    const featureParts: string[] = [];
    
    if (result.features?.streaming) featureParts.push('streaming');
    if (result.features?.toolCalling) featureParts.push('tool-calling');
    if (result.features?.cloudProvider) featureParts.push('cloud-provider');
    
    const featuresStr = featureParts.length > 0 ? ` [${featureParts.join(', ')}]` : '';
    
    if (result.ok) {
        console.log(`\n✅ ${result.name}${statusPart}${notePart}${featuresStr}`);
    } else {
        console.error(`\n❌ ${result.name}${statusPart} — ${result.error || 'Failed'}${featuresStr}`);
    }
}

function hasKeys(obj: any, keys: string[]): boolean {
    return !!obj && typeof obj === 'object' && keys.every(k => Object.prototype.hasOwnProperty.call(obj, k));
}

async function main() {
    console.log(`\n==== Chat Completions Test Runner ====`);
    console.log(`Base URL: ${LMAPI_BASE_URL}`);
    console.log(`Chat Model: ${CHAT_MODEL}`);
    console.log(`Secondary Model: ${CHAT_MODEL_SECONDARY}`);
    console.log(`Cloud Model: ${CLOUD_MODEL}`);
    console.log(`Timeout: ${TIMEOUT_MS}ms (streaming: ${STREAMING_TIMEOUT_MS}ms)`);
    
    const results: TestResult[] = [];
    const scriptStartTime = Date.now();

    // Test 1: OpenAI-compatible endpoint - Basic chat
    {
        const body = {
            model: CHAT_MODEL,
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'What is 2+2? Answer in one short sentence.' }
            ],
            temperature: 0.1,
            max_tokens: 50
        };
        const resp = await request('POST', '/v1/chat/completions', body);
        const ok = resp.ok && hasKeys(resp.data, ['id', 'object', 'model', 'choices']);
        const hasMessage = ok && resp.data.choices?.[0]?.message?.content;
        
        results.push({
            name: 'OpenAI-compatible endpoint (basic)',
            method: 'POST',
            path: '/v1/chat/completions',
            ok: ok && hasMessage,
            status: resp.status,
            note: ok ? `Response: "${resp.data.choices[0]?.message?.content?.substring(0, 100)}..."` : undefined,
            error: resp.error || (!ok ? 'Invalid chat completion response' : !hasMessage ? 'No message content' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
        });
    }

    // Test 2: OpenAI-compatible endpoint - Streaming
    {
        const body = {
            model: CHAT_MODEL,
            messages: [
                { role: 'user', content: 'Count from 1 to 5, each number on a new line.' }
            ],
            stream: true,
            temperature: 0.1
        };
        const resp = await requestStreaming('POST', '/v1/chat/completions', body);
        const hasChunks = resp.chunks.length > 0;
        
        // Parse chunks to verify format
        let validChunks = 0;
        let hasContent = false;
        for (const chunk of resp.chunks) {
            try {
                const parsed = JSON.parse(chunk);
                if (hasKeys(parsed, ['id', 'object', 'choices'])) {
                    validChunks++;
                    if (parsed.choices?.[0]?.delta?.content) {
                        hasContent = true;
                    }
                }
            } catch {}
        }
        
        results.push({
            name: 'OpenAI-compatible endpoint (streaming)',
            method: 'POST',
            path: '/v1/chat/completions',
            ok: resp.ok && hasChunks && hasContent,
            status: resp.status,
            note: resp.ok ? `Received ${resp.chunks.length} chunks (${validChunks} valid, content: ${hasContent})` : undefined,
            error: resp.error || (!hasChunks ? 'No chunks received' : !hasContent ? 'No content in chunks' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            streamChunks: resp.chunks.length,
            features: { streaming: true },
        });
    }

    // Test 3: LMAPI /any endpoint - Non-streaming
    {
        const body = {
            model: CHAT_MODEL,
            messages: [
                { role: 'user', content: 'What is the capital of France? One word answer.' }
            ],
            temperature: 0.1
        };
        const resp = await request('POST', '/api/chat/completions/any', body);
        const ok = resp.ok && hasKeys(resp.data, ['id', 'choices', 'lmapi']);
        const hasLmapiMetadata = ok && resp.data.lmapi?.server_name && typeof resp.data.lmapi?.duration_ms === 'number';
        
        results.push({
            name: 'LMAPI /any endpoint',
            method: 'POST',
            path: '/api/chat/completions/any',
            ok: ok && hasLmapiMetadata,
            status: resp.status,
            note: ok ? `Server: ${resp.data.lmapi?.server_name}, Duration: ${resp.data.lmapi?.duration_ms}ms` : undefined,
            error: resp.error || (!ok ? 'Invalid response' : !hasLmapiMetadata ? 'Missing LMAPI metadata' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
        });
    }

    // Test 4: LMAPI /any endpoint - Streaming
    {
        const body = {
            model: CHAT_MODEL,
            messages: [
                { role: 'user', content: 'List three colors, one per line.' }
            ],
            stream: true,
            temperature: 0.2
        };
        const resp = await requestStreaming('POST', '/api/chat/completions/any', body);
        
        results.push({
            name: 'LMAPI /any endpoint (streaming)',
            method: 'POST',
            path: '/api/chat/completions/any',
            ok: resp.ok && resp.chunks.length > 0,
            status: resp.status,
            note: resp.ok ? `Received ${resp.chunks.length} chunks` : undefined,
            error: resp.error || (!resp.ok ? 'Streaming failed' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            streamChunks: resp.chunks.length,
            features: { streaming: true },
        });
    }

    // Test 5: LMAPI /server endpoint - Specific server
    {
        const body = {
            model: CHAT_MODEL,
            serverName: SERVER_NAME,
            messages: [
                { role: 'user', content: 'Say hello in one word.' }
            ],
            temperature: 0.1
        };
        const resp = await request('POST', '/api/chat/completions/server', body);
        const ok = resp.ok && hasKeys(resp.data, ['id', 'choices', 'lmapi']);
        const correctServer = ok && resp.data.lmapi?.server_name === SERVER_NAME;
        
        results.push({
            name: 'LMAPI /server endpoint',
            method: 'POST',
            path: '/api/chat/completions/server',
            ok: ok && correctServer,
            status: resp.status,
            note: ok ? `Server: ${resp.data.lmapi?.server_name}` : undefined,
            error: resp.error || (!ok ? 'Invalid response' : !correctServer ? `Wrong server: ${resp.data.lmapi?.server_name}` : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
        });
    }

    // Test 6: LMAPI /batch endpoint - Multiple models
    {
        const body = {
            models: [CHAT_MODEL, CHAT_MODEL_SECONDARY],
            messages: [
                { role: 'user', content: 'What is 5*5? One number answer.' }
            ],
            temperature: 0.1
        };
        const resp = await request('POST', '/api/chat/completions/batch', body);
        const ok = resp.ok && hasKeys(resp.data, ['results', 'group_id']);
        const hasResults = ok && Array.isArray(resp.data.results) && resp.data.results.length === 2;
        
        results.push({
            name: 'LMAPI /batch endpoint',
            method: 'POST',
            path: '/api/chat/completions/batch',
            ok: ok && hasResults,
            status: resp.status,
            note: ok ? `Received ${resp.data.results?.length} results, group_id: ${resp.data.group_id}` : undefined,
            error: resp.error || (!ok ? 'Invalid response' : !hasResults ? 'Wrong number of results' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
        });
    }

    // Test 7: LMAPI /all endpoint - All servers
    {
        const body = {
            model: CHAT_MODEL,
            messages: [
                { role: 'user', content: 'Name one primary color.' }
            ],
            temperature: 0.1
        };
        const resp = await request('POST', '/api/chat/completions/all', body);
        const ok = resp.ok && hasKeys(resp.data, ['results', 'group_id']);
        const hasResults = ok && Array.isArray(resp.data.results) && resp.data.results.length > 0;
        
        results.push({
            name: 'LMAPI /all endpoint',
            method: 'POST',
            path: '/api/chat/completions/all',
            ok: ok && hasResults,
            status: resp.status,
            note: ok ? `Broadcast to ${resp.data.results?.length} server(s)` : undefined,
            error: resp.error || (!ok ? 'Invalid response' : !hasResults ? 'No results' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
        });
    }

    // Test 8: Tool/Function calling - Pass-through
    {
        const body = {
            model: CHAT_MODEL,
            messages: [
                { role: 'user', content: 'What is the weather in San Francisco?' }
            ],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'get_weather',
                        description: 'Get the current weather in a location',
                        parameters: {
                            type: 'object',
                            properties: {
                                location: {
                                    type: 'string',
                                    description: 'The city and state, e.g. San Francisco, CA'
                                }
                            },
                            required: ['location']
                        }
                    }
                }
            ],
            tool_choice: 'auto',
            temperature: 0.1
        };
        const resp = await request('POST', '/v1/chat/completions', body);
        const ok = resp.ok && hasKeys(resp.data, ['id', 'choices']);
        const hasToolCalls = ok && resp.data.choices?.[0]?.message?.tool_calls;
        const toolCallsArray = Array.isArray(hasToolCalls) ? hasToolCalls : [];
        
        results.push({
            name: 'Tool/Function calling',
            method: 'POST',
            path: '/v1/chat/completions',
            ok: ok,
            status: resp.status,
            note: ok ? (hasToolCalls ? `Tool calls detected: ${toolCallsArray.length} call(s)` : 'No tool calls (model may not support or chose not to use)') : undefined,
            error: resp.error || (!ok ? 'Request failed' : undefined),
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
            features: { toolCalling: true },
        });
    }

    // Test 9: Cloud provider fallback (if configured)
    {
        const body = {
            model: CLOUD_MODEL,
            messages: [
                { role: 'user', content: 'Say "test" if you can read this.' }
            ],
            temperature: 0.1,
            max_tokens: 20
        };
        const resp = await request('POST', '/v1/chat/completions', body);
        const ok = resp.ok && hasKeys(resp.data, ['id', 'choices']);
        const isCloudProvider = resp.status === 503 || (ok && resp.data.lmapi?.server_name?.includes('router'));
        
        results.push({
            name: 'Cloud provider fallback',
            method: 'POST',
            path: '/v1/chat/completions',
            ok: ok || resp.status === 503,
            status: resp.status,
            note: resp.status === 503 
                ? 'Cloud provider not configured (expected)' 
                : ok 
                ? `Cloud routing worked, provider: ${resp.data.lmapi?.server_name || 'unknown'}` 
                : undefined,
            error: !ok && resp.status !== 503 ? resp.error || 'Unexpected error' : undefined,
            elapsedMs: resp.elapsedMs,
            requestBody: body,
            responseData: resp.data,
            features: { cloudProvider: true },
        });
    }

    // Display results
    console.log('\n' + '='.repeat(60));
    results.forEach(logResult);

    // Summary
    console.log('\n' + '='.repeat(60));
    const passed = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);
    const totalDuration = Date.now() - scriptStartTime;
    
    console.log(`\n📊 SUMMARY`);
    console.log(`   Total tests: ${results.length}`);
    console.log(`   Passed: ${passed.length} ✅`);
    console.log(`   Failed: ${failed.length} ❌`);
    console.log(`   Total duration: ${totalDuration}ms`);
    
    // Feature breakdown
    const streamingTests = results.filter(r => r.features?.streaming);
    const streamingPassed = streamingTests.filter(r => r.ok);
    const toolTests = results.filter(r => r.features?.toolCalling);
    const toolPassed = toolTests.filter(r => r.ok);
    const cloudTests = results.filter(r => r.features?.cloudProvider);
    const cloudPassed = cloudTests.filter(r => r.ok);
    
    console.log(`\n📋 FEATURE BREAKDOWN`);
    console.log(`   Streaming: ${streamingPassed.length}/${streamingTests.length} passed`);
    console.log(`   Tool Calling: ${toolPassed.length}/${toolTests.length} passed`);
    console.log(`   Cloud Provider: ${cloudPassed.length}/${cloudTests.length} passed`);

    if (failed.length > 0) {
        console.error(`\n❌ FAILED TESTS:`);
        failed.forEach(r => {
            console.error(`   - ${r.name}: ${r.error || 'Unknown failure'}`);
        });
        process.exitCode = 1;
    } else {
        console.log('\n✅ All tests passed!');
    }

    // Generate detailed report
    console.log('\n' + '='.repeat(60));
    console.log('\n📄 DETAILED RESULTS:\n');
    
    results.forEach(result => {
        console.log(`Test: ${result.name}`);
        console.log(`  Status: ${result.ok ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`  Endpoint: ${result.method} ${result.path}`);
        console.log(`  Duration: ${result.elapsedMs}ms`);
        if (result.streamChunks) {
            console.log(`  Stream chunks: ${result.streamChunks}`);
        }
        if (result.note) {
            console.log(`  Note: ${result.note}`);
        }
        if (result.error) {
            console.log(`  Error: ${result.error}`);
        }
        console.log('');
    });
}

main().catch(err => {
    console.error('Unexpected error:', err);
    process.exitCode = 1;
});

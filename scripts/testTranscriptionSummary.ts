import { PromptTemplateService } from '../src/services/PromptTemplateService';
import { ReportService, TranscriptionReportEntry } from '../src/services/ReportService';

/**
 * Hit the transcription agents: summarize a fake transcript, then title the summary.
 * Env overrides:
 *  - BASE_URL (default http://localhost:${PORT})
 *  - PORT (default 3111)
 *  - TEST_MODEL (default granite3.3)
 *  - TEST_TIMEOUT_MS (default 60000)
 */

const PORT = process.env.PORT || '3111';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MODEL = process.env.TEST_MODEL || 'granite3.3';
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 60_000);

interface FetchResult {
  ok: boolean;
  status?: number;
  data?: any;
  error?: string;
  elapsedMs: number;
  timestamp: string;
}

async function request(method: string, path: string, body?: unknown): Promise<FetchResult> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const timestamp = new Date().toISOString();

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const elapsedMs = Date.now() - start;
    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? undefined : text,
      elapsedMs,
      timestamp,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - start;
    const reason = err?.name === 'AbortError' ? `Request timed out after ${elapsedMs}ms` : err?.message || 'Unknown error';
    return { ok: false, error: reason, elapsedMs, timestamp };
  } finally {
    clearTimeout(timer);
  }
}

function toText(value: any): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function main() {
  console.log('\n==== Transcription Summary Test ====');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Model: ${MODEL}`);

  const templateSvc = new PromptTemplateService();
  const entries: TranscriptionReportEntry[] = [];

  const fakeTranscript = [
    'Good morning everyone, thanks for joining this sprint review. I want to start with a quick look back at what we set out to achieve and where we landed.',
    'Over the last two weeks the team delivered the upgraded ingestion pipeline, tightened latency on the chat endpoint by 18%, and validated the fallback server routing in staging. There is still follow-up needed on automated rollback rules.',
  ].join('\n\n');

  const { estimatedTokenCount: estimatedSummaryTokens } = await templateSvc.buildSummarizeTranscriptionPrompt(fakeTranscript);

  const summaryResp = await request('POST', '/api/agents/transcribe', { transcript: fakeTranscript, model: MODEL });
  const summaryText = toText(summaryResp.data?.response);
  const summaryOk = summaryResp.ok && !!summaryText;

  entries.push({
    stage: 'summary',
    title: 'Transcript Summary',
    summary: summaryText,
    ok: summaryOk,
    status: summaryResp.status,
    error: summaryResp.error || (!summaryOk ? 'Expected summary text in response' : undefined),
    durationMs: summaryResp.elapsedMs,
    requestTimestamp: summaryResp.timestamp,
    model: MODEL,
    serverName: summaryResp.data?.serverName,
    estimatedTokens: estimatedSummaryTokens,
    inputTokens: summaryResp.data?.inputTokens ?? summaryResp.data?.prompt_eval_count,
  });

  if (!summaryOk) {
    console.error('\nSummary request failed; skipping title generation.');
  }

  if (summaryOk) {
    const { estimatedTokenCount: estimatedTitleTokens } = await templateSvc.buildTranscriptionTitleFromSummary(summaryText);

    const titleResp = await request('POST', '/api/agents/transcribe/title', { summary: summaryText, model: MODEL });
    const titleText = toText(titleResp.data?.response);
    const titleOk = titleResp.ok && !!titleText;

    entries.push({
      stage: 'title',
      title: titleText || 'No title returned',
      summary: summaryText,
      ok: titleOk,
      status: titleResp.status,
      error: titleResp.error || (!titleOk ? 'Expected title text in response' : undefined),
      durationMs: titleResp.elapsedMs,
      requestTimestamp: titleResp.timestamp,
      model: MODEL,
      serverName: titleResp.data?.serverName,
      estimatedTokens: estimatedTitleTokens,
      inputTokens: titleResp.data?.inputTokens ?? titleResp.data?.prompt_eval_count,
    });

    if (titleOk) {
      console.log(`\nTitle: ${titleText}`);
    }
  }

  if (summaryText) {
    const preview = summaryText.length > 300 ? `${summaryText.slice(0, 300)}...` : summaryText;
    console.log(`\nSummary (first 300 chars):\n${preview}`);
  }

  const failures = entries.filter(e => !e.ok);
  if (failures.length) {
    console.error(`\n${failures.length} request(s) failed.`);
    failures.forEach(f => console.error(`- ${f.stage}: ${f.error || 'Unknown failure'}`));
    process.exitCode = 1;
  } else {
    console.log('\nBoth requests succeeded.');
  }

  try {
    const { filePath, fileUrl } = await ReportService.generateTranscriptionReport(entries, {
      baseUrl: BASE_URL,
      model: MODEL,
      timestamp: new Date().toISOString(),
      transcriptPreview: fakeTranscript.slice(0, 120),
    });
    console.log(`\nReport written: ${filePath}`);
    console.log(`Open in browser: ${fileUrl}`);
  } catch (err) {
    console.error('Failed to write transcription report:', err);
  }
}

main().catch(err => {
  console.error('Unexpected error running transcription test:', err);
  process.exitCode = 1;
});

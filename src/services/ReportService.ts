import { promises as fs } from 'fs';
import * as path from 'path';
import { AppPaths } from '../config/AppPaths';

export interface ReportEntry {
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
  requestTimestamp?: string; // ISO string
}

export interface ReportMeta {
  baseUrl: string;
  serverName: string;
  modelPrimary: string;
  modelSecondary?: string;
  embedModel?: string;
  timeoutMs?: number;
  maxParallelPerServer?: number;
  timestamp: string; // ISO string
  totalDurationMs?: number;
}

export interface TranscriptionReportEntry {
  stage: string; // e.g., "summary" or "title"
  title?: string;
  summary?: string;
  ok: boolean;
  status?: number;
  error?: string;
  durationMs?: number;
  requestTimestamp?: string; // ISO string
  model?: string;
  serverName?: string;
  estimatedTokens?: number;
  inputTokens?: number;
}

export interface TranscriptionReportMeta {
  baseUrl: string;
  model: string;
  timestamp: string; // ISO string
  transcriptPreview?: string;
  fullTranscript?: string;
  summarizePrompt?: string;
}

export class ReportService {
  static async generate(entries: ReportEntry[], meta: ReportMeta): Promise<{ filePath: string; fileUrl: string; }> {
    const outDir = AppPaths.getReportsDir();
    await fs.mkdir(outDir, { recursive: true });

    const ts = ReportService.formatTimestampForFile(new Date(meta.timestamp));
    const fileName = `route-report-${ts}.html`;
    const filePath = path.join(outDir, fileName);

    const html = ReportService.buildHtml(entries, meta);
    await fs.writeFile(filePath, html, 'utf8');

    const fileUrl = ReportService.toFileUrl(filePath);
    return { filePath, fileUrl };
  }

  static async generateTranscriptionReport(entries: TranscriptionReportEntry[], meta: TranscriptionReportMeta): Promise<{ filePath: string; fileUrl: string; }> {
    const outDir = AppPaths.getReportsDir();
    await fs.mkdir(outDir, { recursive: true });

    const ts = ReportService.formatTimestampForFile(new Date(meta.timestamp));
    const fileName = `transcription-report-${ts}.html`;
    const filePath = path.join(outDir, fileName);

    const html = ReportService.buildTranscriptionHtml(entries, meta);
    await fs.writeFile(filePath, html, 'utf8');

    const fileUrl = ReportService.toFileUrl(filePath);
    return { filePath, fileUrl };
  }

  private static formatTimestampForFile(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }

  private static toFileUrl(p: string): string {
    const resolved = path.resolve(p);
    const withSlashes = resolved.replace(/\\/g, '/');
    // Ensure drive letter is preserved like C:/...
    if (/^[A-Za-z]:\//.test(withSlashes)) {
      return `file:///${withSlashes}`;
    }
    return `file://${withSlashes}`;
  }

  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private static summarize(entries: ReportEntry[]): { total: number; passed: number; failed: number; avgMs: number; maxMs: number; minMs: number; } {
    const total = entries.length;
    const passed = entries.filter(e => e.ok).length;
    const failed = total - passed;
    const times = entries.map(e => e.elapsedMs ?? 0).filter(n => typeof n === 'number');
    const sum = times.reduce((a, b) => a + b, 0);
    const avgMs = times.length ? Math.round(sum / times.length) : 0;
    const maxMs = times.length ? Math.max(...times) : 0;
    const minMs = times.length ? Math.min(...times) : 0;
    return { total, passed, failed, avgMs, maxMs, minMs };
  }

  private static buildHtml(entries: ReportEntry[], meta: ReportMeta): string {
    const summary = ReportService.summarize(entries);
    const title = `API Route Report — ${new Date(meta.timestamp).toLocaleString()}`;
    const totalDuration = meta.totalDurationMs ? `${(meta.totalDurationMs / 1000).toFixed(2)}s` : '—';

    // Group entries by groupId
    const groups: { [key: string]: ReportEntry[] } = {};
    const ungrouped: ReportEntry[] = [];

    entries.forEach(e => {
      if (e.groupId) {
        if (!groups[e.groupId]) groups[e.groupId] = [];
        groups[e.groupId].push(e);
      } else {
        ungrouped.push(e);
      }
    });

    const renderCard = (e: ReportEntry, isParallel = false) => {
      const statusBadgeClass = e.ok ? 'badge-ok' : 'badge-fail';
      const methodBadgeClass = `method-${e.method.toLowerCase()}`;
      const responseStr = e.responseData != null ? ReportService.escapeHtml(JSON.stringify(e.responseData, null, 2)) : '';
      const reqStr = e.requestBody != null ? ReportService.escapeHtml(JSON.stringify(e.requestBody, null, 2)) : '';
      let noteOrError = '';
      if (e.error) {
        noteOrError = `<div class="error-block">${ReportService.escapeHtml(e.error)}</div>`;
      } else if (e.note) {
        noteOrError = `<div class="note-block">${ReportService.escapeHtml(e.note)}</div>`;
      }
      const elapsed = typeof e.elapsedMs === 'number' ? `${e.elapsedMs}ms` : '—';
      const status = e.status != null ? e.status.toString() : '—';
      const isSlow = (e.elapsedMs ?? 0) > 1000;
      const timeClass = isSlow ? 'metric-highlight-warn' : 'metric-highlight';
      const serverName = e.serverName || 'N/A';
      
      // Extract model from request body
      const model = (e.requestBody?.model as string) || '—';
      
      // Format timestamp
      const requestTime = e.requestTimestamp ? new Date(e.requestTimestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

      return `
        <article class="card ${isParallel ? 'parallel-card' : ''}" data-ok="${e.ok}" data-method="${e.method}" data-status="${e.status ?? ''}" data-path="${ReportService.escapeHtml(e.path)}">
          <header class="card-head">
            <div class="left">
              <span class="badge ${methodBadgeClass}">${ReportService.escapeHtml(e.method)}</span>
              <h3 class="path">${ReportService.escapeHtml(e.path)}</h3>
            </div>
            <div class="right">
              <div class="time-container">
                <span class="label">Duration</span>
                <span class="${timeClass}">${elapsed}</span>
              </div>
              <span class="badge ${statusBadgeClass}">${e.ok ? 'PASSED' : 'FAILED'}</span>
            </div>
          </header>
          <div class="meta">
            <div class="meta-item">
              <span class="label">Test Case:</span>
              <span class="value">${ReportService.escapeHtml(e.name)}</span>
            </div>
            <div class="meta-item">
              <span class="label">Server:</span>
              <span class="value server-pill">${ReportService.escapeHtml(serverName)}</span>
            </div>
            ${model !== '—' ? `
            <div class="meta-item">
              <span class="label">Model:</span>
              <span class="value model-pill">${ReportService.escapeHtml(model)}</span>
            </div>` : ''}
            ${!e.ok ? `
            <div class="meta-item">
              <span class="label">Status:</span>
              <span class="value" style="color: var(--fail); font-weight: 700;">${status}</span>
            </div>` : ''}
            <div class="meta-item sent-item">
              <span class="label">Sent:</span>
              <span class="value time-pill">${requestTime}</span>
            </div>
            <div class="meta-item note-align">${noteOrError || '&nbsp;'}</div>
          </div>
          <details class="collapsed-details">
            <summary>Response</summary>
            <pre class="collapsed-pre">${responseStr || '<em>No response payload</em>'}</pre>
          </details>
          <details class="collapsed-details">
            <summary>Request</summary>
            <pre class="collapsed-pre">${reqStr || '<em>No request body</em>'}</pre>
          </details>
        </article>
      `;
    };

    let htmlContent = '';

    // Render ungrouped cards
    ungrouped.forEach(e => {
      htmlContent += renderCard(e);
    });

    // Render grouped cards
    Object.entries(groups).forEach(([groupId, groupEntries]) => {
      htmlContent += `
        <div class="parallel-group">
          <div class="group-header">
            <span class="group-label">Parallel Group: ${ReportService.escapeHtml(groupId)}</span>
            <span class="group-count">${groupEntries.length} requests</span>
          </div>
          <div class="group-cards">
            ${groupEntries.map(e => renderCard(e, true)).join('')}
          </div>
        </div>
      `;
    });

    const style = `
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
        --card-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        --group-bg: rgba(138, 180, 248, 0.03);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 16px;
        font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
        background-color: var(--bg);
        color: var(--text);
        line-height: 1.5;
      }
      header.page-header {
        display: flex; justify-content: space-between; align-items: flex-end;
        margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px;
      }
      .header-left .title { font-size: 28px; font-weight: 800; letter-spacing: -0.025em; margin-bottom: 2px; }
      .header-left .subtitle { color: var(--text-muted); font-size: 13px; }
      
      .summary-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 16px;
      }
      .summary-tile {
        background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 10px 8px;
        box-shadow: var(--card-shadow);
      }
      .summary-tile .label { color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
      .summary-tile .value { font-size: 22px; font-weight: 700; }
      .summary-tile.ok .value { color: var(--ok); }
      .summary-tile.fail .value { color: var(--fail); }
      .summary-tile.highlight .value { color: var(--accent); }

      .controls { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
      .controls input, .controls select {
        background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 7px; padding: 6px 10px; font-size: 13px; outline: none;
      }
      .controls input:focus { border-color: var(--accent); }
      .controls input[type="search"] { flex-grow: 1; }

      .results-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
      @media (min-width: 1200px) { .results-grid { grid-template-columns: 1fr 1fr; } }

      .parallel-group {
        grid-column: 1 / -1;
        background: var(--group-bg);
        border: 1px dashed var(--accent);
        border-radius: 16px;
        padding: 12px;
        margin-bottom: 8px;
      }
      .group-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        padding: 0 4px;
      }
      .group-label {
        font-size: 12px;
        font-weight: 700;
        color: var(--accent);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .group-count {
        font-size: 11px;
        color: var(--text-muted);
        background: rgba(255,255,255,0.05);
        padding: 2px 8px;
        border-radius: 10px;
      }
      .group-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
        gap: 10px;
      }

      .card {
        background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
        transition: transform 0.2s, background-color 0.2s; box-shadow: var(--card-shadow);
      }
      .card:hover { background-color: var(--panel-hover); }
      .card-head {
        display: flex; justify-content: space-between; align-items: center; padding: 8px 10px;
        border-bottom: 1px solid var(--border);
      }
      .card-head .left { display: flex; align-items: center; gap: 8px; }
      .card-head .path { font-size: 13px; font-weight: 600; margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      .card-head .right { display: flex; align-items: center; gap: 10px; }

      .time-container { text-align: right; }
      .time-container .label { display: block; font-size: 9px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
      .metric-highlight { font-size: 14px; font-weight: 700; color: var(--accent); }
      .metric-highlight-warn { font-size: 14px; font-weight: 700; color: var(--warn); }

      .badge { padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.025em; }
      .badge-ok { background: rgba(16, 185, 129, 0.1); color: var(--ok); border: 1px solid rgba(16, 185, 129, 0.2); }
      .badge-fail { background: rgba(239, 68, 68, 0.1); color: var(--fail); border: 1px solid rgba(239, 68, 68, 0.2); }
      .method-get { background: rgba(138, 180, 248, 0.15); color: var(--accent); border: 1px solid rgba(138, 180, 248, 0.2); }
      .method-post { background: rgba(245, 158, 11, 0.1); color: var(--warn); border: 1px solid rgba(245, 158, 11, 0.2); }

      .meta { padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 16px; background: rgba(0,0,0,0.2); align-items: flex-end; }
      .meta-item .label { font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 1px; }
      .meta-item .value { font-size: 12px; font-weight: 500; }
      .meta-item.sent-item { margin-left: auto; text-align: right; }
      
      .server-pill {
        color: var(--accent);
        font-weight: 700;
        background: rgba(138, 180, 248, 0.1);
        padding: 1px 6px;
        border-radius: 4px;
        border: 1px solid rgba(138, 180, 248, 0.2);
      }
      .model-pill {
        color: #a78bfa;
        font-weight: 700;
        background: rgba(167, 139, 250, 0.1);
        padding: 1px 6px;
        border-radius: 4px;
        border: 1px solid rgba(167, 139, 250, 0.2);
      }
      .time-pill {
        color: #4ade80;
        font-weight: 600;
        font-family: ui-monospace, monospace;
        font-size: 11px;
      }

      .note-block {
        color: var(--accent);
        font-weight: 500;
        font-size: 12px;
        display: block;
        word-break: break-word;
        white-space: pre-line;
        min-height: 16px;
        margin: 0;
      }
      .error-block {
        color: var(--fail);
        font-weight: 500;
        font-size: 12px;
        display: block;
        word-break: break-word;
        white-space: pre-line;
        min-height: 16px;
        margin: 0;
        background: rgba(239, 68, 68, 0.08);
        border-left: 3px solid var(--fail);
        border-radius: 3px;
        padding: 2px 0 2px 6px;
      }
      .meta-item.note-align {
        flex-basis: 100%;
        min-height: 16px;
        margin-top: 1px;
        margin-bottom: 1px;
        display: block;
      }

      .collapsed-details {
        margin: 0 10px 6px 10px;
        font-size: 12px;
      }
      .collapsed-details summary {
        cursor: pointer;
        color: var(--accent);
        font-size: 12px;
        font-weight: 500;
        padding: 3px 0;
        outline: none;
      }
      .collapsed-pre {
        margin: 0; padding: 6px 8px; background: var(--code-bg); overflow: auto; max-height: 220px;
        font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        border-top: 1px solid var(--border);
        color: var(--accent);
        border-radius: 5px;
      }

      footer.page-footer {
        margin-top: 24px; padding-top: 10px; border-top: 1px solid var(--border);
        color: var(--text-muted); font-size: 12px; display: flex; justify-content: space-between;
      }
    `;

    const filterScript = `
      const q = (sel) => document.querySelector(sel);
      const qa = (sel) => Array.from(document.querySelectorAll(sel));
      const applyFilter = () => {
        const show = q('#filter-show').value;
        const method = q('#filter-method').value;
        const search = q('#filter-search').value.trim().toLowerCase();
        qa('.card').forEach(card => {
          const isOk = card.dataset.ok === 'true';
          const m = card.dataset.method.toUpperCase();
          const p = (card.dataset.path || '').toLowerCase();
          let visible = true;
          if (show === 'ok' && !isOk) visible = false;
          if (show === 'fail' && isOk) visible = false;
          if (method !== 'all' && m !== method) visible = false;
          if (search && !p.includes(search)) visible = false;
          card.style.display = visible ? '' : 'none';
        });
        // Hide empty groups
        qa('.parallel-group').forEach(group => {
          const visibleCards = Array.from(group.querySelectorAll('.card')).filter(c => c.style.display !== 'none');
          group.style.display = visibleCards.length > 0 ? '' : 'none';
        });
      };
      ['change', 'input'].forEach(evt => {
        q('#filter-show').addEventListener(evt, applyFilter);
        q('#filter-method').addEventListener(evt, applyFilter);
        q('#filter-search').addEventListener(evt, applyFilter);
      });
      applyFilter();
    `;

    return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${ReportService.escapeHtml(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>${style}</style>
      </head>
      <body>
        <header class="page-header">
          <div class="header-left">
            <div class="title">API Test Dashboard</div>
            <div class="subtitle">
              ${ReportService.escapeHtml(new Date(meta.timestamp).toLocaleString())} • 
              Target: <span style="color: var(--text)">${ReportService.escapeHtml(meta.baseUrl)}</span> • 
              Server: <span style="color: var(--text)">${ReportService.escapeHtml(meta.serverName)}</span>
            </div>
          </div>
          <div class="header-right">
            <div class="controls">
              <select id="filter-show">
                <option value="all">All Results</option>
                <option value="ok">Passed</option>
                <option value="fail">Failed</option>
              </select>
              <select id="filter-method">
                <option value="all">All Methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
              <input id="filter-search" type="search" placeholder="Search endpoints..." />
            </div>
          </div>
        </header>

        <section class="summary-grid">
          <div class="summary-tile highlight"><div class="label">Total Tests</div><div class="value">${summary.total}</div></div>
          <div class="summary-tile ok"><div class="label">Passed</div><div class="value">${summary.passed}</div></div>
          <div class="summary-tile fail"><div class="label">Failed</div><div class="value">${summary.failed}</div></div>
          <div class="summary-tile"><div class="label">Avg Response</div><div class="value">${summary.avgMs}ms</div></div>
          <div class="summary-tile"><div class="label">Slowest</div><div class="value">${summary.maxMs}ms</div></div>
          <div class="summary-tile highlight"><div class="label">Total Duration</div><div class="value">${totalDuration}</div></div>
        </section>

        <section class="results-grid">
          ${htmlContent}
        </section>

        <footer class="page-footer">
          <div>
            Models: <strong>${ReportService.escapeHtml(meta.modelPrimary)}</strong>
            ${meta.modelSecondary ? ' / ' + ReportService.escapeHtml(meta.modelSecondary) : ''}
            ${meta.embedModel ? ' • Embedding: ' + ReportService.escapeHtml(meta.embedModel) : ''}
            ${meta.maxParallelPerServer ? ' • Max Parallel: ' + meta.maxParallelPerServer : ''}
          </div>
          <div>Timeout: ${meta.timeoutMs ?? '—'}ms</div>
        </footer>

        <script>${filterScript}</script>
      </body>
    </html>`;
  }

  private static buildTranscriptionHtml(entries: TranscriptionReportEntry[], meta: TranscriptionReportMeta): string {
    const title = `Transcription Report — ${new Date(meta.timestamp).toLocaleString()}`;

    const summaryEntry = entries.find(e => e.stage.toLowerCase() === 'summary');
    const titleEntry = entries.find(e => e.stage.toLowerCase() === 'title');
    const combinedTitle = titleEntry?.title || titleEntry?.summary || summaryEntry?.title || 'Summary and Title';
    const combinedSummary = summaryEntry?.summary || titleEntry?.summary || '';

    const style = `
      :root {
        --bg: #0a0d12;
        --panel: #101621;
        --panel-soft: #0f1320;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --accent: #7dd3fc;
        --accent-2: #c084fc;
        --ok: #22c55e;
        --fail: #ef4444;
        --border: #1f2937;
        --shadow: 0 14px 40px rgba(0,0,0,0.35);
      }
      body {
        margin: 0;
        padding: 18px;
        font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
        background:
          radial-gradient(circle at 20% 20%, rgba(125, 211, 252, 0.08), transparent 30%),
          radial-gradient(circle at 80% 0%, rgba(192, 132, 252, 0.07), transparent 25%),
          var(--bg);
        color: var(--text);
      }
      header.page-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 14px;
      }
      .title { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
      .subtitle { color: var(--muted); font-size: 12px; }
      .pill { display: inline-block; padding: 6px 12px; border-radius: 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--text); font-size: 12px; }

      .combined-card {
        background: linear-gradient(135deg, rgba(125, 211, 252, 0.08), rgba(192, 132, 252, 0.05));
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 14px 16px;
        box-shadow: var(--shadow);
        margin-bottom: 14px;
      }
      .combined-card h2 { margin: 0 0 6px 0; font-size: 20px; letter-spacing: -0.01em; }
      .combined-card .body-text { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text); white-space: pre-wrap; }

      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 12px 14px 12px;
        box-shadow: var(--shadow);
      }
      .card header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
      .card h3 { margin: 0; font-size: 15px; letter-spacing: -0.01em; }
      .stage { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
      .badge { padding: 3px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; border: 1px solid var(--border); }
      .badge.ok { color: var(--ok); background: rgba(34,197,94,0.12); border-color: rgba(34,197,94,0.35); }
      .badge.fail { color: var(--fail); background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.35); }

      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px;
        margin: 8px 0 10px 0;
        font-size: 12px;
      }
      .meta .label { color: var(--muted); font-size: 11px; }
      .meta .value { color: var(--text); font-weight: 700; font-size: 13px; }
      .meta .value.muted { color: var(--muted); font-weight: 500; }

      .tokens { display: flex; gap: 10px; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
      .tokens .value { color: var(--text); font-weight: 700; }

      .summary {
        background: var(--panel-soft);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        color: var(--text);
        line-height: 1.5;
      }
      .collapsed-section {
        margin-top: 10px;
        font-size: 12px;
      }
      .collapsed-section summary {
        cursor: pointer;
        color: var(--accent);
        font-weight: 500;
        padding: 3px 0;
        outline: none;
      }
      .collapsed-section pre {
        margin: 8px 0 0 0;
        padding: 8px;
        background: var(--panel-soft);
        border: 1px solid var(--border);
        border-radius: 8px;
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        overflow-x: auto;
        max-height: 300px;
        overflow-y: auto;
        color: var(--text);
      }
    `;

    const cards = entries.map(e => {
      const statusClass = e.ok ? 'ok' : 'fail';
      const statusLabel = e.ok ? 'Passed' : 'Failed';
      const titleLabel = e.title ? ReportService.escapeHtml(e.title) : 'Response';
      const summarySource = e.stage.toLowerCase() === 'summary' && meta.transcriptPreview ? meta.transcriptPreview : (e.summary || '');
      const summaryTruncated = summarySource.length > 320 ? `${summarySource.slice(0, 320)}...` : summarySource;
      const summary = summaryTruncated ? ReportService.escapeHtml(summaryTruncated) : '<em>No content returned</em>';
      const when = e.requestTimestamp ? new Date(e.requestTimestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      const duration = typeof e.durationMs === 'number' ? `${e.durationMs}ms` : '—';
      const model = e.model || '—';
      const server = e.serverName || '—';
      const estimated = e.estimatedTokens != null ? e.estimatedTokens.toString() : '—';
      const inputTokens = e.inputTokens != null ? e.inputTokens.toString() : '—';
      const statusDetail = e.error ? ReportService.escapeHtml(e.error) : '';

      return `
        <article class="card">
          <header>
            <div>
              <div class="stage">${ReportService.escapeHtml(e.stage)}</div>
              <h3>${titleLabel}</h3>
            </div>
            <span class="badge ${statusClass}">${statusLabel}</span>
          </header>
          <div class="meta">
            <div><div class="label">Duration</div><div class="value">${ReportService.escapeHtml(duration)}</div></div>
            <div><div class="label">Server</div><div class="value">${ReportService.escapeHtml(server)}</div></div>
            <div><div class="label">Model</div><div class="value">${ReportService.escapeHtml(model)}</div></div>
            <div><div class="label">Status</div><div class="value">${ReportService.escapeHtml(e.status != null ? e.status.toString() : '—')}</div></div>
            <div><div class="label">Timestamp</div><div class="value muted">${ReportService.escapeHtml(when)}</div></div>
          </div>
          <div class="tokens">
            <div>Estimated tokens: <span class="value">${ReportService.escapeHtml(estimated)}</span></div>
            <div>Input tokens: <span class="value">${ReportService.escapeHtml(inputTokens)}</span></div>
          </div>
          ${statusDetail ? `<div style="color: var(--fail); font-size: 12px; margin: 6px 0;">${statusDetail}</div>` : ''}
          <div class="summary">${summary}</div>
          ${e.stage.toLowerCase() === 'summary' && meta.fullTranscript ? `
            <details class="collapsed-section">
              <summary>Full Transcript</summary>
              <pre>${ReportService.escapeHtml(meta.fullTranscript)}</pre>
            </details>
          ` : ''}
          ${e.stage.toLowerCase() === 'summary' && meta.summarizePrompt ? `
            <details class="collapsed-section">
              <summary>Raw Summarize Prompt</summary>
              <pre>${ReportService.escapeHtml(meta.summarizePrompt)}</pre>
            </details>
          ` : ''}
        </article>
      `;
    }).join('\n');

    const transcriptPreview = meta.transcriptPreview ? ReportService.escapeHtml(meta.transcriptPreview) : '—';
    const combinedCard = combinedSummary
      ? `<section class="combined-card">
          <h2>${ReportService.escapeHtml(combinedTitle)}</h2>
          <p class="body-text">${ReportService.escapeHtml(combinedSummary)}</p>
        </section>`
      : '';

    return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${ReportService.escapeHtml(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style>${style}</style>
      </head>
      <body>
        <header class="page-header">
          <div>
            <div class="title">Transcription Summary Run</div>
            <div class="subtitle">Target: ${ReportService.escapeHtml(meta.baseUrl)} • Model: ${ReportService.escapeHtml(meta.model)}</div>
          </div>
          <div class="pill">Transcript preview: ${transcriptPreview}</div>
        </header>
        ${combinedCard}
        <section class="grid">${cards}</section>
      </body>
    </html>`;
  }
}

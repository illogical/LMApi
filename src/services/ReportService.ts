import { promises as fs } from 'fs';
import * as path from 'path';

export interface ReportEntry {
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

export interface ReportMeta {
  baseUrl: string;
  serverName: string;
  modelPrimary: string;
  modelSecondary?: string;
  embedModel?: string;
  timeoutMs?: number;
  timestamp: string; // ISO string
}

export class ReportService {
  static async generate(entries: ReportEntry[], meta: ReportMeta): Promise<{ filePath: string; fileUrl: string; }> {
    const outDir = path.resolve(process.cwd(), 'logs');
    await fs.mkdir(outDir, { recursive: true });

    const ts = ReportService.formatTimestampForFile(new Date(meta.timestamp));
    const fileName = `route-report-${ts}.html`;
    const filePath = path.join(outDir, fileName);

    const html = ReportService.buildHtml(entries, meta);
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

    const cards = entries.map((e, idx) => {
      const statusBadgeClass = e.ok ? 'badge-ok' : 'badge-fail';
      const methodBadgeClass = `method-${e.method.toLowerCase()}`;
      const responseStr = e.responseData != null ? ReportService.escapeHtml(JSON.stringify(e.responseData, null, 2)) : '';
      const reqStr = e.requestBody != null ? ReportService.escapeHtml(JSON.stringify(e.requestBody, null, 2)) : '';
      const note = e.note ? `<span class="note">${ReportService.escapeHtml(e.note)}</span>` : '';
      const error = e.error ? `<div class="error">${ReportService.escapeHtml(e.error)}</div>` : '';
      const elapsed = typeof e.elapsedMs === 'number' ? `${e.elapsedMs} ms` : '—';
      const status = e.status != null ? e.status.toString() : '—';
      return `
        <article class="card" data-ok="${e.ok}" data-method="${e.method}" data-status="${e.status ?? ''}" data-path="${ReportService.escapeHtml(e.path)}">
          <header class="card-head">
            <div class="left">
              <span class="badge ${methodBadgeClass}">${ReportService.escapeHtml(e.method)}</span>
              <h3 class="path">${ReportService.escapeHtml(e.path)}</h3>
            </div>
            <div class="right">
              <span class="badge ${statusBadgeClass}">${e.ok ? 'OK' : 'FAIL'}</span>
              <span class="metric">Status: ${status}</span>
              <span class="metric">Time: ${elapsed}</span>
            </div>
          </header>
          <div class="meta">
            <span class="name">${ReportService.escapeHtml(e.name)}</span>
            ${note}
          </div>
          ${error}
          <details class="details">
            <summary>Response</summary>
            <pre>${responseStr || '<em>No response payload</em>'}</pre>
          </details>
          <details class="details">
            <summary>Request Body</summary>
            <pre>${reqStr || '<em>No request body</em>'}</pre>
          </details>
        </article>
      `;
    }).join('\n');

    const style = `
      :root {
        --bg: #0b0f14;
        --panel: #121821;
        --panel-2: #0f141d;
        --text: #d6e0f0;
        --muted: #9fb3c8;
        --ok: #2ecc71;
        --fail: #ff6b6b;
        --accent: #8ab4f8;
        --yellow: #f4d03f;
        --border: #1e293b;
        --code-bg: #0a0f14;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0; padding: 24px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Helvetica Neue", "Apple Color Emoji", "Segoe UI Emoji";
        background: radial-gradient(1200px 800px at 0% 0%, #0d1420 0%, var(--bg) 50%, var(--bg) 100%);
        color: var(--text);
      }
      header.page {
        display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; margin-bottom: 16px;
      }
      .title { font-size: 20px; font-weight: 600; }
      .subtitle { color: var(--muted); font-size: 13px; }
      .summary {
        display: grid; grid-template-columns: repeat(5, minmax(140px, 1fr)); gap: 12px; margin: 16px 0 20px;
      }
      .summary .tile { background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .tile .label { color: var(--muted); font-size: 12px; }
      .tile .value { font-size: 22px; font-weight: 700; }
      .tile.ok .value { color: var(--ok); }
      .tile.fail .value { color: var(--fail); }
      .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
      .controls input, .controls select, .controls button {
        background: var(--panel-2); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font-size: 13px;
      }
      .controls button.filter { cursor: pointer; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
      @media (min-width: 900px) {
        .grid { grid-template-columns: 1fr 1fr; }
      }
      .card { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%); }
      .card-head { display: grid; grid-template-columns: 1fr auto; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); }
      .card .left { display: flex; gap: 8px; align-items: center; }
      .card .path { font-size: 15px; margin: 0; }
      .card .right { display: flex; gap: 10px; align-items: center; }
      .badge { padding: 4px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border); }
      .badge-ok { background: rgba(46, 204, 113, 0.15); color: var(--ok); border-color: rgba(46, 204, 113, 0.3); }
      .badge-fail { background: rgba(255, 107, 107, 0.15); color: var(--fail); border-color: rgba(255, 107, 107, 0.3); }
      .method-get { background: rgba(138, 180, 248, 0.15); color: var(--accent); }
      .method-post { background: rgba(244, 208, 63, 0.15); color: var(--yellow); }
      .metric { color: var(--muted); font-size: 12px; }
      .meta { padding: 8px 14px; color: var(--muted); font-size: 13px; display: flex; gap: 10px; }
      .meta .name { color: var(--text); }
      .note { background: rgba(138, 180, 248, 0.12); color: var(--accent); padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(138, 180, 248, 0.25); }
      .error { margin: 8px 14px; color: var(--fail); font-size: 13px; }
      .details { border-top: 1px dashed var(--border); }
      .details summary { cursor: pointer; padding: 10px 14px; font-size: 13px; color: var(--muted); }
      .details pre { margin: 0; padding: 12px 14px; background: var(--code-bg); overflow: auto; max-height: 320px; font-size: 12px; border-top: 1px solid var(--border); }
      footer.page { margin-top: 24px; color: var(--muted); font-size: 12px; }
    `;

    const filterScript = `
      const q = (sel) => document.querySelector(sel);
      const qa = (sel) => Array.from(document.querySelectorAll(sel));
      const applyFilter = () => {
        const show = q('#filter-show').value; // all|ok|fail
        const method = q('#filter-method').value; // all|GET|POST
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
        <style>${style}</style>
      </head>
      <body>
        <header class="page">
          <div>
            <div class="title">API Route Report</div>
            <div class="subtitle">${ReportService.escapeHtml(new Date(meta.timestamp).toLocaleString())} • Target: ${ReportService.escapeHtml(meta.baseUrl)} • Server: ${ReportService.escapeHtml(meta.serverName)}</div>
          </div>
          <div class="controls">
            <select id="filter-show" title="Show">
              <option value="all">All</option>
              <option value="ok">Success</option>
              <option value="fail">Failures</option>
            </select>
            <select id="filter-method" title="Method">
              <option value="all">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <input id="filter-search" type="search" placeholder="Search path…" />
          </div>
        </header>

        <section class="summary">
          <div class="tile"><div class="label">Total</div><div class="value">${summary.total}</div></div>
          <div class="tile ok"><div class="label">Passed</div><div class="value">${summary.passed}</div></div>
          <div class="tile fail"><div class="label">Failed</div><div class="value">${summary.failed}</div></div>
          <div class="tile"><div class="label">Avg Time</div><div class="value">${summary.avgMs} ms</div></div>
          <div class="tile"><div class="label">Slowest</div><div class="value">${summary.maxMs} ms</div></div>
        </section>

        <section class="grid">
          ${cards}
        </section>

        <footer class="page">
          Models: ${ReportService.escapeHtml(meta.modelPrimary)}${meta.modelSecondary ? ', ' + ReportService.escapeHtml(meta.modelSecondary) : ''}${meta.embedModel ? ' • Embedding: ' + ReportService.escapeHtml(meta.embedModel) : ''} • Timeout: ${meta.timeoutMs ?? '—'} ms
        </footer>

        <script>${filterScript}</script>
      </body>
    </html>`;
  }
}

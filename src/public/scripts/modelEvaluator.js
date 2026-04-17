// Model Evaluator — ES module

const EVAL_EVENTS = {
    LANE_STARTED: 'eval_lane_started',
    LANE_COMPLETED: 'eval_lane_completed',
    ALL_COMPLETED: 'eval_all_completed',
};

// ── State ───────────────────────────────────────────────────────────────────
let lanes = []; // { el, model, state, timerId }
let activeGroupId = null;
let isRunning = false;
let loadedModels = [];
let servers = [];

// ── Socket ──────────────────────────────────────────────────────────────────
const socket = window.io ? window.io() : null;
if (socket) {
    socket.on(EVAL_EVENTS.LANE_STARTED, (data) => {
        if (data.groupId !== activeGroupId) return;
        const lane = lanes.find(l => l.model === data.model);
        if (lane) setLaneLoading(lane);
    });
    socket.on(EVAL_EVENTS.LANE_COMPLETED, (data) => {
        if (data.groupId !== activeGroupId) return;
        const lane = lanes.find(l => l.model === data.model);
        if (lane) setLaneComplete(lane, data.result);
    });
    socket.on(EVAL_EVENTS.ALL_COMPLETED, (data) => {
        if (data.groupId !== activeGroupId) return;
        finishEval(data);
    });
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const promptTextarea = document.getElementById('prompt-textarea');
const filePicker = document.getElementById('file-picker');
const browseBtn = document.getElementById('browse-btn');
const filePathInput = document.getElementById('file-path-input');
const fileClearBtn = document.getElementById('file-clear-btn');
const fileError = document.getElementById('file-error');
const viewFullBtn = document.getElementById('view-full-btn');
const compareBtn = document.getElementById('compare-btn');
const resetBtn = document.getElementById('reset-btn');
const lanesContainer = document.getElementById('lanes-container');
const addLaneBtn = document.getElementById('add-lane-btn');
const summaryPanel = document.getElementById('summary-panel');
const summaryTableWrap = document.getElementById('summary-table-wrap');
const summaryReportPath = document.getElementById('summary-report-path');
const modalOverlay = document.getElementById('eval-modal-overlay');
const modalContent = document.getElementById('eval-modal-content');
const modalClose = document.getElementById('eval-modal-close');
const toastEl = document.getElementById('toast');

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, isError = false) {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' toast-error' : '') + ' toast-visible';
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3000);
}

// ── Prompt Modal ──────────────────────────────────────────────────────────────
viewFullBtn.addEventListener('click', () => {
    modalContent.textContent = promptTextarea.value || '(empty)';
    modalOverlay.style.display = 'flex';
    modalClose.focus();
});
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
function closeModal() { modalOverlay.style.display = 'none'; }

// ── File handling ─────────────────────────────────────────────────────────────
browseBtn.addEventListener('click', () => filePicker.click());

filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    filePathInput.value = file.name;
    fileClearBtn.style.display = '';
    const reader = new FileReader();
    reader.onload = (e) => { promptTextarea.value = e.target.result; updateCompareBtn(); };
    reader.readAsText(file);
    clearFileError();
});

filePathInput.addEventListener('blur', async () => {
    const p = filePathInput.value.trim();
    if (!p) return;
    clearFileError();
    fileClearBtn.style.display = '';
    try {
        const r = await fetch('/api/evaluate/file?path=' + encodeURIComponent(p));
        const data = await r.json();
        if (!r.ok) { showFileError(data.error || r.statusText); return; }
        promptTextarea.value = data.content;
        updateCompareBtn();
    } catch (e) {
        showFileError('Network error: ' + e.message);
    }
});

fileClearBtn.addEventListener('click', () => {
    filePathInput.value = '';
    fileClearBtn.style.display = 'none';
    filePicker.value = '';
    clearFileError();
});

function showFileError(msg) {
    fileError.textContent = msg;
    fileError.style.display = '';
}
function clearFileError() {
    fileError.style.display = 'none';
    fileError.textContent = '';
}

promptTextarea.addEventListener('input', updateCompareBtn);

function updateCompareBtn() {
    const hasPrompt = promptTextarea.value.trim().length > 0;
    const hasModels = lanes.some(l => l.state !== 'chooser');
    compareBtn.disabled = !hasPrompt || !hasModels || isRunning;
}

// ── Add Lane ──────────────────────────────────────────────────────────────────
addLaneBtn.addEventListener('click', addLane);

function addLane() {
    const laneEl = document.createElement('div');
    laneEl.className = 'eval-lane';

    const lane = { el: laneEl, model: null, state: 'chooser', timerId: null };
    lanes.push(lane);

    lanesContainer.insertBefore(laneEl, addLaneBtn);
    renderChooser(lane);
    fetchModels();
    return lane;
}

function removeLane(lane) {
    clearTimer(lane);
    lane.el.remove();
    lanes = lanes.filter(l => l !== lane);
    updateCompareBtn();
}

function clearTimer(lane) {
    if (lane.timerId) { clearInterval(lane.timerId); lane.timerId = null; }
}

// ── Model Chooser ─────────────────────────────────────────────────────────────
async function fetchModels() {
    if (loadedModels.length > 0) return;
    try {
        const [modelsRes, serversRes] = await Promise.all([
            fetch('/api/models/loaded'),
            fetch('/api/servers')
        ]);
        const modelsData = await modelsRes.json();
        const serversData = await serversRes.json();
        loadedModels = modelsData.models || [];
        servers = serversData.servers || [];
        lanes.filter(l => l.state === 'chooser').forEach(renderChooser);
    } catch (e) {
        console.error('Failed to fetch models/servers', e);
    }
}

function renderChooser(lane) {
    lane.state = 'chooser';
    lane.model = null;
    const el = lane.el;
    el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'eval-lane-header';
    header.innerHTML = `<span class="eval-lane-title muted">Choose a model</span>
      <button class="icon-btn" title="Remove lane">✕</button>`;
    header.querySelector('button').addEventListener('click', () => removeLane(lane));
    el.appendChild(header);

    const filter = document.createElement('input');
    filter.type = 'text';
    filter.placeholder = 'Filter models…';
    filter.className = 'eval-chooser-filter';
    el.appendChild(filter);

    const list = document.createElement('div');
    list.className = 'chooser-model-list';
    el.appendChild(list);

    function renderList(query) {
        list.innerHTML = '';
        const q = query.toLowerCase();
        const filtered = loadedModels.filter(m => {
            const name = m.name || m;
            return !q || name.toLowerCase().includes(q);
        });

        if (filtered.length === 0) {
            list.innerHTML = '<div class="chooser-empty">No models found</div>';
            return;
        }

        filtered.forEach(m => {
            const name = m.name || m;
            const modelServers = servers.filter(s => s.models && s.models.includes(name));
            const row = document.createElement('div');
            row.className = 'chooser-model-row';

            const pills = modelServers.map(s =>
                `<span class="model-pill">${s.name || s}</span>`
            ).join('');
            const multi = modelServers.length >= 2
                ? `<span class="model-pill multi-server">×${modelServers.length}</span>` : '';

            row.innerHTML = `<span class="chooser-model-name">${name}</span><span class="chooser-model-pills">${pills}${multi}</span>`;
            row.addEventListener('click', () => selectModel(lane, name));
            list.appendChild(row);
        });
    }

    renderList('');
    filter.addEventListener('input', () => renderList(filter.value));
}

function selectModel(lane, modelName) {
    lane.model = modelName;
    setLaneIdle(lane);
    updateCompareBtn();
}

// ── Lane States ───────────────────────────────────────────────────────────────
function setLaneIdle(lane) {
    lane.state = 'idle';
    clearTimer(lane);
    const el = lane.el;
    el.className = 'eval-lane';
    el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'eval-lane-header';
    header.innerHTML = `
      <span class="eval-lane-title">${lane.model}</span>
      <div style="display:flex;gap:4px">
        <button class="icon-btn swap-btn" title="Change model" ${isRunning ? 'disabled' : ''}>⇄</button>
        <button class="icon-btn remove-btn" title="Remove lane">✕</button>
      </div>`;
    header.querySelector('.swap-btn').addEventListener('click', () => {
        if (!isRunning) renderChooser(lane);
    });
    header.querySelector('.remove-btn').addEventListener('click', () => removeLane(lane));
    el.appendChild(header);

    const status = document.createElement('div');
    status.className = 'lane-status muted';
    status.textContent = 'Ready — Server: —';
    el.appendChild(status);
}

function setLaneLoading(lane) {
    lane.state = 'loading';
    clearTimer(lane);
    const el = lane.el;
    el.className = 'eval-lane';
    el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'eval-lane-header';
    header.innerHTML = `<span class="eval-lane-title">${lane.model}</span>`;
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'lane-loading-body';

    const timerEl = document.createElement('div');
    timerEl.className = 'lane-timer';
    timerEl.textContent = '00:00.000';

    const spinner = document.createElement('div');
    spinner.className = 'lane-spinner';

    body.appendChild(spinner);
    body.appendChild(timerEl);
    el.appendChild(body);

    const started = Date.now();
    lane.timerId = setInterval(() => {
        const ms = Date.now() - started;
        timerEl.textContent = formatDuration(ms);
    }, 50);
}

function setLaneComplete(lane, result) {
    lane.state = result.error ? 'error' : 'complete';
    clearTimer(lane);
    const el = lane.el;
    el.className = 'eval-lane' + (result.error ? ' lane-error' : ' lane-complete-flash');
    el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'eval-lane-header';
    header.innerHTML = `
      <span class="eval-lane-title">${lane.model}</span>
      <div style="display:flex;gap:4px">
        <button class="icon-btn swap-btn" title="Change model" disabled>⇄</button>
        <button class="icon-btn remove-btn" title="Remove lane">✕</button>
      </div>`;
    header.querySelector('.remove-btn').addEventListener('click', () => removeLane(lane));
    el.appendChild(header);

    if (result.error) {
        const errEl = document.createElement('div');
        errEl.className = 'lane-error-msg';
        errEl.textContent = result.error;
        el.appendChild(errEl);
        return;
    }

    // Metrics
    const metrics = document.createElement('div');
    metrics.className = 'lane-metrics';

    const metricRows = [
        ['Duration', result.duration_ms != null ? result.duration_ms.toLocaleString() + ' ms' : '—'],
        ['Server', result.server_name || '—'],
        ['Tok/s', result.tokens_per_second != null ? result.tokens_per_second.toFixed(1) : '—'],
        ['Output tokens', result.output_tokens != null ? result.output_tokens.toLocaleString() : '—'],
        ['Input tokens', result.input_tokens != null ? result.input_tokens.toLocaleString() : '—'],
        ['Load time', result.load_duration_ms != null ? result.load_duration_ms.toLocaleString() + ' ms' : '—'],
        ['Gen time', result.eval_duration_ms != null ? result.eval_duration_ms.toLocaleString() + ' ms' : '—'],
        ['Finish', result.finish_reason || '—'],
    ];

    for (const [label, value] of metricRows) {
        const row = document.createElement('div');
        row.className = 'metric-row';
        if (label === 'Finish') {
            const badge = document.createElement('span');
            const reasonClass = result.finish_reason === 'stop' ? 'stop'
                : result.finish_reason === 'length' ? 'length'
                    : result.finish_reason === 'tool_calls' ? 'tool' : '';
            badge.className = `finish-badge ${reasonClass}`;
            badge.textContent = result.finish_reason || '—';
            row.innerHTML = `<span class="metric-label">${label}</span>`;
            row.appendChild(badge);
        } else {
            row.innerHTML = `<span class="metric-label">${label}</span><span class="metric-value">${value}</span>`;
        }
        metrics.appendChild(row);
    }
    el.appendChild(metrics);

    // Thinking section
    if (result.thinking) {
        const thinkSection = document.createElement('details');
        thinkSection.className = 'lane-thinking';
        thinkSection.innerHTML = `<summary>Thinking</summary><pre class="lane-response-text">${escapeHtml(result.thinking)}</pre>`;
        el.appendChild(thinkSection);
    }

    // Response text
    const responseEl = document.createElement('pre');
    responseEl.className = 'lane-response-text';
    responseEl.textContent = result.response_text || '(empty response)';
    el.appendChild(responseEl);

    // Tool calls
    if (result.tool_calls && result.tool_calls.length > 0) {
        const tcSection = document.createElement('details');
        tcSection.className = 'lane-thinking';
        tcSection.innerHTML = `<summary>Tool Calls</summary><pre class="lane-response-text">${escapeHtml(JSON.stringify(result.tool_calls, null, 2))}</pre>`;
        el.appendChild(tcSection);
    }
}

// ── Compare ───────────────────────────────────────────────────────────────────
compareBtn.addEventListener('click', async () => {
    const prompt = promptTextarea.value.trim();
    if (!prompt) return;

    const models = lanes.filter(l => l.state !== 'chooser' && l.model).map(l => l.model);
    if (models.length === 0) return;

    isRunning = true;
    summaryPanel.style.display = 'none';
    updateCompareBtn();
    compareBtn.disabled = true;

    activeGroupId = null;

    try {
        const res = await fetch('/api/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                models,
                generateReport: true,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            showToast('Evaluation failed: ' + (err.error || res.statusText), true);
            isRunning = false;
            updateCompareBtn();
            return;
        }

        const data = await res.json();
        activeGroupId = data.group_id;

        // If WebSocket events already fired before we got here, apply them from HTTP response
        if (data.results) {
            for (const result of data.results) {
                const lane = lanes.find(l => l.model === result.model);
                if (lane && lane.state !== 'complete' && lane.state !== 'error') {
                    setLaneComplete(lane, result);
                }
            }
            finishEval(data);
        }
    } catch (e) {
        showToast('Network error: ' + e.message, true);
        isRunning = false;
        updateCompareBtn();
    }
});

function finishEval(data) {
    isRunning = false;
    updateCompareBtn();

    if (data.report_path) {
        summaryReportPath.textContent = '📋 Saved: reports/' + data.report_path;
    } else {
        summaryReportPath.textContent = '';
    }

    if (data.results && data.results.length > 0) {
        renderSummaryTable(data.results);
        summaryPanel.style.display = '';
    }
}

function renderSummaryTable(results) {
    const sorted = [...results].sort((a, b) => (a.duration_ms || 0) - (b.duration_ms || 0));
    const rows = sorted.map(r => `
      <tr>
        <td>${escapeHtml(r.model)}</td>
        <td>${escapeHtml(r.server_name || '—')}</td>
        <td>${r.duration_ms != null ? r.duration_ms.toLocaleString() : '—'}</td>
        <td>${r.tokens_per_second != null ? r.tokens_per_second.toFixed(1) : '—'}</td>
        <td>${r.output_tokens != null ? r.output_tokens.toLocaleString() : '—'}</td>
        <td><span class="finish-badge ${r.finish_reason}">${escapeHtml(r.finish_reason || '—')}</span></td>
      </tr>`).join('');

    summaryTableWrap.innerHTML = `
      <table class="summary-table">
        <thead>
          <tr><th>Model</th><th>Server</th><th>Duration (ms)</th><th>Tok/s</th><th>Output Tokens</th><th>Finish</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
}

// ── Reset ─────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
    lanes.forEach(l => {
        clearTimer(l);
        l.el.remove();
    });
    lanes = [];
    activeGroupId = null;
    isRunning = false;
    summaryPanel.style.display = 'none';
    updateCompareBtn();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(ms) {
    const min = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const msPart = ms % 1000;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(msPart).padStart(3, '0')}`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Start with 2 lanes
addLane();
addLane();

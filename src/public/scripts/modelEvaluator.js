import { DashboardSocket } from './dashboardSocket.js';

const SOCKET_EVENTS = {
    EVAL_LANE_STARTED: 'eval_lane_started',
    EVAL_LANE_COMPLETED: 'eval_lane_completed',
    EVAL_ALL_COMPLETED: 'eval_all_completed',
};

class ModelEvaluator {
    constructor() {
        this.lanes = [];
        this.currentGroupId = null;
        this.socket = null;
        this.isEvaluating = false;
        
        this.initElements();
        this.initEventListeners();
        this.initWebSocket();
    }

    initElements() {
        // Prompt elements
        this.filePicker = document.getElementById('file-picker');
        this.browseBtn = document.getElementById('browse-btn');
        this.filePathInput = document.getElementById('file-path-input');
        this.clearFileBtn = document.getElementById('clear-file-btn');
        this.fileError = document.getElementById('file-error');
        this.promptTextarea = document.getElementById('prompt-textarea');
        this.viewFullBtn = document.getElementById('view-full-btn');
        
        // Controls
        this.resetBtn = document.getElementById('reset-btn');
        this.compareBtn = document.getElementById('compare-btn');
        
        // Lanes
        this.lanesContainer = document.getElementById('lanes-container');
        this.addLaneBtn = document.getElementById('add-lane-btn');
        
        // Summary
        this.summaryPanel = document.getElementById('summary-panel');
        this.reportPath = document.getElementById('report-path');
        this.summaryBody = document.getElementById('summary-body');
        
        // Modal
        this.promptModal = document.getElementById('prompt-modal');
        this.closeModalBtn = document.getElementById('close-modal-btn');
        this.modalPromptContent = document.getElementById('modal-prompt-content');
        
        // Toast
        this.toast = document.getElementById('toast');
    }

    initEventListeners() {
        // File handling
        this.browseBtn.addEventListener('click', () => this.filePicker.click());
        this.filePicker.addEventListener('change', (e) => this.handleFileSelect(e));
        this.filePathInput.addEventListener('blur', () => this.handleFilePathBlur());
        this.clearFileBtn.addEventListener('click', () => this.clearFile());
        
        // Prompt textarea
        this.promptTextarea.addEventListener('input', () => this.updateCompareButton());
        this.viewFullBtn.addEventListener('click', () => this.showPromptModal());
        
        // Controls
        this.resetBtn.addEventListener('click', () => this.resetLanes());
        this.compareBtn.addEventListener('click', () => this.startComparison());
        
        // Lanes
        this.addLaneBtn.addEventListener('click', () => this.addLane());
        
        // Modal
        this.closeModalBtn.addEventListener('click', () => this.hidePromptModal());
        this.promptModal.addEventListener('click', (e) => {
            if (e.target === this.promptModal) this.hidePromptModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.promptModal.style.display !== 'none') {
                this.hidePromptModal();
            }
        });
        
        // Refresh button
        document.getElementById('refresh-btn').addEventListener('click', () => location.reload());
    }

    initWebSocket() {
        this.socket = new DashboardSocket();
        
        this.socket.on(SOCKET_EVENTS.EVAL_LANE_STARTED, (data) => {
            if (data.group_id === this.currentGroupId) {
                this.handleLaneStarted(data);
            }
        });
        
        this.socket.on(SOCKET_EVENTS.EVAL_LANE_COMPLETED, (data) => {
            if (data.group_id === this.currentGroupId) {
                this.handleLaneCompleted(data);
            }
        });
        
        this.socket.on(SOCKET_EVENTS.EVAL_ALL_COMPLETED, (data) => {
            if (data.group_id === this.currentGroupId) {
                this.handleAllCompleted(data);
            }
        });
    }

    // File handling
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        this.filePathInput.value = file.name;
        this.hideFileError();
        
        try {
            const text = await file.text();
            this.promptTextarea.value = text;
            this.updateCompareButton();
        } catch (error) {
            this.showFileError(`Failed to read file: ${error.message}`);
        }
    }

    async handleFilePathBlur() {
        const path = this.filePathInput.value.trim();
        if (!path) return;
        
        this.hideFileError();
        
        try {
            const response = await fetch(`/api/evaluate/file?path=${encodeURIComponent(path)}`);
            const data = await response.json();
            
            if (!response.ok) {
                this.showFileError(data.error || 'Failed to load file');
                return;
            }
            
            this.promptTextarea.value = data.content;
            this.updateCompareButton();
        } catch (error) {
            this.showFileError(`Failed to load file: ${error.message}`);
        }
    }

    clearFile() {
        this.filePathInput.value = '';
        this.filePicker.value = '';
        this.hideFileError();
    }

    showFileError(message) {
        this.fileError.textContent = message;
        this.fileError.style.display = 'block';
    }

    hideFileError() {
        this.fileError.style.display = 'none';
    }

    // Prompt modal
    showPromptModal() {
        const prompt = this.promptTextarea.value;
        if (!prompt) return;
        
        this.modalPromptContent.textContent = prompt;
        this.promptModal.style.display = 'flex';
    }

    hidePromptModal() {
        this.promptModal.style.display = 'none';
    }

    // Lane management
    async addLane() {
        const lane = {
            id: `lane-${Date.now()}`,
            state: 'chooser', // chooser, idle, loading, complete, error
            model: null,
            element: null,
            timer: null,
            startTime: null,
        };
        
        this.lanes.push(lane);
        await this.renderLane(lane);
        this.updateCompareButton();
    }

    async renderLane(lane) {
        const laneEl = document.createElement('div');
        laneEl.id = lane.id;
        laneEl.className = 'lane panel';
        laneEl.style.cssText = 'width: 320px; flex-shrink: 0; min-height: 200px;';
        
        // Insert before the add button
        this.lanesContainer.insertBefore(laneEl, this.addLaneBtn);
        lane.element = laneEl;
        
        if (lane.state === 'chooser') {
            await this.renderChooserState(lane);
        } else if (lane.state === 'idle') {
            this.renderIdleState(lane);
        } else if (lane.state === 'loading') {
            this.renderLoadingState(lane);
        } else if (lane.state === 'complete') {
            this.renderCompleteState(lane);
        } else if (lane.state === 'error') {
            this.renderErrorState(lane);
        }
    }

    async renderChooserState(lane) {
        try {
            // Fetch models and servers
            const [modelsResp, serversResp] = await Promise.all([
                fetch('/api/models/loaded'),
                fetch('/api/servers')
            ]);
            
            const models = await modelsResp.json();
            const servers = await serversResp.json();
            
            // Build server map
            const modelServerMap = {};
            for (const server of servers) {
                if (!server.models) continue;
                for (const model of server.models) {
                    if (!modelServerMap[model]) {
                        modelServerMap[model] = [];
                    }
                    modelServerMap[model].push(server.name);
                }
            }
            
            // Sort models alphabetically
            const sortedModels = Object.keys(modelServerMap).sort();
            
            let html = `
                <div class="panel-head">
                    <span>Choose Model</span>
                    <button class="icon-btn lane-close-btn" data-lane-id="${lane.id}">✕</button>
                </div>
                <div style="padding: 12px;">
                    <input type="text" class="lane-filter" placeholder="🔍 Filter models..." 
                        style="width: 100%; padding: 8px; margin-bottom: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color); font-size: 14px;" />
                    <div class="chooser-model-list" style="max-height: 400px; overflow-y: auto;">
            `;
            
            for (const model of sortedModels) {
                const serverList = modelServerMap[model];
                const serverCount = serverList.length;
                
                html += `
                    <div class="chooser-model-item" data-model="${model}" style="padding: 8px; cursor: pointer; border-radius: 4px; margin-bottom: 4px;">
                        <div style="font-weight: 500; color: var(--text-color); margin-bottom: 4px;">${model}</div>
                        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                `;
                
                if (serverCount === 1) {
                    html += `<span class="model-pill" style="font-size: 11px; padding: 2px 6px; background: var(--muted-bg); color: var(--muted-color); border-radius: 3px;">${serverList[0]}</span>`;
                } else {
                    html += `<span class="model-pill" style="font-size: 11px; padding: 2px 6px; background: var(--accent-gold); color: var(--bg-color); border-radius: 3px; font-weight: 500;">×${serverCount}</span>`;
                    html += `<span class="model-pill" style="font-size: 11px; padding: 2px 6px; background: var(--muted-bg); color: var(--muted-color); border-radius: 3px;">${serverList[0]}</span>`;
                }
                
                html += `
                        </div>
                    </div>
                `;
            }
            
            html += `
                    </div>
                </div>
            `;
            
            lane.element.innerHTML = html;
            
            // Add event listeners
            const filterInput = lane.element.querySelector('.lane-filter');
            filterInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const items = lane.element.querySelectorAll('.chooser-model-item');
                items.forEach(item => {
                    const model = item.dataset.model.toLowerCase();
                    item.style.display = model.includes(query) ? 'block' : 'none';
                });
            });
            
            const modelItems = lane.element.querySelectorAll('.chooser-model-item');
            modelItems.forEach(item => {
                item.addEventListener('click', () => {
                    lane.model = item.dataset.model;
                    lane.state = 'idle';
                    this.renderIdleState(lane);
                    this.updateCompareButton();
                });
                
                item.addEventListener('mouseenter', () => {
                    item.style.background = 'var(--hover-bg)';
                });
                
                item.addEventListener('mouseleave', () => {
                    item.style.background = 'transparent';
                });
            });
            
            const closeBtn = lane.element.querySelector('.lane-close-btn');
            closeBtn.addEventListener('click', () => this.removeLane(lane.id));
            
        } catch (error) {
            console.error('Failed to load models:', error);
            this.showToast('Failed to load models');
        }
    }

    renderIdleState(lane) {
        let html = `
            <div class="panel-head">
                <div>
                    <div style="font-weight: 500; color: var(--text-color);">${lane.model}</div>
                    <div style="font-size: 12px; color: var(--muted-color); margin-top: 2px;">Server: —</div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="icon-btn lane-swap-btn" data-lane-id="${lane.id}" title="Change model">⇄</button>
                    <button class="icon-btn lane-close-btn" data-lane-id="${lane.id}">✕</button>
                </div>
            </div>
            <div style="padding: 16px; text-align: center; color: var(--muted-color);">
                <div style="font-size: 14px;">Ready</div>
            </div>
        `;
        
        lane.element.innerHTML = html;
        
        // Add event listeners
        const swapBtn = lane.element.querySelector('.lane-swap-btn');
        swapBtn.addEventListener('click', () => this.swapLaneModel(lane));
        
        const closeBtn = lane.element.querySelector('.lane-close-btn');
        closeBtn.addEventListener('click', () => this.removeLane(lane.id));
    }

    renderLoadingState(lane) {
        let html = `
            <div class="panel-head">
                <div>
                    <div style="font-weight: 500; color: var(--text-color);">${lane.model}</div>
                    <div style="font-size: 12px; color: var(--muted-color); margin-top: 2px;">Server: ${lane.serverName || '—'}</div>
                </div>
            </div>
            <div style="padding: 16px; text-align: center;">
                <div class="dot-pending" style="margin: 0 auto 12px;"></div>
                <div id="${lane.id}-timer" style="font-size: 20px; font-family: 'Courier New', monospace; color: var(--text-color);">00:00.000</div>
            </div>
        `;
        
        lane.element.innerHTML = html;
        
        // Start timer
        lane.startTime = Date.now();
        lane.timer = setInterval(() => {
            const elapsed = Date.now() - lane.startTime;
            const minutes = Math.floor(elapsed / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            const ms = elapsed % 1000;
            const timerEl = document.getElementById(`${lane.id}-timer`);
            if (timerEl) {
                timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
            }
        }, 16);
    }

    renderCompleteState(lane) {
        const result = lane.result;
        
        // Stop timer
        if (lane.timer) {
            clearInterval(lane.timer);
            lane.timer = null;
        }
        
        // Add flash animation
        lane.element.classList.add('lane-complete-flash');
        setTimeout(() => {
            lane.element.classList.remove('lane-complete-flash');
        }, 1000);
        
        const tokPerSec = result.tokens_per_second ? Math.round(result.tokens_per_second) : '—';
        const finishBadgeClass = result.finish_reason === 'stop' ? 'success' : (result.finish_reason === 'length' ? 'warning' : 'info');
        
        let html = `
            <div class="panel-head">
                <div>
                    <div style="font-weight: 500; color: var(--text-color);">${lane.model}</div>
                    <div style="font-size: 12px; color: var(--muted-color); margin-top: 2px;">Server: ${result.server_name}</div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="icon-btn lane-swap-btn" data-lane-id="${lane.id}" title="Change model">⇄</button>
                    <button class="icon-btn lane-close-btn" data-lane-id="${lane.id}">✕</button>
                </div>
            </div>
            <div style="padding: 12px; font-size: 13px;">
                <div class="metric-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                    <div><span style="color: var(--muted-color);">Duration:</span> <span style="color: var(--text-color);">${result.duration_ms.toLocaleString()} ms</span></div>
                    <div><span style="color: var(--muted-color);">Tokens/s:</span> <span style="color: var(--text-color);">${tokPerSec}</span></div>
                    <div><span style="color: var(--muted-color);">Output:</span> <span style="color: var(--text-color);">${result.output_tokens || '—'}</span></div>
                    <div><span style="color: var(--muted-color);">Input:</span> <span style="color: var(--text-color);">${result.input_tokens || '—'}</span></div>
                </div>
                <div style="margin-bottom: 8px;">
                    <span class="finish-badge ${finishBadgeClass}" style="font-size: 11px; padding: 3px 8px; border-radius: 3px;">${result.finish_reason}</span>
                </div>
        `;
        
        // Thinking section
        if (result.thinking) {
            html += `
                <details style="margin-bottom: 12px;">
                    <summary style="cursor: pointer; color: var(--muted-color); font-size: 12px; margin-bottom: 4px;">Thinking</summary>
                    <div class="lane-response-text" style="background: var(--code-bg); padding: 8px; border-radius: 4px; max-height: 150px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(result.thinking)}</div>
                </details>
            `;
        }
        
        // Tool calls section
        if (result.tool_calls && result.tool_calls.length > 0) {
            html += `
                <details style="margin-bottom: 12px;">
                    <summary style="cursor: pointer; color: var(--muted-color); font-size: 12px; margin-bottom: 4px;">Tool Calls</summary>
                    <div class="lane-response-text" style="background: var(--code-bg); padding: 8px; border-radius: 4px; max-height: 150px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 11px; white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(JSON.stringify(result.tool_calls, null, 2))}</div>
                </details>
            `;
        }
        
        // Response text
        html += `
                <div style="margin-bottom: 4px; color: var(--muted-color); font-size: 12px;">Response:</div>
                <div class="lane-response-text" style="background: var(--code-bg); padding: 12px; border-radius: 4px; max-height: 400px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 12px; white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(result.response_text)}</div>
            </div>
        `;
        
        lane.element.innerHTML = html;
        
        // Add event listeners
        const swapBtn = lane.element.querySelector('.lane-swap-btn');
        swapBtn.addEventListener('click', () => this.swapLaneModel(lane));
        
        const closeBtn = lane.element.querySelector('.lane-close-btn');
        closeBtn.addEventListener('click', () => this.removeLane(lane.id));
    }

    renderErrorState(lane) {
        const result = lane.result;
        
        // Stop timer
        if (lane.timer) {
            clearInterval(lane.timer);
            lane.timer = null;
        }
        
        lane.element.style.border = '2px solid var(--danger-color)';
        
        let html = `
            <div class="panel-head">
                <div>
                    <div style="font-weight: 500; color: var(--text-color);">${lane.model}</div>
                    <div style="font-size: 12px; color: var(--muted-color); margin-top: 2px;">Server: ${result.server_name}</div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="icon-btn lane-swap-btn" data-lane-id="${lane.id}" title="Change model">⇄</button>
                    <button class="icon-btn lane-close-btn" data-lane-id="${lane.id}">✕</button>
                </div>
            </div>
            <div style="padding: 12px;">
                <div style="color: var(--danger-color); font-weight: 500; margin-bottom: 8px;">Error</div>
                <div style="background: var(--code-bg); padding: 12px; border-radius: 4px; font-size: 13px; color: var(--text-color); white-space: pre-wrap; word-wrap: break-word;">${this.escapeHtml(result.error)}</div>
            </div>
        `;
        
        lane.element.innerHTML = html;
        
        // Add event listeners
        const swapBtn = lane.element.querySelector('.lane-swap-btn');
        swapBtn.addEventListener('click', () => this.swapLaneModel(lane));
        
        const closeBtn = lane.element.querySelector('.lane-close-btn');
        closeBtn.addEventListener('click', () => this.removeLane(lane.id));
    }

    async swapLaneModel(lane) {
        if (this.isEvaluating) return; // Don't allow swapping during evaluation
        
        lane.state = 'chooser';
        lane.model = null;
        lane.result = null;
        lane.element.style.border = '';
        await this.renderChooserState(lane);
        this.updateCompareButton();
    }

    removeLane(laneId) {
        const index = this.lanes.findIndex(l => l.id === laneId);
        if (index === -1) return;
        
        const lane = this.lanes[index];
        
        // Stop timer if running
        if (lane.timer) {
            clearInterval(lane.timer);
        }
        
        // Remove from DOM
        if (lane.element) {
            lane.element.remove();
        }
        
        // Remove from array
        this.lanes.splice(index, 1);
        
        this.updateCompareButton();
    }

    resetLanes() {
        // Clear all lanes
        this.lanes.forEach(lane => {
            if (lane.timer) {
                clearInterval(lane.timer);
            }
            if (lane.element) {
                lane.element.remove();
            }
        });
        
        this.lanes = [];
        this.currentGroupId = null;
        this.isEvaluating = false;
        
        // Hide summary panel
        this.summaryPanel.style.display = 'none';
        
        this.updateCompareButton();
    }

    updateCompareButton() {
        const prompt = this.promptTextarea.value.trim();
        const readyLanes = this.lanes.filter(l => l.state === 'idle' && l.model);
        
        this.compareBtn.disabled = !prompt || readyLanes.length === 0 || this.isEvaluating;
    }

    async startComparison() {
        const prompt = this.promptTextarea.value.trim();
        if (!prompt) {
            this.showToast('Please enter a prompt');
            return;
        }
        
        const readyLanes = this.lanes.filter(l => l.state === 'idle' && l.model);
        if (readyLanes.length === 0) {
            this.showToast('Please select at least one model');
            return;
        }
        
        this.isEvaluating = true;
        this.updateCompareButton();
        
        // Hide summary panel
        this.summaryPanel.style.display = 'none';
        
        // Set lanes to loading state
        for (const lane of readyLanes) {
            lane.state = 'loading';
            this.renderLoadingState(lane);
        }
        
        // Disable swap buttons
        document.querySelectorAll('.lane-swap-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
        
        try {
            const models = readyLanes.map(l => l.model);
            
            const response = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    models,
                    generateReport: true,
                }),
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Evaluation failed');
            }
            
            const data = await response.json();
            this.currentGroupId = data.group_id;
            
            // WebSocket events will handle the rest
            
        } catch (error) {
            console.error('Comparison failed:', error);
            this.showToast(`Comparison failed: ${error.message}`);
            this.isEvaluating = false;
            this.updateCompareButton();
        }
    }

    handleLaneStarted(data) {
        const lane = this.lanes.find(l => l.model === data.model);
        if (lane && data.server_name) {
            lane.serverName = data.server_name;
            // Update server name in UI if lane is in loading state
            if (lane.state === 'loading') {
                const serverEl = lane.element.querySelector('.panel-head div:first-child > div:last-child');
                if (serverEl) {
                    serverEl.textContent = `Server: ${data.server_name}`;
                }
            }
        }
    }

    handleLaneCompleted(data) {
        const lane = this.lanes.find(l => l.model === data.model);
        if (!lane) return;
        
        lane.result = data.result;
        
        if (data.result.error) {
            lane.state = 'error';
            this.renderErrorState(lane);
        } else {
            lane.state = 'complete';
            this.renderCompleteState(lane);
        }
    }

    handleAllCompleted(data) {
        this.isEvaluating = false;
        this.updateCompareButton();
        
        // Show summary panel
        this.summaryPanel.style.display = 'block';
        
        // Update report path
        if (data.report_path) {
            this.reportPath.textContent = `📋 Saved: ${data.report_path}`;
        } else {
            this.reportPath.textContent = '';
        }
        
        // Build summary table
        const sortedResults = [...data.results].sort((a, b) => {
            if (a.error && !b.error) return 1;
            if (!a.error && b.error) return -1;
            return a.duration_ms - b.duration_ms;
        });
        
        let html = '';
        for (const result of sortedResults) {
            if (result.error) {
                html += `
                    <tr>
                        <td>${result.model}</td>
                        <td>${result.server_name}</td>
                        <td style="color: var(--danger-color);">ERROR</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                    </tr>
                `;
            } else {
                const tokPerSec = result.tokens_per_second ? Math.round(result.tokens_per_second) : '—';
                html += `
                    <tr>
                        <td>${result.model}</td>
                        <td>${result.server_name}</td>
                        <td>${result.duration_ms.toLocaleString()} ms</td>
                        <td>${tokPerSec}</td>
                        <td>${result.output_tokens || '—'}</td>
                        <td>${result.finish_reason}</td>
                    </tr>
                `;
            }
        }
        
        this.summaryBody.innerHTML = html;
        
        // Scroll to summary
        this.summaryPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    showToast(message) {
        this.toast.textContent = message;
        this.toast.classList.add('show');
        setTimeout(() => {
            this.toast.classList.remove('show');
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    new ModelEvaluator();
});

// Note: This file is intended to be used in the browser. 
// It assumes socket.io-client is loaded via a script tag and available as `window.io`.

// Re-defining constants to avoid import issues in the browser without a bundler
const SOCKET_EVENTS = {
    PROMPT_HISTORY_ADDED: 'prompt_history_added',
    PROMPT_HISTORY_UPDATED: 'prompt_history_updated',
    SERVER_STATUS_CHANGED: 'server_status_changed',
    SERVERS_UPDATED: 'servers_updated',
    ACTIVE_REQUESTS_CHANGED: 'active_requests_changed',
    SERVERS_CONFIG_UPDATED: 'servers_config_updated',
};

export class DashboardSocket {
    // `options.path` should match the server's namespaced Socket.IO path
    // (`${basePath}socket.io/`) — see the `socketIoPath()` helper used at
    // each call site, derived from `document.baseURI` so it works under
    // both standalone (`/`) and hosted (`/lmapi/`) base paths.
    constructor(url, options) {
        const socketIo = window.io;
        if (!socketIo) {
            console.error('Socket.io client not found. Make sure the socket.io client script is loaded.');
            return;
        }
        this.socket = url ? socketIo(url, options) : socketIo(options);
    }

    on(event, cb) {
        if (this.socket) this.socket.on(event, cb);
    }

    setupListeners(actions) {
        if (!this.socket) return;

        this.socket.on(SOCKET_EVENTS.PROMPT_HISTORY_ADDED, (record) => {
            actions.addHistoryRecord(record);
            actions.showToast('New prompt request sent');
        });

        this.socket.on(SOCKET_EVENTS.PROMPT_HISTORY_UPDATED, (record) => {
            actions.updateHistoryRecord(record);
            if (record.isError) {
                actions.showToast(`Request failed on ${record.serverName}`);
            }
        });

        this.socket.on(SOCKET_EVENTS.SERVER_STATUS_CHANGED, (serverStatus) => {
            if (actions.updateServerStatus) actions.updateServerStatus(serverStatus);
        });

        this.socket.on(SOCKET_EVENTS.SERVERS_UPDATED, (servers) => {
            if (actions.updateAllServers) actions.updateAllServers(servers);
        });

        this.socket.on(SOCKET_EVENTS.ACTIVE_REQUESTS_CHANGED, (data) => {
            if (actions.updateActiveRequests) actions.updateActiveRequests(data.serverName, data.activeRequests);
        });

        this.socket.on(SOCKET_EVENTS.SERVERS_CONFIG_UPDATED, (servers) => {
            if (actions.serversConfigUpdated) actions.serversConfigUpdated(servers);
        });
    }

    disconnect() {
        if (this.socket) this.socket.disconnect();
    }
}
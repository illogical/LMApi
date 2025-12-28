// Note: This file is intended to be used in the browser. 
// It assumes socket.io-client is loaded via a script tag and available as `window.io`.

// Re-defining constants to avoid import issues in the browser without a bundler
const SOCKET_EVENTS = {
    PROMPT_HISTORY_ADDED: 'prompt_history_added',
    SERVER_STATUS_CHANGED: 'server_status_changed',
    SERVERS_UPDATED: 'servers_updated',
    ACTIVE_REQUESTS_CHANGED: 'active_requests_changed',
};

export class DashboardSocket {
    constructor(url) {
        const socketIo = window.io;
        if (!socketIo) {
            console.error('Socket.io client not found. Make sure /socket.io/socket.io.js is loaded.');
            return;
        }
        this.socket = url ? socketIo(url) : socketIo();
    }

    on(event, cb) {
        if (this.socket) this.socket.on(event, cb);
    }

    setupListeners(actions) {
        if (!this.socket) return;

        this.socket.on(SOCKET_EVENTS.PROMPT_HISTORY_ADDED, () => {
            actions.loadHistory();
            actions.showToast('New prompt record received');
        });

        this.socket.on(SOCKET_EVENTS.SERVER_STATUS_CHANGED, (serverStatus) => {
            actions.updateServerStatus(serverStatus);
        });

        this.socket.on(SOCKET_EVENTS.SERVERS_UPDATED, (servers) => {
            actions.updateAllServers(servers);
        });

        this.socket.on(SOCKET_EVENTS.ACTIVE_REQUESTS_CHANGED, (data) => {
            actions.updateActiveRequests(data.serverName, data.activeRequests);
        });
    }

    disconnect() {
        if (this.socket) this.socket.disconnect();
    }
}
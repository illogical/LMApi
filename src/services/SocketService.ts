import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { LogService } from './LogService';
import { SOCKET_EVENTS } from '../constants';
import { ActiveRequestState, EvaluationResult } from '../types';

export class SocketService {
    private static io: SocketIOServer | null = null;
    private static onFirstSubscriber: (() => void) | null = null;
    private static onLastSubscriber: (() => void) | null = null;
    private static subscriberCount = 0;

    /**
     * @param basePath Standalone `/`, hosted `/lmapi/`-style mount prefix.
     * Namespaces the Socket.IO path under it (`${basePath}socket.io/`) so
     * this app's realtime traffic can't collide with a sibling HomeBase
     * application sharing the same http.Server.
     */
    static initialize(server: HttpServer, basePath: string = '/') {
        if (this.io) {
            LogService.warn('SocketService already initialized');
            return;
        }

        this.io = new SocketIOServer(server, {
            path: `${basePath}socket.io/`,
            cors: {
                origin: '*', // Adjust as needed for security
                methods: ['GET', 'POST']
            }
        });

        this.io.on('connection', (socket) => {
            this.subscriberCount++;
            LogService.info(`Client connected: ${socket.id}. Total clients: ${this.subscriberCount}`);

            if (this.subscriberCount === 1 && this.onFirstSubscriber) {
                this.onFirstSubscriber();
            }

            socket.on('disconnect', () => {
                this.subscriberCount--;
                LogService.info(`Client disconnected: ${socket.id}. Remaining clients: ${this.subscriberCount}`);
                
                if (this.subscriberCount === 0 && this.onLastSubscriber) {
                    this.onLastSubscriber();
                }
            });
        });

        LogService.info('SocketService initialized');
    }

    static setSubscriberCallbacks(onFirst: () => void, onLast: () => void) {
        this.onFirstSubscriber = onFirst;
        this.onLastSubscriber = onLast;
    }

    static getSubscriberCount(): number {
        return this.subscriberCount;
    }

    /** Cheap health signal for a hosted adapter's getStatus() — true once attachRealtime() has run. */
    static isInitialized(): boolean {
        return !!this.io;
    }

    /**
     * Disconnects every connected client and drops this app's Socket.IO
     * instance. Deliberately does NOT call `io.close()` — Socket.IO's own
     * `close()` unconditionally closes whatever `http.Server` it was
     * attached to (verified directly in socket.io's `dist/index.js`), which
     * would take down HomeBase's shared server and every sibling
     * application along with it. `disconnectSockets()` only tears down
     * individual client connections. Idempotent — safe to call more than
     * once (including before `initialize()`).
     */
    static dispose(): void {
        if (!this.io) return;
        LogService.info('Disposing SocketService (disconnecting clients; shared http.Server is left untouched)');
        this.io.disconnectSockets(true);
        this.io = null;
        this.subscriberCount = 0;
    }

    static emit(event: string, data: any) {
        if (!this.io) {
            LogService.warn(`SocketService not initialized. Cannot emit event: ${event}`);
            return;
        }
        this.io.emit(event, data);
    }

    static emitPromptHistoryAdded(record: any) {
        this.emit(SOCKET_EVENTS.PROMPT_HISTORY_ADDED, record);
    }

    static emitPromptHistoryUpdated(record: any) {
        this.emit(SOCKET_EVENTS.PROMPT_HISTORY_UPDATED, record);
    }

    static emitServerStatusChanged(serverStatus: any) {
        this.emit(SOCKET_EVENTS.SERVER_STATUS_CHANGED, serverStatus);
    }

    static emitServersUpdated(servers: any[]) {
        this.emit(SOCKET_EVENTS.SERVERS_UPDATED, servers);
    }

    static emitActiveRequestsChanged(serverName: string, activeRequests: number) {
        this.emit(SOCKET_EVENTS.ACTIVE_REQUESTS_CHANGED, { serverName, activeRequests });
    }

    static emitServersConfigUpdated(servers: any[]) {
        this.emit(SOCKET_EVENTS.SERVERS_CONFIG_UPDATED, servers);
    }

    static emitRequestStarted(state: ActiveRequestState) {
        this.emit(SOCKET_EVENTS.REQUEST_STARTED, state);
    }

    static emitRequestCompleted(state: ActiveRequestState) {
        this.emit(SOCKET_EVENTS.REQUEST_COMPLETED, state);
    }

    static emitRequestFailed(state: ActiveRequestState) {
        this.emit(SOCKET_EVENTS.REQUEST_FAILED, state);
    }

    static emitQueueUpdated(queue: ActiveRequestState[]) {
        this.emit(SOCKET_EVENTS.QUEUE_UPDATED, { queue, length: queue.length });
    }

    static emitEvalLaneStarted(groupId: string, model: string, laneIndex: number) {
        this.emit(SOCKET_EVENTS.EVAL_LANE_STARTED, { groupId, model, laneIndex });
    }

    static emitEvalLaneCompleted(groupId: string, model: string, result: EvaluationResult) {
        this.emit(SOCKET_EVENTS.EVAL_LANE_COMPLETED, { groupId, model, result });
    }

    static emitEvalAllCompleted(groupId: string, results: EvaluationResult[], reportPath?: string) {
        this.emit(SOCKET_EVENTS.EVAL_ALL_COMPLETED, { groupId, results, reportPath });
    }
}

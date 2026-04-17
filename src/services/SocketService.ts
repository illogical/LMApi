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

    static initialize(server: HttpServer) {
        if (this.io) {
            LogService.warn('SocketService already initialized');
            return;
        }

        this.io = new SocketIOServer(server, {
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

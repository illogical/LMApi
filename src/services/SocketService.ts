import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { LogService } from './LogService';
import { SOCKET_EVENTS } from '../constants';

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
}

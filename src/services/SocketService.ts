import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { LogService } from './LogService';
import { SOCKET_EVENTS } from '../constants';

export class SocketService {
    private static io: SocketIOServer | null = null;

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
            LogService.info(`Client connected: ${socket.id}`);

            socket.on('disconnect', () => {
                LogService.info(`Client disconnected: ${socket.id}`);
            });
        });

        LogService.info('SocketService initialized');
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

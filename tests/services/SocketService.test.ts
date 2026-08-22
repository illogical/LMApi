import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

// tests/setup.ts globally mocks SocketService (most other tests only need a
// no-op stub) — this file tests the real implementation's namespacing and
// close-safety behavior, so it opts back out of that mock.
vi.unmock('../../src/services/SocketService');

const { SocketService } = await import('../../src/services/SocketService');

describe('SocketService', () => {
    let httpServer: HttpServer | null = null;

    afterEach((): Promise<void> => {
        SocketService.dispose();
        vi.restoreAllMocks();
        return new Promise((resolve) => {
            if (httpServer) {
                httpServer.close(() => resolve());
                httpServer = null;
            } else {
                resolve();
            }
        });
    });

    function listen(): Promise<HttpServer> {
        return new Promise((resolve) => {
            const server = createServer();
            server.listen(0, () => resolve(server));
        });
    }

    it('namespaces the Socket.IO path under the given basePath', async () => {
        httpServer = await listen();
        SocketService.initialize(httpServer, '/lmapi/');

        const io = (SocketService as any).io as SocketIOServer;
        // Server#path() strips the trailing slash it was configured with.
        expect(io.path()).toBe('/lmapi/socket.io');
    });

    it('defaults to the standalone root path when no basePath is given', async () => {
        httpServer = await listen();
        SocketService.initialize(httpServer);

        const io = (SocketService as any).io as SocketIOServer;
        expect(io.path()).toBe('/socket.io');
    });

    it('dispose() disconnects sockets but never closes the shared http.Server', async () => {
        httpServer = await listen();
        SocketService.initialize(httpServer, '/lmapi/');

        const io = (SocketService as any).io as SocketIOServer;
        const disconnectSpy = vi.spyOn(io, 'disconnectSockets');
        const closeSpy = vi.spyOn(io, 'close');

        SocketService.dispose();

        expect(disconnectSpy).toHaveBeenCalledWith(true);
        expect(closeSpy).not.toHaveBeenCalled();
        expect(httpServer.listening).toBe(true);
    });

    it('dispose() is idempotent (safe to call twice, and before initialize())', async () => {
        expect(() => SocketService.dispose()).not.toThrow();

        httpServer = await listen();
        SocketService.initialize(httpServer, '/lmapi/');
        SocketService.dispose();
        expect(() => SocketService.dispose()).not.toThrow();
        expect(SocketService.getSubscriberCount()).toBe(0);
    });
});

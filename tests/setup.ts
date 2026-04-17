import { vi } from 'vitest';

// Mock SocketService globally since most services depend on it
vi.mock('../src/services/SocketService', () => ({
    SocketService: {
        initialize: vi.fn(),
        setSubscriberCallbacks: vi.fn(),
        getSubscriberCount: vi.fn().mockReturnValue(0),
        emit: vi.fn(),
        emitPromptHistoryAdded: vi.fn(),
        emitPromptHistoryUpdated: vi.fn(),
        emitServerStatusChanged: vi.fn(),
        emitServersUpdated: vi.fn(),
        emitServersConfigUpdated: vi.fn(),
        emitActiveRequestsChanged: vi.fn(),
        emitRequestStarted: vi.fn(),
        emitRequestCompleted: vi.fn(),
        emitRequestFailed: vi.fn(),
        emitQueueUpdated: vi.fn(),
        emitEvalLaneStarted: vi.fn(),
        emitEvalLaneCompleted: vi.fn(),
        emitEvalAllCompleted: vi.fn(),
    },
}));

// Mock LogService globally to suppress log output during tests
vi.mock('../src/services/LogService', () => ({
    LogService: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

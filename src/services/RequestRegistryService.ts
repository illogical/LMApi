import { ActiveRequestState, GroupStatus, RequestPhase } from '../types';
import { SocketService } from './SocketService';

const TERMINAL_PHASES: ReadonlySet<RequestPhase> = new Set(['completed', 'failed', 'cancelled']);

const registry = new Map<string, ActiveRequestState>();
const groupIndex = new Map<string, Set<string>>();

function now(): string {
    return new Date().toISOString();
}

function computeElapsed(startedAt: string): number {
    return Date.now() - new Date(startedAt).getTime();
}

function withElapsed(state: ActiveRequestState): ActiveRequestState {
    return { ...state, elapsedMs: computeElapsed(state.startedAt) };
}

function emitQueueUpdate(): void {
    SocketService.emitQueueUpdated(RequestRegistryService.getQueueSnapshot());
}

export class RequestRegistryService {
    static create(params: {
        requestId: string;
        groupId?: string | null;
        requestType: ActiveRequestState['requestType'];
        modelName: string;
        promptPreview?: string;
    }): ActiveRequestState {
        const ts = now();
        const state: ActiveRequestState = {
            requestId: params.requestId,
            groupId: params.groupId ?? null,
            requestType: params.requestType,
            serverName: null,
            modelName: params.modelName,
            phase: 'queued',
            startedAt: ts,
            queuedAt: ts,
            lastActivityAt: ts,
            elapsedMs: 0,
            promptPreview: params.promptPreview,
            retryCount: 0,
        };

        registry.set(params.requestId, state);

        if (params.groupId) {
            if (!groupIndex.has(params.groupId)) {
                groupIndex.set(params.groupId, new Set());
            }
            groupIndex.get(params.groupId)!.add(params.requestId);
        }

        SocketService.emitRequestStarted(withElapsed(state));
        emitQueueUpdate();

        return withElapsed(state);
    }

    static markDispatching(requestId: string, serverName: string): void {
        const state = registry.get(requestId);
        if (!state) return;
        state.phase = 'dispatching';
        state.serverName = serverName;
        state.dispatchedAt = now();
        state.lastActivityAt = now();
        emitQueueUpdate();
    }

    static markEvaluating(requestId: string): void {
        const state = registry.get(requestId);
        if (!state) return;
        state.phase = 'evaluating';
        state.lastActivityAt = now();
        emitQueueUpdate();
    }

    static markStreaming(requestId: string): void {
        const state = registry.get(requestId);
        if (!state) return;
        state.phase = 'streaming';
        state.lastActivityAt = now();
        emitQueueUpdate();
    }

    static markCompleted(requestId: string): void {
        const state = registry.get(requestId);
        if (!state) return;
        state.phase = 'completed';
        state.lastActivityAt = now();

        SocketService.emitRequestCompleted(withElapsed(state));
        emitQueueUpdate();
    }

    static markFailed(requestId: string, error: string): void {
        const state = registry.get(requestId);
        if (!state) return;
        state.phase = 'failed';
        state.error = error;
        state.lastActivityAt = now();

        SocketService.emitRequestFailed(withElapsed(state));
        emitQueueUpdate();
    }

    static markCancelled(requestId: string): void {
        const state = registry.get(requestId);
        if (!state) return;
        state.phase = 'cancelled';
        state.lastActivityAt = now();
        emitQueueUpdate();
    }

    static getActive(): ActiveRequestState[] {
        return Array.from(registry.values())
            .filter(s => !TERMINAL_PHASES.has(s.phase))
            .map(withElapsed);
    }

    static getOne(requestId: string): ActiveRequestState | undefined {
        const state = registry.get(requestId);
        return state ? withElapsed(state) : undefined;
    }

    static getGroupStatus(groupId: string): GroupStatus | null {
        const ids = groupIndex.get(groupId);
        if (!ids || ids.size === 0) return null;

        const states = Array.from(ids)
            .map(id => registry.get(id))
            .filter((s): s is ActiveRequestState => s !== undefined);

        if (states.length === 0) return null;

        const byModel: Record<string, number> = {};
        const byServer: Record<string, number> = {};

        let queued = 0, running = 0, completed = 0, failed = 0;

        for (const s of states) {
            if (s.phase === 'queued') queued++;
            else if (s.phase === 'completed') completed++;
            else if (s.phase === 'failed' || s.phase === 'cancelled') failed++;
            else running++;

            byModel[s.modelName] = (byModel[s.modelName] ?? 0) + 1;
            if (s.serverName) {
                byServer[s.serverName] = (byServer[s.serverName] ?? 0) + 1;
            }
        }

        const startedAt = states.reduce((earliest, s) =>
            s.startedAt < earliest ? s.startedAt : earliest, states[0].startedAt);

        return {
            groupId,
            total: states.length,
            queued,
            running,
            completed,
            failed,
            byModel,
            byServer,
            startedAt,
            updatedAt: now(),
        };
    }

    static getQueueSnapshot(): ActiveRequestState[] {
        return Array.from(registry.values())
            .filter(s => s.phase === 'queued')
            .map(withElapsed);
    }

    static pruneCompleted(maxAgeMs = 5 * 60_000): void {
        const cutoff = Date.now() - maxAgeMs;
        for (const [id, state] of registry.entries()) {
            if (TERMINAL_PHASES.has(state.phase)) {
                const lastActivity = new Date(state.lastActivityAt).getTime();
                if (lastActivity < cutoff) {
                    registry.delete(id);
                    if (state.groupId) {
                        const group = groupIndex.get(state.groupId);
                        if (group) {
                            group.delete(id);
                            if (group.size === 0) groupIndex.delete(state.groupId);
                        }
                    }
                }
            }
        }
    }
}

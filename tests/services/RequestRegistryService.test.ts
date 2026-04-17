import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RequestRegistryService } from '../../src/services/RequestRegistryService';

// Access the module-level maps via the service's methods
// We need to clear state between tests

describe('RequestRegistryService', () => {
    beforeEach(() => {
        // Prune everything - set maxAge to 0 and mark all as completed first
        // For non-terminal entries, we mark them completed first, then prune
        const active = RequestRegistryService.getActive();
        for (const req of active) {
            RequestRegistryService.markCompleted(req.requestId);
        }
        // Wait a tick then prune to ensure timestamps are in the past
        RequestRegistryService.pruneCompleted(0);
        // Verify cleanup
        expect(RequestRegistryService.getActive()).toHaveLength(0);
    });

    describe('create', () => {
        it('should create a new request in queued phase', () => {
            const state = RequestRegistryService.create({
                requestId: 'test-1',
                requestType: 'generate',
                modelName: 'llama3.2',
            });

            expect(state.requestId).toBe('test-1');
            expect(state.phase).toBe('queued');
            expect(state.requestType).toBe('generate');
            expect(state.modelName).toBe('llama3.2');
            expect(state.serverName).toBeNull();
            expect(state.retryCount).toBe(0);
            expect(state.startedAt).toBeTruthy();
            expect(state.queuedAt).toBeTruthy();
            expect(state.elapsedMs).toBeGreaterThanOrEqual(0);
        });

        it('should create a request with groupId', () => {
            const state = RequestRegistryService.create({
                requestId: 'test-2',
                groupId: 'group-1',
                requestType: 'chat',
                modelName: 'qwen2.5',
                promptPreview: 'Hello world',
            });

            expect(state.groupId).toBe('group-1');
            expect(state.promptPreview).toBe('Hello world');
        });

        it('should create requests with different request types', () => {
            const types: Array<'generate' | 'chat' | 'embed' | 'agent'> = ['generate', 'chat', 'embed', 'agent'];
            for (const type of types) {
                const state = RequestRegistryService.create({
                    requestId: `test-${type}`,
                    requestType: type,
                    modelName: 'llama3.2',
                });
                expect(state.requestType).toBe(type);
            }
        });
    });

    describe('markDispatching', () => {
        it('should transition to dispatching phase with server name', () => {
            RequestRegistryService.create({
                requestId: 'disp-1',
                requestType: 'generate',
                modelName: 'llama3.2',
            });

            RequestRegistryService.markDispatching('disp-1', 'alpha');

            const state = RequestRegistryService.getOne('disp-1');
            expect(state?.phase).toBe('dispatching');
            expect(state?.serverName).toBe('alpha');
            expect(state?.dispatchedAt).toBeTruthy();
        });

        it('should no-op for nonexistent request', () => {
            // Should not throw
            RequestRegistryService.markDispatching('nonexistent', 'alpha');
        });
    });

    describe('markEvaluating', () => {
        it('should transition to evaluating phase', () => {
            RequestRegistryService.create({
                requestId: 'eval-1',
                requestType: 'chat',
                modelName: 'llama3.2',
            });
            RequestRegistryService.markDispatching('eval-1', 'alpha');
            RequestRegistryService.markEvaluating('eval-1');

            const state = RequestRegistryService.getOne('eval-1');
            expect(state?.phase).toBe('evaluating');
        });
    });

    describe('markStreaming', () => {
        it('should transition to streaming phase', () => {
            RequestRegistryService.create({
                requestId: 'stream-1',
                requestType: 'chat',
                modelName: 'llama3.2',
            });
            RequestRegistryService.markStreaming('stream-1');

            const state = RequestRegistryService.getOne('stream-1');
            expect(state?.phase).toBe('streaming');
        });
    });

    describe('markCompleted', () => {
        it('should transition to completed phase', () => {
            RequestRegistryService.create({
                requestId: 'comp-1',
                requestType: 'generate',
                modelName: 'llama3.2',
            });
            RequestRegistryService.markCompleted('comp-1');

            const state = RequestRegistryService.getOne('comp-1');
            expect(state?.phase).toBe('completed');
        });
    });

    describe('markFailed', () => {
        it('should transition to failed phase with error message', () => {
            RequestRegistryService.create({
                requestId: 'fail-1',
                requestType: 'generate',
                modelName: 'llama3.2',
            });
            RequestRegistryService.markFailed('fail-1', 'Timeout');

            const state = RequestRegistryService.getOne('fail-1');
            expect(state?.phase).toBe('failed');
            expect(state?.error).toBe('Timeout');
        });
    });

    describe('markCancelled', () => {
        it('should transition to cancelled phase', () => {
            RequestRegistryService.create({
                requestId: 'cancel-1',
                requestType: 'generate',
                modelName: 'llama3.2',
            });
            RequestRegistryService.markCancelled('cancel-1');

            const state = RequestRegistryService.getOne('cancel-1');
            expect(state?.phase).toBe('cancelled');
        });
    });

    describe('getActive', () => {
        it('should return only non-terminal requests', () => {
            RequestRegistryService.create({ requestId: 'a-1', requestType: 'generate', modelName: 'm1' });
            RequestRegistryService.create({ requestId: 'a-2', requestType: 'chat', modelName: 'm2' });
            RequestRegistryService.create({ requestId: 'a-3', requestType: 'embed', modelName: 'm3' });

            RequestRegistryService.markCompleted('a-2');
            RequestRegistryService.markFailed('a-3', 'error');

            const active = RequestRegistryService.getActive();
            expect(active).toHaveLength(1);
            expect(active[0].requestId).toBe('a-1');
        });

        it('should return empty array when no active requests', () => {
            const active = RequestRegistryService.getActive();
            expect(active).toHaveLength(0);
        });

        it('should compute elapsedMs', () => {
            RequestRegistryService.create({ requestId: 'elapsed-1', requestType: 'generate', modelName: 'm1' });
            const active = RequestRegistryService.getActive();
            expect(active[0].elapsedMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getOne', () => {
        it('should return a specific request by id', () => {
            RequestRegistryService.create({ requestId: 'one-1', requestType: 'generate', modelName: 'llama3.2' });
            const state = RequestRegistryService.getOne('one-1');
            expect(state).toBeDefined();
            expect(state?.requestId).toBe('one-1');
        });

        it('should return undefined for nonexistent request', () => {
            const state = RequestRegistryService.getOne('nonexistent');
            expect(state).toBeUndefined();
        });
    });

    describe('getGroupStatus', () => {
        it('should aggregate group statistics', () => {
            RequestRegistryService.create({ requestId: 'g-1', groupId: 'grp', requestType: 'chat', modelName: 'llama3.2' });
            RequestRegistryService.create({ requestId: 'g-2', groupId: 'grp', requestType: 'chat', modelName: 'qwen2.5' });
            RequestRegistryService.create({ requestId: 'g-3', groupId: 'grp', requestType: 'chat', modelName: 'llama3.2' });

            RequestRegistryService.markDispatching('g-1', 'alpha');
            RequestRegistryService.markEvaluating('g-1');
            RequestRegistryService.markCompleted('g-2');
            RequestRegistryService.markDispatching('g-3', 'beta');

            const status = RequestRegistryService.getGroupStatus('grp');
            expect(status).not.toBeNull();
            expect(status!.groupId).toBe('grp');
            expect(status!.total).toBe(3);
            expect(status!.completed).toBe(1);
            expect(status!.running).toBe(2); // evaluating + dispatching
            expect(status!.queued).toBe(0);
            expect(status!.byModel['llama3.2']).toBe(2);
            expect(status!.byModel['qwen2.5']).toBe(1);
        });

        it('should return null for nonexistent group', () => {
            const status = RequestRegistryService.getGroupStatus('nonexistent');
            expect(status).toBeNull();
        });

        it('should count failed and cancelled in failed bucket', () => {
            RequestRegistryService.create({ requestId: 'f-1', groupId: 'fail-grp', requestType: 'chat', modelName: 'm1' });
            RequestRegistryService.create({ requestId: 'f-2', groupId: 'fail-grp', requestType: 'chat', modelName: 'm2' });

            RequestRegistryService.markFailed('f-1', 'error');
            RequestRegistryService.markCancelled('f-2');

            const status = RequestRegistryService.getGroupStatus('fail-grp');
            expect(status!.failed).toBe(2);
        });
    });

    describe('getQueueSnapshot', () => {
        it('should return only queued requests', () => {
            RequestRegistryService.create({ requestId: 'q-1', requestType: 'generate', modelName: 'm1' });
            RequestRegistryService.create({ requestId: 'q-2', requestType: 'chat', modelName: 'm2' });

            RequestRegistryService.markDispatching('q-2', 'alpha');

            const queue = RequestRegistryService.getQueueSnapshot();
            expect(queue).toHaveLength(1);
            expect(queue[0].requestId).toBe('q-1');
        });
    });

    describe('pruneCompleted', () => {
        it('should remove terminal entries older than maxAge', async () => {
            RequestRegistryService.create({ requestId: 'prune-1', requestType: 'generate', modelName: 'm1' });
            RequestRegistryService.markCompleted('prune-1');

            // Wait a tiny bit so lastActivity is in the past relative to a very large maxAge window
            await new Promise(r => setTimeout(r, 10));

            // Use a maxAge so large that Date.now() - maxAge is well before the entry's lastActivity
            // Actually, we need maxAge to be small enough that the cutoff is AFTER the entry.
            // cutoff = Date.now() - maxAge. Entry is ~10ms old. maxAge=0 means cutoff=now, entry.lastActivity < now → should prune.
            // The issue is entry was created at same millisecond. Wait then prune.
            RequestRegistryService.pruneCompleted(5); // 5ms maxAge, entry is >10ms old

            const state = RequestRegistryService.getOne('prune-1');
            expect(state).toBeUndefined();
        });

        it('should not prune non-terminal entries', () => {
            RequestRegistryService.create({ requestId: 'prune-2', requestType: 'generate', modelName: 'm1' });

            RequestRegistryService.pruneCompleted(0);

            const state = RequestRegistryService.getOne('prune-2');
            expect(state).toBeDefined();
        });

        it('should clean up group index when pruning', async () => {
            RequestRegistryService.create({ requestId: 'prune-g1', groupId: 'prune-group', requestType: 'chat', modelName: 'm1' });
            RequestRegistryService.markCompleted('prune-g1');

            await new Promise(r => setTimeout(r, 10));
            RequestRegistryService.pruneCompleted(5);

            const status = RequestRegistryService.getGroupStatus('prune-group');
            expect(status).toBeNull();
        });
    });

    describe('lifecycle flow', () => {
        it('should track full lifecycle: queued → dispatching → evaluating → completed', () => {
            const state = RequestRegistryService.create({
                requestId: 'lifecycle-1',
                requestType: 'generate',
                modelName: 'llama3.2',
            });
            expect(state.phase).toBe('queued');

            RequestRegistryService.markDispatching('lifecycle-1', 'alpha');
            expect(RequestRegistryService.getOne('lifecycle-1')?.phase).toBe('dispatching');

            RequestRegistryService.markEvaluating('lifecycle-1');
            expect(RequestRegistryService.getOne('lifecycle-1')?.phase).toBe('evaluating');

            RequestRegistryService.markCompleted('lifecycle-1');
            expect(RequestRegistryService.getOne('lifecycle-1')?.phase).toBe('completed');

            // No longer in active list
            const active = RequestRegistryService.getActive();
            expect(active.find(r => r.requestId === 'lifecycle-1')).toBeUndefined();
        });

        it('should track streaming lifecycle: queued → dispatching → streaming → completed', () => {
            RequestRegistryService.create({
                requestId: 'stream-life',
                requestType: 'chat',
                modelName: 'llama3.2',
            });

            RequestRegistryService.markDispatching('stream-life', 'alpha');
            RequestRegistryService.markStreaming('stream-life');
            expect(RequestRegistryService.getOne('stream-life')?.phase).toBe('streaming');

            RequestRegistryService.markCompleted('stream-life');
            expect(RequestRegistryService.getOne('stream-life')?.phase).toBe('completed');
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelCacheService } from '../../src/services/ModelCacheService';

describe('ModelCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear internal cache by refreshing with an error
        ModelCacheService.clearCache('http://test-server:11434');
    });

    describe('refreshCache', () => {
        it('should fetch and cache models from server', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    models: [
                        { name: 'llama3.2:latest' },
                        { name: 'qwen2.5:latest' },
                    ],
                }),
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

            const models = await ModelCacheService.refreshCache('http://test-server:11434');
            expect(models).toHaveLength(2);
            expect(models).toContain('llama3.2:latest');
            expect(models).toContain('qwen2.5:latest');
            expect(fetch).toHaveBeenCalledWith(
                'http://test-server:11434/api/tags',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
        });

        it('should return empty array on fetch failure', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

            const models = await ModelCacheService.refreshCache('http://unreachable:11434');
            expect(models).toEqual([]);
        });

        it('should return empty array on non-ok response', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: false,
                statusText: 'Internal Server Error',
            } as any);

            const models = await ModelCacheService.refreshCache('http://test-server:11434');
            expect(models).toEqual([]);
        });

        it('should sort models alphabetically', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    models: [
                        { name: 'zephyr:latest' },
                        { name: 'alpha:latest' },
                        { name: 'llama:latest' },
                    ],
                }),
            } as any);

            const models = await ModelCacheService.refreshCache('http://test-server:11434');
            expect(models).toEqual(['alpha:latest', 'llama:latest', 'zephyr:latest']);
        });
    });

    describe('getModels', () => {
        it('should return cached models if fresh', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    models: [{ name: 'llama3.2:latest' }],
                }),
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

            // First call - fetches from server
            await ModelCacheService.refreshCache('http://test-server:11434');
            vi.mocked(fetch).mockClear();

            // Second call - should use cache
            const models = await ModelCacheService.getModels('http://test-server:11434');
            expect(models).toHaveLength(1);
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('getRunningModels', () => {
        it('should fetch running models from server', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    models: [{ name: 'llama3.2:latest' }],
                }),
            } as any);

            const models = await ModelCacheService.getRunningModels('http://test-server:11434');
            expect(models).toContain('llama3.2:latest');
            expect(fetch).toHaveBeenCalledWith(
                'http://test-server:11434/api/ps',
                expect.any(Object)
            );
        });

        it('should return empty array on failure', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'));

            const models = await ModelCacheService.getRunningModels('http://unreachable:11434');
            expect(models).toEqual([]);
        });
    });

    describe('clearCache', () => {
        it('should clear cache for a server URL', async () => {
            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    models: [{ name: 'llama3.2:latest' }],
                }),
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as any);

            await ModelCacheService.refreshCache('http://test-server:11434');
            ModelCacheService.clearCache('http://test-server:11434');

            // Next call should fetch again
            vi.mocked(fetch).mockClear();
            await ModelCacheService.getModels('http://test-server:11434');
            expect(fetch).toHaveBeenCalled();
        });
    });
});

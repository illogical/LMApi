import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DbService, PromptHistoryRecord, PromptHistoryQuery } from '../../src/services/DbService';

// DbService uses process.cwd()/data/history.db. We need each test suite to start fresh.
// We'll clear the table between tests.

describe('DbService', () => {
    beforeEach(() => {
        // Ensure DB is initialized
        try {
            DbService.getDb();
        } catch {
            DbService.initialize();
        }

        // Clear all data between tests
        const db = DbService.getDb();
        db.prepare('DELETE FROM PromptHistory').run();
    });

    describe('initialize', () => {
        it('should create the database and tables', () => {
            const db = DbService.getDb();
            expect(db).toBeDefined();

            // Check that PromptHistory table exists
            const tableCheck = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='PromptHistory'"
            ).get() as any;
            expect(tableCheck).toBeDefined();
            expect(tableCheck.name).toBe('PromptHistory');
        });

        it('should have WAL journal mode', () => {
            const db = DbService.getDb();
            const result = db.prepare('PRAGMA journal_mode').get() as any;
            expect(result.journal_mode).toBe('wal');
        });
    });

    describe('insertPromptHistory', () => {
        it('should insert a basic record', () => {
            const id = DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                prompt: 'Hello',
                responseText: 'Hi there!',
                responseDurationMs: 1500,
            });

            expect(id).toBeDefined();
            expect(typeof id === 'number' || typeof id === 'bigint').toBe(true);
        });

        it('should insert record with all fields', () => {
            const id = DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                prompt: 'Hello',
                responseText: 'Response',
                responseDurationMs: 1500,
                inputTokens: 10,
                outputTokens: 20,
                loadDuration: 500,
                evalDuration: 1000,
                totalDuration: 1500,
                thinking: 'Step 1...',
                messages: JSON.stringify([{ role: 'user', content: 'Hello' }]),
                toolCalls: JSON.stringify([]),
                temperature: 0.7,
                createdAt: new Date().toISOString(),
                responseAt: new Date().toISOString(),
                isError: false,
                groupId: 'group-1',
                requestType: 'chat',
            });

            const db = DbService.getDb();
            const record = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id) as any;
            expect(record.serverName).toBe('alpha');
            expect(record.modelName).toBe('llama3.2');
            expect(record.temperature).toBe(0.7);
            expect(record.groupId).toBe('group-1');
            expect(record.requestType).toBe('chat');
        });

        it('should insert error records', () => {
            const id = DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                prompt: 'Test',
                isError: true,
                responseText: 'Model not found',
            });

            const db = DbService.getDb();
            const record = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id) as any;
            expect(record.isError).toBe(1);
        });
    });

    describe('updatePromptHistory', () => {
        it('should update specific fields', () => {
            const id = DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                prompt: 'Hello',
            });

            DbService.updatePromptHistory(id as number, {
                responseText: 'Updated response',
                responseDurationMs: 2000,
            });

            const db = DbService.getDb();
            const record = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id) as any;
            expect(record.responseText).toBe('Updated response');
            expect(record.responseDurationMs).toBe(2000);
        });

        it('should not update when no fields provided', () => {
            const id = DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
            });

            // Should not throw
            DbService.updatePromptHistory(id as number, {});
        });
    });

    describe('getPromptHistory', () => {
        beforeEach(() => {
            // Insert test data
            for (let i = 0; i < 10; i++) {
                DbService.insertPromptHistory({
                    serverName: i % 2 === 0 ? 'alpha' : 'beta',
                    modelName: i < 5 ? 'llama3.2' : 'qwen2.5',
                    prompt: `Prompt ${i}`,
                    responseText: `Response ${i}`,
                    responseDurationMs: (i + 1) * 100,
                    requestType: i % 3 === 0 ? 'chat' : 'generate',
                });
            }
        });

        it('should return paginated results', () => {
            const result = DbService.getPromptHistory({
                limit: 5,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
            });

            expect(result.total).toBe(10);
            expect(result.records).toHaveLength(5);
        });

        it('should filter by model name', () => {
            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
                modelName: 'llama3.2',
            });

            expect(result.total).toBe(5);
            for (const record of result.records) {
                expect(record.modelName).toBe('llama3.2');
            }
        });

        it('should filter by server name', () => {
            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
                serverName: 'alpha',
            });

            expect(result.total).toBe(5);
            for (const record of result.records) {
                expect(record.serverName).toBe('alpha');
            }
        });

        it('should filter by requestType', () => {
            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
                requestType: 'chat',
            });

            expect(result.total).toBeGreaterThan(0);
            for (const record of result.records) {
                expect(record.requestType).toBe('chat');
            }
        });

        it('should sort by duration ascending', () => {
            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'responseDurationMs',
                direction: 'ASC',
            });

            for (let i = 1; i < result.records.length; i++) {
                const prev = result.records[i - 1].responseDurationMs ?? 0;
                const curr = result.records[i].responseDurationMs ?? 0;
                expect(curr).toBeGreaterThanOrEqual(prev);
            }
        });

        it('should filter by duration range', () => {
            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
                durationGt: 300,
                durationLt: 700,
            });

            for (const record of result.records) {
                expect(record.responseDurationMs).toBeGreaterThan(300);
                expect(record.responseDurationMs).toBeLessThan(700);
            }
        });

        it('should handle pagination with offset', () => {
            const page1 = DbService.getPromptHistory({
                limit: 3,
                offset: 0,
                sort: 'createdAt',
                direction: 'ASC',
            });
            const page2 = DbService.getPromptHistory({
                limit: 3,
                offset: 3,
                sort: 'createdAt',
                direction: 'ASC',
            });

            expect(page1.records).toHaveLength(3);
            expect(page2.records).toHaveLength(3);
            // No overlap
            const page1Ids = page1.records.map(r => r.id);
            const page2Ids = page2.records.map(r => r.id);
            const overlap = page1Ids.filter(id => page2Ids.includes(id));
            expect(overlap).toHaveLength(0);
        });

        it('should filter by isError', () => {
            DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                isError: true,
                responseText: 'Error occurred',
            });

            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
                isError: true,
            });

            expect(result.total).toBeGreaterThan(0);
        });

        it('should filter by groupId', () => {
            DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                groupId: 'test-group-filter',
            });

            const result = DbService.getPromptHistory({
                limit: 50,
                offset: 0,
                sort: 'createdAt',
                direction: 'DESC',
                groupId: 'test-group-filter',
            });

            expect(result.total).toBe(1);
            expect(result.records[0].groupId).toBe('test-group-filter');
        });
    });

    describe('assignGroupIdByPrompt', () => {
        it('should assign groupId to records with same prompt', async () => {
            DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                prompt: 'Same prompt',
            });
            const id2 = DbService.insertPromptHistory({
                serverName: 'beta',
                modelName: 'qwen2.5',
                prompt: 'Same prompt',
            });

            await DbService.assignGroupIdByPrompt(id2 as number, 'Same prompt');

            const db = DbService.getDb();
            const records = db.prepare('SELECT * FROM PromptHistory WHERE prompt = ?').all('Same prompt') as any[];
            expect(records.length).toBe(2);
            expect(records[0].groupId).toBeTruthy();
            expect(records[0].groupId).toBe(records[1].groupId);
        });

        it('should not assign groupId for single prompt', async () => {
            const id = DbService.insertPromptHistory({
                serverName: 'alpha',
                modelName: 'llama3.2',
                prompt: 'Unique prompt',
            });

            await DbService.assignGroupIdByPrompt(id as number, 'Unique prompt');

            const db = DbService.getDb();
            const record = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id) as any;
            expect(record.groupId).toBeNull();
        });
    });
});

import { describe, it, expect } from 'vitest';
import { SOCKET_EVENTS } from '../../src/constants';

describe('constants', () => {
    describe('SOCKET_EVENTS', () => {
        it('should export SOCKET_EVENTS as a frozen object', () => {
            expect(SOCKET_EVENTS).toBeDefined();
            expect(typeof SOCKET_EVENTS).toBe('object');
        });

        it('should contain all expected event names', () => {
            const expectedEvents = [
                'CONNECT',
                'DISCONNECT',
                'PROMPT_HISTORY_ADDED',
                'PROMPT_HISTORY_UPDATED',
                'SERVER_STATUS_CHANGED',
                'SERVERS_UPDATED',
                'ACTIVE_REQUESTS_CHANGED',
                'SERVERS_CONFIG_UPDATED',
                'REQUEST_STARTED',
                'REQUEST_COMPLETED',
                'REQUEST_FAILED',
                'QUEUE_UPDATED',
                'EVAL_LANE_STARTED',
                'EVAL_LANE_COMPLETED',
                'EVAL_ALL_COMPLETED',
            ];

            for (const event of expectedEvents) {
                expect(SOCKET_EVENTS).toHaveProperty(event);
            }
        });

        it('should have string values for all events', () => {
            for (const [key, value] of Object.entries(SOCKET_EVENTS)) {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
            }
        });

        it('should use lowercase_snake_case values', () => {
            for (const [key, value] of Object.entries(SOCKET_EVENTS)) {
                expect(value).toMatch(/^[a-z_]+$/);
            }
        });

        it('should have unique values', () => {
            const values = Object.values(SOCKET_EVENTS);
            const uniqueValues = new Set(values);
            expect(uniqueValues.size).toBe(values.length);
        });
    });
});

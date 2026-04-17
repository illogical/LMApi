import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/public/**', 'src/app.ts'],
        },
        testTimeout: 10000,
        setupFiles: ['tests/setup.ts'],
    },
});

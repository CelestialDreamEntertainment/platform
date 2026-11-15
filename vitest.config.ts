import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: ['packages/*'],
        passWithNoTests: true,
        coverage: {
            provider: 'v8',
            include: ['packages/*/src/**'],
            exclude: ['**/*.test.ts', '**/*.test-d.ts', '**/*.test.tsx'],
            thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }
        }
    }
});

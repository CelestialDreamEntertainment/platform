import { defineProject } from 'vitest/config';

export default defineProject({
    test: {
        name: 'web',
        environment: 'jsdom',
        typecheck: { enabled: true, tsconfig: './tsconfig.test.json' }
    }
});

import { defineProject } from 'vitest/config';

export default defineProject({
    test: {
        name: 'runtime',
        typecheck: { enabled: true, tsconfig: './tsconfig.test.json' }
    }
});

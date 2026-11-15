import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/dist/', '**/coverage/', '**/.platform/'] },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
        languageOptions: { globals: { ...globals.node } },
        rules: {
            'prefer-arrow-callback': 'error',
            'func-style': ['error', 'expression'],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ]
        }
    },
    prettier
);

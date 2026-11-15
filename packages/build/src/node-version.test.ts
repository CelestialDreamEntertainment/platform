import { describe, expect, it } from 'vitest';
import {
    checkNodeVersion,
    ESBUILD_TARGET,
    LAMBDA_RUNTIME,
    miseNodeVersion,
    NODE_MAJOR
} from './node-version.js';

describe('node version', () => {
    it('derives the esbuild target and Lambda runtime from one major version', () => {
        expect(NODE_MAJOR).toBe(24);
        expect(ESBUILD_TARGET).toBe('node24');
        expect(LAMBDA_RUNTIME).toBe('nodejs24.x');
    });

    it('reads the node pin from mise.toml', () => {
        expect(miseNodeVersion('[tools]\nnode = "24.22.3"\npnpm = "12"\n')).toBe('24.22.3');
        expect(miseNodeVersion('[tools]\npnpm = "12"\n')).toBeUndefined();
    });

    it('passes when everything agrees', () => {
        expect(checkNodeVersion('24.22.3', 'node = "24"')).toBeUndefined();
        expect(checkNodeVersion('v24.1.0')).toBeUndefined();
    });

    it('passes when mise.toml has no node pin', () => {
        expect(checkNodeVersion('24.22.3', '[tools]\n')).toBeUndefined();
    });

    it('fails on the wrong running Node', () => {
        expect(checkNodeVersion('22.23.4', 'node = "24"')).toMatch(
            /needs Node 24, but Node 22.23.4 is running/
        );
    });

    it('fails on the wrong mise.toml pin', () => {
        expect(checkNodeVersion('24.22.3', 'node = "22.1.0"')).toMatch(
            /mise.toml pins Node 22.1.0/
        );
    });
});

import { describe, expect, it } from 'vitest';
import { created, isReply, noContent, reply } from './reply.js';

describe('replies', () => {
    it('builds replies with a status', () => {
        expect(created({ id: 1 })).toMatchObject({ status: 201, body: { id: 1 } });
        expect(noContent()).toMatchObject({ status: 204, body: undefined });
        expect(reply(202, 'queued')).toMatchObject({ status: 202, body: 'queued' });
    });

    // RACC for `typeof value === 'object' && value !== null && REPLY in value`.
    it.each([
        ['a reply', created(1), true],
        ['a non-object', 'reply', false],
        ['null', null, false],
        ['a plain object with the same fields', { status: 201, body: 1 }, false]
    ])('isReply on %s is %j', (_, value, expected) => {
        expect(isReply(value)).toBe(expected);
    });
});

import { describe, expectTypeOf, it } from 'vitest';
import type { noContent } from './reply.js';
import { created, type ReplyBody } from './reply.js';

describe('reply types', () => {
    it('unwraps reply bodies', () => {
        expectTypeOf<ReplyBody<ReturnType<typeof created<{ id: string }>>>>().toEqualTypeOf<{
            id: string;
        }>();
        expectTypeOf<ReplyBody<ReturnType<typeof noContent>>>().toEqualTypeOf<undefined>();
    });

    it('passes plain values through', () => {
        expectTypeOf<ReplyBody<string[]>>().toEqualTypeOf<string[]>();
    });

    it('keeps the status literal', () => {
        expectTypeOf(created(1).status).toEqualTypeOf<201>();
    });
});

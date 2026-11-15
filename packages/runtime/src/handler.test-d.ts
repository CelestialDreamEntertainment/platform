import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { app } from '../test/app.js';
import { defineHandler, definePublicHandler } from './handler.js';
import type { User } from './user.js';

describe('handler types', () => {
    it('types inputs from the schemas', () => {
        defineHandler(
            app,
            {
                params: z.object({ id: z.string() }),
                query: z.object({ page: z.coerce.number().optional() }),
                body: z.object({ title: z.string() })
            },
            ({ params, query, body }) => {
                expectTypeOf(params).toEqualTypeOf<{ id: string }>();
                expectTypeOf(query).toEqualTypeOf<{ page?: number | undefined }>();
                expectTypeOf(body).toEqualTypeOf<{ title: string }>();
            }
        );
    });

    it('leaves undeclared inputs empty', () => {
        defineHandler(app, {}, ({ params, query, body }) => {
            expectTypeOf(params).toEqualTypeOf<Record<string, never>>();
            expectTypeOf(query).toEqualTypeOf<Record<string, never>>();
            expectTypeOf(body).toEqualTypeOf<undefined>();
        });
    });

    it("limits user.has to the app's scopes", () => {
        defineHandler(app, {}, ({ user }) => {
            expectTypeOf(user).toEqualTypeOf<User<'events:guest' | 'events:host'>>();
            user.has('events:host');
            // @ts-expect-error not a declared scope
            user.has('events:hots');
        });
    });

    it('gives public handlers no user', () => {
        definePublicHandler(app, {}, (request) => {
            expectTypeOf(request.user).toEqualTypeOf<undefined>();
        });
    });

    it('keeps the result type', () => {
        const handler = defineHandler(app, {}, async () => ({ ok: true as const }));
        expectTypeOf(handler.handle).returns.resolves.toEqualTypeOf<{ ok: true }>();
    });
});

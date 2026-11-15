import { created, defineHandler } from '@sbwp/runtime';
import { z } from 'zod';
import app from '../app.js';

export const handler = defineHandler(app, { body: z.object({ title: z.string() }) }, ({ body }) =>
    created({ id: 'e2', title: body.title })
);

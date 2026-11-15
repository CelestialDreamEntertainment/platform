import { defineHandler } from '@sbwp/runtime';
import { z } from 'zod';
import app from '../app.js';

export const handler = defineHandler(
    app,
    { params: z.object({ id: z.string() }) },
    ({ params }) => ({
        id: params.id
    })
);

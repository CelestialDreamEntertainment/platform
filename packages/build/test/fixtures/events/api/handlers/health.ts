import { definePublicHandler } from '@sbwp/runtime';
import app from '../app.js';

export const handler = definePublicHandler(app, {}, () => ({ ok: true }));

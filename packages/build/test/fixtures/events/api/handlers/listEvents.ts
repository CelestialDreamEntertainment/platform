import { defineHandler } from '@sbwp/runtime';
import app from '../app.js';

export const handler = defineHandler(app, {}, ({ user }) => [{ id: 'e1', viewer: user.email }]);

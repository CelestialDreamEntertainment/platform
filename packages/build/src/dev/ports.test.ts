import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PORTS, portsFor } from './ports.js';

describe('ports', () => {
    it("gives each app's port pair", () => {
        expect(portsFor('events')).toEqual({ api: 4102, web: 5102 });
    });

    it('explains how to add an app', () => {
        expect(() => portsFor('budget')).toThrow('No local ports for "budget"');
    });

    it('matches the Caddy config', async () => {
        const caddy = await readFile(
            new URL('../../../../local-dev/Caddyfile', import.meta.url),
            'utf8'
        );
        for (const [app, { api, web }] of Object.entries(PORTS)) {
            const block = new RegExp(
                `${app}\\.local\\.sabrinabea\\.com \\{[^}]*/api/\\* localhost:${api}[^}]*localhost:${web}`,
                's'
            );
            expect(caddy).toMatch(block);
        }
    });
});

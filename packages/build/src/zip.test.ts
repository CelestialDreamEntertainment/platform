import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeZip } from './zip.js';

describe('writeZip', () => {
    it('produces identical zips for identical content, whatever the file order or mtime', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'zip-'));
        await writeFile(join(dir, 'a'), 'alpha');
        await writeFile(join(dir, 'b'), 'beta');
        const first = join(dir, '1.zip');
        const second = join(dir, '2.zip');
        await writeZip(first, [
            { name: 'a.txt', path: join(dir, 'a') },
            { name: 'b.txt', path: join(dir, 'b') }
        ]);
        await new Promise((done) => setTimeout(done, 20));
        await writeFile(join(dir, 'a'), 'alpha');
        await writeZip(second, [
            { name: 'b.txt', path: join(dir, 'b') },
            { name: 'a.txt', path: join(dir, 'a') }
        ]);
        expect(await readFile(first)).toEqual(await readFile(second));
    });
});

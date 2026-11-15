import { cp, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Copies the events fixture app to a temporary directory and applies any file overrides. Its
 * node_modules links to this package's, so it resolves @sbwp/runtime and zod.
 */
export const fixtureApp = async (files: Record<string, string> = {}): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'sbwp-app-'));
    await cp(join(here, 'fixtures', 'events'), dir, {
        recursive: true,
        filter: (src) => !/[\\/](dist|\.platform)$/.test(src)
    });
    await symlink(join(here, '..', 'node_modules'), join(dir, 'node_modules'), 'dir');
    for (const [name, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, name)), { recursive: true });
        await writeFile(join(dir, name), content);
    }
    return dir;
};

import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';

/** A fixed timestamp, so unchanged code always produces an identical zip. */
const EPOCH = new Date('1980-01-01T00:00:00Z');

/** Writes a deterministic zip: sorted entries, fixed timestamps and permissions. */
export const writeZip = async (
    outfile: string,
    files: readonly { readonly name: string; readonly path: string }[]
): Promise<void> => {
    const zip = new ZipFile();
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    for (const file of sorted) {
        zip.addBuffer(await readFile(file.path), file.name, { mtime: EPOCH, mode: 0o100644 });
    }
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(outfile));
};

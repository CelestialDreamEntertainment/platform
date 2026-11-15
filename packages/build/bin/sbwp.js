#!/usr/bin/env node
import { run } from '../dist/cli.js';

process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    nodeVersion: process.versions.node,
    out: (line) => console.log(line),
    err: (line) => console.error(line)
});

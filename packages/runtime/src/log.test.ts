import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLog, type LogLevel } from './log.js';

const capture = () => {
    const lines: { entry: Record<string, unknown>; level: LogLevel }[] = [];
    const log = createLog({ app: 'events' }, (line, level) => {
        lines.push({ entry: JSON.parse(line) as Record<string, unknown>, level });
    });
    return { log, lines };
};

describe('createLog', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['debug', 'info', 'warn', 'error'] as const)('writes %s lines as JSON', (level) => {
        const { log, lines } = capture();
        log[level]('hello', { count: 2 });
        expect(lines).toEqual([
            {
                level,
                entry: {
                    level,
                    time: expect.any(String),
                    message: 'hello',
                    app: 'events',
                    count: 2
                }
            }
        ]);
    });

    it('works without fields', () => {
        const { log, lines } = capture();
        log.info('hi');
        expect(lines[0]?.entry).toMatchObject({ message: 'hi', app: 'events' });
    });

    it('serializes errors', () => {
        const { log, lines } = capture();
        log.error('failed', { error: new TypeError('boom') });
        expect(lines[0]?.entry.error).toEqual({
            name: 'TypeError',
            message: 'boom',
            stack: expect.stringContaining('boom')
        });
    });

    it('never lets fields overwrite level, time or message', () => {
        const lines: string[] = [];
        const log = createLog({ message: 'base', level: 'x' }, (line) => lines.push(line));
        log.warn('real', { time: 'then', level: 'debug' });
        expect(JSON.parse(lines[0] ?? '')).toMatchObject({ level: 'warn', message: 'real' });
        expect(JSON.parse(lines[0] ?? '').time).not.toBe('then');
    });

    it('adds child fields to every line', () => {
        const { log, lines } = capture();
        log.child({ requestId: 'r1' }).child({ route: 'GET /x' }).info('hi');
        expect(lines[0]?.entry).toMatchObject({ app: 'events', requestId: 'r1', route: 'GET /x' });
    });

    it('writes errors to stderr and everything else to stdout by default', () => {
        const out = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const log = createLog();
        log.warn('careful');
        log.error('bad');
        expect(out).toHaveBeenCalledOnce();
        expect(err).toHaveBeenCalledOnce();
        expect(JSON.parse(String(err.mock.calls[0]?.[0]))).toMatchObject({ message: 'bad' });
    });
});

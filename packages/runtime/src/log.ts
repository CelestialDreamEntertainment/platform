export type LogFields = Record<string, unknown>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Log = {
    readonly debug: (message: string, fields?: LogFields) => void;
    readonly info: (message: string, fields?: LogFields) => void;
    readonly warn: (message: string, fields?: LogFields) => void;
    readonly error: (message: string, fields?: LogFields) => void;
    /** A logger that adds `fields` to every line. */
    readonly child: (fields: LogFields) => Log;
};

export type LogSink = (line: string, level: LogLevel) => void;

const serialize = (value: unknown): unknown =>
    value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value;

const consoleSink: LogSink = (line, level) => {
    (level === 'error' ? console.error : console.log)(line);
};

/** A structured logger that writes one JSON object per line. */
export const createLog = (base: LogFields = {}, sink: LogSink = consoleSink): Log => {
    const write =
        (level: LogLevel) =>
        (message: string, fields: LogFields = {}): void => {
            const entry: LogFields = { ...base };
            for (const [key, value] of Object.entries(fields)) {
                entry[key] = serialize(value);
            }
            // Set last, so fields can never overwrite them.
            Object.assign(entry, { level, time: new Date().toISOString(), message });
            sink(JSON.stringify(entry), level);
        };
    return {
        debug: write('debug'),
        info: write('info'),
        warn: write('warn'),
        error: write('error'),
        child: (fields) => createLog({ ...base, ...fields }, sink)
    };
};

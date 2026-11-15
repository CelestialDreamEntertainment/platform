import { pathParams, type AppManifest, type Handler, type RouteDef } from '@sbwp/runtime';

const isHandler = (value: unknown): value is Handler =>
    typeof value === 'object' &&
    value !== null &&
    'handle' in value &&
    typeof value.handle === 'function' &&
    'public' in value &&
    typeof value.public === 'boolean' &&
    'schemas' in value;

const shapeKeys = (schema: unknown): string[] | undefined => {
    if (typeof schema === 'object' && schema !== null && 'shape' in schema) {
        const { shape } = schema as { shape: unknown };
        if (typeof shape === 'object' && shape !== null) {
            return Object.keys(shape).sort();
        }
    }
    return undefined;
};

/**
 * Checks that a route's handler module matches the route: it exports `handler`, it's public
 * exactly when the route is, and its params schema has exactly the path's parameters.
 * Returns the problems found, as messages.
 */
export const checkHandler = (
    app: AppManifest,
    r: RouteDef,
    module: Record<string, unknown>
): string[] => {
    const key = `${r.method} ${r.path} (${r.handler})`;
    const { handler } = module;
    if (!isHandler(handler)) {
        return [
            `${key}: the module must export \`handler\`, made with defineHandler or definePublicHandler`
        ];
    }
    const problems: string[] = [];
    if (handler.app.name !== app.name) {
        problems.push(`${key}: the handler belongs to the "${handler.app.name}" app`);
    }
    if (handler.public !== r.public) {
        problems.push(
            r.public
                ? `${key}: the route is public, so use definePublicHandler`
                : `${key}: the route is not public, so use defineHandler`
        );
    }
    const expected = pathParams(r.path).sort();
    const { params } = handler.schemas;
    if (params === undefined) {
        if (expected.length > 0) {
            problems.push(`${key}: declare a params schema with ${expected.join(', ')}`);
        }
    } else {
        const actual = shapeKeys(params);
        if (actual === undefined) {
            problems.push(`${key}: the params schema must be a z.object`);
        } else if (actual.join() !== expected.join()) {
            problems.push(
                `${key}: the params schema has [${actual.join(', ')}], but the path has [${expected.join(', ')}]`
            );
        }
    }
    return problems;
};

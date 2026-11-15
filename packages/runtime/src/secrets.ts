export type Secrets = {
    /** Reads one of the app's secrets by name, e.g. `ctx.secrets.get('client-secret')`. */
    readonly get: (name: string) => Promise<string>;
};

/** Fetches a decrypted SecureString parameter. The real one wraps SSM's GetParameter. */
export type ParameterReader = (name: string) => Promise<string | undefined>;

const NAME = /^[a-z0-9][a-z0-9-]*$/;

const checkName = (name: string): void => {
    if (!NAME.test(name)) {
        throw new Error(`Invalid secret name "${name}": use lowercase letters, digits and dashes`);
    }
};

/** The environment variable a secret comes from locally: `client-secret` is `SECRET_CLIENT_SECRET`. */
export const secretEnvName = (name: string): string =>
    `SECRET_${name.toUpperCase().replaceAll('-', '_')}`;

/** Local secrets come from `SECRET_*` environment variables, usually set in `.env.local`. */
export const envSecrets = (env: NodeJS.ProcessEnv): Secrets => ({
    get: async (name) => {
        checkName(name);
        const value = env[secretEnvName(name)];
        if (value === undefined) {
            throw new Error(
                `Secret "${name}" is not set. Add ${secretEnvName(name)} to .env.local.`
            );
        }
        return value;
    }
});

/**
 * Deployed secrets are SSM SecureString parameters under the app's prefix (`/<app>/<env>`), read
 * once per process and cached.
 */
export const parameterSecrets = (prefix: string, read: ParameterReader): Secrets => {
    const cache = new Map<string, Promise<string>>();
    return {
        get: (name) => {
            checkName(name);
            let value = cache.get(name);
            if (!value) {
                const path = `${prefix}/${name}`;
                value = read(path).then((found) => {
                    if (found === undefined) {
                        throw new Error(`Secret parameter ${path} has no value`);
                    }
                    return found;
                });
                value.catch(() => cache.delete(name));
                cache.set(name, value);
            }
            return value;
        }
    };
};

/** Reads parameters with the AWS SDK, which the Lambda runtime provides. */
export const ssmReader = (): ParameterReader => {
    const client = import('@aws-sdk/client-ssm').then(({ SSMClient, GetParameterCommand }) => ({
        ssm: new SSMClient({}),
        GetParameterCommand
    }));
    return async (name) => {
        const { ssm, GetParameterCommand } = await client;
        const result = await ssm.send(
            new GetParameterCommand({ Name: name, WithDecryption: true })
        );
        return result.Parameter?.Value;
    };
};

/**
 * Picks the secrets source: SSM when the deployment sets `SECRETS_PREFIX`, otherwise local
 * environment variables.
 */
export const createSecrets = (
    env: NodeJS.ProcessEnv = process.env,
    reader?: ParameterReader
): Secrets =>
    env.SECRETS_PREFIX
        ? parameterSecrets(env.SECRETS_PREFIX, reader ?? ssmReader())
        : envSecrets(env);

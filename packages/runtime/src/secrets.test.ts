import { describe, expect, it, vi } from 'vitest';
import {
    createSecrets,
    envSecrets,
    parameterSecrets,
    secretEnvName,
    ssmReader
} from './secrets.js';

const sent: unknown[] = [];
vi.mock('@aws-sdk/client-ssm', () => ({
    SSMClient: class {
        send = async (command: { input: { Name: string } }) => {
            sent.push(command.input);
            return {
                Parameter: command.input.Name.endsWith('/missing')
                    ? undefined
                    : { Value: 'from-ssm' }
            };
        };
    },
    GetParameterCommand: class {
        constructor(readonly input: unknown) {}
    }
}));

describe('secretEnvName', () => {
    it('maps a secret name to its environment variable', () => {
        expect(secretEnvName('client-secret')).toBe('SECRET_CLIENT_SECRET');
    });
});

describe('envSecrets', () => {
    it('reads SECRET_* variables', async () => {
        await expect(envSecrets({ SECRET_API_KEY: 'k' }).get('api-key')).resolves.toBe('k');
    });

    it('explains how to set a missing secret', async () => {
        await expect(envSecrets({}).get('api-key')).rejects.toThrow(
            'Secret "api-key" is not set. Add SECRET_API_KEY to .env.local.'
        );
    });

    it('rejects invalid names', async () => {
        await expect(envSecrets({}).get('../x')).rejects.toThrow('Invalid secret name "../x"');
    });
});

describe('parameterSecrets', () => {
    it("reads parameters under the app's prefix and caches them", async () => {
        const read = vi.fn(async () => 'v');
        const secrets = parameterSecrets('/events/dev', read);
        await expect(secrets.get('client-secret')).resolves.toBe('v');
        await expect(secrets.get('client-secret')).resolves.toBe('v');
        expect(read).toHaveBeenCalledOnce();
        expect(read).toHaveBeenCalledWith('/events/dev/client-secret');
    });

    it('fails for a parameter with no value, and retries next time', async () => {
        const read = vi.fn<(name: string) => Promise<string | undefined>>(async () => undefined);
        const secrets = parameterSecrets('/events/dev', read);
        await expect(secrets.get('x')).rejects.toThrow(
            'Secret parameter /events/dev/x has no value'
        );
        read.mockResolvedValueOnce('later');
        await expect(secrets.get('x')).resolves.toBe('later');
    });

    it('rejects invalid names without reading', () => {
        const read = vi.fn(async () => 'v');
        expect(() => parameterSecrets('/events/dev', read).get('Bad')).toThrow(
            'Invalid secret name'
        );
        expect(read).not.toHaveBeenCalled();
    });
});

describe('ssmReader', () => {
    it('gets decrypted parameters with the AWS SDK', async () => {
        const read = ssmReader();
        await expect(read('/events/dev/a')).resolves.toBe('from-ssm');
        await expect(read('/events/dev/missing')).resolves.toBeUndefined();
        expect(sent).toEqual([
            { Name: '/events/dev/a', WithDecryption: true },
            { Name: '/events/dev/missing', WithDecryption: true }
        ]);
    });
});

describe('createSecrets', () => {
    it('uses SSM when SECRETS_PREFIX is set', async () => {
        const read = vi.fn(async () => 'v');
        await createSecrets({ SECRETS_PREFIX: '/events/prod' }, read).get('a');
        expect(read).toHaveBeenCalledWith('/events/prod/a');
    });

    it('defaults to the real SSM reader', async () => {
        await expect(createSecrets({ SECRETS_PREFIX: '/events/prod' }).get('a')).resolves.toBe(
            'from-ssm'
        );
    });

    it('uses environment variables otherwise', async () => {
        await expect(createSecrets({ SECRET_A: 'local' }).get('a')).resolves.toBe('local');
    });

    it('reads process.env by default', async () => {
        await expect(createSecrets().get('not-set-anywhere')).rejects.toThrow('is not set');
    });
});

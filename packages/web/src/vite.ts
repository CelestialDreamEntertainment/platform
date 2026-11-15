import react from '@vitejs/plugin-react';
import { mergeConfig, type UserConfig } from 'vite';

export type BuildInfo = { readonly sha: string; readonly time: string };

/** The commit and time baked into every build, for footers, logs and error reports. */
export const buildInfo = (env: NodeJS.ProcessEnv = process.env, now = new Date()): BuildInfo => ({
    sha: env.GITHUB_SHA ?? 'local',
    time: now.toISOString()
});

/**
 * The platform's Vite config. The app's frontend lives in `web/` and builds to `dist/web`. In dev,
 * `/api` goes to the local API server (`sbwp dev` sets `SBWP_API_PORT`), the same split Caddy and
 * CloudFront make, and `*.local.sabrinabea.com` is an allowed host.
 */
export const platformVite = (
    config: UserConfig = {},
    env: NodeJS.ProcessEnv = process.env
): UserConfig => {
    const info = buildInfo(env);
    return mergeConfig(
        {
            root: 'web',
            plugins: [react()],
            define: {
                'import.meta.env.BUILD_SHA': JSON.stringify(info.sha),
                'import.meta.env.BUILD_TIME': JSON.stringify(info.time)
            },
            server: {
                allowedHosts: ['.local.sabrinabea.com'],
                proxy: { '/api': `http://127.0.0.1:${env.SBWP_API_PORT ?? '4102'}` }
            },
            build: { outDir: '../dist/web', emptyOutDir: true, target: 'es2022' }
        } satisfies UserConfig,
        config
    );
};

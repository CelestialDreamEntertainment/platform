/** The Node major version the platform targets. The esbuild target, the Lambda runtime and `engines.node` all follow it. */
export const NODE_MAJOR = 24;
export const LAMBDA_RUNTIME = `nodejs${NODE_MAJOR}.x`;
export const ESBUILD_TARGET = `node${NODE_MAJOR}`;

/** Reads the Node version pinned in a mise.toml, if any. */
export const miseNodeVersion = (toml: string): string | undefined =>
    /^\s*node\s*=\s*"([^"]+)"/m.exec(toml)?.[1];

const major = (version: string): number => Number(version.replace(/^v/, '').split('.')[0]);

/**
 * Returns a clear error message when the running Node, or the app's mise.toml pin, isn't on the
 * platform's major version. Returns undefined when everything agrees.
 */
export const checkNodeVersion = (running: string, miseToml?: string): string | undefined => {
    if (major(running) !== NODE_MAJOR) {
        return `This platform version needs Node ${NODE_MAJOR}, but Node ${running} is running. Run \`mise install\` in the app repo.`;
    }
    const pinned = miseToml === undefined ? undefined : miseNodeVersion(miseToml);
    if (pinned !== undefined && major(pinned) !== NODE_MAJOR) {
        return `mise.toml pins Node ${pinned}, but this platform version needs Node ${NODE_MAJOR}. Update the node line in mise.toml.`;
    }
    return undefined;
};

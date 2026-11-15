/**
 * Each app's fixed local port pair: the API server and Vite. Caddy's config in
 * `local-dev/Caddyfile` uses the same ports; a test keeps them in step.
 */
export const PORTS: Readonly<Record<string, { readonly api: number; readonly web: number }>> = {
    events: { api: 4102, web: 5102 },
    admin: { api: 4103, web: 5103 }
};

export const portsFor = (app: string): { api: number; web: number } => {
    const ports = PORTS[app];
    if (!ports) {
        throw new Error(
            `No local ports for "${app}". Add it to PORTS in @sbwp/build and to local-dev/Caddyfile.`
        );
    }
    return ports;
};

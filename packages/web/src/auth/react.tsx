import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthClient, AuthState, SessionUser } from './client.js';

const AuthContext = createContext<AuthClient | undefined>(undefined);

/** Provides the auth client to the app and restores the session on load. */
export const AuthProvider = <Scope extends string>({
    client,
    children
}: {
    client: AuthClient<Scope>;
    children: ReactNode;
}) => {
    useEffect(() => {
        void client.start();
    }, [client]);
    return (
        <AuthContext.Provider value={client as unknown as AuthClient}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = <Scope extends string = string>(): AuthClient<Scope> => {
    const client = useContext(AuthContext);
    if (!client) {
        throw new Error('useAuth needs an <AuthProvider> above it');
    }
    return client as unknown as AuthClient<Scope>;
};

export const useAuthState = <Scope extends string = string>(): AuthState<Scope> => {
    const client = useAuth<Scope>();
    return useSyncExternalStore(client.subscribe, client.getState);
};

/** The signed-in user, or undefined while loading or signed out. */
export const useUser = <Scope extends string = string>(): SessionUser<Scope> | undefined => {
    const state = useAuthState<Scope>();
    return state.status === 'signedIn' ? state.user : undefined;
};

/** Renders its children only for a signed-in user, and sends everyone else to sign in. */
export const RequireAuth = ({
    children,
    fallback = null
}: {
    children: ReactNode;
    fallback?: ReactNode;
}) => {
    const client = useAuth();
    const state = useAuthState();
    useEffect(() => {
        if (state.status === 'signedOut') {
            client.signIn();
        }
    }, [client, state.status]);
    return state.status === 'signedIn' ? children : fallback;
};

export type User<Scope extends string = string> = {
    /** Stable ID from the auth server. */
    readonly id: string;
    readonly email: string;
    readonly name?: string;
    readonly scopes: readonly Scope[];
    readonly has: (scope: Scope) => boolean;
};

/** Verified token claims, as API Gateway's JWT authorizer passes them (all values are strings). */
export type Claims = Readonly<Record<string, string | undefined>>;

/**
 * Builds the `User` from verified claims. Returns undefined when the claims don't identify a user,
 * so callers can fail closed. Only scopes the app declares are kept.
 */
export const userFromClaims = <Scope extends string>(
    claims: Claims,
    declared: readonly Scope[]
): User<Scope> | undefined => {
    const { sub, email, name } = claims;
    if (!sub || !email) {
        return undefined;
    }
    const granted = new Set((claims.scope ?? '').split(' '));
    const scopes = declared.filter((scope) => granted.has(scope));
    return {
        id: sub,
        email,
        ...(name ? { name } : {}),
        scopes,
        has: (scope) => scopes.includes(scope)
    };
};

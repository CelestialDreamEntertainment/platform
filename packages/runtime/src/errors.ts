export type ErrorBody = {
    error: { code: string; message: string; issues?: readonly Issue[] };
};

export type Issue = { path: string; message: string };

/** An error that becomes an HTTP response with its own status code. */
export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly issues?: readonly Issue[]
    ) {
        super(message);
        this.name = new.target.name;
    }

    toBody(): ErrorBody {
        return {
            error: {
                code: this.code,
                message: this.message,
                ...(this.issues ? { issues: this.issues } : {})
            }
        };
    }
}

export class BadRequestError extends HttpError {
    constructor(message = 'Bad request', issues?: readonly Issue[]) {
        super(400, 'bad_request', message, issues);
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message = 'Sign in required') {
        super(401, 'unauthorized', message);
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = 'Forbidden') {
        super(403, 'forbidden', message);
    }
}

export class NotFoundError extends HttpError {
    constructor(message = 'Not found') {
        super(404, 'not_found', message);
    }
}

export class ConflictError extends HttpError {
    constructor(message = 'Conflict') {
        super(409, 'conflict', message);
    }
}

export const internalErrorBody: ErrorBody = {
    error: { code: 'internal', message: 'Internal server error' }
};

import { describe, expect, it } from 'vitest';
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    HttpError,
    NotFoundError,
    UnauthorizedError
} from './errors.js';

describe('errors', () => {
    it.each([
        [new BadRequestError(), 400, 'bad_request', 'Bad request', 'BadRequestError'],
        [new UnauthorizedError(), 401, 'unauthorized', 'Sign in required', 'UnauthorizedError'],
        [new ForbiddenError(), 403, 'forbidden', 'Forbidden', 'ForbiddenError'],
        [new NotFoundError(), 404, 'not_found', 'Not found', 'NotFoundError'],
        [new ConflictError(), 409, 'conflict', 'Conflict', 'ConflictError']
    ])('%s has status %i', (error, status, code, message, name) => {
        expect(error).toBeInstanceOf(HttpError);
        expect(error).toMatchObject({ status, code, message, name });
    });

    it('takes custom messages', () => {
        expect(new NotFoundError('No such event').message).toBe('No such event');
        expect(new BadRequestError('Bad date').message).toBe('Bad date');
        expect(new UnauthorizedError('Nope').message).toBe('Nope');
        expect(new ForbiddenError('Hosts only').message).toBe('Hosts only');
        expect(new ConflictError('Taken').message).toBe('Taken');
    });

    it('builds the response body', () => {
        expect(new NotFoundError().toBody()).toEqual({
            error: { code: 'not_found', message: 'Not found' }
        });
    });

    it('includes issues in the body', () => {
        const issues = [{ path: 'title', message: 'Required' }];
        expect(new BadRequestError('Invalid body', issues).toBody()).toEqual({
            error: { code: 'bad_request', message: 'Invalid body', issues }
        });
    });

    it('supports custom subclasses', () => {
        class TeapotError extends HttpError {
            constructor() {
                super(418, 'teapot', "I'm a teapot");
            }
        }
        expect(new TeapotError()).toMatchObject({ status: 418, name: 'TeapotError' });
    });
});

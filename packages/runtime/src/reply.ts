const REPLY = Symbol.for('@sbwp/runtime/reply');

/** A successful response with a status other than 200. Returning a plain value means 200. */
export type Reply<Status extends number, Body> = {
    readonly [REPLY]: true;
    readonly status: Status;
    readonly body: Body;
};

export const reply = <const Status extends number, Body>(
    status: Status,
    body: Body
): Reply<Status, Body> => ({ [REPLY]: true, status, body });

export const created = <Body>(body: Body): Reply<201, Body> => reply(201, body);

export const noContent = (): Reply<204, undefined> => reply(204, undefined);

export const isReply = (value: unknown): value is Reply<number, unknown> =>
    typeof value === 'object' && value !== null && REPLY in value;

/** The JSON body a handler's return type produces. */
export type ReplyBody<Result> = Result extends Reply<number, infer Body> ? Body : Result;

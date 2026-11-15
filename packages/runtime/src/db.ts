import { MongoClient, type Db } from 'mongodb';

export const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017';

let client: MongoClient | undefined;

/**
 * Returns the app's own database. The client is created once per process and connects on first
 * use, so routes that never touch the database never connect. `MONGODB_URI` is set by the
 * deployment; it defaults to local Mongo.
 */
export const getDb = (app: string, env: NodeJS.ProcessEnv = process.env): Db => {
    client ??= new MongoClient(env.MONGODB_URI ?? DEFAULT_MONGODB_URI);
    return client.db(app);
};

/** Closes the shared client. Used by tests and the local dev server. */
export const closeDb = async (): Promise<void> => {
    const current = client;
    client = undefined;
    await current?.close();
};

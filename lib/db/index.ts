import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// For migrations and one-off queries, disable prefetch as it's not supported
const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });

import { drizzle } from "drizzle-orm/d1/driver";
import { sql } from "drizzle-orm/sql/sql";

export interface D1ReadinessRepository {
    check(): Promise<void>;
}

export function createD1ReadinessRepository(binding: D1Database): D1ReadinessRepository {
    const database = drizzle(binding);

    return {
        async check(): Promise<void> {
            await database.run(sql`select 1`);
        },
    };
}

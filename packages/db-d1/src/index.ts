import { drizzle } from "drizzle-orm/d1/driver";
import { sql } from "drizzle-orm/sql/sql";

export async function checkD1Readiness(binding: D1Database): Promise<void> {
    await drizzle(binding).run(sql`select 1`);
}

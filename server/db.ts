import { Pool } from "pg";
export interface Database {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export interface Transactions {
  transaction<T>(run: (db: Database) => Promise<T>): Promise<T>;
}
export function postgres(
  connectionString: string,
): Transactions & { close(): Promise<void> } {
  const pool = new Pool({
    connectionString,
    max: 10,
    statement_timeout: 10_000,
  });
  return {
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run({
          query: async (sql, params) => ({
            rows: (await client.query(sql, params)).rows,
          }),
        });
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

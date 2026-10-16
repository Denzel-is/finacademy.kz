import pg from "pg";
// Public API counts/epochs are numbers; PostgreSQL otherwise returns int8 text.
pg.types.setTypeParser(20, (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error("Database integer exceeds safe range");
  return number;
});

export function postgresSql(source: string) {
  let query = "",
    quote = "",
    parameter = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      query += char;
      if (char === quote) {
        if (source[i + 1] === quote) query += source[++i];
        else quote = "";
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      query += char;
    } else query += char === "?" ? `$${++parameter}` : char;
  }
  return query
    .replace(/\s+COLLATE NOCASE\b/gi, "")
    .replace(/\bWHERE 1\s+ON CONFLICT/gi, "WHERE TRUE ON CONFLICT")
    .replace(/\bjson_group_array\(/g, "jsonb_agg(")
    .replace(/\bjson_group_object\(/g, "jsonb_object_agg(")
    .replace(/\bjson_object\(/g, "jsonb_build_object(")
    .replace(/\bMIN\(strftime\(/g, "LEAST(strftime(")
    .replace(
      /MAX\(proctor_events.duration_ms,excluded.duration_ms\)/g,
      "GREATEST(proctor_events.duration_ms,excluded.duration_ms)",
    )
    .replace(
      /GROUP BY test_id ORDER BY count/g,
      "GROUP BY test_id,test_title ORDER BY count",
    );
}
function databaseError(error: any): never {
  if (error.code === "23505") {
    if (error.constraint === "idx_one_active_attempt")
      throw new Error(
        "UNIQUE constraint failed: attempts.user_id, attempts.test_id",
      );
    throw new Error("UNIQUE constraint failed");
  }
  if (error.code === "23503") throw new Error("FOREIGN KEY constraint failed");
  throw error;
}
type Executor = Pick<pg.Pool, "query">;
// Preserve the original failure, and never return a connection with a failed
// rollback to the pool where a later request could inherit its transaction.
async function rollback(client: pg.PoolClient) {
  try { await client.query("ROLLBACK"); return false; }
  catch (error) {
    console.error("Database rollback failed", (error as { code?: string }).code || "connection_error");
    return true;
  }
}
class Statement {
  constructor(
    public database: PostgresDatabase,
    public query: string,
    public params: any[] = [],
  ) {}
  bind(...params: any[]) {
    return new Statement(this.database, this.query, params);
  }
  async execute(executor: Executor = this.database.pool) {
    try {
      let result;
      if (
        /INSERT INTO attempts\b/i.test(this.query) &&
        executor === this.database.pool
      ) {
        const client = await this.database.pool.connect();
        let discard = false;
        try {
          await client.query("BEGIN");
          // Serialize admission, then evaluate the active-count predicate in a
          // fresh READ COMMITTED statement snapshot after acquiring the lock.
          await client.query("SELECT pg_advisory_xact_lock(48500050)");
          result = await client.query(postgresSql(this.query), this.params);
          await client.query("COMMIT");
        } catch (error) {
          discard = await rollback(client);
          throw error;
        } finally {
          client.release(discard);
        }
      } else
        result = await executor.query(postgresSql(this.query), this.params);
      return {
        results: result.rows,
        success: true,
        meta: { changes: result.rowCount || 0 },
      };
    } catch (error) {
      databaseError(error);
    }
  }
  async first<T = Record<string, unknown>>() {
    return ((await this.execute()).results[0] as T) || null;
  }
  async all<T = Record<string, unknown>>() {
    return (await this.execute()) as {
      results: T[];
      success: boolean;
      meta: { changes: number };
    };
  }
  async run() {
    return this.execute();
  }
}
export class PostgresDatabase {
  constructor(public pool: pg.Pool) {}
  prepare(query: string) {
    return new Statement(this, query);
  }
  async batch(statements: Statement[]) {
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      let discard = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        const results = [];
        for (const statement of statements)
          results.push(await statement.execute(client as Executor));
        await client.query("COMMIT");
        return results;
      } catch (error: any) {
        discard = await rollback(client);
        if (attempt >= 3 || !["40001", "40P01"].includes(error.code))
          throw error;
      } finally {
        client.release(discard);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 10 + Math.random() * 40),
      );
    }
  }
}
export function databasePool() {
  const pool = new pg.Pool({
    host: process.env.PGHOST || "/var/run/postgresql",
    user: process.env.PGUSER || "finacademy",
    database: process.env.PGDATABASE || "finacademy",
    max: 12,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 15000,
    maxLifetimeSeconds: 1800,
    options: "-c search_path=public,fa_compat -c timezone=UTC -c idle_in_transaction_session_timeout=30000",
  });
  // pg emits idle connection failures outside the request promise. Handling
  // this event lets the pool replace that connection instead of crashing Node.
  pool.on("error", (error) => {
    console.error("Idle database connection failed", (error as { code?: string }).code || "connection_error");
  });
  return pool;
}

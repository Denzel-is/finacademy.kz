import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
export function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
  sql.exec(readFileSync('migrations/0003_flows.sql','utf8'));
  sql.exec(readFileSync('migrations/0004_attempt_flow.sql','utf8'));
  const db: any = {
    calls: { first: 0, batch: 0 },
    prepare(query: string) {
      const statement = {
        query,
        params: [] as any[],
        bind(...params: any[]) {
          return { ...statement, params };
        },
        async first() {
          db.calls.first++;
          return sql.prepare(query).get(...this.params) || null;
        },
        async all() {
          return { results: sql.prepare(query).all(...this.params) };
        },
        async run() {
          if (db.beforeRun) await db.beforeRun(query, this.params);
          const s = sql.prepare(query);
          let results: any[] = [],
            changes = 0;
          try {
            results = s.all(...this.params);
            changes = Number(sql.prepare("SELECT changes() AS n").get()!.n);
          } catch (e) {
            if (String(e).includes("does not return data"))
              changes = Number(s.run(...this.params).changes);
            else throw e;
          }
          if (query.includes("SET status=?,finished_at=?"))
            await new Promise((r) => setTimeout(r, 15));
          return { results, meta: { changes }, success: true };
        },
      };
      return statement;
    },
    async batch(statements: any[]) {
      db.calls.batch++;
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { sql, db };
}

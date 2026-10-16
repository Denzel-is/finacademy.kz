import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { digest } from "./security.ts";

const filtersSchema = z.object({
  test_id: z.string().max(120).default(""),
  group_id: z.string().max(120).default(""),
  search: z.string().trim().max(120).default(""),
  status: z.enum(["", "passed", "failed", "active", "completed", "expired", "blocked"]).default(""),
});
const cursorSchema = z.object({
  snapshot: z.iso.datetime(),
  started_at: z.iso.datetime(),
  id: z.string().min(1).max(120),
  filters: z.string().regex(/^[a-f\d]{64}$/),
});
function filters(query: Record<string, string>) {
  const value = filtersSchema.parse(query);
  const clauses: string[] = [], params: (string | number)[] = [];
  if (value.test_id) { clauses.push("a.test_id=?"); params.push(value.test_id); }
  if (value.group_id) { clauses.push("a.group_id_snapshot=?"); params.push(value.group_id); }
  if (value.search) {
    clauses.push("lower(a.student_name || ' ' || u.login || ' ' || a.test_title) LIKE ? ESCAPE '\\'");
    params.push("%" + value.search.toLocaleLowerCase().replace(/[\\%_]/g, "\\$&") + "%");
  }
  if (value.status === "passed") clauses.push("a.passed=1");
  else if (value.status === "failed") clauses.push("a.passed=0 AND a.status<>'active'");
  else if (value.status) { clauses.push("a.status=?"); params.push(value.status); }
  return { where: clauses.length ? clauses.join(" AND ") : "1=1", params, value };
}
const order = " ORDER BY a.started_at DESC,a.id DESC";

export function registerResults(app: any, resultSql: (where: string) => string) {
  app.get("/api/admin/results", async (c: any) => {
    const query = c.req.query(), { where, params } = filters(query);
    if (query.page === undefined) {
      return c.json((await c.env.DB.prepare(resultSql(where) + order + " LIMIT 5000").bind(...params).all()).results);
    }
    const { page, page_size } = z.object({
      page: z.coerce.number().int().min(1).max(1000000),
      page_size: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(query);
    const [stats, rows] = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT COUNT(*) AS total,COUNT(CASE WHEN a.status<>'active' THEN 1 END) AS completed,COALESCE(ROUND(AVG(CASE WHEN a.status<>'active' THEN a.percent END)),0) AS average,COUNT(CASE WHEN a.status='active' AND (a.deadline IS NULL OR a.deadline>?) THEN 1 END) AS active,COALESCE(SUM(a.violation_count),0) AS violations FROM attempts a JOIN users u ON u.id=a.user_id WHERE ${where}`).bind(new Date().toISOString(), ...params),
      c.env.DB.prepare(resultSql(where) + order + " LIMIT ? OFFSET ?").bind(...params, page_size, (page - 1) * page_size),
    ]);
    const { total, ...summary } = stats.results[0];
    return c.json({ items: rows.results, total, stats: summary, page, page_size });
  });
  app.get("/api/admin/results/export", async (c: any) => {
    const { where, params, value } = filters(c.req.query());
    const fingerprint = await digest(JSON.stringify(value));
    let cursor: z.infer<typeof cursorSchema> | null = null;
    const raw = c.req.query("cursor");
    if (raw) {
      try { cursor = cursorSchema.parse(JSON.parse(atob(z.string().max(2048).parse(raw)))); }
      catch { throw new HTTPException(400, { message: "Некорректная страница экспорта. Начните выгрузку заново." }); }
      if (cursor.filters !== fingerprint)
        throw new HTTPException(400, { message: "Фильтры выгрузки изменились. Начните выгрузку заново." });
    }
    const snapshot = cursor?.snapshot || new Date().toISOString();
    const clauses = [where, "a.started_at<=?"];
    params.push(snapshot);
    if (cursor) { clauses.push("(a.started_at<? OR (a.started_at=? AND a.id<?))"); params.push(cursor.started_at, cursor.started_at, cursor.id); }
    const rows: any[] = (await c.env.DB.prepare(resultSql(clauses.join(" AND ")) + order + " LIMIT 501").bind(...params).all()).results;
    const items = rows.slice(0, 500), last = items.at(-1);
    const next_cursor = rows.length > 500 ? btoa(JSON.stringify({ snapshot, started_at: last.started_at, id: last.id, filters: fingerprint })) : null;
    return c.json({ items, next_cursor, snapshot });
  });
}

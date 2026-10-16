import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  digest,
  hashPassword,
  verifyPassword,
  randomPassword,
  randomToken,
  passwordNeedsUpgrade,
  uniquePassword,
  mapConcurrent,
} from "./security.ts";
import { boundedRequest, REQUEST_LIMITS } from "./request.ts";
import {
  finalize,
  publicAttempt,
  shuffle,
  validateAnswers,
  type AttemptRecord,
} from "./exam.ts";
import { normalizeEvent } from "../shared/proctor.ts";
import { certificatePdf } from "./pdf.ts";
import type { User, Test, Question, Answers } from "../shared/types.ts";
import { normalizeLogin } from '../shared/flows.ts';
import { registerFlows } from './flows.ts';
import { registerResults } from './results.ts';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_TIMEZONE: string;
  APP_REVISION?: string;
  BACKGROUND_EXPIRY?: boolean;
  MIGRATION_TARGET?: string;
  MIGRATION_MODE?: string;
};
type App = { Bindings: Env; Variables: { user: User; tokenHash: string; ownedAttempt?: AttemptRecord | null; authMs?: number; launch?: D1Result[] } };
const app = new Hono<App>();
const now = () => new Date().toISOString();
function fail(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 = 400,
): never {
  throw new HTTPException(status, { message });
}
const flag = z.coerce.number().int().min(0).max(1);
const displayLoginSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(
    /^[\p{L}\p{M}\p{N}_.@'’\- ]+$/u,
    "Логин: ФИО либо буквы, цифры, пробел, точка, дефис или @.",
  )
  .transform((s) => s.normalize('NFC').replace(/\s+/gu,' '));
const loginSchema = displayLoginSchema.transform(normalizeLogin);
const studentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  login: displayLoginSchema,
  password: z.string().min(10).max(128).refine(p=>p.trim().length>=10,'Пароль должен содержать минимум 10 значимых символов.').optional(),
  group_id: z.string().nullable().optional(),
  blocked: flag.optional(),
});
const testSchema = z.object({
  title: z.string().trim().min(3).max(180),
  discipline: z.string().trim().min(2).max(120),
  description: z.string().max(2000).default(""),
  question_count: z.coerce.number().int().min(1).max(200),
  pass_percent: z.coerce.number().int().min(0).max(100),
  minutes: z.coerce.number().int().min(0).max(240),
  max_attempts: z.coerce.number().int().min(1).max(20),
  published: flag,
  proctor_mode: z.enum(["off", "log", "warn", "block"]),
  proctor_limit: z.coerce.number().int().min(1).max(50),
  fullscreen: flag,
  show_result: flag,
  show_history: flag,
});
const optionSchema = z.object({
  id: z.string().min(1).max(36),
  text: z.string().trim().min(1).max(2000),
});
const questionSchema = z
  .object({
    test_id: z.string().min(1),
    text: z.string().trim().min(5).max(8000),
    options: z.array(optionSchema).min(2).max(10),
    correct_id: z.string(),
  })
  .refine(
    (q) =>
      new Set(q.options.map((o) => o.id)).size === q.options.length &&
      q.options.some((o) => o.id === q.correct_id),
    "Укажите один правильный вариант; идентификаторы вариантов должны быть уникальны.",
  );
const assignmentSchema = z
  .object({
    test_id: z.string(),
    group_ids: z.array(z.string()).max(100).default([]),
    user_ids: z.array(z.string()).max(500).default([]),
    starts_at: z.string().nullable().default(null),
    ends_at: z.string().nullable().default(null),
    max_attempts: z.coerce.number().int().min(1).max(20),
    minutes: z.coerce.number().int().min(1).max(240).nullable().default(null),
  })
  .refine(
    (v) => v.group_ids.length + v.user_ids.length > 0,
    "Выберите поток или студентов.",
  )
  .refine(
    (v) =>
      (!v.starts_at || Number.isFinite(Date.parse(v.starts_at))) &&
      (!v.ends_at || Number.isFinite(Date.parse(v.ends_at))) &&
      (!v.starts_at ||
        !v.ends_at ||
        Date.parse(v.ends_at) > Date.parse(v.starts_at)),
    "Некорректный период доступа.",
  );
async function body(c: any, max = REQUEST_LIMITS.standard) {
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > max)
    fail("Слишком большой запрос.", 413);
  try {
    return JSON.parse(text);
  } catch {
    return fail("Некорректный JSON.");
  }
}
async function audit(
  db: D1Database,
  user: User,
  action: string,
  details: string,
) {
  await db
    .prepare(
      "INSERT INTO audit_log(id,user_id,action,details,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), user.id, action, details, now())
    .run();
}
async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: any[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...params)
      .all<T>()
  ).results;
}
function resultSql(where = "1=1") {
  return `SELECT a.id,a.user_id,a.test_id,a.test_title,a.student_name,a.group_name,a.status,a.started_at,a.deadline,a.finished_at,a.pass_percent,a.version,a.score,a.percent,a.passed,a.violation_count,a.proctor_mode,a.proctor_limit,a.fullscreen,a.show_result,a.show_history,a.proctor_epoch,json_array_length(a.question_snapshot_json) AS total_questions,u.login FROM attempts a JOIN users u ON u.id=a.user_id WHERE ${where}`;
}

app.use("/api/*", async (c, next) => {
  const started = performance.now();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    const url = new URL(c.req.url);
    if (
      origin &&
      origin !== url.origin &&
      !(url.hostname === "127.0.0.1" && origin === "http://127.0.0.1:5173")
    )
      fail("Запрос с другого сайта запрещён.", 403);
    if (c.req.header("Sec-Fetch-Site") === "cross-site")
      fail("Запрос с другого сайта запрещён.", 403);
    if (!c.req.header("Content-Type")?.startsWith("application/json"))
      fail("Требуется application/json.");
    const limit = c.req.path.startsWith("/api/auth/") ? REQUEST_LIMITS.auth : c.req.path.startsWith("/api/admin/import/") ? REQUEST_LIMITS.import : REQUEST_LIMITS.standard;
    c.req.raw = await boundedRequest(c.req.raw, limit);
  }
  await next();
  const total = performance.now() - started;
  const auth = c.get("authMs") || 0;
  c.header("Server-Timing", `authdb;dur=${auth.toFixed(1)},handler;dur=${Math.max(0, total - auth).toFixed(1)},total;dur=${total.toFixed(1)}`);
  c.header("X-App-Revision", c.env.APP_REVISION || "perf-20261012-5");
  c.header("X-Worker-Colo", String(c.req.raw.cf?.colo || "local"));
});
app.get("/api/health", (c) =>
  c.json({ ok: true, service: "FinanceAcademy", version: "0.1.0" }),
);
app.post("/api/auth/login", async (c) => {
  const input = z
    .object({ login: loginSchema, password: z.string().min(1).max(128) })
    .parse(await body(c));
  const db = c.env.DB,
    time = Date.now(),
    window = 15 * 60 * 1000;
  const keys = await Promise.all([
    digest(`ip:${c.req.header("CF-Connecting-IP") || "local"}`),
    digest(`login:${input.login}`),
  ]);
  const limits = await db.batch([
    ...keys.map((key) =>
      db
        .prepare(
          `INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=? THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<=? THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count,reset_at`,
        )
        .bind(key, time + window, time, time),
    ),
    db
      .prepare(
        "SELECT u.*,g.name AS group_name FROM users u LEFT JOIN groups g ON g.id=u.group_id WHERE COALESCE(u.login_key,lower(u.login))=?",
      )
      .bind(input.login),
  ]);
  if (
    Number((limits[0].results[0] as any)?.count) > 3000 ||
    Number((limits[1].results[0] as any)?.count) > 15
  ) {
    const remaining = Math.max(...limits.slice(0, 2).filter((result, index) => Number((result.results[0] as any)?.count) > (index === 0 ? 3000 : 15)).map((result) => Number((result.results[0] as any)?.reset_at) - time));
    c.header("Retry-After", String(Math.max(1, Math.ceil(remaining / 1000))));
    fail("Слишком много попыток входа. Подождите до 15 минут.", 429);
  }
  const row = limits[2].results[0] as
    (User & { password_hash: string }) | undefined;
  const valid = row
    ? await verifyPassword(input.password, row.password_hash)
    : (await hashPassword(input.password), false);
  if (!row || !valid || row.blocked)
    fail("Неверный логин или пароль либо учётная запись заблокирована.", 401);
  const token = randomToken();
  const tokenHash = await digest(token);
  const upgraded = passwordNeedsUpgrade(row.password_hash) ? await hashPassword(input.password) : row.password_hash;
  const oldToken = getCookie(c, "fa_session");
  const issued = await db.batch([
    ...(upgraded !== row.password_hash ? [db.prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND blocked=0").bind(upgraded,row.id,row.password_hash)] : []),
    db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) SELECT ?,id,? FROM users WHERE id=? AND password_hash=? AND blocked=0 RETURNING token_hash",
      )
      .bind(tokenHash, new Date(time + 12 * 3600000).toISOString(), row.id, upgraded),
    // Rotating the current browser session avoids accumulating old live cookies.
    ...(oldToken ? [db.prepare("DELETE FROM sessions WHERE token_hash=? AND user_id=?").bind(await digest(oldToken), row.id)] : []),
    db.prepare("DELETE FROM rate_limits WHERE key=?").bind(keys[1]),
    db.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now()),
    db.prepare("DELETE FROM rate_limits WHERE reset_at<=?").bind(time),
  ]);
  if (!issued[upgraded !== row.password_hash ? 1 : 0].results.length)
    fail("Доступ изменился во время входа. Войдите снова.", 401);
  setCookie(c, "fa_session", token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: 43200,
  });
  const { password_hash: _, ...user } = row;
  return c.json({ user });
});
// A fresh launch samples, snapshots and enforces access/attempt limits in one
// statement. MATERIALIZED keeps the displayed sample and private key identical.
app.post("/api/student/start", async (c, next) => {
  const token = getCookie(c, "fa_session");
  if (!token) return next();
  const input = z.object({ test_id: z.string() }).parse(await body(c));
  const time = now();
  let inserted: AttemptRecord | null;
  try {
    inserted = await c.env.DB.prepare(`
      WITH candidate AS MATERIALIZED (
        SELECT t.*,COALESCE(a.minutes,t.minutes) AS attempt_minutes,u.id AS student_id,u.name AS student_name,u.group_id AS student_group_id,COALESCE(g.name,'') AS group_name,a.id AS access_id,a.ends_at,a.max_attempts AS allowed_attempts
        FROM sessions session JOIN users u ON u.id=session.user_id LEFT JOIN groups g ON g.id=u.group_id
        JOIN tests t ON t.id=? AND t.published=1
        JOIN assignments a ON a.test_id=t.id AND a.closed=0 AND (a.user_id=u.id OR a.group_id=u.group_id)
        WHERE session.token_hash=? AND session.expires_at>? AND u.blocked=0 AND u.must_change_password=0 AND u.role='student'
          AND NOT EXISTS(SELECT 1 FROM assignments individual WHERE individual.test_id=t.id AND individual.user_id=u.id AND individual.closed=0 AND a.user_id IS NULL)
          AND (a.starts_at IS NULL OR a.starts_at<=?) AND (a.ends_at IS NULL OR a.ends_at>?)
        ORDER BY (a.user_id IS NOT NULL) DESC LIMIT 1
      ), sample AS MATERIALIZED (
        SELECT q.* FROM questions q JOIN candidate c ON q.test_id=c.id WHERE q.archived=0
        ORDER BY random() LIMIT COALESCE((SELECT question_count FROM candidate),0)
      ), bank AS (
        SELECT COUNT(*) AS n,json_group_object(s.id,s.correct_id) AS answer_key,
          json_group_array(json_object('id',s.id,'text',s.text,'options',json((
            SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(s.options_json) ORDER BY random())
          )))) AS snapshot FROM sample s
      )
      INSERT INTO attempts(id,user_id,test_id,assignment_id,test_title,student_name,group_name,group_id_snapshot,started_at,deadline,pass_percent,question_snapshot_json,answer_key_json,proctor_mode,proctor_limit,fullscreen,show_result,show_history)
      SELECT ?,c.student_id,c.id,c.access_id,c.title,c.student_name,c.group_name,c.student_group_id,?,
        CASE WHEN c.attempt_minutes>0 THEN MIN(strftime('%Y-%m-%dT%H:%M:%fZ',?,'+'||c.attempt_minutes||' minutes'),COALESCE(c.ends_at,'9999-12-31T23:59:59.999Z')) ELSE c.ends_at END,
        c.pass_percent,b.snapshot,b.answer_key,c.proctor_mode,c.proctor_limit,c.fullscreen,c.show_result,c.show_history
      FROM candidate c CROSS JOIN bank b WHERE b.n=c.question_count
        AND (SELECT COUNT(*) FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>?))<50
        AND (SELECT COUNT(*) FROM attempts WHERE user_id=c.student_id AND test_id=c.id)<c.allowed_attempts
        AND NOT EXISTS(SELECT 1 FROM attempts WHERE user_id=c.student_id AND test_id=c.id AND status='active')
      RETURNING *`).bind(input.test_id, await digest(token), time, time, time, crypto.randomUUID(), time, time, time).first<AttemptRecord>();
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: attempts.user_id, attempts.test_id")) return next();
    throw error;
  }
  if (inserted) return c.json(publicAttempt(inserted), 201);
  return next();
});
// Idle heartbeats need no question snapshot. Authentication and lease renewal
// stay atomic, with the full handler retaining expiry/conflict/error behavior.
app.post("/api/student/attempts/:id/lease", async (c, next) => {
  const token = getCookie(c, "fa_session");
  if (!token) return next();
  const input = z.object({ clientId: z.uuid(), compact: z.boolean().default(false), force: z.boolean().default(false), release: z.boolean().default(false) }).parse(await body(c));
  if (!input.compact || input.force || input.release) return next();
  const time = Date.now();
  const updated = await c.env.DB.prepare(`UPDATE attempts SET client_lease_until=?
    WHERE id=? AND user_id=(SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.blocked=0 AND u.must_change_password=0 AND u.role='student')
      AND status='active' AND client_id=? AND client_lease_until>=?
      AND (deadline IS NULL OR deadline>?) AND NOT(proctor_mode='block' AND violation_count>=proctor_limit)
    RETURNING status,version,deadline,violation_count,proctor_epoch`).bind(time + 60000, c.req.param("id"), await digest(token), now(), input.clientId, time, now()).first();
  if (updated) return c.json({ ...updated, server_now: now() });
  return next();
});
// Common saves validate ownership, current authentication, lease, version,
// deadline and every question/option atomically in a single database call.
// Stale packets, expired attempts and invalid requests use the full path below.
app.post("/api/student/attempts/:id/save", async (c, next) => {
  const token = getCookie(c, "fa_session");
  if (!token) return next();
  const input = clientSchema.parse(await body(c));
  const encoded = JSON.stringify(input.answers);
  const updated = await c.env.DB.prepare(`
    UPDATE attempts SET answers_json=?,version=?,client_lease_until=?
    WHERE id=? AND user_id=(SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.blocked=0 AND u.must_change_password=0 AND u.role='student')
      AND status='active' AND client_id=? AND client_lease_until>=? AND version<?
      AND (deadline IS NULL OR deadline>?) AND NOT(proctor_mode='block' AND violation_count>=proctor_limit)
      AND NOT EXISTS(SELECT 1 FROM json_each(?) answer WHERE answer.type<>'text' OR NOT EXISTS(
        SELECT 1 FROM json_each(attempts.question_snapshot_json) question,json_each(question.value,'$.options') option
        WHERE json_extract(question.value,'$.id')=answer.key AND json_extract(option.value,'$.id')=answer.value))
    RETURNING version`).bind(encoded, input.version, Date.now() + 60000, c.req.param("id"), await digest(token), now(), input.clientId, Date.now(), input.version, now(), encoded).first<{ version: number }>();
  if (updated) return c.json({ version: updated.version, saved: true });
  return next();
});
app.use("/api/*", async (c, next) => {
  const authStarted = performance.now();
  const token = getCookie(c, "fa_session");
  if (!token) fail("Войдите в аккаунт.", 401);
  const tokenHash = await digest(token!);
  const authQuery = c.env.DB.prepare(
    "SELECT u.id,u.name,u.login,u.role,u.group_id,u.blocked,u.must_change_password,g.name AS group_name FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN groups g ON g.id=u.group_id WHERE s.token_hash=? AND s.expires_at>?",
  )
    .bind(tokenHash, now());
  // Authentication and owned snapshot are read in one consistent database batch.
  // No session/role cache: blocking, logout and revocation remain immediate.
  const match = new URL(c.req.url).pathname.match(/^\/api\/student\/attempts\/([^/]+)(?:\/(?:lease|save|finish|events|certificate))?$/);
  let user: User | null;
  if (c.req.path === "/api/student/start" && c.req.method === "POST") {
    const input = z.object({ test_id: z.string() }).parse(await body(c));
    const userIdSql = "(SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?)";
    const time = now();
    const result = await c.env.DB.batch([
      authQuery,
      c.env.DB.prepare(`SELECT * FROM attempts WHERE user_id=${userIdSql} AND test_id=? AND status='active'`).bind(tokenHash, time, input.test_id),
      c.env.DB.prepare("SELECT * FROM tests WHERE id=? AND published=1").bind(input.test_id),
      c.env.DB.prepare(`SELECT * FROM assignments WHERE test_id=? AND closed=0 AND (user_id=${userIdSql} OR group_id=(SELECT group_id FROM users WHERE id=${userIdSql})) ORDER BY (user_id IS NOT NULL) DESC LIMIT 1`).bind(input.test_id, tokenHash, time, tokenHash, time),
      c.env.DB.prepare("SELECT id,text,options_json,correct_id FROM questions WHERE test_id=? AND archived=0 ORDER BY random() LIMIT COALESCE((SELECT question_count FROM tests WHERE id=?),0)").bind(input.test_id, input.test_id),
    ]);
    user = (result[0].results[0] as User) || null;
    c.set("launch", result.slice(1));
  } else if (match) {
    const result = await c.env.DB.batch([
      authQuery,
      c.env.DB.prepare("SELECT * FROM attempts WHERE id=? AND user_id=(SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?)")
        .bind(decodeURIComponent(match[1]), tokenHash, now()),
    ]);
    user = (result[0].results[0] as User) || null;
    c.set("ownedAttempt", (result[1].results[0] as AttemptRecord) || null);
  } else user = await authQuery.first<User>();
  if (!user || user.blocked) fail("Сессия завершена. Войдите снова.", 401);
  c.set("user", user);
  c.set("tokenHash", tokenHash);
  c.set("authMs", performance.now() - authStarted);
  if (user.must_change_password && !['/api/auth/me','/api/auth/password','/api/auth/logout'].includes(c.req.path)) fail('Сначала замените временный пароль.',403);
  await next();
});
app.get("/api/auth/me", async (c) =>
  c.json({
    user: c.get("user"),
    settings: Object.fromEntries(
      (
        await all<{ key: string; value: string }>(
          c.env.DB,
          "SELECT * FROM settings",
        )
      ).map((r) => [r.key, r.value]),
    ),
  }),
);
app.post("/api/auth/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
    .bind(c.get("tokenHash"))
    .run();
  deleteCookie(c, "fa_session", { path: "/" });
  return c.json({ ok: true });
});
app.post("/api/auth/password", async (c) => {
  const input = z
    .object({
      current: z.string().max(128),
      password: z.string().min(10).max(128).refine(password => password.trim().length >= 10, "Пароль должен содержать минимум 10 значимых символов."),
    })
    .parse(await body(c));
  const rateKey = await digest("password-change:" + c.get("user").id), time = Date.now();
  const rate = await c.env.DB.prepare("INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=? THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<=? THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count,reset_at").bind(rateKey,time+15*60000,time,time).first<{count:number;reset_at:number}>();
  if (Number(rate?.count) > 10) {
    c.header("Retry-After", String(Math.max(1, Math.ceil((Number(rate?.reset_at) - time) / 1000))));
    fail("Слишком много попыток смены пароля. Подождите до 15 минут или обратитесь к администратору.",429);
  }
  const row = await c.env.DB.prepare(
    "SELECT password_hash FROM users WHERE id=?",
  )
    .bind(c.get("user").id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(input.current, row.password_hash)))
    fail("Текущий пароль неверен.");
  const changed = await c.env.DB.prepare('UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND password_hash=?').bind(await hashPassword(input.password),c.get('user').id,row.password_hash).run();
  if (!changed.meta.changes) fail('Пароль уже изменён или сброшен. Войдите снова.',409);
  await c.env.DB.prepare(
      "DELETE FROM sessions WHERE user_id=? AND token_hash<>?",
    ).bind(c.get("user").id, c.get("tokenHash")).run();
  await c.env.DB.prepare("DELETE FROM rate_limits WHERE key=?").bind(rateKey).run();
  return c.json({ ok: true });
});

app.use("/api/admin/*", async (c, next) => {
  if (c.get("user").role === "student") fail("Недостаточно прав.", 403);
  await next();
});
registerFlows(app);
app.get("/api/admin/active-count", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS active FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>?)").bind(now()).first<{ active: number }>();
  return c.json({ active: row?.active || 0, server_now: now() });
});
app.get("/api/admin/dashboard", async (c) => {
  const db = c.env.DB;
  // The VPS sweeper owns expiry; retain recovery for environments without it.
  if (!c.env.BACKGROUND_EXPIRY) {
  const expired = await all<{ id: string }>(
    db,
    "SELECT id FROM attempts WHERE status='active' AND deadline IS NOT NULL AND deadline<? LIMIT 30",
    now(),
  );
  for (const row of expired) await finalize(db, row.id, undefined, "expired");
  }
  const [stats, recent, trend, activity, popular] = await Promise.all([
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM users WHERE role='student') AS students,(SELECT COUNT(*) FROM groups) AS groups,(SELECT COUNT(*) FROM tests WHERE published=1) AS tests,COUNT(CASE WHEN status<>'active' THEN 1 END) AS completed,COUNT(CASE WHEN status='active' AND (deadline IS NULL OR deadline>?) THEN 1 END) AS active,COALESCE(ROUND(AVG(CASE WHEN status<>'active' THEN percent END),1),0) AS average,COUNT(CASE WHEN passed=1 THEN 1 END) AS passed,COALESCE(SUM(violation_count),0) AS violations FROM attempts`,
      )
      .bind(now())
      .first(),
    all(db, resultSql() + " ORDER BY a.started_at DESC LIMIT 6"),
    all(
      db,
      "SELECT substr(finished_at,1,10) AS day,COUNT(*) AS completed,SUM(passed) AS passed FROM attempts WHERE finished_at>=? GROUP BY day ORDER BY day",
      new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10),
    ),
    all(
      db,
      "SELECT a.*,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 5",
    ),
    all(
      db,
      "SELECT test_title AS title,COUNT(*) AS count,ROUND(AVG(percent),1) AS average FROM attempts WHERE status<>'active' GROUP BY test_id ORDER BY count DESC LIMIT 4",
    ),
  ]);
  return c.json({ ...stats, recent, trend, activity, popular });
});
app.get("/api/admin/students", async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT u.id,u.name,u.login,u.role,u.group_id,u.blocked,u.created_at,g.name AS group_name,(SELECT COUNT(DISTINCT test_id) FROM assignments a WHERE a.closed=0 AND (a.user_id=u.id OR a.group_id=u.group_id)) AS test_count FROM users u LEFT JOIN groups g ON g.id=u.group_id WHERE u.role='student' ORDER BY u.created_at DESC`,
    ),
  ),
);
app.post("/api/admin/students", async (c) => {
  const input = studentSchema.parse(await body(c));
  const id = crypto.randomUUID(),
    password = input.password || randomPassword();
  if (
    input.group_id &&
    !(await c.env.DB.prepare("SELECT id FROM groups WHERE id=?")
      .bind(input.group_id)
      .first())
  )
    fail("Группа не найдена.");
  await c.env.DB.prepare(
    "INSERT INTO users(id,name,login,login_key,password_hash,must_change_password,role,group_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      input.name,
      input.login,
      normalizeLogin(input.login),
      await hashPassword(password),
      1,
      "student",
      input.group_id || null,
      now(),
    )
    .run();
  await audit(c.env.DB, c.get("user"), "student.create", input.name);
  return c.json({ id, login: input.login, password }, 201);
});
app.put("/api/admin/students/:id", async (c) => {
  const input = studentSchema
    .omit({ password: true })
    .partial()
    .parse(await body(c));
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM users WHERE id=? AND role='student'",
  )
    .bind(id)
    .first<User>();
  if (!row) fail("Студент не найден.", 404);
  const next = { ...row, ...input };
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE users SET name=?,login=?,login_key=?,group_id=?,blocked=? WHERE id=?",
    ).bind(next.name, next.login, normalizeLogin(next.login), next.group_id || null, next.blocked, id),
    ...(next.blocked
      ? [c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id)]
      : []),
  ]);
  await audit(c.env.DB, c.get("user"), "student.update", next.name);
  return c.json({ ok: true });
});
app.post("/api/admin/students/:id/reset-password", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id,login FROM users WHERE id=? AND role='student'",
  )
    .bind(id)
    .first<{ id: string; login: string }>();
  if (!row) fail("Студент не найден.", 404);
  const password = randomPassword();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash=?,must_change_password=1 WHERE id=?").bind(
      await hashPassword(password),
      id,
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM rate_limits WHERE key IN(?,?)").bind(await digest('login:'+normalizeLogin(row.login)), await digest('password-change:'+id)),
  ]);
  await audit(c.env.DB, c.get("user"), "student.password-reset", row.login);
  return c.json({ login: row.login, password });
});
app.get("/api/admin/groups", async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT g.*,(SELECT COUNT(*) FROM users u WHERE u.group_id=g.id AND u.role='student') AS student_count,(SELECT COUNT(*) FROM assignments a WHERE a.group_id=g.id AND a.closed=0) AS assignment_count FROM groups g ORDER BY name`,
    ),
  ),
);
app.post("/api/admin/groups", async (c) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(80),
      description: z.string().max(1000).default(""),
    })
    .parse(await body(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO groups(id,name,description,created_at) VALUES(?,?,?,?)",
  )
    .bind(id, input.name, input.description, now())
    .run();
  await audit(c.env.DB, c.get("user"), "group.create", input.name);
  return c.json({ id }, 201);
});
app.put("/api/admin/groups/:id", async (c) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(80),
      description: z.string().max(1000).default(""),
    })
    .parse(await body(c));
  await c.env.DB.prepare("UPDATE groups SET name=?,description=? WHERE id=?")
    .bind(input.name, input.description, c.req.param("id"))
    .run();
  await audit(c.env.DB, c.get("user"), "group.update", input.name);
  return c.json({ ok: true });
});
app.get("/api/admin/tests", async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT t.*,(SELECT COUNT(*) FROM questions q WHERE q.test_id=t.id AND archived=0) AS bank_count,(SELECT COUNT(*) FROM assignments a WHERE a.test_id=t.id AND closed=0) AS assigned_count FROM tests t ORDER BY t.demo ASC,t.created_at DESC`,
    ),
  ),
);
app.post("/api/admin/tests", async (c) => {
  const input = testSchema.parse(await body(c));
  if (input.published)
    fail("Сначала добавьте вопросы в новый тест, затем опубликуйте его.");
  const id = crypto.randomUUID();
  const keys = Object.keys(input);
  await c.env.DB.prepare(
    `INSERT INTO tests(id,${keys.join(",")},created_at) VALUES(${Array(
      keys.length + 2,
    )
      .fill("?")
      .join(",")})`,
  )
    .bind(id, ...Object.values(input), now())
    .run();
  await audit(c.env.DB, c.get("user"), "test.create", input.title);
  return c.json({ id }, 201);
});
app.put("/api/admin/tests/:id", async (c) => {
  const input = testSchema.parse(await body(c));
  const id = c.req.param("id");
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM questions WHERE test_id=? AND archived=0",
  )
    .bind(id)
    .first<{ n: number }>();
  if (input.published && Number(count?.n) < input.question_count)
    fail(`Для публикации нужно минимум ${input.question_count} вопросов.`);
  await c.env.DB.prepare(
    `UPDATE tests SET ${Object.keys(input)
      .map((k) => `${k}=?`)
      .join(",")} WHERE id=?`,
  )
    .bind(...Object.values(input), id)
    .run();
  await audit(c.env.DB, c.get("user"), "test.update", input.title);
  return c.json({ ok: true });
});
app.get("/api/admin/questions", async (c) => {
  const id = c.req.query("test_id");
  const rows = await all<any>(
    c.env.DB,
    `SELECT id,test_id,text,options_json,correct_id,archived FROM questions ${id ? "WHERE test_id=?" : ""} ORDER BY created_at DESC`,
    ...(id ? [id] : []),
  );
  return c.json(
    rows.map(({ options_json, ...row }) => ({
      ...row,
      options: JSON.parse(options_json),
    })),
  );
});
async function questionHash(q: { text: string; options: { text: string }[] }) {
  return digest(
    q.text.trim().toLowerCase() +
      "|" +
      q.options
        .map((o) => o.text.trim().toLowerCase())
        .sort()
        .join("|"),
  );
}
app.post("/api/admin/questions", async (c) => {
  const input = questionSchema.parse(await body(c));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      input.test_id,
      input.text,
      JSON.stringify(input.options),
      input.correct_id,
      await questionHash(input),
      now(),
    )
    .run();
  await audit(
    c.env.DB,
    c.get("user"),
    "question.create",
    input.text.slice(0, 100),
  );
  return c.json({ id }, 201);
});
app.put("/api/admin/questions/:id", async (c) => {
  const input = questionSchema
    .safeExtend({ archived: flag.default(0) })
    .parse(await body(c));
  await c.env.DB.prepare(
    "UPDATE questions SET text=?,options_json=?,correct_id=?,content_hash=?,archived=? WHERE id=? AND test_id=?",
  )
    .bind(
      input.text,
      JSON.stringify(input.options),
      input.correct_id,
      await questionHash(input),
      input.archived,
      c.req.param("id"),
      input.test_id,
    )
    .run();
  await audit(
    c.env.DB,
    c.get("user"),
    "question.update",
    input.text.slice(0, 100),
  );
  return c.json({ ok: true });
});
app.get("/api/admin/assignments", async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT a.*,t.title,t.minutes AS test_minutes,COALESCE(g.name,u.name) AS target_name,CASE WHEN a.group_id IS NOT NULL THEN (SELECT COUNT(*) FROM users WHERE group_id=a.group_id AND role='student') ELSE 1 END AS student_count FROM assignments a JOIN tests t ON t.id=a.test_id LEFT JOIN groups g ON g.id=a.group_id LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC`,
    ),
  ),
);
app.post("/api/admin/assignments", async (c) => {
  const input = assignmentSchema.parse(await body(c));
  const test = await c.env.DB.prepare(
    "SELECT id,minutes FROM tests WHERE id=? AND published=1",
  )
    .bind(input.test_id)
    .first();
  if (!test) fail("Сначала опубликуйте тест.");
  if (input.minutes === null && Number(test.minutes) < 1)
    fail("Укажите время прохождения теста от 1 до 240 минут.");
  const statements = [...new Set(input.group_ids)]
    .map((id) => ({ group: id, user: null as string | null }))
    .concat(
      [...new Set(input.user_ids)].map((id) => ({
        group: null as any,
        user: id,
      })),
    );
  const [groupRows, userRows] = await Promise.all([
    all<{ id: string }>(
      c.env.DB,
      "SELECT id FROM groups WHERE id IN(SELECT value FROM json_each(?))",
      JSON.stringify(input.group_ids),
    ),
    all<{ id: string }>(
      c.env.DB,
      "SELECT id FROM users WHERE role='student' AND id IN(SELECT value FROM json_each(?))",
      JSON.stringify(input.user_ids),
    ),
  ]);
  const groupIds = new Set(groupRows.map((g) => g.id)),
    userIds = new Set(userRows.map((u) => u.id));
  if (
    statements.some((t) =>
      t.group ? !groupIds.has(t.group) : !userIds.has(t.user!),
    )
  )
    fail("Одна из групп или студентов не найдена.");
  const targets = statements.map((t) => ({
    id: crypto.randomUUID(),
    group: t.group,
    user: t.user,
  }));
  await c.env.DB.batch((["group", "user"] as const).map((kind) => c.env.DB.prepare(
    `INSERT INTO assignments(id,test_id,group_id,user_id,starts_at,ends_at,max_attempts,created_at,minutes) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.group'),json_extract(value,'$.user'),?,?,?,?,? FROM json_each(?) WHERE 1 ON CONFLICT(test_id,${kind}_id) WHERE ${kind}_id IS NOT NULL DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,max_attempts=excluded.max_attempts,minutes=excluded.minutes,closed=0`,
  ).bind(
      input.test_id,
      input.starts_at ? new Date(input.starts_at).toISOString() : null,
      input.ends_at ? new Date(input.ends_at).toISOString() : null,
      input.max_attempts,
      now(),
      input.minutes,
      JSON.stringify(targets.filter((target) => target[kind] !== null)),
    )));
  await audit(
    c.env.DB,
    c.get("user"),
    "assignment.create",
    `Назначений: ${statements.length}`,
  );
  return c.json({ count: statements.length });
});
app.post("/api/admin/assignments/:id/close", async (c) => {
  await c.env.DB.prepare("UPDATE assignments SET closed=1 WHERE id=?")
    .bind(c.req.param("id"))
    .run();
  await audit(
    c.env.DB,
    c.get("user"),
    "assignment.close",
    "Доступ закрыт для новых попыток",
  );
  return c.json({ ok: true });
});
registerResults(app, resultSql);
app.get("/api/admin/attempts/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM attempts WHERE id=?")
    .bind(c.req.param("id"))
    .first<AttemptRecord>();
  if (!row) fail("Попытка не найдена.", 404);
  const current = await finalize(c.env.DB, row.id, undefined, undefined, row);
  const events = await all(
    c.env.DB,
    "SELECT * FROM proctor_events WHERE attempt_id=? ORDER BY epoch DESC,occurred_at DESC LIMIT 200",
    row.id,
  );
  const journal = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM proctor_events WHERE attempt_id=?").bind(row.id).first<{count:number}>();
  return c.json({
    attempt: publicAttempt(current, true),
    events,
    correct_answers: JSON.parse(current.answer_key_json),
    event_count: journal?.count || 0,
    events_has_more: Number(journal?.count || 0) > events.length,
    log_truncated: Number(journal?.count || 0) >= 1000,
  });
});
app.get("/api/admin/audit", async (c) =>
  c.json(
    await all(
      c.env.DB,
      "SELECT a.*,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200",
    ),
  ),
);
app.put("/api/admin/settings", async (c) => {
  const input = z
    .object({
      academy_name: z.string().trim().min(2).max(120),
      support_email: z.union([z.email(), z.literal("")]),
      timezone: z.enum(["Asia/Almaty", "Asia/Aqtobe", "Europe/Moscow"]),
    })
    .parse(await body(c));
  await c.env.DB.batch(
    Object.entries(input).map(([key, value]) =>
      c.env.DB.prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(key, value),
    ),
  );
  await audit(
    c.env.DB,
    c.get("user"),
    "settings.update",
    "Настройки организации",
  );
  return c.json({ ok: true });
});
app.get("/api/admin/administrators", async (c) => {
  return c.json(
    await all(
      c.env.DB,
      "SELECT id,name,login,role,blocked FROM users WHERE role<>'student' AND blocked=0",
    ),
  );
});
app.post("/api/admin/administrators", async (c) => {
  const input = studentSchema.parse(await body(c));
  if (input.password && input.password.length < 10)
    fail("Пароль администратора должен содержать минимум 10 символов.");
  const password = input.password || randomPassword();
  await c.env.DB.prepare(
    "INSERT INTO users(id,name,login,login_key,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      input.name,
      input.login,
      normalizeLogin(input.login),
      await hashPassword(password),
      "admin",
      now(),
    )
    .run();
  await audit(c.env.DB, c.get("user"), "admin.create", input.login);
  return c.json({ login: input.login, password }, 201);
});

// Student routes are role-bound, ownership-checked, and never return answer keys.
app.use("/api/student/*", async (c, next) => {
  if (c.get("user").role !== "student")
    fail("Откройте кабинет студента с учётной записью студента.", 403);
  await next();
});
app.get("/api/student/tests", async (c) => {
  const user = c.get("user"),
    db = c.env.DB;
  const rows = await all<any>(
    db,
    `SELECT t.*,COALESCE(a.minutes,t.minutes) AS minutes,a.id AS access_id,a.starts_at,a.ends_at,a.max_attempts AS access_attempts,(SELECT COUNT(*) FROM attempts p WHERE p.user_id=? AND p.test_id=t.id) AS attempts_used,(SELECT id FROM attempts p WHERE p.user_id=? AND p.test_id=t.id AND p.status='active') AS active_attempt FROM tests t JOIN assignments a ON a.id=COALESCE((SELECT id FROM assignments s WHERE s.test_id=t.id AND s.closed=0 AND (s.user_id=? OR s.group_id=?) ORDER BY (s.user_id IS NOT NULL) DESC LIMIT 1),(SELECT assignment_id FROM attempts p WHERE p.user_id=? AND p.test_id=t.id AND p.status='active')) WHERE t.published=1 OR EXISTS(SELECT 1 FROM attempts p WHERE p.user_id=? AND p.test_id=t.id AND p.status='active') ORDER BY t.demo ASC,t.created_at DESC`,
    user.id,
    user.id,
    user.id,
    user.group_id,
    user.id,
    user.id,
  );
  return c.json(
    rows.map(({ access_id, starts_at, ends_at, access_attempts, ...test }) => ({
      ...test,
      access: {
        id: access_id,
        starts_at,
        ends_at,
        max_attempts: access_attempts,
      },
    })),
  );
});
app.get("/api/student/results", async (c) => {
  const rows = await all<any>(
    c.env.DB,
    resultSql("a.user_id=? AND a.status<>'active' AND a.show_history=1") +
      " ORDER BY a.finished_at DESC",
    c.get("user").id,
  );
  return c.json(
    rows.map((r) =>
      r.show_result ? r : { ...r, score: null, percent: null, passed: null },
    ),
  );
});
app.post("/api/student/start", async (c) => {
  const input = z.object({ test_id: z.string() }).parse(await body(c));
  const db = c.env.DB,
    user = c.get("user");
  // One round trip reads a consistent launch snapshot under a simultaneous start burst.
  const launch = c.get("launch") || await db.batch([
    db
      .prepare(
        "SELECT * FROM attempts WHERE user_id=? AND test_id=? AND status='active'",
      )
      .bind(user.id, input.test_id),
    db
      .prepare("SELECT * FROM tests WHERE id=? AND published=1")
      .bind(input.test_id),
    db
      .prepare(
        "SELECT * FROM assignments WHERE test_id=? AND closed=0 AND (user_id=? OR group_id=?) ORDER BY (user_id IS NOT NULL) DESC LIMIT 1",
      )
      .bind(input.test_id, user.id, user.group_id),
    db
      .prepare(
        "SELECT id,text,options_json,correct_id FROM questions WHERE test_id=? AND archived=0 ORDER BY random() LIMIT COALESCE((SELECT question_count FROM tests WHERE id=?),0)",
      )
      .bind(input.test_id, input.test_id),
  ]);
  const existing = launch[0].results[0] as AttemptRecord | undefined;
  if (existing) {
    const row = await finalize(db, existing.id, undefined, undefined, existing);
    if (row.status === "active") return c.json(publicAttempt(row));
  }
  const test = launch[1].results[0] as Test | undefined;
  if (!test) fail("Тест недоступен.", 403);
  const access = launch[2].results[0] as any;
  if (!access) fail("Тест вам не назначен.", 403);
  const bank = launch[3].results as any[];
  const time = now();
  if (access.starts_at && access.starts_at > time)
    fail("Период доступа ещё не начался.", 403);
  if (access.ends_at && access.ends_at <= time)
    fail("Период доступа завершён.", 403);
  if (bank.length < test.question_count)
    fail("В банке недостаточно вопросов. Сообщите администратору.");
  const chosen = shuffle(bank).slice(0, test.question_count);
  const key = Object.fromEntries(chosen.map((q) => [q.id, q.correct_id]));
  const questions = chosen.map((q) => ({
    id: q.id,
    text: q.text,
    options: shuffle(JSON.parse(q.options_json)),
  }));
  const id = crypto.randomUUID();
  const durationMinutes = access.minutes ?? test.minutes;
  const capacity = await db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>?)").bind(time).first<{n:number}>();
  if ((capacity?.n || 0) >= 50) fail('Сейчас тест проходят 50 студентов. Дождитесь свободного места.',429);
  const deadline = durationMinutes
    ? new Date(
        Math.min(
          Date.now() + durationMinutes * 60000,
          access.ends_at ? Date.parse(access.ends_at) : Infinity,
        ),
      ).toISOString()
    : access.ends_at;
  let inserted: AttemptRecord | null = null;
  try {
    inserted = await db
      .prepare(
        `INSERT INTO attempts(id,user_id,test_id,assignment_id,test_title,student_name,group_name,group_id_snapshot,started_at,deadline,pass_percent,question_snapshot_json,answer_key_json,proctor_mode,proctor_limit,fullscreen,show_result,show_history)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM attempts WHERE user_id=? AND test_id=?)<? AND EXISTS(SELECT 1 FROM assignments WHERE id=? AND closed=0 AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?) AND max_attempts=?) AND EXISTS(SELECT 1 FROM tests WHERE id=? AND published=1) AND (SELECT COUNT(*) FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>?))<50 RETURNING *`,
      )
      .bind(
        id,
        user.id,
        test.id,
        access.id,
        test.title,
        user.name,
        user.group_name || "",
        user.group_id,
        time,
        deadline || null,
        test.pass_percent,
        JSON.stringify(questions),
        JSON.stringify(key),
        test.proctor_mode,
        test.proctor_limit,
        test.fullscreen,
        test.show_result,
        test.show_history,
        user.id,
        test.id,
        access.max_attempts,
        access.id,
        time,
        time,
        access.max_attempts,
        test.id,
        time,
      )
      .first<AttemptRecord>();
    if (!inserted) {
      const full = await db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE status='active' AND (deadline IS NULL OR deadline>?)").bind(now()).first<{n:number}>();
      if ((full?.n || 0)>=50) fail("Сейчас тест проходят 50 студентов. Дождитесь свободного места.",429);
      fail("Попытки закончились или доступ изменился.",403);
    }
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const active = await db
      .prepare(
        "SELECT * FROM attempts WHERE user_id=? AND test_id=? AND status='active'",
      )
      .bind(user.id, test.id)
      .first<AttemptRecord>();
    if (active) return c.json(publicAttempt(active));
    throw error;
  }
  return c.json(publicAttempt(inserted!), 201);
});
async function owned(c: any): Promise<AttemptRecord> {
  if (c.get("ownedAttempt") !== undefined) {
    const row = c.get("ownedAttempt");
    if (!row) fail("Попытка не найдена.", 404);
    return row;
  }
  const row = await c.env.DB.prepare(
    "SELECT * FROM attempts WHERE id=? AND user_id=?",
  )
    .bind(c.req.param("id"), c.get("user").id)
    .first();
  if (!row) fail("Попытка не найдена.", 404);
  return row as AttemptRecord;
}
app.get("/api/student/attempts/:id", async (c) => {
  const row = await owned(c);
  if (row.status !== "active" && !row.show_history)
    fail("Просмотр истории отключён.", 403);
  return c.json(
    publicAttempt(await finalize(c.env.DB, row.id, undefined, undefined, row)),
  );
});
const clientSchema = z.object({
  clientId: z.uuid(),
  version: z.number().int().min(0).max(2147483647),
  answers: z.record(z.string(), z.string()),
});
app.post("/api/student/attempts/:id/lease", async (c) => {
  const row = await owned(c);
  const current = await finalize(c.env.DB, row.id, undefined, undefined, row);
  if (current.status !== "active") return c.json(publicAttempt(current));
  const input = z
    .object({
      clientId: z.uuid(),
      force: z.boolean().default(false),
      release: z.boolean().default(false),
    })
    .parse(await body(c));
  if (input.release) {
    await c.env.DB.prepare(
      "UPDATE attempts SET client_lease_until=0 WHERE id=? AND client_id=?",
    )
      .bind(row.id, input.clientId)
      .run();
    return c.json({ ok: true });
  }
  const updated = await c.env.DB.prepare(
    "UPDATE attempts SET client_id=?,client_lease_until=? WHERE id=? AND status='active' AND (client_id=? OR client_lease_until<? OR ?=1) RETURNING *",
  )
    .bind(
      input.clientId,
      Date.now() + 60000,
      row.id,
      input.clientId,
      Date.now(),
      Number(input.force),
    )
    .first<AttemptRecord>();
  if (!updated)
    fail(
      "Тест открыт в другой вкладке. Закройте её или подключите эту вкладку.",
      409,
    );
  return c.json(publicAttempt(updated));
});
app.post("/api/student/attempts/:id/save", async (c) => {
  const row = await owned(c);
  const current = await finalize(c.env.DB, row.id, undefined, undefined, row);
  if (current.status !== "active")
    return c.json({
      attempt: publicAttempt(current),
      version: current.version,
    });
  const input = clientSchema.parse(await body(c));
  const answers = validateAnswers(
    input.answers,
    JSON.parse(row.question_snapshot_json),
  );
  if (row.client_id !== input.clientId || row.client_lease_until < Date.now())
    fail("Тест открыт в другой вкладке. Подключитесь заново.", 409);
  const updated = await c.env.DB.prepare(
    "UPDATE attempts SET answers_json=?,version=?,client_lease_until=? WHERE id=? AND status='active' AND client_id=? AND version<? AND client_lease_until>=? AND (deadline IS NULL OR deadline>?) AND NOT(proctor_mode='block' AND violation_count>=proctor_limit) RETURNING version,client_id,status",
  )
    .bind(
      JSON.stringify(answers),
      input.version,
      Date.now() + 60000,
      row.id,
      input.clientId,
      input.version,
      Date.now(),
      now(),
    )
    .first<AttemptRecord>();
  let latest =
    updated ||
    (await c.env.DB.prepare("SELECT * FROM attempts WHERE id=?")
      .bind(row.id)
      .first<AttemptRecord>());
  if (!latest) fail("Попытка не найдена.", 404);
  if (!updated) latest = await finalize(c.env.DB, row.id, undefined, undefined, latest);
  if (latest.status !== "active") return c.json({version:latest.version,attempt:publicAttempt(latest)});
  if (latest.client_id !== input.clientId)
    fail("Попытка перехвачена другой вкладкой.", 409);
  if (!updated && latest.status === "active" && latest.client_lease_until < Date.now())
    fail("Попытка открыта в другой вкладке. Подключитесь заново.", 409);
  if (!updated && input.version === latest.version) {
    const saved = JSON.parse(latest.answers_json) as Answers;
    if (Object.keys(saved).length !== Object.keys(answers).length || Object.entries(answers).some(([id,value])=>saved[id]!==value))
      fail("Ответы изменились. Подключитесь заново, чтобы сравнить версии.",409);
    await c.env.DB.prepare("UPDATE attempts SET client_lease_until=? WHERE id=? AND client_id=? AND status='active' AND client_lease_until>=? AND (deadline IS NULL OR deadline>?)")
      .bind(Date.now()+60000,row.id,input.clientId,Date.now(),now()).run();
  }
  return c.json({
    version: latest.version,
    saved: Boolean(updated),
    attempt: latest.status === "active" ? undefined : publicAttempt(latest),
  });
});
app.post("/api/student/attempts/:id/finish", async (c) => {
  const row = await owned(c);
  const input = clientSchema.parse(await body(c));
  return c.json(
    publicAttempt(await finalize(c.env.DB, row.id, input, undefined, row)),
  );
});
app.post("/api/student/attempts/:id/events", async (c) => {
  const row = await owned(c);
  const input = z
    .object({
      clientId: z.uuid(),
      epoch: z.number().int().min(0),
      events: z.array(z.unknown()).max(50),
    })
    .parse(await body(c));
  if (row.proctor_mode === "off" || input.epoch !== row.proctor_epoch)
    return c.json({
      violation_count: row.violation_count,
      stale: input.epoch !== row.proctor_epoch,
    });
  if (row.client_id !== input.clientId)
    fail("Тест открыт в другой вкладке.", 409);
  if (row.status === 'active' && (!row.deadline || row.deadline > now()) && row.client_lease_until < Date.now())
    fail("Попытка открыта в другой вкладке. Подключитесь заново.",409);
  const events = input.events.map((e) => normalizeEvent(e));
  if (events.some((e) => !e)) fail("Неверное событие контроля.");
  const queries = events.map((event) => {
    const e = event!;
    const counted = Number(["focus", "hidden", "fullscreen"].includes(e.kind));
    return c.env.DB.prepare(
      `INSERT INTO proctor_events(attempt_id,epoch,event_id,kind,occurred_at,received_at,returned_at,duration_ms,question_code,counted)
      SELECT id,proctor_epoch,?,?,?,?,?,?,?,? FROM attempts WHERE id=? AND proctor_epoch=? AND client_id=? AND ((status='active' AND (deadline IS NULL OR deadline>?) AND client_lease_until>=?) OR EXISTS(SELECT 1 FROM proctor_events WHERE attempt_id=? AND epoch=? AND event_id=?)) AND ((SELECT COUNT(*) FROM proctor_events WHERE attempt_id=?)<1000 OR EXISTS(SELECT 1 FROM proctor_events WHERE attempt_id=? AND epoch=? AND event_id=?))
      ON CONFLICT(attempt_id,epoch,event_id) DO UPDATE SET returned_at=COALESCE(proctor_events.returned_at,excluded.returned_at),duration_ms=MAX(proctor_events.duration_ms,excluded.duration_ms) RETURNING event_id`,
    ).bind(
      e.id,
      e.kind,
      e.occurredAt,
      now(),
      e.returnedAt || null,
      e.durationMs || 0,
      e.questionCode || "",
      counted,
      row.id,
      input.epoch,
      input.clientId,
      now(),
      Date.now(),
      row.id,
      input.epoch,
      e.id,
      row.id,
      row.id,
      input.epoch,
      e.id,
    );
  });
  queries.push(
    c.env.DB.prepare(
      "UPDATE attempts SET violation_count=(SELECT COUNT(*) FROM proctor_events WHERE attempt_id=? AND epoch=? AND counted=1) WHERE id=? AND proctor_epoch=? AND status='active'",
    ).bind(row.id, input.epoch, row.id, input.epoch),
  );
  queries.unshift(c.env.DB.prepare("UPDATE attempts SET client_lease_until=? WHERE id=? AND client_id=? AND status='active' AND client_lease_until>=? AND (deadline IS NULL OR deadline>?) AND proctor_epoch=?")
    .bind(Date.now()+60000,row.id,input.clientId,Date.now(),now(),input.epoch));
  queries.push(c.env.DB.prepare("SELECT COUNT(*) AS count FROM proctor_events WHERE attempt_id=?").bind(row.id));
  const stored = await c.env.DB.batch(queries);
  const accepted = new Set(stored.slice(1, events.length + 1).flatMap(result => result.results.map((event: any) => String(event.event_id))));
  const rejected = events.filter(event => !accepted.has(event!.id)).map(event => event!.id);
  const current = await finalize(c.env.DB, row.id);
  if (current.status === 'active' && current.client_id !== input.clientId)
    fail("Попытка открыта в другой вкладке. Подключитесь заново.",409);
  return c.json({
    stale: current.proctor_epoch !== input.epoch,
    violation_count: current.violation_count,
    accepted_event_ids: [...accepted],
    rejected_event_ids: [...new Set(rejected)],
    log_truncated: Number((stored.at(-1)!.results[0] as any)?.count || 0) >= 1000,
    attempt: current.status !== "active" ? publicAttempt(current) : undefined,
  });
});

// Imports use browser-side Excel decoding and repeat server validation at commit.
const importRow = z
  .object({
    name: z.string().trim().min(2).max(120),
    login: displayLoginSchema,
    password: z.string().max(128).default(""),
    group: z.string().trim().max(80).default(""),
  })
  .refine(
    (r) => !r.password || r.password === "Авто" || r.password.trim().length >= 10,
    "Пароль должен содержать минимум 10 значимых символов.",
  );
const importSchema = z.object({
  rows: z.array(z.unknown()).min(1).max(500),
  mode: z.enum(["skip", "update"]).default("skip"),
});
async function previewStudents(
  db: D1Database,
  input: z.infer<typeof importSchema>,
) {
  const seen = new Set<string>();
  const existing = new Set(
    (await all<{ login: string }>(db, "SELECT login FROM users")).map((u) =>
      normalizeLogin(u.login),
    ),
  );
  return input.rows.map((raw, index) => {
    const parsed = importRow.safeParse(raw);
    if (!parsed.success)
      return {
        row: index + 2,
        status: "error",
        errors: parsed.error.issues.map((i) => i.message).join("; "),
        data: raw,
      };
    const r = parsed.data;
    const loginKey = normalizeLogin(r.login);
    if (seen.has(loginKey))
      return {
        row: index + 2,
        status: "error",
        errors: "Логин повторяется в файле.",
        data: r,
      };
    seen.add(loginKey);
    return {
      row: index + 2,
      status: existing.has(loginKey)
        ? input.mode === "skip"
          ? "skip"
          : "update"
        : "create",
      errors: "",
      data: r,
    };
  });
}
app.post("/api/admin/import/students/preview", async (c) => {
  const input = importSchema.parse(await body(c, REQUEST_LIMITS.import));
  return c.json(await previewStudents(c.env.DB, input));
});
app.post("/api/admin/import/students/commit", async (c) => {
  const input = importSchema.parse(await body(c, REQUEST_LIMITS.import));
  const rows = await previewStudents(c.env.DB, input);
  if (rows.some((r) => r.status === "error"))
    fail("Исправьте ошибки в файле перед импортом.");
  const db = c.env.DB,
    credentials: {
      name: string;
      login: string;
      password: string;
      group: string;
    }[] = [],
    existing = new Map(
      (
        await all<{ id: string; login: string; role: string }>(
          db,
          "SELECT id,login,role FROM users",
        )
      ).map((u) => [normalizeLogin(u.login), u]),
    );
  const createRows: any[] = [],
    updateRows: any[] = [],
    groupRows: any[] = [];
  const issuedPasswords = new Set<string>(rows.map(item => (item.data as z.infer<typeof importRow>).password).filter(password => password.length > 0 && password !== 'Авто'));
  let skipped = 0;
  for (const item of rows) {
    if (item.status === "skip") {
      skipped++;
      continue;
    }
    const r = item.data as z.infer<typeof importRow>;
    if (r.group && !groupRows.some((g) => g.name === r.group))
      groupRows.push({ id: crypto.randomUUID(), name: r.group });
    const loginKey = normalizeLogin(r.login);
    const account = existing.get(loginKey);
    if (account) {
      if (account.role !== "student")
        fail("Импорт не может изменять аккаунты администраторов.");
      updateRows.push({ id: account.id, name: r.name, login: r.login, group: r.group });
    } else {
      const password =
        r.password && r.password !== "Авто" ? r.password : uniquePassword(issuedPasswords);
      createRows.push({
        id: crypto.randomUUID(),
        name: r.name,
        login: r.login,
        login_key: loginKey,
        password,
        temporary: 1,
        group: r.group,
      });
      credentials.push({
        name: r.name,
        login: r.login,
        password,
        group: r.group,
      });
    }
  }
  const hashedRows = await mapConcurrent(createRows, async row => {
    const { password, ...persisted } = row;
    return { ...persisted, hash: await hashPassword(password) };
  });
  // JSON row sets keep a 500-student import inside the Free plan query limit.
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO groups(id,name,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),? FROM json_each(?) WHERE 1 ON CONFLICT(name) DO NOTHING",
      )
      .bind(now(), JSON.stringify(groupRows)),
    db
      .prepare(
        "INSERT INTO users(id,name,login,login_key,password_hash,must_change_password,role,group_id,created_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.login'),json_extract(value,'$.login_key'),json_extract(value,'$.hash'),CAST(json_extract(value,'$.temporary') AS INTEGER),'student',(SELECT id FROM groups WHERE name=json_extract(value,'$.group')),? FROM json_each(?) WHERE 1 ON CONFLICT DO NOTHING RETURNING login",
      )
      .bind(now(), JSON.stringify(hashedRows)),
    db
      .prepare(
        "UPDATE users SET name=(SELECT json_extract(value,'$.name') FROM json_each(?) WHERE json_extract(value,'$.id')=users.id),group_id=(SELECT g.id FROM json_each(?) j JOIN groups g ON g.name=json_extract(j.value,'$.group') WHERE json_extract(j.value,'$.id')=users.id) WHERE role='student' AND id IN(SELECT json_extract(value,'$.id') FROM json_each(?))",
      )
      .bind(
        JSON.stringify(updateRows),
        JSON.stringify(updateRows),
        JSON.stringify(updateRows),
      ),
  ]);
  const created = new Set(result[1].results.map((r: any) => r.login));
  const issued = credentials.filter((r) => created.has(r.login));
  skipped += credentials.length - issued.length;
  const updated = result[2].meta.changes;
  await audit(
    db,
    c.get("user"),
    "students.import",
    `Создано: ${issued.length}; обновлено: ${updated}; пропущено: ${skipped}`,
  );
  return c.json({
    created: issued.length,
    updated,
    skipped,
    credentials: issued,
  });
});
const bankImportSchema = z.object({
  test_id: z.string(),
  rows: z.array(z.unknown()).min(1).max(500),
});
async function previewQuestions(
  db: D1Database,
  input: z.infer<typeof bankImportSchema>,
) {
  const hashes = new Set(
    (
      await all<{ content_hash: string }>(
        db,
        "SELECT content_hash FROM questions WHERE test_id=?",
        input.test_id,
      )
    ).map((q) => q.content_hash),
  );
  const rows = [];
  for (let i = 0; i < input.rows.length; i++) {
    const parsed = questionSchema.safeParse({
      ...(input.rows[i] as any),
      test_id: input.test_id,
    });
    if (!parsed.success) {
      rows.push({
        row: i + 2,
        status: "error",
        errors: parsed.error.issues.map((e) => e.message).join("; "),
        data: input.rows[i],
      });
      continue;
    }
    const hash = await questionHash(parsed.data);
    const status = hashes.has(hash) ? "skip" : "create";
    hashes.add(hash);
    rows.push({ row: i + 2, status, errors: "", data: parsed.data, hash });
  }
  return rows;
}
app.post("/api/admin/import/questions/preview", async (c) =>
  c.json(
    await previewQuestions(
      c.env.DB,
      bankImportSchema.parse(await body(c, REQUEST_LIMITS.import)),
    ),
  ),
);
app.post("/api/admin/import/questions/commit", async (c) => {
  const input = bankImportSchema.parse(await body(c, REQUEST_LIMITS.import));
  const rows = await previewQuestions(c.env.DB, input);
  if (rows.some((r) => r.status === "error")) fail("Исправьте ошибки в файле.");
  const prepared = rows
    .filter((r) => r.status === "create")
    .map((r) => {
      const q = r.data as z.infer<typeof questionSchema>;
      return {
        id: crypto.randomUUID(),
        text: q.text,
        options: JSON.stringify(q.options),
        correct: q.correct_id,
        hash: r.hash,
      };
    });
  const result = await c.env.DB.prepare(
    "INSERT INTO questions(id,test_id,text,options_json,correct_id,content_hash,created_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.text'),json_extract(value,'$.options'),json_extract(value,'$.correct'),json_extract(value,'$.hash'),? FROM json_each(?) WHERE 1 ON CONFLICT(test_id,content_hash) DO NOTHING",
  )
    .bind(input.test_id, now(), JSON.stringify(prepared))
    .run();
  await audit(
    c.env.DB,
    c.get("user"),
    "questions.import",
    `Вопросов: ${result.meta.changes}`,
  );
  return c.json({
    created: result.meta.changes,
    skipped: rows.length - result.meta.changes,
  });
});
app.post("/api/admin/import/assignments/preview", async (c) => {
  const input = z
    .object({ logins: z.array(z.string()).min(1).max(500) })
    .parse(await body(c));
  const found = await all<{ id: string; login: string; name: string }>(
    c.env.DB,
    "SELECT id,login,name FROM users WHERE role='student'",
  );
  return c.json(
    [...new Set(input.logins.map(normalizeLogin))].map(
      (login) => ({
        login,
        user: found.find((u) => normalizeLogin(u.login) === login) || null,
      }),
    ),
  );
});

app.post("/api/admin/students/bulk", async (c) => {
  const input = z
    .object({
      ids: z.array(z.string()).min(1).max(500),
      group_id: z.string().nullable(),
    })
    .parse(await body(c));
  if (
    input.group_id &&
    !(await c.env.DB.prepare("SELECT id FROM groups WHERE id=?")
      .bind(input.group_id)
      .first())
  )
    fail("Группа не найдена.");
  await c.env.DB.prepare(
    "UPDATE users SET group_id=? WHERE role='student' AND id IN(SELECT value FROM json_each(?))",
  )
    .bind(input.group_id, JSON.stringify([...new Set(input.ids)]))
    .run();
  await audit(
    c.env.DB,
    c.get("user"),
    "students.move",
    `Студентов: ${input.ids.length}`,
  );
  return c.json({ ok: true });
});
async function pdfResponse(c: any, row: AttemptRecord) {
  if (row.status === "active") fail("Документ доступен после завершения.", 409);
  const settings = Object.fromEntries(
    (await all<any>(c.env.DB, "SELECT key,value FROM settings")).map(
      (s: any) => [s.key, s.value],
    ),
  );
  const font = await c.env.ASSETS.fetch(
    new URL("/fonts/Roboto-Regular.ttf", c.req.url),
  );
  if (!font.ok) throw new Error("PDF font unavailable");
  const bytes = await certificatePdf(
    row,
    settings.academy_name || "Академия финансов",
    await font.arrayBuffer(),
    settings.timezone || "Asia/Almaty",
  );
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="FinanceAcademy-${row.id.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
app.get("/api/admin/attempts/:id/certificate", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM attempts WHERE id=?")
    .bind(c.req.param("id"))
    .first<AttemptRecord>();
  if (!row) fail("Попытка не найдена.", 404);
  return pdfResponse(
    c,
    await finalize(c.env.DB, row.id, undefined, undefined, row),
  );
});
app.get("/api/student/attempts/:id/certificate", async (c) => {
  const row = await owned(c);
  if (!row.show_result) fail("Документ скрыт настройками теста.", 403);
  return pdfResponse(
    c,
    await finalize(c.env.DB, row.id, undefined, undefined, row),
  );
});

app.notFound((c) => c.json({ error: "Маршрут не найден." }, 404));
app.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json(
      { error: error.issues.map((i) => i.message).join("; ") },
      400,
    );
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  if (error.message.includes("UNIQUE constraint"))
    return c.json(
      {
        error:
          "Такая запись уже существует. Проверьте логин, название или дубликат вопроса.",
      },
      409,
    );
  if (error.message.includes("FOREIGN KEY constraint"))
    return c.json(
      { error: "Связанная запись не найдена. Обновите страницу." },
      400,
    );
  if (
    error.message.startsWith("Ответ ") ||
    error.message.startsWith("Попытка открыта") ||
    error.message.startsWith("Ответы изменяются")
  )
    return c.json({ error: error.message }, 409);
  console.error("API failure", error.message);
  if (error.message.includes("free tier daily") || error.message.includes("D1's free tier")) {
    const time = new Date();
    const reset = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate() + 1);
    c.header("Retry-After", String(Math.ceil((reset - time.getTime()) / 1000)));
    return c.json({ error: "Сервис временно недоступен. Попробуйте позже или обратитесь к администратору." }, 503);
  }
  return c.json(
    { error: "Не удалось выполнить операцию. Повторите запрос." },
    500,
  );
});
export default app;
